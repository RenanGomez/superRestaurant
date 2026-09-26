import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { OperationalWorkTrayV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { OperationalWorkTrayError, OperationalWorkTrayService } from "./operational-work-tray.js";

@Controller("operational-work")
export class OperationalWorkTrayController {
  public constructor(@Inject(OperationalWorkTrayService) private readonly tray: OperationalWorkTrayService) {}

  @Post("tray")
  @Header("Cache-Control", "private, no-store")
  public list(@Req() request: unknown, @Body() body: unknown): Promise<OperationalWorkTrayV1> {
    return this.map(() => this.tray.list(getAuthenticatedPrincipal(request), body));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (!(error instanceof OperationalWorkTrayError)) throw unavailable();
      if (error.code === "request") throw new BadRequestException({ code: "OPERATIONAL_WORK_TRAY_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "OPERATIONAL_WORK_TRAY_UNAVAILABLE" });
}
