import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { transaction } from "./database";
const idSchema = z.coerce.number().int().positive();
const money = z.number().int().nonnegative().max(100000000);
const customerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.union([z.email(), z.literal("")]).default(""),
  document: z.string().trim().max(30).default(""),
});
const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sku: z.string().trim().min(1).max(40),
  price: money,
  stock: z.number().int().nonnegative().max(1000000).default(0),
});
const orderSchema = z.object({
  customerId: idSchema,
  items: z
    .array(
      z.object({
        productId: idSchema,
        quantity: z.number().int().positive().max(10000),
      }),
    )
    .min(1)
    .max(100),
});
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
}
export class Erp {
  constructor(readonly db: DatabaseSync) {}
  customers() {
    return this.db.prepare("SELECT * FROM customers ORDER BY name").all();
  }
  products() {
    return this.db.prepare("SELECT * FROM products ORDER BY name").all();
  }
  createCustomer(input: unknown) {
    const v = parse(customerSchema, input);
    const r = this.db
      .prepare("INSERT INTO customers(name,email,document) VALUES(?,?,?)")
      .run(v.name, v.email, v.document);
    return { id: Number(r.lastInsertRowid), ...v };
  }
  createProduct(input: unknown) {
    const v = parse(productSchema, input);
    return transaction(this.db, () => {
      if (this.db.prepare("SELECT id FROM products WHERE sku=?").get(v.sku))
        throw new BadRequestException("SKU já cadastrado.");
      const r = this.db
        .prepare("INSERT INTO products(name,sku,price,stock) VALUES(?,?,?,?)")
        .run(v.name, v.sku, v.price, v.stock);
      if (v.stock)
        this.movement(
          Number(r.lastInsertRowid),
          null,
          v.stock,
          "Estoque inicial",
        );
      return { id: Number(r.lastInsertRowid), ...v };
    });
  }
  movement(
    productId: number,
    orderId: number | null,
    quantity: number,
    reason: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO movements(product_id,order_id,quantity,reason) VALUES(?,?,?,?)",
      )
      .run(productId, orderId, quantity, reason);
  }
  restock(id: number, input: unknown) {
    const v = parse(
      z.object({
        quantity: z.number().int().positive().max(1000000),
        reason: z.string().trim().min(3).max(200),
      }),
      input,
    );
    return transaction(this.db, () => {
      if (!this.db.prepare("SELECT id FROM products WHERE id=?").get(id))
        throw new NotFoundException("Produto não encontrado.");
      this.db
        .prepare("UPDATE products SET stock=stock+? WHERE id=?")
        .run(v.quantity, id);
      this.movement(id, null, v.quantity, v.reason);
      return { ok: true };
    });
  }
  orders() {
    return this.db
      .prepare(
        `SELECT o.*,c.name customer_name FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.id DESC`,
      )
      .all()
      .map((o) => ({
        ...o,
        id: Number(o.id),
        status: String(o.status),
        total: Number(o.total),
        items: this.db
          .prepare(
            "SELECT i.*,p.name product_name,p.sku FROM order_items i JOIN products p ON p.id=i.product_id WHERE order_id=?",
          )
          .all(o.id),
      }));
  }
  createOrder(input: unknown) {
    const v = parse(orderSchema, input);
    return transaction(this.db, () => {
      if (
        !this.db
          .prepare("SELECT id FROM customers WHERE id=?")
          .get(v.customerId)
      )
        throw new BadRequestException("Cliente não encontrado.");
      if (new Set(v.items.map((i) => i.productId)).size !== v.items.length)
        throw new BadRequestException("Agrupe os produtos repetidos.");
      const items = v.items.map((i) => {
        const p = this.db
          .prepare("SELECT * FROM products WHERE id=?")
          .get(i.productId);
        if (!p) throw new BadRequestException("Produto não encontrado.");
        return { ...i, price: Number(p.price) };
      });
      const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
      if (!Number.isSafeInteger(total))
        throw new BadRequestException("Total inválido.");
      const r = this.db
        .prepare("INSERT INTO orders(customer_id,total) VALUES(?,?)")
        .run(v.customerId, total);
      const id = Number(r.lastInsertRowid);
      for (const i of items)
        this.db
          .prepare(
            "INSERT INTO order_items(order_id,product_id,quantity,price) VALUES(?,?,?,?)",
          )
          .run(id, i.productId, i.quantity, i.price);
      return { id };
    });
  }
  transition(id: number, action: string) {
    return transaction(this.db, () => {
      const order = this.db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) throw new NotFoundException("Pedido não encontrado.");
      const allowed: Record<string, string[]> = {
        confirm: ["draft"],
        pay: ["confirmed"],
        cancel: ["draft", "confirmed"],
      };
      if (!allowed[action]?.includes(String(order.status)))
        throw new BadRequestException("Transição de pedido não permitida.");
      const items = this.db
        .prepare("SELECT * FROM order_items WHERE order_id=?")
        .all(id);
      for (const i of items) {
        if (action === "confirm") {
          const r = this.db
            .prepare(
              "UPDATE products SET stock=stock-? WHERE id=? AND stock>=?",
            )
            .run(i.quantity, i.product_id, i.quantity);
          if (!r.changes)
            throw new BadRequestException(
              "Estoque insuficiente. Reponha o produto antes de confirmar.",
            );
          this.movement(
            Number(i.product_id),
            id,
            -Number(i.quantity),
            "Venda confirmada",
          );
        }
        if (action === "cancel" && order.status === "confirmed") {
          this.db
            .prepare("UPDATE products SET stock=stock+? WHERE id=?")
            .run(i.quantity, i.product_id);
          this.movement(
            Number(i.product_id),
            id,
            Number(i.quantity),
            "Cancelamento de venda",
          );
        }
      }
      this.db.prepare("UPDATE orders SET status=? WHERE id=?").run(
        (
          {
            confirm: "confirmed",
            pay: "paid",
            cancel: "cancelled",
          } as Record<string, string>
        )[action],
        id,
      );
      return { ok: true };
    });
  }
  movements() {
    return this.db
      .prepare(
        "SELECT m.*,p.name product_name FROM movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 100",
      )
      .all();
  }
  dashboard() {
    return {
      sales: this.db
        .prepare(
          "SELECT COALESCE(SUM(total),0) value FROM orders WHERE status IN ('confirmed','paid')",
        )
        .get()?.value,
      receivable: this.db
        .prepare(
          "SELECT COALESCE(SUM(total),0) value FROM orders WHERE status='confirmed'",
        )
        .get()?.value,
      received: this.db
        .prepare(
          "SELECT COALESCE(SUM(total),0) value FROM orders WHERE status='paid'",
        )
        .get()?.value,
      lowStock: this.db
        .prepare("SELECT COUNT(*) value FROM products WHERE stock<=5")
        .get()?.value,
    };
  }
}
