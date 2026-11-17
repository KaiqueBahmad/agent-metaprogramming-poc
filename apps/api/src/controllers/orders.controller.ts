import { Body, Controller, Get, Param, ParseIntPipe, Post } from "@nestjs/common";
import { Erp } from "../erp";

@Controller("api/orders")
export class OrdersController {
  constructor(private readonly erp: Erp) {}

  @Get()
  list() {
    return this.erp.orders();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.erp.createOrder(body);
  }

  @Post(":id/:action")
  transition(
    @Param("id", ParseIntPipe) id: number,
    @Param("action") action: string,
  ) {
    return this.erp.transition(id, action);
  }
}
