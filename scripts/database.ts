import { openDatabase, clear } from "../apps/api/src/database";
import { Erp } from "../apps/api/src/erp";
const db = openDatabase();
try {
  if (process.argv[2] === "clear") {
    clear(db);
    console.log("Banco limpo; estrutura preservada.");
  } else if (process.argv[2] === "seed") {
    if (
      Number(db.prepare("SELECT COUNT(*) count FROM customers").get()?.count) ||
      Number(db.prepare("SELECT COUNT(*) count FROM products").get()?.count) ||
      Number(db.prepare("SELECT COUNT(*) count FROM orders").get()?.count)
    )
      throw new Error(
        "O seed exige banco vazio. Use npm run reset para recriar os dados de demonstração.",
      );
    const erp = new Erp(db);
    // Cada operação usa sua própria transação, pelas mesmas regras da API.
    const customers = [
      ["Estúdio Aurora", "contato@aurora.example"],
      ["Café Botânico", "oi@botanico.example"],
      ["Ateliê Horizonte", "compras@horizonte.example"],
    ].map(([name, email]) => erp.createCustomer({ name, email }));
    const products = [
      ["Caderno pontilhado", "PAP-001", 3490, 42],
      ["Caneta gel preta", "PAP-002", 1290, 80],
      ["Organizador de mesa", "ORG-001", 8990, 18],
      ["Planner semanal", "PAP-003", 5990, 5],
      ["Bloco de notas", "PAP-004", 1890, 30],
    ].map(([name, sku, price, stock]) =>
      erp.createProduct({ name, sku, price, stock }),
    );
    for (let n = 0; n < 6; n++) {
      const o = erp.createOrder({
        customerId: customers[n % 3].id,
        items: [{ productId: products[n % 5].id, quantity: n + 1 }],
      });
      if (n < 4) erp.transition(o.id, "confirm");
      if (n < 2) erp.transition(o.id, "pay");
    }
    console.log("Seed concluído: 3 clientes, 5 produtos e 6 pedidos.");
  } else throw new Error("Use clear ou seed.");
} finally {
  db.close();
}
