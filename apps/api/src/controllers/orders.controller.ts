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
@Controller("api/orders")
export class OrdersController {
  constructor(private readonly erp: ErpFactory) {}

  @Get()
  list(@CurrentCompany() companyId: number) {
    return this.erp.forCompany(companyId).orders();
  }

  @Post()
  create(@CurrentCompany() companyId: number, @Body() body: unknown) {
    return this.erp.forCompany(companyId).createOrder(body);
  }

  @Post(":id/:action")
  transition(
    @CurrentCompany() companyId: number,
    @Param("id", ParseIntPipe) id: number,
    @Param("action") action: string,
  ) {
    return this.erp.forCompany(companyId).transition(id, action);
  }
}
