import { Body, Controller, Get, Param, ParseIntPipe, Post } from "@nestjs/common";
import { Erp } from "../erp";

@Controller("api")
export class StockController {
  constructor(private readonly erp: Erp) {}

  @Post("products/:id/restock")
  restock(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.erp.restock(id, body);
  }

  @Get("movements")
  movements() {
    return this.erp.movements();
  }
}
