import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const defaultPath = resolve(__dirname, "../../../data/erp.sqlite");
const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'USER' CHECK(role IN ('ADMIN','USER'))
  );
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, document TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS memberships (
    company_id INTEGER NOT NULL REFERENCES companies(id), user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('DONO','FUNCIONARIO')), PRIMARY KEY(company_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '', document TEXT NOT NULL DEFAULT '', UNIQUE(id,company_id)
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL, sku TEXT NOT NULL,
    price INTEGER NOT NULL CHECK(price>=0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
    UNIQUE(company_id,sku), UNIQUE(id,company_id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), customer_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','paid','cancelled')),
    total INTEGER NOT NULL CHECK(total>=0), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(id,company_id), FOREIGN KEY(customer_id,company_id) REFERENCES customers(id,company_id)
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), price INTEGER NOT NULL CHECK(price>=0),
    FOREIGN KEY(order_id,company_id) REFERENCES orders(id,company_id) ON DELETE CASCADE,
    FOREIGN KEY(product_id,company_id) REFERENCES products(id,company_id)
  );
  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), product_id INTEGER NOT NULL,
    order_id INTEGER, quantity INTEGER NOT NULL, reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY(product_id,company_id) REFERENCES products(id,company_id),
    FOREIGN KEY(order_id,company_id) REFERENCES orders(id,company_id)
  );
  CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
  CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
  CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id);
  CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id,company_id);
  CREATE INDEX IF NOT EXISTS idx_movements_company ON movements(company_id);
  CREATE TABLE IF NOT EXISTS assistant_conversations (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    company_id INTEGER NOT NULL REFERENCES companies(id), updated_at INTEGER NOT NULL, payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_scope ON assistant_conversations(user_id,company_id,updated_at);
  PRAGMA user_version=2;
`;

export function openDatabase(
  path = process.env.DATABASE_PATH || defaultPath,
  options: { reset?: boolean } = {},
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    if (options.reset) clear(db);
    else {
      const columns = db.prepare("PRAGMA table_info(customers)").all();
      if (columns.length && !columns.some((c) => c.name === "company_id")) {
        throw new Error(
          "Banco anterior à versão multiempresa. Pare a API e execute npm run reset (apaga os dados). Faça backup antes se necessário.",
        );
      }
      db.exec(schema);
    }
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function clear(db: DatabaseSync) {
  transaction(db, () => {
    db.exec(`DROP TABLE IF EXISTS assistant_conversations; DROP TABLE IF EXISTS movements; DROP TABLE IF EXISTS order_items;
      DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS products; DROP TABLE IF EXISTS customers;
      DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS memberships;
      DROP TABLE IF EXISTS companies; DROP TABLE IF EXISTS users;`);
    db.exec(schema);
  });
}
