import { Controller, Get } from "@nestjs/common";

import { Public } from "./auth/authentication.js";

@Controller("health")
@Public()
export class HealthController {
  @Get()
  public getHealth(): Readonly<{ status: "ok" }> {
    return Object.freeze({ status: "ok" });
  }
}
