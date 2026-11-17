import { Controller, Get } from "@nestjs/common";
import { Erp } from "../erp";

@Controller("api/dashboard")
export class DashboardController {
  constructor(private readonly erp: Erp) {}

  @Get()
  summary() {
    return this.erp.dashboard();
  }
}
