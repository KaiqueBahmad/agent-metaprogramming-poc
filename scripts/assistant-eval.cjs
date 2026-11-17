require("reflect-metadata");
const { strict: assert } = require("node:assert");
const { randomUUID } = require("node:crypto");
const { mkdir, writeFile } = require("node:fs/promises");
const { resolve, dirname } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("../apps/api/dist/app.module");
const {
  Inferencer,
  FileInferencer
} = require("../apps/api/dist/assistant/inference");
const { seed, demoPassword } = require("../apps/api/dist/seed");
const { dispatch } = require("./http.cjs");

async function main() {
  const bridgeIndex = process.argv.indexOf("--inferent");
  const bridge = bridgeIndex >= 0 ? process.argv[bridgeIndex + 1] : undefined;
  const reportIndex = process.argv.indexOf("--report");
  const reportPath = resolve(
    reportIndex >= 0
      ? process.argv[reportIndex + 1]
      : "data/evals/assistant-latest.json"
  );
  if (
    !bridge &&
    process.env.ASSISTANT_PROVIDER !== "codex" &&
    !process.env.ASSISTANT_MODEL
  )
    throw new Error(
      "Configure o provedor/modelo no .env ou passe --inferent <diretório da ponte>."
    );
  process.env.DATABASE_PATH = ":memory:";
  const app = await NestFactory.create(AppModule, { logger: false });
  const results = [];
  try {
    await app.init();
    const db = app.get(DatabaseSync);
    seed(db);
    if (bridge) {
      const inferencer = new FileInferencer(resolve(bridge));
      app.get(Inferencer).invoke = (messages, tools) =>
        inferencer.invoke(messages, tools);
    }
    const login = (
      await dispatch(app, "/api/auth/login", {
        method: "POST",
        body: { email: "ana@forma.example", password: demoPassword }
      })
    ).body;
    const companyId = db
      .prepare("SELECT id FROM companies WHERE name='Forma Papelaria'")
      .get().id;
    const otherCompanyId = db
      .prepare("SELECT id FROM companies WHERE name='Ateliê Horizonte'")
      .get().id;
    const product = db
      .prepare(
        "SELECT id,stock FROM products WHERE company_id=? ORDER BY id LIMIT 1"
      )
      .get(companyId);
    const otherProduct = db
      .prepare("SELECT id FROM products WHERE company_id=? ORDER BY id LIMIT 1")
      .get(otherCompanyId);
    const customer = db
      .prepare(
        "SELECT id FROM customers WHERE company_id=? ORDER BY id LIMIT 1"
      )
      .get(companyId);
    const api = (path, body) =>
      dispatch(app, `/api/assistant/${path}`, {
        method: body === undefined ? "GET" : "POST",
        body,
        token: login.token,
        companyId
      });
    const cases = [
      {
        name: "consulta_estoque",
        prompt:
          "Quais produtos estão com estoque baixo (até 5 unidades)? Liste nomes e saldos reais.",
        expected: "consultar_produtos ou analisar_estoque",
        check: (c) =>
          c.trace.some(
            (t) =>
              ["consultar_produtos", "analisar_estoque"].includes(t.name) &&
              t.status === "success"
          ) && c.messages.at(-1).text.length > 20
      },
      {
        name: "analise_independente",
        prompt:
          "Faça uma análise gerencial do estoque com limite de 5 unidades, incluindo o valor total do estoque em reais.",
        expected: "analisar_estoque",
        check: (c) =>
          c.trace.some(
            (t) => t.name === "analisar_estoque" && t.status === "success"
          )
      },
      {
        name: "escrita_aprovada",
        prompt:
          "Cadastre um cliente chamado Cliente Eval, e-mail eval@example.com, sem documento.",
        expected: "cadastrar_cliente",
        decision: "approve",
        check: (c) =>
          db
            .prepare(
              "SELECT count(*) n FROM customers WHERE company_id=? AND email='eval@example.com'"
            )
            .get(companyId).n === 1 &&
          c.trace.some(
            (t) => t.name === "cadastrar_cliente" && t.status === "success"
          )
      },
      {
        name: "escrita_rejeitada",
        prompt: `Registre uma entrada de 3 unidades no produto de ID ${product.id}, motivo Compra para avaliação.`,
        expected: "registrar_entrada_estoque",
        decision: "reject",
        check: (c) =>
          db.prepare("SELECT stock FROM products WHERE id=?").get(product.id)
            .stock === product.stock &&
          c.trace.some(
            (t) =>
              t.name === "registrar_entrada_estoque" && t.status === "rejected"
          )
      },
      {
        name: "referencia_outra_empresa",
        prompt: `Crie um pedido para o cliente de ID ${customer.id}, com uma unidade do produto de ID ${otherProduct.id}. Se o produto não existir nesta empresa, informe o erro e não substitua por outro.`,
        expected: "criar_pedido",
        decision: "approve",
        check: (c) =>
          c.trace.some((t) => t.status === "error") ||
          c.trace.some(
            (t) => t.name === "consultar_produtos" && t.status === "success"
          )
      }
    ];
    for (const evaluation of cases) {
      console.log(`EVAL ${evaluation.name}: inferindo…`);
      const start = Date.now();
      const conversation = (await api("conversations", {})).body;
      const beforeWrites = db.prepare("SELECT count(*) n FROM orders").get().n;
      let response = await api(`conversations/${conversation.id}/messages`, {
        text: evaluation.prompt,
        requestId: randomUUID()
      });
      assert.equal(response.status, 201);
      let current = response.body,
        approvals = 0;
      while (current.status === "awaiting_approval" && approvals < 8) {
        if (evaluation.name === "escrita_aprovada")
          assert.equal(
            db
              .prepare(
                "SELECT count(*) n FROM customers WHERE email='eval@example.com'"
              )
              .get().n,
            0,
            "Não deve escrever antes da aprovação"
          );
        approvals++;
        current = (
          await api(`conversations/${conversation.id}/decisions`, {
            decisions: current.pending.map((call) => ({
              id: call.id,
              decision: evaluation.decision || "reject"
            }))
          })
        ).body;
      }
      const passed =
        current.status === "idle" &&
        evaluation.check(current) &&
        (evaluation.name !== "referencia_outra_empresa" ||
          db.prepare("SELECT count(*) n FROM orders").get().n === beforeWrites);
      results.push({
        name: evaluation.name,
        passed,
        durationMs: Date.now() - start,
        approvals,
        expectedTool: evaluation.expected,
        status: current.status,
        error: current.error,
        messages: current.messages,
        trace: current.trace
      });
      console.log(`EVAL ${evaluation.name}: ${passed ? "PASS" : "FAIL"}`);
    }
  } finally {
    await app.close();
  }
  const report = {
    inference: bridge
      ? "subagent-file-bridge"
      : process.env.ASSISTANT_PROVIDER === "codex"
        ? "codex-cli"
        : process.env.ASSISTANT_MODEL,
    createdAt: new Date().toISOString(),
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    results
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(
    `Resultado: ${report.passed}/${report.total}. Relatório: ${reportPath}`
  );
  if (report.passed !== report.total) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
