import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { parse } from "./erp";

export type User = {
  id: number;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
};
export const passwordSchema = z.string().min(8).max(128);
const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .email()
    .max(200)
    .transform((s) => s.toLowerCase()),
  password: passwordSchema,
  role: z.enum(["ADMIN", "USER"]).default("USER"),
});
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function checkPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const expected = Buffer.from(key, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const publicUser = (row: Record<string, unknown>): User => ({
  id: Number(row.id),
  name: String(row.name),
  email: String(row.email),
  role: row.role as User["role"],
});
export function requireAdmin(user: User) {
  if (user.role !== "ADMIN")
    throw new ForbiddenException("Somente ADMIN pode realizar esta operação.");
}

// Usado pelo seed para criar o primeiro ADMIN; não é uma rota pública.
export function insertUser(db: DatabaseSync, input: unknown): User {
  const v = parse(userSchema, input);
  if (db.prepare("SELECT id FROM users WHERE email=?").get(v.email))
    throw new BadRequestException("E-mail já cadastrado.");
  const result = db
    .prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)")
    .run(v.name, v.email, hashPassword(v.password), v.role);
  return {
    id: Number(result.lastInsertRowid),
    name: v.name,
    email: v.email,
    role: v.role,
  };
}

export class Identity {
  constructor(readonly db: DatabaseSync) {}
  login(input: unknown) {
    const v = parse(
      z.object({
        email: z
          .email()
          .max(200)
          .transform((s) => s.toLowerCase()),
        password: z.string().min(1).max(128),
      }),
      input,
    );
    const row = this.db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(v.email);
    // Verifica um hash também quando o usuário não existe.
    const hash = row
      ? String(row.password_hash)
      : `${"0".repeat(32)}:${"0".repeat(128)}`;
    if (!checkPassword(v.password, hash) || !row)
      throw new UnauthorizedException("E-mail ou senha inválidos.");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
    this.db
      .prepare("DELETE FROM sessions WHERE expires_at<=?")
      .run(Math.floor(Date.now() / 1000));
    this.db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
      )
      .run(tokenHash(token), row.id, expiresAt);
    return { token, user: publicUser(row), expiresAt };
  }
  authenticate(token: string): User {
    const row = this.db
      .prepare(
        "SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
      )
      .get(tokenHash(token), Math.floor(Date.now() / 1000));
    if (!row)
      throw new UnauthorizedException(
        "Sessão inválida ou expirada. Entre novamente.",
      );
    return publicUser(row);
  }
  logout(token: string) {
    this.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(tokenHash(token));
    return { ok: true };
  }
  users(actor: User) {
    requireAdmin(actor);
    return this.db
      .prepare("SELECT id,name,email,role FROM users ORDER BY name")
      .all();
  }
  createUser(actor: User, input: unknown) {
    requireAdmin(actor);
    return insertUser(this.db, input);
  }
}
