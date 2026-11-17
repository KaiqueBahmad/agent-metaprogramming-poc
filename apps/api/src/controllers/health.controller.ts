import { Public } from "../auth";
import { Controller, Get } from "@nestjs/common";

@Public()
@Controller("api/health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}
