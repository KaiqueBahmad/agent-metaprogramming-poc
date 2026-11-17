import { z } from "zod";
import { AgentController, AgentRoute } from "../assistant/metadata";
import { customerSchema } from "../erp";
import { Body, Controller, Get, Post } from "@nestjs/common";
import { ErpFactory } from "../erp";
import { CompanyRequired, CurrentCompany } from "../auth";

@AgentController({
  name: "clientes",
  description: "Consultar e cadastrar clientes."
})
@CompanyRequired()
@Controller("api/customers")
export class CustomersController {
  constructor(private readonly erp: ErpFactory) {}

  @AgentRoute({
    name: "consultar_clientes",
    description: "Lista os clientes da empresa.",
    effect: "read",
    schema: z.object({})
  })
  @Get()
  list(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).customers();
  }

  @AgentRoute({
    name: "cadastrar_cliente",
    description: "Cadastra um cliente.",
    effect: "write",
    schema: customerSchema,
    approvalMessage: ({ name, email, document }) =>
      [
        `Cadastrar o cliente “${name}”.`,
        email ? `E-mail: ${email}.` : "Sem e-mail.",
        document ? `Documento: ${document}.` : "Sem documento."
      ].join(" ")
  })
  @Post()
  create(@CurrentCompany() companyId: number, @Body() body: unknown) {
    return this.erp.forCompany(companyId).createCustomer(body);
  }
}
