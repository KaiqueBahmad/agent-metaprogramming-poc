import { Body, Controller, Get, Post } from "@nestjs/common";
import { ErpFactory } from "../erp";
import { CompanyRequired, CurrentCompany } from "../auth";

@CompanyRequired()
@Controller("api/products")
export class ProductsController {
  constructor(private readonly erp: ErpFactory) {}

  @Get()
  list(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).products();
  }

  @Post()
  create(@CurrentCompany() companyId: number, @Body() body: unknown) {
    return this.erp.forCompany(companyId).createProduct(body);
  }
}
