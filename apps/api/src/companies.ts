import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { transaction } from "./database";
import { parse } from "./erp";
import { insertUser, passwordSchema, requireAdmin, User } from "./identity";

export type CompanyRole = "DONO" | "FUNCIONARIO";
export class Companies {
  constructor(readonly db: DatabaseSync) {}
  list(user: User) {
    if (user.role === "ADMIN")
      return this.db
        .prepare("SELECT c.*, 'ADMIN' role FROM companies c ORDER BY c.name")
        .all();
    return this.db
      .prepare(
        "SELECT c.*,m.role FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=? ORDER BY c.name",
      )
      .all(user.id);
  }
  access(user: User, companyId: number): "ADMIN" | CompanyRole {
    if (!Number.isSafeInteger(companyId) || companyId <= 0)
      throw new BadRequestException("Selecione uma empresa válida.");
    if (!this.db.prepare("SELECT id FROM companies WHERE id=?").get(companyId))
      throw new NotFoundException("Empresa não encontrada.");
    if (user.role === "ADMIN") return "ADMIN";
    const m = this.db
      .prepare("SELECT role FROM memberships WHERE company_id=? AND user_id=?")
      .get(companyId, user.id);
    if (!m)
      throw new ForbiddenException("Você não possui vínculo com esta empresa.");
    return m.role as CompanyRole;
  }
  private manager(user: User, companyId: number) {
    const role = this.access(user, companyId);
    if (role === "FUNCIONARIO")
      throw new ForbiddenException(
        "Somente ADMIN ou DONO pode gerenciar os vínculos da empresa.",
      );
    return role;
  }
  create(user: User, input: unknown) {
    requireAdmin(user);
    const v = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        document: z.string().trim().max(30).default(""),
      }),
      input,
    );
    const r = this.db
      .prepare("INSERT INTO companies(name,document) VALUES(?,?)")
      .run(v.name, v.document);
    return { id: Number(r.lastInsertRowid), ...v, role: "ADMIN" };
  }
  members(user: User, companyId: number) {
    this.manager(user, companyId);
    return this.db
      .prepare(
        "SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=? ORDER BY u.name",
      )
      .all(companyId);
  }
  addMember(user: User, companyId: number, input: unknown) {
    const actorRole = this.manager(user, companyId);
    const v = parse(
      z.object({
        email: z
          .email()
          .max(200)
          .transform((s) => s.toLowerCase()),
        name: z.string().trim().min(2).max(120).optional(),
        password: passwordSchema.optional(),
        role: z.enum(["DONO", "FUNCIONARIO"]),
      }),
      input,
    );
    if (actorRole !== "ADMIN" && v.role !== "FUNCIONARIO")
      throw new ForbiddenException("Somente ADMIN pode atribuir o papel DONO.");
    return transaction(this.db, () => {
      let target = this.db
        .prepare("SELECT id,name,email,role FROM users WHERE email=?")
        .get(v.email);
      if (!target) {
        if (!v.name || !v.password)
          throw new BadRequestException(
            "Para um novo usuário, informe nome e senha com pelo menos 8 caracteres.",
          );
        target = insertUser(this.db, {
          name: v.name,
          email: v.email,
          password: v.password,
          role: "USER",
        });
      }
      if (target.role === "ADMIN")
        throw new BadRequestException(
          "ADMIN tem acesso global e não recebe vínculos de empresa.",
        );
      if (
        this.db
          .prepare("SELECT 1 FROM memberships WHERE company_id=? AND user_id=?")
          .get(companyId, target.id)
      )
        throw new BadRequestException(
          "Este usuário já possui um vínculo com a empresa.",
        );
      this.db
        .prepare(
          "INSERT INTO memberships(company_id,user_id,role) VALUES(?,?,?)",
        )
        .run(companyId, target.id, v.role);
      return {
        id: Number(target.id),
        name: String(target.name),
        email: String(target.email),
        role: v.role,
      };
    });
  }
  changeRole(user: User, companyId: number, userId: number, input: unknown) {
    requireAdmin(user);
    this.access(user, companyId);
    const v = parse(z.object({ role: z.enum(["DONO", "FUNCIONARIO"]) }), input);
    const result = this.db
      .prepare("UPDATE memberships SET role=? WHERE company_id=? AND user_id=?")
      .run(v.role, companyId, userId);
    if (!result.changes) throw new NotFoundException("Vínculo não encontrado.");
    return { ok: true };
  }
  removeMember(user: User, companyId: number, userId: number) {
    const actorRole = this.manager(user, companyId);
    const target = this.db
      .prepare("SELECT role FROM memberships WHERE company_id=? AND user_id=?")
      .get(companyId, userId);
    if (!target) throw new NotFoundException("Vínculo não encontrado.");
    if (actorRole !== "ADMIN" && target.role === "DONO")
      throw new ForbiddenException("Somente ADMIN pode remover um DONO.");
    this.db
      .prepare("DELETE FROM memberships WHERE company_id=? AND user_id=?")
      .run(companyId, userId);
    return { ok: true };
  }
}
