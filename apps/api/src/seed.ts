import { DatabaseSync } from "node:sqlite";
import { Companies } from "./companies";
import { Erp } from "./erp";
import { insertUser } from "./identity";

export const demoPassword = "senha123";
export function seed(db: DatabaseSync) {
  if (
    Number(db.prepare("SELECT COUNT(*) count FROM users").get()?.count) ||
    Number(db.prepare("SELECT COUNT(*) count FROM companies").get()?.count)
  ) {
    throw new Error(
      "O seed exige banco vazio. Use npm run reset para recriar a demonstração.",
    );
  }
  const admin = insertUser(db, {
    name: "Administrador",
    email: "admin@forma.example",
    password: demoPassword,
    role: "ADMIN",
  });
  const ana = insertUser(db, {
    name: "Ana Souza",
    email: "ana@forma.example",
    password: demoPassword,
  });
  const bruno = insertUser(db, {
    name: "Bruno Lima",
    email: "bruno@forma.example",
    password: demoPassword,
  });
  const carla = insertUser(db, {
    name: "Carla Santos",
    email: "carla@forma.example",
    password: demoPassword,
  });
  const diego = insertUser(db, {
    name: "Diego Costa",
    email: "diego@forma.example",
    password: demoPassword,
  });
  insertUser(db, {
    name: "Usuário sem vínculo",
    email: "semvinculo@forma.example",
    password: demoPassword,
  });
  const companies = new Companies(db);
  const forma = companies.create(admin, {
    name: "Forma Papelaria",
    document: "11.111.111/0001-11",
  });
  const horizonte = companies.create(admin, {
    name: "Ateliê Horizonte",
    document: "22.222.222/0001-22",
  });
  const botanico = companies.create(admin, {
    name: "Café Botânico",
    document: "33.333.333/0001-33",
  });
  for (const [company, user, role] of [
    [forma, ana, "DONO"],
    [horizonte, ana, "DONO"],
    [botanico, bruno, "DONO"],
    [forma, bruno, "FUNCIONARIO"],
    [horizonte, bruno, "FUNCIONARIO"],
    [forma, carla, "FUNCIONARIO"],
    [botanico, carla, "FUNCIONARIO"],
    [horizonte, diego, "FUNCIONARIO"],
  ] as const)
    companies.addMember(admin, company.id, { email: user.email, role });

  for (const company of [forma, horizonte, botanico]) {
    const erp = new Erp(db, company.id);
    const customers = [
      ["Estúdio Aurora", "contato@aurora.example"],
      ["Livraria Central", "compras@central.example"],
      ["Loja Jardim", "oi@jardim.example"],
    ].map(([name, email]) =>
      erp.createCustomer({ name: `${name} · ${company.name}`, email }),
    );
    // Os mesmos SKUs em empresas diferentes demonstram o isolamento do catálogo.
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
      const order = erp.createOrder({
        customerId: customers[n % 3].id,
        items: [{ productId: products[n % 5].id, quantity: n + 1 }],
      });
      if (n < 4) erp.transition(order.id, "confirm");
      if (n < 2) erp.transition(order.id, "pay");
    }
  }
  return {
    users: 6,
    companies: 3,
    memberships: 8,
    customers: 9,
    products: 15,
    orders: 18,
  };
}
