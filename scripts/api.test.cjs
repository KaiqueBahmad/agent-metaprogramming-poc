// Exercita HTTP, roteamento, guards, pipes e controllers sem abrir portas.
require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("../apps/api/dist/app.module");
const { seed, demoPassword } = require("../apps/api/dist/seed");

const { dispatch } = require("./http.cjs");

test("pipeline HTTP autenticado e multiempresa", async (t) => {
  process.env.DATABASE_PATH = ":memory:";
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await app.init();
    seed(app.get(DatabaseSync));
    const login = async (email) => {
      const result = await dispatch(app, "/api/auth/login", {
        method: "POST",
        body: { email, password: demoPassword }
      });
      assert.equal(result.status, 201);
      assert.ok(!("password_hash" in result.body.user));
      return result.body.token;
    };
    const admin = await login("admin@forma.example");
    const ana = await login("ana@forma.example");
    const bruno = await login("bruno@forma.example");
    const carla = await login("carla@forma.example");
    const companies = (await dispatch(app, "/api/companies", { token: admin }))
      .body;
    const forma = companies.find((c) => c.name === "Forma Papelaria").id;
    const horizonte = companies.find((c) => c.name === "Ateliê Horizonte").id;
    const botanico = companies.find((c) => c.name === "Café Botânico").id;

    await t.test(
      "health público; ERP exige login e empresa; pipes validam identificadores",
      async () => {
        assert.equal((await dispatch(app, "/api/health")).status, 200);
        assert.equal((await dispatch(app, "/api/customers")).status, 401);
        assert.equal(
          (await dispatch(app, "/api/products", { token: ana })).status,
          400
        );
        assert.equal(
          (
            await dispatch(app, "/api/orders/invalido/confirm", {
              method: "POST",
              body: {},
              token: ana,
              companyId: forma
            })
          ).status,
          400
        );
        assert.equal(
          (
            await dispatch(app, "/api/auth/login", {
              method: "POST",
              body: { email: "ana@forma.example", password: "errada" }
            })
          ).status,
          401
        );
      }
    );
    await t.test(
      "somente ADMIN cadastra empresa e usuário global",
      async () => {
        for (const token of [ana, carla]) {
          assert.equal(
            (
              await dispatch(app, "/api/companies", {
                method: "POST",
                body: { name: "Proibida" },
                token
              })
            ).status,
            403
          );
          assert.equal(
            (await dispatch(app, "/api/users", { token })).status,
            403
          );
          assert.equal(
            (
              await dispatch(app, "/api/users", {
                method: "POST",
                body: {
                  name: "Teste",
                  email: "novo@forma.example",
                  password: demoPassword,
                  role: "ADMIN"
                },
                token
              })
            ).status,
            403
          );
        }
        const created = await dispatch(app, "/api/companies", {
          method: "POST",
          body: { name: "Nova empresa" },
          token: admin
        });
        assert.equal(created.status, 201);
        assert.equal(
          (
            await dispatch(app, `/api/companies/${created.body.id}/members`, {
              method: "POST",
              body: { email: "ana@forma.example", role: "DONO" },
              token: admin
            })
          ).status,
          201
        );
      }
    );
    await t.test(
      "vínculo determina acesso e papel em cada empresa",
      async () => {
        assert.equal(
          (await dispatch(app, "/api/companies", { token: carla })).body.length,
          2
        );
        assert.equal(
          (
            await dispatch(app, "/api/products", {
              token: carla,
              companyId: horizonte
            })
          ).status,
          403
        );
        assert.equal(
          (
            await dispatch(app, `/api/companies/${forma}/members`, {
              token: bruno
            })
          ).status,
          403
        );
        assert.equal(
          (
            await dispatch(app, `/api/companies/${botanico}/members`, {
              token: bruno
            })
          ).status,
          200
        );
        assert.equal(
          (
            await dispatch(app, `/api/companies/${forma}/members`, {
              token: ana
            })
          ).status,
          200
        );
        assert.equal(
          (
            await dispatch(app, `/api/companies/${forma}/members`, {
              method: "POST",
              body: { email: "carla@forma.example", role: "DONO" },
              token: ana
            })
          ).status,
          403
        );
      }
    );
    await t.test(
      "dados e referências de outra empresa não atravessam o escopo",
      async () => {
        const customersA = (
          await dispatch(app, "/api/customers", {
            token: ana,
            companyId: forma
          })
        ).body;
        const productsB = (
          await dispatch(app, "/api/products", {
            token: ana,
            companyId: horizonte
          })
        ).body;
        assert.ok(customersA.every((c) => c.company_id === forma));
        const cross = await dispatch(app, "/api/orders", {
          method: "POST",
          token: ana,
          companyId: forma,
          body: {
            customerId: customersA[0].id,
            items: [{ productId: productsB[0].id, quantity: 1 }]
          }
        });
        assert.equal(cross.status, 400);
        const otherOrder = (
          await dispatch(app, "/api/orders", {
            token: ana,
            companyId: horizonte
          })
        ).body[0];
        assert.equal(
          (
            await dispatch(app, `/api/orders/${otherOrder.id}/confirm`, {
              method: "POST",
              body: {},
              token: ana,
              companyId: forma
            })
          ).status,
          404
        );
        const product = await dispatch(app, "/api/products", {
          method: "POST",
          token: carla,
          companyId: forma,
          body: {
            name: "Produto funcionário",
            sku: "FUNC-001",
            price: 100,
            stock: 2,
            company_id: horizonte
          }
        });
        assert.equal(product.status, 201);
        assert.ok(
          !(
            await dispatch(app, "/api/products", {
              token: ana,
              companyId: horizonte
            })
          ).body.some((p) => p.sku === "FUNC-001")
        );
      }
    );
    await t.test(
      "remoção de vínculo e logout têm efeito na próxima requisição",
      async () => {
        const members = (
          await dispatch(app, `/api/companies/${forma}/members`, { token: ana })
        ).body;
        const member = members.find((m) => m.email === "carla@forma.example");
        assert.equal(
          (
            await dispatch(
              app,
              `/api/companies/${forma}/members/${member.id}/remove`,
              { method: "POST", body: {}, token: ana }
            )
          ).status,
          201
        );
        assert.equal(
          (
            await dispatch(app, "/api/products", {
              token: carla,
              companyId: forma
            })
          ).status,
          403
        );
        assert.equal(
          (
            await dispatch(app, "/api/products", {
              token: carla,
              companyId: botanico
            })
          ).status,
          200
        );
        assert.equal(
          (
            await dispatch(app, "/api/auth/logout", {
              method: "POST",
              body: {},
              token: carla
            })
          ).status,
          201
        );
        assert.equal(
          (await dispatch(app, "/api/auth/me", { token: carla })).status,
          401
        );
      }
    );
  } finally {
    await app.close();
  }
});
