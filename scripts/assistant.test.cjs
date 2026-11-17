require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { NestFactory } = require("@nestjs/core");
const { AIMessage } = require("@langchain/core/messages");
const { AppModule } = require("../apps/api/dist/app.module");
const {
  Inferencer,
  LangChainInferencer
} = require("../apps/api/dist/assistant/inference");
const { ToolCatalog } = require("../apps/api/dist/assistant/catalog");
const { ChatStore } = require("../apps/api/dist/assistant/store");
const { seed, demoPassword } = require("../apps/api/dist/seed");
const { dispatch } = require("./http.cjs");
const call = (name, args) =>
  new AIMessage({
    content: "",
    tool_calls: [{ id: randomUUID(), name, args }]
  });
const group = (name) => call("consultar_grupo", { grupo: name });

test("assistente: inferência, ferramentas, aprovações e isolamento pelo pipeline real", async (t) => {
  process.env.DATABASE_PATH = ":memory:";
  const app = await NestFactory.create(AppModule, { logger: false });
  const observedOrigins = [];
  app.useGlobalInterceptors({
    intercept(context, next) {
      const req = context.switchToHttp().getRequest();
      if (req.origin === "agent") observedOrigins.push(req.url);
      return next.handle();
    }
  });
  try {
    await app.init();
    const db = app.get(DatabaseSync);
    seed(db);
    const login = async (email) =>
      (
        await dispatch(app, "/api/auth/login", {
          method: "POST",
          body: { email, password: demoPassword }
        })
      ).body.token;
    const ana = await login("ana@forma.example"),
      bruno = await login("bruno@forma.example"),
      carla = await login("carla@forma.example");
    const companies = (await dispatch(app, "/api/companies", { token: ana }))
      .body;
    const companyId = companies.find((c) => c.name === "Forma Papelaria").id;
    const otherId = companies.find((c) => c.name === "Ateliê Horizonte").id;
    const api = (path, body, token = ana, scope = companyId) =>
      dispatch(app, `/api/assistant/${path}`, {
        method: body === undefined ? "GET" : "POST",
        body,
        token,
        companyId: scope
      });
    const create = async () => (await api("conversations", {})).body;
    const send = (
      id,
      text = "Consultar indicadores",
      requestId = randomUUID()
    ) => api(`conversations/${id}/messages`, { text, requestId });
    const decide = (id, pending, decision = "approve") =>
      api(`conversations/${id}/decisions`, {
        decisions: pending.map((item) => ({ id: item.id, decision }))
      });
    let responses = [],
      invocations = [];
    app.get(Inferencer).invoke = async (messages, tools, model) => {
      assert.ok(
        !JSON.stringify(messages).includes(ana),
        "token privado fora das mensagens"
      );
      assert.ok(!JSON.stringify(tools).includes(ana));
      invocations.push({ messages, tools, model });
      const response = responses.shift();
      assert.ok(response, "inferência inesperada");
      return typeof response === "function"
        ? response(messages, tools)
        : response;
    };
    await t.test(
      "catálogo filtrado; auth, usuários e o próprio chat não viram ferramentas",
      async () => {
        assert.equal(
          (await api("conversations", undefined, undefined, otherId)).status,
          200
        );
        assert.equal(
          (await api("conversations", undefined, carla, otherId)).status,
          403
        );
        const ownerGroups = (await api("groups")).body;
        assert.ok(ownerGroups.some((g) => g.name === "analises"));
        assert.ok(
          !(await api("groups", undefined, bruno)).body.some(
            (g) => g.name === "analises"
          )
        );
        const names = app
          .get(ToolCatalog)
          .tools({ token: ana, companyId })
          .map((tool) => tool.name);
        assert.ok(!names.includes("login") && !names.includes("send"));
        assert.equal(
          (await dispatch(app, "/api/assistant/conversations")).status,
          401
        );
      }
    );
    await t.test(
      "descoberta progressiva e consulta HTTP com origem confiável",
      async () => {
        const c = await create();
        invocations = [];
        responses = [
          group("indicadores"),
          call("consultar_indicadores", {}),
          new AIMessage("Resumo consultado.")
        ];
        const result = (await send(c.id)).body;
        assert.equal(result.status, "idle");
        assert.equal(result.trace.length, 2);
        assert.deepEqual(
          invocations[0].tools.map((tool) => tool.name),
          ["consultar_grupo"]
        );
        assert.ok(
          invocations[1].tools.some(
            (tool) => tool.name === "consultar_indicadores"
          )
        );
        assert.ok(
          observedOrigins.includes("/api/dashboard"),
          JSON.stringify(result.trace)
        );
        assert.ok(!("internal" in result) && !("requests" in result));
        assert.equal(
          (await api(`conversations/${c.id}`, undefined, bruno)).status,
          404
        );
        assert.equal(
          (await api(`conversations/${c.id}`, undefined, ana, otherId)).status,
          404
        );
      }
    );
    await t.test(
      "escrita espera aprovação, executa uma vez e rejeita replay",
      async () => {
        const c = await create(),
          count = db.prepare("SELECT count(*) n FROM customers").get().n;
        const requestId = randomUUID();
        responses = [
          group("clientes"),
          call("cadastrar_cliente", { name: "Cliente aprovado" }),
          new AIMessage("Cliente cadastrado.")
        ];
        const pending = (
          await send(c.id, "Cadastre Cliente aprovado", requestId)
        ).body;
        assert.equal(pending.status, "awaiting_approval");
        assert.equal(pending.pending.length, 1);
        assert.equal(
          pending.pending[0].approvalMessage,
          "Cadastrar o cliente “Cliente aprovado”. Sem e-mail. Sem documento."
        );
        assert.equal(
          (await api(`conversations/${c.id}`)).body.pending[0].approvalMessage,
          pending.pending[0].approvalMessage
        );
        assert.equal(
          db.prepare("SELECT count(*) n FROM customers").get().n,
          count
        );
        assert.equal(
          (await send(c.id, "Cadastre Cliente aprovado", requestId)).body
            .pending[0].id,
          pending.pending[0].id
        );
        const result = (await decide(c.id, pending.pending)).body;
        assert.equal(result.status, "idle");
        assert.equal(
          db.prepare("SELECT count(*) n FROM customers").get().n,
          count + 1,
          JSON.stringify(result.trace)
        );
        assert.equal((await decide(c.id, pending.pending)).status, 409);
        await send(c.id, "Cadastre Cliente aprovado", requestId);
        assert.equal(
          db.prepare("SELECT count(*) n FROM customers").get().n,
          count + 1,
          JSON.stringify(result.trace)
        );
      }
    );
    await t.test(
      "rejeição não executa e leituras também podem exigir aprovação",
      async () => {
        const c = await create();
        await api(`conversations/${c.id}/update`, { policy: "none" });
        responses = [
          group("indicadores"),
          call("consultar_indicadores", {}),
          new AIMessage("Consulta rejeitada.")
        ];
        const pending = (await send(c.id)).body;
        assert.equal(pending.pending[0].effect, "read");
        assert.equal(
          (await api(`conversations/${c.id}/update`, { policy: "all" })).status,
          409
        );
        const result = (await decide(c.id, pending.pending, "reject")).body;
        assert.equal(result.trace.at(-1).status, "rejected");
      }
    );
    await t.test(
      "autorização própria, validação estrita e erros de ferramenta",
      async () => {
        const c = await create();
        responses = [
          group("analises"),
          call("analisar_estoque", { limite: 5 }),
          new AIMessage("Estoque analisado.")
        ];
        const result = (await send(c.id, "Analise o estoque")).body;
        assert.equal(result.trace.at(-1).status, "success");
        assert.equal(
          typeof result.trace.at(-1).output.valorEmCentavos,
          "number"
        );
        responses = [
          group("clientes"),
          call("cadastrar_cliente", { name: "Invasão", companyId: otherId }),
          new AIMessage("Argumentos inválidos.")
        ];
        const invalid = (await send(c.id, "Tente usar outra empresa")).body;
        assert.equal(invalid.status, "idle");
        assert.equal(invalid.trace.at(-1).status, "error");
        assert.equal(
          db
            .prepare("SELECT count(*) n FROM customers WHERE name='Invasão'")
            .get().n,
          0
        );
        responses = [
          call("ferramenta_inventada", {}),
          new AIMessage("Ferramenta indisponível.")
        ];
        assert.equal((await send(c.id)).body.trace.at(-1).status, "error");
      }
    );
    await t.test(
      "authorize da action independente é aplicado mesmo após descoberta",
      async () => {
        const c = await create();
        const entry = app
          .get(ToolCatalog)
          .definition("analisar_estoque", { token: ana, companyId });
        const original = entry.authorize;
        try {
          entry.authorize = () => false;
          responses = [
            group("analises"),
            call("analisar_estoque", { limite: 5 }),
            new AIMessage("Análise não autorizada.")
          ];
          const result = (await send(c.id)).body;
          assert.equal(result.trace.at(-1).status, "error");
          assert.equal(
            result.trace.at(-1).output.message,
            "Ação não autorizada."
          );
        } finally {
          entry.authorize = original;
        }
      }
    );
    await t.test(
      "aprovação automática não repete a mesma escrita no mesmo turno",
      async () => {
        const c = await create();
        await api(`conversations/${c.id}/update`, { policy: "all" });
        responses = [
          group("clientes"),
          call("cadastrar_cliente", { name: "Cliente único" }),
          call("cadastrar_cliente", { name: "Cliente único" }),
          new AIMessage("Cliente cadastrado uma única vez.")
        ];
        const result = (await send(c.id, "Cadastre Cliente único")).body;
        assert.equal(result.status, "idle");
        assert.equal(result.pending.length, 0);
        assert.equal(result.trace.at(-1).output.duplicate, true);
        assert.equal(
          db
            .prepare(
              "SELECT count(*) n FROM customers WHERE name='Cliente único'"
            )
            .get().n,
          1
        );
      }
    );
    await t.test(
      "pipe e regras de negócio rejeitam referências de outra empresa",
      async () => {
        const c = await create();
        const customer = db
          .prepare("SELECT id FROM customers WHERE company_id=? LIMIT 1")
          .get(companyId);
        const product = db
          .prepare("SELECT id FROM products WHERE company_id=? LIMIT 1")
          .get(otherId);
        responses = [
          group("pedidos"),
          call("criar_pedido", {
            customerId: customer.id,
            items: [{ productId: product.id, quantity: 1 }]
          }),
          new AIMessage("Produto não encontrado nesta empresa.")
        ];
        const pending = (await send(c.id, "Crie o pedido")).body;
        const result = (await decide(c.id, pending.pending)).body;
        assert.equal(result.trace.at(-1).output.status, 400);
      }
    );
    await t.test(
      "serializa solicitações simultâneas da mesma conversa",
      async () => {
        const c = await create();
        let release, entered;
        const waiting = new Promise((resolve) => {
          entered = resolve;
        });
        responses = [
          () => {
            entered();
            return new Promise((resolve) => {
              release = resolve;
            });
          }
        ];
        const first = send(c.id);
        await waiting;
        try {
          assert.equal((await send(c.id, "Outra solicitação")).status, 409);
        } finally {
          release(new AIMessage("Concluído."));
        }
        assert.equal((await first).body.status, "idle");
      }
    );
    await t.test("revalida sessão e vínculo após aprovação", async () => {
      const c = (await api("conversations", {}, carla)).body;
      responses = [
        group("clientes"),
        call("cadastrar_cliente", { name: "Não autorizado" })
      ];
      const pending = (
        await api(
          `conversations/${c.id}/messages`,
          { text: "Cadastre Não autorizado", requestId: randomUUID() },
          carla
        )
      ).body;
      assert.equal(pending.status, "awaiting_approval");
      const userId = db
        .prepare("SELECT id FROM users WHERE email=?")
        .get("carla@forma.example").id;
      db.prepare(
        "DELETE FROM memberships WHERE user_id=? AND company_id=?"
      ).run(userId, companyId);
      assert.equal(
        (
          await api(
            `conversations/${c.id}/decisions`,
            { decisions: [{ id: pending.pending[0].id, decision: "approve" }] },
            carla
          )
        ).status,
        403
      );
      assert.equal(
        db
          .prepare(
            "SELECT count(*) n FROM customers WHERE name='Não autorizado'"
          )
          .get().n,
        0
      );
    });
    await t.test(
      "falha de inferência permite retomar sem duplicar a mensagem",
      async () => {
        const c = await create();
        responses = [
          () => {
            throw new Error("segredo do provedor");
          }
        ];
        const failed = (await send(c.id)).body;
        assert.equal(failed.status, "error");
        assert.ok(!failed.error.includes("segredo"));
        responses = [new AIMessage("Podemos continuar.")];
        const resumed = (await api(`conversations/${c.id}/retry`, {})).body;
        assert.equal(resumed.status, "idle");
        assert.equal(
          resumed.messages.filter((m) => m.role === "user").length,
          1
        );
      }
    );
    await t.test(
      "adaptador Bedrock resolve credenciais AWS e converte tools/tool calls",
      async () => {
        const {
          BedrockRuntimeClient,
          ConverseCommand
        } = require("@aws-sdk/client-bedrock-runtime");
        const originalSend = BedrockRuntimeClient.prototype.send;
        const keys = [
          "ASSISTANT_PROVIDER",
          "ASSISTANT_MODEL",
          "AWS_REGION",
          "AWS_DEFAULT_REGION",
          "AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY",
          "AWS_SESSION_TOKEN",
          "AWS_PROFILE",
          "AWS_BEARER_TOKEN_BEDROCK",
          "BEDROCK_AWS_ACCESS_KEY_ID",
          "BEDROCK_AWS_SECRET_ACCESS_KEY",
          "BEDROCK_AWS_SESSION_TOKEN"
        ];
        const previous = Object.fromEntries(
          keys.map((key) => [key, process.env[key]])
        );
        let requestBody,
          expectedRegion = "us-east-1";
        try {
          for (const key of keys) delete process.env[key];
          Object.assign(process.env, {
            ASSISTANT_MODEL: "test.model-v1:0",
            AWS_REGION: expectedRegion,
            AWS_ACCESS_KEY_ID: "test-access-key",
            AWS_SECRET_ACCESS_KEY: "test-secret-key",
            AWS_SESSION_TOKEN: "test-session-token"
          });
          BedrockRuntimeClient.prototype.send = async function (
            command,
            options
          ) {
            assert.ok(command instanceof ConverseCommand);
            assert.ok(options.abortSignal);
            assert.equal(await this.config.region(), expectedRegion);
            const credentials = await this.config.credentials();
            assert.equal(credentials.accessKeyId, "test-access-key");
            assert.equal(credentials.secretAccessKey, "test-secret-key");
            assert.equal(credentials.sessionToken, "test-session-token");
            requestBody = command.input;
            return {
              output: {
                message: {
                  role: "assistant",
                  content: [
                    {
                      toolUse: {
                        toolUseId: "bedrock-call",
                        name: "consultar_indicadores",
                        input: {}
                      }
                    }
                  ]
                }
              },
              stopReason: "tool_use",
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              metrics: { latencyMs: 1 },
              $metadata: {}
            };
          };
          const { HumanMessage } = require("@langchain/core/messages");
          const { z } = require("zod");
          const invoke = () =>
            new LangChainInferencer().invoke(
              [new HumanMessage("Resumo da operação")],
              [
                {
                  name: "consultar_indicadores",
                  description: "Consulta indicadores",
                  schema: z.object({})
                }
              ]
            );
          const response = await invoke();
          assert.equal(requestBody.modelId, "test.model-v1:0");
          assert.equal(
            requestBody.toolConfig.tools[0].toolSpec.name,
            "consultar_indicadores"
          );
          assert.equal(
            requestBody.toolConfig.tools[0].toolSpec.inputSchema.json.type,
            "object"
          );
          assert.equal(response.tool_calls[0].name, "consultar_indicadores");
          assert.deepEqual(response.tool_calls[0].args, {});
          for (const value of [
            "test-access-key",
            "test-secret-key",
            "test-session-token"
          ])
            assert.ok(!JSON.stringify(requestBody).includes(value));
          delete process.env.AWS_REGION;
          expectedRegion = process.env.AWS_DEFAULT_REGION = "us-west-2";
          await invoke();
        } finally {
          BedrockRuntimeClient.prototype.send = originalSend;
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
    );
    await t.test(
      "Bedrock aceita profile com região e API key sem credenciais estáticas",
      async () => {
        const {
          BedrockRuntimeClient
        } = require("@aws-sdk/client-bedrock-runtime");
        const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
        const { tmpdir } = require("node:os");
        const { join } = require("node:path");
        const dir = mkdtempSync(join(tmpdir(), "forma-bedrock-"));
        const originalSend = BedrockRuntimeClient.prototype.send;
        const keys = [
          "ASSISTANT_PROVIDER",
          "ASSISTANT_MODEL",
          "AWS_REGION",
          "AWS_DEFAULT_REGION",
          "AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY",
          "AWS_SESSION_TOKEN",
          "AWS_PROFILE",
          "AWS_CONFIG_FILE",
          "AWS_SHARED_CREDENTIALS_FILE",
          "AWS_BEARER_TOKEN_BEDROCK",
          "BEDROCK_AWS_ACCESS_KEY_ID",
          "BEDROCK_AWS_SECRET_ACCESS_KEY",
          "BEDROCK_AWS_SESSION_TOKEN"
        ];
        const previous = Object.fromEntries(
          keys.map((key) => [key, process.env[key]])
        );
        let mode = "profile";
        try {
          for (const key of keys) delete process.env[key];
          writeFileSync(
            join(dir, "config"),
            "[profile eval-profile]\nregion=us-east-2\n"
          );
          writeFileSync(
            join(dir, "credentials"),
            "[eval-profile]\naws_access_key_id=profile-access-key\naws_secret_access_key=profile-secret-key\n"
          );
          Object.assign(process.env, {
            ASSISTANT_MODEL: "test.model-v1:0",
            AWS_PROFILE: "eval-profile",
            AWS_CONFIG_FILE: join(dir, "config"),
            AWS_SHARED_CREDENTIALS_FILE: join(dir, "credentials")
          });
          BedrockRuntimeClient.prototype.send = async function (command) {
            assert.equal(await this.config.region(), "us-east-2");
            if (mode === "profile") {
              const credentials = await this.config.credentials();
              assert.equal(credentials.accessKeyId, "profile-access-key");
              assert.equal(credentials.secretAccessKey, "profile-secret-key");
            } else {
              assert.equal(
                (await this.config.token()).token,
                "test-bedrock-bearer"
              );
            }
            assert.ok(
              !JSON.stringify(command.input).includes("profile-secret-key")
            );
            assert.ok(
              !JSON.stringify(command.input).includes("test-bedrock-bearer")
            );
            return {
              output: {
                message: { role: "assistant", content: [{ text: "Pronto." }] }
              },
              stopReason: "end_turn",
              usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
              $metadata: {}
            };
          };
          const { HumanMessage } = require("@langchain/core/messages");
          const invoke = () =>
            new LangChainInferencer().invoke([new HumanMessage("Olá")], []);
          assert.equal((await invoke()).content, "Pronto.");
          mode = "bearer";
          delete process.env.AWS_PROFILE;
          process.env.AWS_REGION = "us-east-2";
          process.env.AWS_BEARER_TOKEN_BEDROCK = "test-bedrock-bearer";
          assert.equal((await invoke()).content, "Pronto.");
        } finally {
          BedrockRuntimeClient.prototype.send = originalSend;
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
          rmSync(dir, { recursive: true, force: true });
        }
      }
    );
    await t.test(
      "provedor openai funciona sem credenciais AWS e rejeita provedor inválido",
      async () => {
        const originalFetch = globalThis.fetch;
        const keys = [
          "ASSISTANT_PROVIDER",
          "ASSISTANT_MODEL",
          "ASSISTANT_API_KEY",
          "ASSISTANT_BASE_URL",
          "AWS_REGION",
          "AWS_DEFAULT_REGION",
          "AWS_PROFILE",
          "AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY",
          "AWS_SESSION_TOKEN",
          "AWS_BEARER_TOKEN_BEDROCK"
        ];
        const previous = Object.fromEntries(
          keys.map((key) => [key, process.env[key]])
        );
        let requestBody;
        try {
          for (const key of keys) delete process.env[key];
          Object.assign(process.env, {
            ASSISTANT_PROVIDER: "openai",
            ASSISTANT_MODEL: "external-test-model",
            ASSISTANT_API_KEY: "test-key",
            ASSISTANT_BASE_URL: "https://model.example/v1"
          });
          globalThis.fetch = async (_url, options) => {
            requestBody = JSON.parse(options.body);
            return new Response(
              JSON.stringify({
                id: "completion-test",
                object: "chat.completion",
                created: 1,
                model: "external-test-model",
                choices: [
                  {
                    index: 0,
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "external-call",
                          type: "function",
                          function: {
                            name: "consultar_indicadores",
                            arguments: "{}"
                          }
                        }
                      ]
                    }
                  }
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 5,
                  total_tokens: 15
                }
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          };
          const { HumanMessage } = require("@langchain/core/messages");
          const { z } = require("zod");
          const invoke = () =>
            new LangChainInferencer().invoke(
              [new HumanMessage("Resumo")],
              [
                {
                  name: "consultar_indicadores",
                  description: "Consulta indicadores",
                  schema: z.object({})
                }
              ]
            );
          const response = await invoke();
          assert.equal(requestBody.model, "external-test-model");
          assert.equal(response.tool_calls[0].name, "consultar_indicadores");
          assert.ok(!JSON.stringify(requestBody).includes("test-key"));
          process.env.ASSISTANT_PROVIDER = "invalido";
          await assert.rejects(invoke, /ASSISTANT_PROVIDER deve ser/);
          process.env.ASSISTANT_PROVIDER = "openai";
          delete process.env.ASSISTANT_API_KEY;
          await assert.rejects(invoke, /ASSISTANT_API_KEY/);
        } finally {
          globalThis.fetch = originalFetch;
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
    );
    await t.test(
      "falha AWS chega ao chat com diagnóstico e permite retomar",
      async () => {
        const {
          inferenceFailure
        } = require("../apps/api/dist/assistant/inference-errors");
        const c = await create();
        responses = [
          () => {
            throw inferenceFailure(
              Object.assign(
                new Error(
                  "The security token included in the request is invalid."
                ),
                { name: "UnrecognizedClientException" }
              ),
              "bedrock"
            );
          }
        ];
        const failed = (await send(c.id)).body;
        assert.equal(failed.status, "error");
        assert.match(failed.error, /AWS recusou as credenciais/);
        assert.match(failed.error, /AWS_SESSION_TOKEN/);
        assert.equal(failed.trace.length, 0);
        responses = [new AIMessage("Bom dia!")];
        assert.equal(
          (await api(`conversations/${c.id}/retry`, {})).body.status,
          "idle"
        );
      }
    );
    await t.test(
      "adaptador converte erro real do SDK sem expor credenciais",
      async () => {
        const {
          BedrockRuntimeClient
        } = require("@aws-sdk/client-bedrock-runtime");
        const originalSend = BedrockRuntimeClient.prototype.send;
        const keys = [
          "ASSISTANT_PROVIDER",
          "ASSISTANT_MODEL",
          "AWS_REGION",
          "AWS_SECRET_ACCESS_KEY"
        ];
        const previous = Object.fromEntries(
          keys.map((key) => [key, process.env[key]])
        );
        try {
          Object.assign(process.env, {
            ASSISTANT_PROVIDER: "bedrock",
            ASSISTANT_MODEL: "test.model-v1:0",
            AWS_REGION: "us-east-1",
            AWS_SECRET_ACCESS_KEY: "test-sensitive-secret"
          });
          BedrockRuntimeClient.prototype.send = async () => {
            throw Object.assign(
              new Error("Invalid request: test-sensitive-secret"),
              {
                name: "ValidationException",
                $metadata: { httpStatusCode: 400, requestId: "test-request" }
              }
            );
          };
          const { HumanMessage } = require("@langchain/core/messages");
          await assert.rejects(
            () =>
              new LangChainInferencer().invoke(
                [new HumanMessage("Bom dia")],
                []
              ),
            (error) => {
              assert.match(error.message, /Bedrock rejeitou/);
              assert.ok(!error.message.includes("test-sensitive-secret"));
              assert.match(error.message, /redigido/);
              return true;
            }
          );
        } finally {
          BedrockRuntimeClient.prototype.send = originalSend;
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
    );
    await t.test(
      "modelo por conversa é validado e enviado ao inferente",
      async () => {
        const keys = [
          "ASSISTANT_PROVIDER",
          "ASSISTANT_MODEL",
          "ASSISTANT_MODELS"
        ];
        const previous = Object.fromEntries(
          keys.map((key) => [key, process.env[key]])
        );
        try {
          Object.assign(process.env, {
            ASSISTANT_PROVIDER: "codex",
            ASSISTANT_MODEL: "gpt-5.6-luna",
            ASSISTANT_MODELS: "gpt-5.6-luna,gpt-6.1-sol"
          });
          const c = await create();
          assert.equal(c.model, "gpt-5.6-luna");
          assert.deepEqual((await api("models")).body.models, [
            "gpt-5.6-luna",
            "gpt-6.1-sol"
          ]);
          assert.equal(
            (
              await api(`conversations/${c.id}/update`, {
                model: "nao-permitido"
              })
            ).status,
            400
          );
          assert.equal(
            (
              await api(`conversations/${c.id}/update`, {
                model: "gpt-6.1-sol"
              })
            ).body.model,
            "gpt-6.1-sol"
          );
          responses = [new AIMessage("Bom dia!")];
          const result = (await send(c.id, "Bom dia")).body;
          assert.equal(result.model, "gpt-6.1-sol");
          assert.equal(invocations.at(-1).model, "gpt-6.1-sol");
          assert.equal(
            (
              await api(`conversations/${c.id}/update`, {
                model: "gpt-5.6-luna"
              })
            ).status,
            409
          );
        } finally {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
    );
    await t.test(
      "Codex propõe ferramentas com modelo legado e sem credenciais do ERP",
      async () => {
        const childProcess = require("node:child_process");
        const { EventEmitter } = require("node:events");
        const { Writable } = require("node:stream");
        const { writeFileSync } = require("node:fs");
        const { HumanMessage } = require("@langchain/core/messages");
        const { z } = require("zod");
        const {
          codexInference
        } = require("../apps/api/dist/assistant/codex-inference");
        const originalSpawn = childProcess.spawn;
        try {
          childProcess.spawn = (command, args, options) => {
            assert.equal(command, "codex");
            assert.equal(args[args.indexOf("--model") + 1], "gpt-5.6-luna");
            assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
            assert.ok(args.includes("--ignore-user-config"));
            assert.equal(options.env.AWS_SECRET_ACCESS_KEY, undefined);
            assert.equal(options.env.ASSISTANT_API_KEY, undefined);
            assert.equal(options.shell, false);
            const child = new EventEmitter();
            child.kill = () => {};
            child.stdin = new Writable({
              write(chunk, encoding, callback) {
                callback();
              },
              final(callback) {
                writeFileSync(
                  args[args.indexOf("--output-last-message") + 1],
                  JSON.stringify({
                    content: "",
                    tool_calls: [
                      {
                        name: "consultar_grupo",
                        arguments_json: '{"grupo":"estoque"}'
                      }
                    ]
                  })
                );
                callback();
                process.nextTick(() => child.emit("close", 0));
              }
            });
            return child;
          };
          const result = await codexInference(
            [new HumanMessage("Veja o estoque")],
            [
              {
                name: "consultar_grupo",
                description: "Carrega grupo",
                schema: z.object({ grupo: z.string() })
              }
            ],
            "gpt-5.6-luna"
          );
          assert.equal(result.tool_calls[0].name, "consultar_grupo");
          assert.deepEqual(result.tool_calls[0].args, { grupo: "estoque" });
          assert.ok(result.tool_calls[0].id);
        } finally {
          childProcess.spawn = originalSpawn;
        }
      }
    );
    await t.test(
      "formatador recebe payload validado e não modifica os argumentos originais",
      async () => {
        const catalog = app.get(ToolCatalog);
        const context = { token: ana, companyId };
        const entry = catalog.definition("cadastrar_cliente", context);
        const original = entry.approvalMessage;
        let calls = 0;
        try {
          entry.approvalMessage = async (input, actor) => {
            calls++;
            assert.equal(input.name, "Cliente normalizado");
            assert.equal(input.email, "");
            assert.equal(actor.companyId, companyId);
            assert.ok(!("token" in actor));
            input.name = "Tentativa de alteração";
            return "Texto personalizado";
          };
          const input = { name: "  Cliente normalizado  " };
          assert.equal(
            await catalog.approvalMessage("cadastrar_cliente", input, context),
            "Texto personalizado"
          );
          assert.deepEqual(input, { name: "  Cliente normalizado  " });
          await assert.rejects(() =>
            catalog.approvalMessage("cadastrar_cliente", { name: "X" }, context)
          );
          assert.equal(calls, 1);
        } finally {
          entry.approvalMessage = original;
        }
      }
    );
    await t.test(
      "aprovações em lote recebem textos antes da pausa e o formatador é opcional",
      async () => {
        const c = await create();
        responses = [
          group("clientes"),
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: randomUUID(),
                name: "cadastrar_cliente",
                args: { name: "Cliente lote A" }
              },
              {
                id: randomUUID(),
                name: "cadastrar_cliente",
                args: { name: "Cliente lote B" }
              }
            ]
          }),
          new AIMessage("Chamadas rejeitadas.")
        ];
        const pending = (await send(c.id, "Cadastre dois clientes")).body;
        assert.equal(pending.pending.length, 2);
        assert.ok(
          pending.pending[0].approvalMessage.includes("Cliente lote A")
        );
        assert.ok(
          pending.pending[1].approvalMessage.includes("Cliente lote B")
        );
        await decide(c.id, pending.pending, "reject");
        assert.equal(
          await app
            .get(ToolCatalog)
            .approvalMessage(
              "consultar_indicadores",
              {},
              { token: ana, companyId }
            ),
          undefined
        );
      }
    );
    await t.test(
      "falha na apresentação mantém os argumentos disponíveis sem executar a escrita",
      async () => {
        const entry = app
          .get(ToolCatalog)
          .definition("cadastrar_cliente", { token: ana, companyId });
        const original = entry.approvalMessage;
        try {
          entry.approvalMessage = () => {
            throw new Error("Erro no formatador");
          };
          const c = await create();
          responses = [
            group("clientes"),
            call("cadastrar_cliente", { name: "Cliente fallback" }),
            new AIMessage("Rejeitado.")
          ];
          const pending = (await send(c.id)).body;
          assert.equal(pending.status, "awaiting_approval");
          assert.equal(pending.pending[0].approvalMessage, undefined);
          assert.equal(pending.pending[0].args.name, "Cliente fallback");
          assert.equal(
            db
              .prepare(
                "SELECT count(*) n FROM customers WHERE name='Cliente fallback'"
              )
              .get().n,
            0
          );
          await decide(c.id, pending.pending, "reject");
        } finally {
          entry.approvalMessage = original;
        }
      }
    );
    await t.test(
      "recupera interrupção sem repetir uma escrita iniciada",
      async () => {
        const c = await create();
        responses = [
          group("clientes"),
          call("cadastrar_cliente", { name: "Operação interrompida" })
        ];
        const pending = (await send(c.id)).body;
        const store = app.get(ChatStore),
          actor = app.get(ToolCatalog).context({ token: ana, companyId });
        const interrupted = store.get(c.id, actor.user.id, companyId);
        interrupted.calls[0].status = "running";
        interrupted.status = "processing";
        store.save(interrupted, actor.user.id, companyId);
        new ChatStore(db);
        responses = [
          new AIMessage("Confira o cadastro antes de repetir a operação.")
        ];
        const result = (await api(`conversations/${c.id}/retry`, {})).body;
        assert.equal(result.status, "idle");
        assert.equal(result.trace.at(-1).status, "error");
        assert.equal(
          db
            .prepare(
              "SELECT count(*) n FROM customers WHERE name='Operação interrompida'"
            )
            .get().n,
          0
        );
      }
    );
  } finally {
    await app.close();
  }
});
