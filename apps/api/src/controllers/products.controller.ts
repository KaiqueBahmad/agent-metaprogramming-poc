import { Body, Controller, Get, Post } from "@nestjs/common";
import { Erp } from "../erp";

@Controller("api/products")
export class ProductsController {
  constructor(private readonly erp: Erp) {}

  @Get()
  list() {
    return this.erp.products();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.erp.createProduct(body);
  }
}
