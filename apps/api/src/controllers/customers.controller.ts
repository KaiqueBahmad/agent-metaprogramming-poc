import { Body, Controller, Get, Post } from "@nestjs/common";
import { ErpFactory } from "../erp";
import { CompanyRequired, CurrentCompany } from "../auth";

@CompanyRequired()
@Controller("api/customers")
export class CustomersController {
  constructor(private readonly erp: ErpFactory) {}

  @Get()
  list(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).customers();
  }

  @Post()
  create(@CurrentCompany() companyId: number, @Body() body: unknown) {
    return this.erp.forCompany(companyId).createCustomer(body);
  }
}
