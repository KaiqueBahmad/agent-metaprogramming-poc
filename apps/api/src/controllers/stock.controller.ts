import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from "@nestjs/common";
import { ErpFactory } from "../erp";
import { CompanyRequired, CurrentCompany } from "../auth";

@CompanyRequired()
@Controller("api")
export class StockController {
  constructor(private readonly erp: ErpFactory) {}

  @Post("products/:id/restock")
  restock(
    @CurrentCompany() companyId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.erp.forCompany(companyId).restock(id, body);
  }

  @Get("movements")
  movements(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).movements();
  }
}
