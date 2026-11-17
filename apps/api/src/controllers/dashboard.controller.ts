import { z } from "zod";
import { AgentController, AgentRoute } from "../assistant/metadata";
import { Controller, Get } from "@nestjs/common";
import { ErpFactory } from "../erp";
import { CompanyRequired, CurrentCompany } from "../auth";

@AgentController({
  name: "indicadores",
  description: "Consultar indicadores de vendas e recebimentos."
})
@CompanyRequired()
@Controller("api/dashboard")
export class DashboardController {
  constructor(private readonly erp: ErpFactory) {}

  @AgentRoute({
    name: "consultar_indicadores",
    description:
      "Consulta vendas, a receber, recebido em centavos e quantidade de produtos com estoque baixo.",
    effect: "read",
    schema: z.object({})
  })
  @Get()
  summary(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).dashboard();
  }
}
