import { z } from "zod";
import { AgentController, AgentRoute } from "../assistant/metadata";
import { restockSchema } from "../erp";
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
  name: "estoque",
  description: "Consultar movimentações e registrar entradas de estoque."
})
@CompanyRequired()
@Controller("api")
export class StockController {
  constructor(private readonly erp: ErpFactory) {}

  @AgentRoute({
    name: "registrar_entrada_estoque",
    description: "Repõe estoque de um produto, com quantidade e motivo.",
    effect: "write",
    schema: restockSchema.extend({ id: z.number().int().positive() })
  })
  @Post("products/:id/restock")
  restock(
    @CurrentCompany() companyId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown
  ) {
    return this.erp.forCompany(companyId).restock(id, body);
  }

  @AgentRoute({
    name: "consultar_movimentacoes",
    description: "Consulta as últimas 100 movimentações de estoque.",
    effect: "read",
    schema: z.object({})
  })
  @Get("movements")
  movements(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).movements();
  }
}
