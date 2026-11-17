import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ErpFactory } from "../erp";
import { AgentAction, AgentContext, AgentGroup } from "./metadata";

const canManage = ({ companyRole }: AgentContext) =>
  companyRole === "ADMIN" || companyRole === "DONO";

@Injectable()
@AgentGroup({
  name: "analises",
  description: "Análises gerenciais de estoque para donos e administradores."
})
export class ReportTools {
  constructor(private readonly erp: ErpFactory) {}

  @AgentAction({
    name: "analisar_estoque",
    description:
      "Resume quantidade e valor do estoque em centavos e lista produtos com até o limite informado.",
    effect: "read",
    schema: z.object({ limite: z.number().int().min(0).max(1000000) }),
    approvalMessage: ({ limite }) =>
      `Consultar a análise gerencial do estoque e listar produtos com até ${limite} unidades.`,
    canUse: canManage,
    authorize: canManage
  })
  stock(input: { limite: number }, context: AgentContext) {
    const products = this.erp.forCompany(context.companyId).products();
    return {
      produtos: products.length,
      unidades: products.reduce(
        (total, product) => total + Number(product.stock),
        0
      ),
      valorEmCentavos: products.reduce(
        (total, product) =>
          total + Number(product.stock) * Number(product.price),
        0
      ),
      estoqueBaixo: products.filter(
        (product) => Number(product.stock) <= input.limite
      )
    };
  }
}
