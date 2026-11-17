import { Module } from "@nestjs/common";
import { openDatabase } from "./database";
import { Erp } from "./erp";
import { CustomersController } from "./controllers/customers.controller";
import { DashboardController } from "./controllers/dashboard.controller";
import { HealthController } from "./controllers/health.controller";
import { OrdersController } from "./controllers/orders.controller";
import { ProductsController } from "./controllers/products.controller";
import { StockController } from "./controllers/stock.controller";

@Module({
  controllers: [
    CustomersController,
    DashboardController,
    HealthController,
    OrdersController,
    ProductsController,
    StockController,
  ],
  providers: [{ provide: Erp, useFactory: () => new Erp(openDatabase()) }],
})
export class AppModule {}
