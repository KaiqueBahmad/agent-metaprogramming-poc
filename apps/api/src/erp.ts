import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { transaction } from "./database";
const idSchema = z.coerce.number().int().positive();
const money = z.number().int().nonnegative().max(100000000);
export const customerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.union([z.email(), z.literal("")]).default(""),
  document: z.string().trim().max(30).default(""),
});
export const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sku: z.string().trim().min(1).max(40),
  price: money,
  stock: z.number().int().nonnegative().max(1000000).default(0),
});
export const orderSchema = z.object({
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
export const restockSchema = z.object({
  quantity: z.number().int().positive().max(1000000),
  reason: z.string().trim().min(3).max(200),
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
  constructor(
    readonly db: DatabaseSync,
    readonly companyId: number,
  ) {
    if (!Number.isSafeInteger(companyId) || companyId <= 0)
      throw new Error("Empresa obrigatória.");
  }
  customers() {
    return this.db
      .prepare("SELECT * FROM customers WHERE company_id=? ORDER BY name")
      .all(this.companyId);
  }
  products() {
    return this.db
      .prepare("SELECT * FROM products WHERE company_id=? ORDER BY name")
      .all(this.companyId);
  }
  createCustomer(input: unknown) {
    const v = parse(customerSchema, input);
    const r = this.db
      .prepare(
        "INSERT INTO customers(company_id,name,email,document) VALUES(?,?,?,?)",
      )
      .run(this.companyId, v.name, v.email, v.document);
    return { id: Number(r.lastInsertRowid), ...v };
  }
  createProduct(input: unknown) {
    const v = parse(productSchema, input);
    return transaction(this.db, () => {
      if (
        this.db
          .prepare("SELECT id FROM products WHERE sku=? AND company_id=?")
          .get(v.sku, this.companyId)
      )
        throw new BadRequestException("SKU já cadastrado.");
      const r = this.db
        .prepare(
          "INSERT INTO products(company_id,name,sku,price,stock) VALUES(?,?,?,?,?)",
        )
        .run(this.companyId, v.name, v.sku, v.price, v.stock);
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
        "INSERT INTO movements(company_id,product_id,order_id,quantity,reason) VALUES(?,?,?,?,?)",
      )
      .run(this.companyId, productId, orderId, quantity, reason);
  }
  restock(id: number, input: unknown) {
    const v = parse(restockSchema, input);
    return transaction(this.db, () => {
      if (
        !this.db
          .prepare("SELECT id FROM products WHERE id=? AND company_id=?")
          .get(id, this.companyId)
      )
        throw new NotFoundException("Produto não encontrado.");
      this.db
        .prepare(
          "UPDATE products SET stock=stock+? WHERE id=? AND company_id=?",
        )
        .run(v.quantity, id, this.companyId);
      this.movement(id, null, v.quantity, v.reason);
      return { ok: true };
    });
  }
  orders() {
    return this.db
      .prepare(
        `SELECT o.*,c.name customer_name FROM orders o JOIN customers c ON c.id=o.customer_id AND c.company_id=o.company_id WHERE o.company_id=? ORDER BY o.id DESC`,
      )
      .all(this.companyId)
      .map((o) => ({
        ...o,
        id: Number(o.id),
        status: String(o.status),
        total: Number(o.total),
        items: this.db
          .prepare(
            "SELECT i.*,p.name product_name,p.sku FROM order_items i JOIN products p ON p.id=i.product_id WHERE order_id=? AND i.company_id=?",
          )
          .all(o.id, this.companyId),
      }));
  }
  createOrder(input: unknown) {
    const v = parse(orderSchema, input);
    return transaction(this.db, () => {
      if (
        !this.db
          .prepare("SELECT id FROM customers WHERE id=? AND company_id=?")
          .get(v.customerId, this.companyId)
      )
        throw new BadRequestException("Cliente não encontrado.");
      if (new Set(v.items.map((i) => i.productId)).size !== v.items.length)
        throw new BadRequestException("Agrupe os produtos repetidos.");
      const items = v.items.map((i) => {
        const p = this.db
          .prepare("SELECT * FROM products WHERE id=? AND company_id=?")
          .get(i.productId, this.companyId);
        if (!p) throw new BadRequestException("Produto não encontrado.");
        return { ...i, price: Number(p.price) };
      });
      const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
      if (!Number.isSafeInteger(total))
        throw new BadRequestException("Total inválido.");
      const r = this.db
        .prepare(
          "INSERT INTO orders(company_id,customer_id,total) VALUES(?,?,?)",
        )
        .run(this.companyId, v.customerId, total);
      const id = Number(r.lastInsertRowid);
      for (const i of items)
        this.db
          .prepare(
            "INSERT INTO order_items(company_id,order_id,product_id,quantity,price) VALUES(?,?,?,?,?)",
          )
          .run(this.companyId, id, i.productId, i.quantity, i.price);
      return { id };
    });
  }
  transition(id: number, action: string) {
    return transaction(this.db, () => {
      const order = this.db
        .prepare("SELECT * FROM orders WHERE id=? AND company_id=?")
        .get(id, this.companyId);
      if (!order) throw new NotFoundException("Pedido não encontrado.");
      const allowed: Record<string, string[]> = {
        confirm: ["draft"],
        pay: ["confirmed"],
        cancel: ["draft", "confirmed"],
      };
      if (!allowed[action]?.includes(String(order.status)))
        throw new BadRequestException("Transição de pedido não permitida.");
      const items = this.db
        .prepare("SELECT * FROM order_items WHERE order_id=? AND company_id=?")
        .all(id, this.companyId);
      for (const i of items) {
        if (action === "confirm") {
          const r = this.db
            .prepare(
              "UPDATE products SET stock=stock-? WHERE id=? AND stock>=? AND company_id=?",
            )
            .run(i.quantity, i.product_id, i.quantity, this.companyId);
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
            .prepare(
              "UPDATE products SET stock=stock+? WHERE id=? AND company_id=?",
            )
            .run(i.quantity, i.product_id, this.companyId);
          this.movement(
            Number(i.product_id),
            id,
            Number(i.quantity),
            "Cancelamento de venda",
          );
        }
      }
      this.db
        .prepare("UPDATE orders SET status=? WHERE id=? AND company_id=?")
        .run(
          (
            {
              confirm: "confirmed",
              pay: "paid",
              cancel: "cancelled",
            } as Record<string, string>
          )[action],
          id,
          this.companyId,
        );
      return { ok: true };
    });
  }
  movements() {
    return this.db
      .prepare(
        "SELECT m.*,p.name product_name FROM movements m JOIN products p ON p.id=m.product_id AND p.company_id=m.company_id WHERE m.company_id=? ORDER BY m.id DESC LIMIT 100",
      )
      .all(this.companyId);
  }
  dashboard() {
    return {
      sales: this.db
        .prepare(
          "SELECT COALESCE(SUM(total),0) value FROM orders WHERE company_id=? AND status IN ('confirmed','paid')",
        )
        .get(this.companyId)?.value,
      receivable: this.db
        .prepare(
          "SELECT COALESCE(SUM(total),0) value FROM orders WHERE company_id=? AND status='confirmed'",
        )
        .get(this.companyId)?.value,
      received: this.db
        .prepare(
          "SELECT COALESCE(SUM(total),0) value FROM orders WHERE company_id=? AND status='paid'",
        )
        .get(this.companyId)?.value,
      lowStock: this.db
        .prepare(
          "SELECT COUNT(*) value FROM products WHERE company_id=? AND stock<=5",
        )
        .get(this.companyId)?.value,
    };
  }
}

export class ErpFactory {
  constructor(readonly db: DatabaseSync) {}
  forCompany(companyId: number) {
    return new Erp(this.db, companyId);
  }
}
