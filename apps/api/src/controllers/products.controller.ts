import { z } from "zod";
import { AgentController, AgentRoute } from "../assistant/metadata";
import { productSchema } from "../erp";
import { Body, Controller, Get, Post } from "@nestjs/common";
import { ErpFactory } from "../erp";
import { CompanyRequired, CurrentCompany } from "../auth";

@AgentController({
  name: "produtos",
  description: "Consultar catálogo e cadastrar produtos."
})
@CompanyRequired()
@Controller("api/products")
export class ProductsController {
  constructor(private readonly erp: ErpFactory) {}

  @AgentRoute({
    name: "consultar_produtos",
    description: "Lista produtos, preços em centavos e saldo de estoque.",
    effect: "read",
    schema: z.object({})
  })
  @Get()
  list(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).products();
  }

  @AgentRoute({
    name: "cadastrar_produto",
    description: "Cadastra um produto. Informe preço em centavos.",
    effect: "write",
    schema: productSchema
  })
  @Post()
  create(@CurrentCompany() companyId: number, @Body() body: unknown) {
    return this.erp.forCompany(companyId).createProduct(body);
  }
}
