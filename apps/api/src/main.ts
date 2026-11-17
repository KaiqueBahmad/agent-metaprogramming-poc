import "reflect-metadata";
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Module,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { openDatabase } from "./database";
import { Erp } from "./erp";
const db = openDatabase();
const erp = new Erp(db);
@Controller("api")
class AppController {
  @Get("health") health() {
    return { status: "ok" };
  }
  @Get("dashboard") dashboard() {
    return erp.dashboard();
  }
  @Get("customers") customers() {
    return erp.customers();
  }
  @Post("customers") customer(@Body() body: unknown) {
    return erp.createCustomer(body);
  }
  @Get("products") products() {
    return erp.products();
  }
  @Post("products") product(@Body() body: unknown) {
    return erp.createProduct(body);
  }
  @Post("products/:id/restock") restock(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return erp.restock(id, body);
  }
  @Get("orders") orders() {
    return erp.orders();
  }
  @Post("orders") order(@Body() body: unknown) {
    return erp.createOrder(body);
  }
  @Post("orders/:id/:action") action(
    @Param("id", ParseIntPipe) id: number,
    @Param("action") action: string,
  ) {
    return erp.transition(id, action);
  }
  @Get("movements") movements() {
    return erp.movements();
  }
}
@Module({ controllers: [AppController] })
class AppModule {}
async function main() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 3000), "0.0.0.0");
}
void main();
