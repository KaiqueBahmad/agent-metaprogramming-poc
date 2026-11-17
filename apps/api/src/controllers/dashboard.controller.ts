import { Controller, Get } from "@nestjs/common";
import { ErpFactory } from "../erp";
import { CompanyRequired, CurrentCompany } from "../auth";

@CompanyRequired()
@Controller("api/dashboard")
export class DashboardController {
  constructor(private readonly erp: ErpFactory) {}

  @Get()
  summary(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).dashboard();
  }
}
