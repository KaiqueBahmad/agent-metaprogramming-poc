import { Body, Controller, Get, Post } from "@nestjs/common";
import { Erp } from "../erp";

@Controller("api/customers")
export class CustomersController {
  constructor(private readonly erp: Erp) {}

  @Get()
  list() {
    return this.erp.customers();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.erp.createCustomer(body);
  }
}
