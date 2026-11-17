import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, clear } from "./database";
import { Identity, insertUser } from "./identity";
import { Companies } from "./companies";
import { Erp } from "./erp";
import { AuthGuard, AdminOnly, CompanyRequired, Public } from "./auth";
import { seed, demoPassword } from "./seed";

function fixture() {
  const db = openDatabase(":memory:");
  const admin = insertUser(db, {
    name: "Admin",
    email: "admin@test.example",
    password: demoPassword,
    role: "ADMIN",
  });
  const owner = insertUser(db, {
    name: "Dono",
    email: "dono@test.example",
    password: demoPassword,
  });
  const employee = insertUser(db, {
    name: "Funcionário",
    email: "funcionario@test.example",
    password: demoPassword,
  });
  const identity = new Identity(db),
    companies = new Companies(db);
  const a = companies.create(admin, { name: "Empresa A" }),
    b = companies.create(admin, { name: "Empresa B" }),
    c = companies.create(admin, { name: "Empresa C" });
  companies.addMember(admin, a.id, { email: owner.email, role: "DONO" });
  companies.addMember(admin, b.id, { email: owner.email, role: "DONO" });
  companies.addMember(admin, a.id, {
    email: employee.email,
    role: "FUNCIONARIO",
  });
  companies.addMember(admin, b.id, {
    email: employee.email,
    role: "FUNCIONARIO",
  });
  companies.addMember(admin, c.id, { email: employee.email, role: "DONO" });
  return { db, admin, owner, employee, identity, companies, a, b, c };
}

test("login valida senha, retorna sessão e não expõe hash; logout e expiração revogam acesso", () => {
  const { db, identity, owner } = fixture();
  try {
    assert.throws(
      () => identity.login({ email: owner.email, password: "errada" }),
      UnauthorizedException,
    );
    assert.throws(
      () =>
        identity.login({
          email: "inexistente@test.example",
          password: "errada",
        }),
      UnauthorizedException,
    );
    const session = identity.login({
      email: owner.email.toUpperCase(),
      password: demoPassword,
    });
    assert.deepEqual(session.user, owner);
    assert.ok(!("password_hash" in session.user));
    assert.equal(identity.authenticate(session.token).id, owner.id);
    assert.notEqual(
      db.prepare("SELECT token_hash FROM sessions").get()?.token_hash,
      session.token,
    );
    identity.logout(session.token);
    assert.throws(
      () => identity.authenticate(session.token),
      UnauthorizedException,
    );
    const expired = identity.login({
      email: owner.email,
      password: demoPassword,
    });
    db.prepare("UPDATE sessions SET expires_at=0").run();
    assert.throws(
      () => identity.authenticate(expired.token),
      UnauthorizedException,
    );
  } finally {
    db.close();
  }
});

test("usuário pode ser dono de várias empresas, funcionário de várias e ter papéis diferentes", () => {
  const { db, companies, admin, owner, employee, a, b, c } = fixture();
  try {
    assert.deepEqual(
      companies.list(owner).map((x) => x.role),
      ["DONO", "DONO"],
    );
    assert.equal(companies.access(employee, a.id), "FUNCIONARIO");
    assert.equal(companies.access(employee, b.id), "FUNCIONARIO");
    assert.equal(companies.access(employee, c.id), "DONO");
    assert.equal(companies.list(admin).length, 3);
    assert.throws(() => companies.access(owner, c.id), ForbiddenException);
    assert.throws(
      () =>
        companies.addMember(admin, a.id, {
          email: owner.email,
          role: "FUNCIONARIO",
        }),
      BadRequestException,
    );
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO memberships(company_id,user_id,role) VALUES(?,?,?)",
        )
        .run(a.id, owner.id, "FUNCIONARIO"),
    );
  } finally {
    db.close();
  }
});

test("somente admin cadastra empresas e usuários globais; funcionário não gerencia vínculos", () => {
  const { db, companies, identity, owner, employee, a } = fixture();
  try {
    for (const user of [owner, employee]) {
      assert.throws(
        () => companies.create(user, { name: "Proibida" }),
        ForbiddenException,
      );
      assert.throws(
        () =>
          identity.createUser(user, {
            name: "Novo",
            email: "novo@test.example",
            password: demoPassword,
            role: "ADMIN",
          }),
        ForbiddenException,
      );
      assert.throws(() => identity.users(user), ForbiddenException);
    }
    assert.throws(() => companies.members(employee, a.id), ForbiddenException);
    assert.throws(
      () =>
        companies.addMember(employee, a.id, {
          email: "novo@test.example",
          name: "Novo",
          password: demoPassword,
          role: "FUNCIONARIO",
        }),
      ForbiddenException,
    );
    assert.throws(
      () =>
        companies.addMember(owner, a.id, {
          email: "novo@test.example",
          name: "Novo",
          password: demoPassword,
          role: "DONO",
        }),
      ForbiddenException,
    );
  } finally {
    db.close();
  }
});

test("dono cadastra funcionário, vínculo existente preserva senha, remoção revoga acesso", () => {
  const { db, companies, identity, owner, employee, admin, a, b } = fixture();
  try {
    const added = companies.addMember(owner, a.id, {
      name: "Nova Pessoa",
      email: "nova@test.example",
      password: demoPassword,
      role: "FUNCIONARIO",
    });
    assert.equal(
      companies.access(
        identity.login({ email: "nova@test.example", password: demoPassword })
          .user,
        a.id,
      ),
      "FUNCIONARIO",
    );
    companies.addMember(owner, b.id, {
      name: "Ignorado",
      email: "nova@test.example",
      password: "OutraSenha!",
      role: "FUNCIONARIO",
    });
    assert.equal(
      identity.login({ email: "nova@test.example", password: demoPassword })
        .user.name,
      "Nova Pessoa",
    );
    assert.throws(
      () =>
        identity.login({ email: "nova@test.example", password: "OutraSenha!" }),
      UnauthorizedException,
    );
    companies.removeMember(owner, a.id, added.id);
    assert.throws(
      () =>
        companies.access(
          identity.login({ email: "nova@test.example", password: demoPassword })
            .user,
          a.id,
        ),
      ForbiddenException,
    );
    assert.throws(
      () => companies.removeMember(owner, a.id, owner.id),
      ForbiddenException,
    );
    assert.throws(
      () => companies.changeRole(owner, a.id, employee.id, { role: "DONO" }),
      ForbiddenException,
    );
    companies.changeRole(admin, a.id, employee.id, { role: "DONO" });
    assert.equal(companies.access(employee, a.id), "DONO");
    companies.removeMember(admin, a.id, employee.id);
    assert.throws(() => companies.access(employee, a.id), ForbiddenException);
  } finally {
    db.close();
  }
});

test("ERP isola clientes, produtos, pedidos, estoque e indicadores por empresa", () => {
  const { db, a, b } = fixture();
  try {
    const one = new Erp(db, a.id),
      two = new Erp(db, b.id);
    const c1 = one.createCustomer({ name: "Cliente A" }),
      c2 = two.createCustomer({ name: "Cliente B" });
    const p1 = one.createProduct({
        name: "Produto A",
        sku: "MESMO",
        price: 100,
        stock: 10,
      }),
      p2 = two.createProduct({
        name: "Produto B",
        sku: "MESMO",
        price: 250,
        stock: 20,
      });
    assert.throws(() =>
      one.createProduct({ name: "Duplicado", sku: "MESMO", price: 100 }),
    );
    assert.equal(one.customers().length, 1);
    assert.equal(two.products()[0].name, "Produto B");
    assert.throws(() =>
      one.createOrder({
        customerId: c2.id,
        items: [{ productId: p1.id, quantity: 1 }],
      }),
    );
    assert.throws(() =>
      one.createOrder({
        customerId: c1.id,
        items: [{ productId: p2.id, quantity: 1 }],
      }),
    );
    const o1 = one.createOrder({
        customerId: c1.id,
        items: [{ productId: p1.id, quantity: 2 }],
      }),
      o2 = two.createOrder({
        customerId: c2.id,
        items: [{ productId: p2.id, quantity: 3 }],
      });
    assert.throws(() => one.transition(o2.id, "confirm"));
    assert.throws(() =>
      one.restock(p2.id, { quantity: 10, reason: "Invasão" }),
    );
    one.transition(o1.id, "confirm");
    two.transition(o2.id, "confirm");
    two.transition(o2.id, "pay");
    assert.equal(one.dashboard().sales, 200);
    assert.equal(two.dashboard().sales, 750);
    assert.equal(one.dashboard().received, 0);
    assert.equal(two.dashboard().received, 750);
    assert.equal(one.orders().length, 1);
    assert.equal(one.products()[0].stock, 8);
    assert.equal(two.products()[0].stock, 17);
    assert.ok(one.movements().every((x) => x.company_id === a.id));
    one.transition(o1.id, "cancel");
    assert.equal(one.products()[0].stock, 10);
    assert.equal(two.products()[0].stock, 17);
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO orders(company_id,customer_id,total) VALUES(?,?,?)",
        )
        .run(a.id, c2.id, 100),
    );
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO order_items(company_id,order_id,product_id,quantity,price) VALUES(?,?,?,?,?)",
        )
        .run(a.id, o1.id, p2.id, 1, 100),
    );
  } finally {
    db.close();
  }
});

test("guard protege rotas, valida empresa e consulta vínculo atual a cada chamada", () => {
  const { db, companies, identity, owner, employee, admin, a, c } = fixture();
  try {
    const guard = new AuthGuard(new Reflector(), identity, companies);
    class Protected {}
    class Tenant {}
    class Admin {}
    class Health {}
    CompanyRequired()(Tenant);
    AdminOnly()(Admin);
    Public()(Health);
    const handler = () => {};
    const makeContext = (
      controller: unknown,
      headers: Record<string, string> = {},
      params: Record<string, string> = {},
    ) => {
      const req = { headers, params };
      return {
        req,
        ctx: {
          getHandler: () => handler,
          getClass: () => controller,
          switchToHttp: () => ({ getRequest: () => req }),
        } as unknown as ExecutionContext,
      };
    };
    assert.throws(
      () => guard.canActivate(makeContext(Protected).ctx),
      UnauthorizedException,
    );
    assert.equal(guard.canActivate(makeContext(Health).ctx), true);
    const ownerToken = identity.login({
      email: owner.email,
      password: demoPassword,
    }).token;
    const headers = {
      authorization: `Bearer ${ownerToken}`,
      "x-company-id": String(a.id),
    };
    assert.equal(guard.canActivate(makeContext(Tenant, headers).ctx), true);
    assert.throws(
      () =>
        guard.canActivate(
          makeContext(Tenant, { authorization: headers.authorization }).ctx,
        ),
      BadRequestException,
    );
    assert.throws(
      () =>
        guard.canActivate(
          makeContext(Tenant, { ...headers, "x-company-id": String(c.id) }).ctx,
        ),
      ForbiddenException,
    );
    assert.throws(
      () => guard.canActivate(makeContext(Admin, headers).ctx),
      ForbiddenException,
    );
    const adminToken = identity.login({
      email: admin.email,
      password: demoPassword,
    }).token;
    assert.equal(
      guard.canActivate(
        makeContext(Admin, { authorization: `Bearer ${adminToken}` }).ctx,
      ),
      true,
    );
    const employeeToken = identity.login({
      email: employee.email,
      password: demoPassword,
    }).token;
    companies.removeMember(owner, a.id, employee.id);
    assert.throws(
      () =>
        guard.canActivate(
          makeContext(Tenant, {
            authorization: `Bearer ${employeeToken}`,
            "x-company-id": String(a.id),
          }).ctx,
        ),
      ForbiddenException,
    );
    // O parâmetro da rota prevalece sobre um header que tente indicar outra empresa.
    assert.throws(
      () =>
        guard.canActivate(
          makeContext(Tenant, headers, { companyId: String(c.id) }).ctx,
        ),
      ForbiddenException,
    );
  } finally {
    db.close();
  }
});

test("seed cobre todos os cenários, recusa duplicação e clear invalida sessões", () => {
  const db = openDatabase(":memory:");
  try {
    assert.deepEqual(seed(db), {
      users: 6,
      companies: 3,
      memberships: 8,
      customers: 9,
      products: 15,
      orders: 18,
    });
    const identity = new Identity(db),
      companies = new Companies(db);
    const bruno = identity.login({
      email: "bruno@forma.example",
      password: demoPassword,
    });
    assert.deepEqual(
      companies
        .list(bruno.user)
        .map((c) => c.role)
        .sort(),
      ["DONO", "FUNCIONARIO", "FUNCIONARIO"],
    );
    const ana = identity.login({
      email: "ana@forma.example",
      password: demoPassword,
    });
    assert.deepEqual(
      companies.list(ana.user).map((c) => c.role),
      ["DONO", "DONO"],
    );
    const noCompany = identity.login({
      email: "semvinculo@forma.example",
      password: demoPassword,
    });
    assert.equal(companies.list(noCompany.user).length, 0);
    assert.throws(() => seed(db));
    clear(db);
    assert.throws(
      () => identity.authenticate(bruno.token),
      UnauthorizedException,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM users").get()?.count,
      0,
    );
  } finally {
    db.close();
  }
});

test("banco legado exige reset explícito e clear recria schema sem migrations", () => {
  const dir = mkdtempSync(join(tmpdir(), "forma-schema-"));
  const path = join(dir, "legacy.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT)");
    legacy.close();
    assert.throws(() => openDatabase(path), /npm run reset/);
    const db = openDatabase(path, { reset: true });
    assert.ok(
      db
        .prepare("PRAGMA table_info(customers)")
        .all()
        .some((c) => c.name === "company_id"),
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
