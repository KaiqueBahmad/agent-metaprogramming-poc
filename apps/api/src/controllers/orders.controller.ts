import { z } from "zod";
import { AgentController, AgentRoute } from "../assistant/metadata";
import { orderSchema } from "../erp";
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post
} from "@nestjs/common";
import { ErpFactory } from "../erp";
import { CompanyRequired, CurrentCompany } from "../auth";

@AgentController({
  name: "pedidos",
  description: "Consultar, criar, confirmar, receber e cancelar pedidos."
})
@CompanyRequired()
@Controller("api/orders")
export class OrdersController {
  constructor(private readonly erp: ErpFactory) {}

  @AgentRoute({
    name: "consultar_pedidos",
    description:
      "Lista pedidos com itens, cliente, status e total em centavos.",
    effect: "read",
    schema: z.object({})
  })
  @Get()
  list(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).orders();
  }

  @AgentRoute({
    name: "criar_pedido",
    description:
      "Cria um pedido em rascunho para um cliente com produtos existentes.",
    effect: "write",
    schema: orderSchema,
    approvalMessage: ({ customerId, items }) =>
      `Criar um pedido em rascunho para o cliente #${customerId}: ${items.map(({ productId, quantity }) => `${quantity} unidade(s) do produto #${productId}`).join("; ")}.`
  })
  @Post()
  create(@CurrentCompany() companyId: number, @Body() body: unknown) {
    return this.erp.forCompany(companyId).createOrder(body);
  }

  @AgentRoute({
    name: "alterar_status_pedido",
    description:
      "Confirma (confirm), registra recebimento (pay) ou cancela (cancel) um pedido. Confirmar baixa estoque; cancelar uma venda confirmada estorna estoque.",
    effect: "write",
    schema: z.object({
      id: z.number().int().positive(),
      action: z.enum(["confirm", "pay", "cancel"])
    }),
    approvalMessage: ({ id, action }) =>
      ({
        confirm: `Confirmar o pedido #${id} e baixar os produtos do estoque.`,
        pay: `Registrar o recebimento integral do pedido #${id}.`,
        cancel: `Cancelar o pedido #${id}. Se a venda já foi confirmada, os produtos serão devolvidos ao estoque.`
      })[action]
  })
  @Post(":id/:action")
  transition(
    @CurrentCompany() companyId: number,
    @Param("id", ParseIntPipe) id: number,
    @Param("action") action: string
  ) {
    return this.erp.forCompany(companyId).transition(id, action);
  }
}
