import { Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { openDatabase } from "./database";
import { ErpFactory } from "./erp";
import { DatabaseSync } from "node:sqlite";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth";
import { Identity } from "./identity";
import { Companies } from "./companies";
import { AuthController } from "./controllers/auth.controller";
import { CompaniesController } from "./controllers/companies.controller";
import { UsersController } from "./controllers/users.controller";
import { CustomersController } from "./controllers/customers.controller";
import { DashboardController } from "./controllers/dashboard.controller";
import { HealthController } from "./controllers/health.controller";
import { OrdersController } from "./controllers/orders.controller";
import { ProductsController } from "./controllers/products.controller";
import { StockController } from "./controllers/stock.controller";

@Module({
  controllers: [
    AuthController,
    CompaniesController,
    UsersController,
    CustomersController,
    DashboardController,
    HealthController,
    OrdersController,
    ProductsController,
    StockController,
  ],
  providers: [
    { provide: DatabaseSync, useFactory: () => openDatabase() },
    {
      provide: ErpFactory,
      useFactory: (db: DatabaseSync) => new ErpFactory(db),
      inject: [DatabaseSync],
    },
    {
      provide: Identity,
      useFactory: (db: DatabaseSync) => new Identity(db),
      inject: [DatabaseSync],
    },
    {
      provide: Companies,
      useFactory: (db: DatabaseSync) => new Companies(db),
      inject: [DatabaseSync],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DatabaseSync) private readonly db: DatabaseSync) {}
  onApplicationShutdown() {
    this.db.close();
  }
}
