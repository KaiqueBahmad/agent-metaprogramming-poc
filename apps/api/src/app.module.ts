import { agentSockets } from "./assistant/dispatch";
import { AuthRequest } from "./auth";
import { AssistantController } from "./controllers/assistant.controller";
import { AssistantChat } from "./assistant/chat";
import { ToolCatalog } from "./assistant/catalog";
import { ChatStore } from "./assistant/store";
import { Inferencer, LangChainInferencer } from "./assistant/inference";
import { ReportTools } from "./assistant/report-tools";
import {
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnApplicationShutdown
} from "@nestjs/common";
import { openDatabase } from "./database";
import { ErpFactory } from "./erp";
import { DatabaseSync } from "node:sqlite";
import { DiscoveryModule, APP_GUARD } from "@nestjs/core";
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
  imports: [DiscoveryModule],
  controllers: [
    AssistantController,
    AuthController,
    CompaniesController,
    UsersController,
    CustomersController,
    DashboardController,
    HealthController,
    OrdersController,
    ProductsController,
    StockController
  ],
  providers: [
    AssistantChat,
    ToolCatalog,
    ChatStore,
    ReportTools,
    { provide: Inferencer, useClass: LangChainInferencer },
    { provide: DatabaseSync, useFactory: () => openDatabase() },
    {
      provide: ErpFactory,
      useFactory: (db: DatabaseSync) => new ErpFactory(db),
      inject: [DatabaseSync]
    },
    {
      provide: Identity,
      useFactory: (db: DatabaseSync) => new Identity(db),
      inject: [DatabaseSync]
    },
    {
      provide: Companies,
      useFactory: (db: DatabaseSync) => new Companies(db),
      inject: [DatabaseSync]
    },
    { provide: APP_GUARD, useClass: AuthGuard }
  ]
})
export class AppModule implements OnApplicationShutdown, NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((request: AuthRequest, _response: unknown, next: () => void) => {
        if (request.socket && agentSockets.has(request.socket))
          request.origin = "agent";
        next();
      })
      .forRoutes("*");
  }

  constructor(@Inject(DatabaseSync) private readonly db: DatabaseSync) {}

  onApplicationShutdown() {
    this.db.close();
  }
}
