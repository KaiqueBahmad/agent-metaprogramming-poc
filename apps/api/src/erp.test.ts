import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, clear } from "./database";
import { Erp } from "./erp";
function fixture() {
  const db = openDatabase(":memory:");
  const company = db
    .prepare("INSERT INTO companies(name) VALUES(?)")
    .run("Empresa teste");
  const erp = new Erp(db, Number(company.lastInsertRowid));
  const c = erp.createCustomer({ name: "Cliente teste" });
  const p = erp.createProduct({
    name: "Produto teste",
    sku: "SKU-1",
    price: 1990,
    stock: 10,
  });
  return { db, erp, c, p };
}
test("fluxo: rascunho, confirmação e recebimento sem dupla baixa", () => {
  const { db, erp, c, p } = fixture();
  try {
    const o = erp.createOrder({
      customerId: c.id,
      items: [{ productId: p.id, quantity: 2 }],
    });
    assert.equal(erp.products()[0].stock, 10);
    erp.transition(o.id, "confirm");
    assert.equal(erp.products()[0].stock, 8);
    assert.equal(erp.dashboard().receivable, 3980);
    erp.transition(o.id, "pay");
    assert.equal(erp.products()[0].stock, 8);
    assert.equal(erp.dashboard().received, 3980);
    assert.throws(() => erp.transition(o.id, "confirm"));
    assert.throws(() => erp.transition(o.id, "cancel"));
  } finally {
    db.close();
  }
});
test("confirmação sem estoque reverte todas as baixas e movimentos", () => {
  const { db, erp, c, p } = fixture();
  try {
    const q = erp.createProduct({
      name: "Sem estoque",
      sku: "SKU-2",
      price: 100,
      stock: 0,
    });
    const o = erp.createOrder({
      customerId: c.id,
      items: [
        { productId: p.id, quantity: 1 },
        { productId: q.id, quantity: 1 },
      ],
    });
    const before = erp.movements().length;
    assert.throws(() => erp.transition(o.id, "confirm"));
    assert.equal(erp.products().find((x) => x.id === p.id)?.stock, 10);
    assert.equal(erp.movements().length, before);
    assert.equal(erp.orders()[0].status, "draft");
  } finally {
    db.close();
  }
});
test("cancelamento confirmado estorna estoque uma única vez", () => {
  const { db, erp, c, p } = fixture();
  try {
    const o = erp.createOrder({
      customerId: c.id,
      items: [{ productId: p.id, quantity: 3 }],
    });
    erp.transition(o.id, "confirm");
    erp.transition(o.id, "cancel");
    assert.equal(erp.products()[0].stock, 10);
    assert.equal(erp.dashboard().sales, 0);
    assert.throws(() => erp.transition(o.id, "cancel"));
    assert.equal(erp.products()[0].stock, 10);
  } finally {
    db.close();
  }
});
test("valida referências, duplicidade, valores e reposição", () => {
  const { db, erp, c, p } = fixture();
  try {
    assert.throws(() =>
      erp.createOrder({
        customerId: 999,
        items: [{ productId: p.id, quantity: 1 }],
      }),
    );
    assert.throws(() =>
      erp.createOrder({
        customerId: c.id,
        items: [
          { productId: p.id, quantity: 1 },
          { productId: p.id, quantity: 1 },
        ],
      }),
    );
    assert.throws(() =>
      erp.createProduct({ name: "Teste", sku: "SKU-1", price: 2 }),
    );
    assert.throws(() =>
      erp.restock(p.id, { quantity: -1, reason: "Inválido" }),
    );
    assert.throws(() =>
      erp.createOrder({
        customerId: c.id,
        items: [{ productId: p.id, quantity: 1.5 }],
      }),
    );
    erp.restock(p.id, { quantity: 2, reason: "Compra fornecedor" });
    assert.equal(erp.products()[0].stock, 12);
    clear(db);
    assert.equal(erp.customers().length, 0);
    assert.equal(erp.products().length, 0);
    assert.equal(erp.movements().length, 0);
  } finally {
    db.close();
  }
});
test("preço é preservado no pedido e rascunho cancelado não movimenta estoque", () => {
  const { db, erp, c, p } = fixture();
  try {
    const o = erp.createOrder({
      customerId: c.id,
      items: [{ productId: p.id, quantity: 2 }],
    });
    db.prepare("UPDATE products SET price=2500 WHERE id=?").run(p.id);
    assert.equal(erp.orders()[0].total, 3980);
    const count = erp.movements().length;
    erp.transition(o.id, "cancel");
    assert.equal(erp.products()[0].stock, 10);
    assert.equal(erp.movements().length, count);
  } finally {
    db.close();
  }
});
