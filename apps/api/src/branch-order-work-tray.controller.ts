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
import type { BranchOrderWorkTrayV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { BranchOrderWorkTrayError, BranchOrderWorkTrayService } from "./branch-order-work-tray.js";

@Controller("branch-orders")
export class BranchOrderWorkTrayController {
  public constructor(@Inject(BranchOrderWorkTrayService) private readonly tray: BranchOrderWorkTrayService) {}

  @Post("tray")
  @Header("Cache-Control", "private, no-store")
  public list(@Req() request: unknown, @Body() body: unknown): Promise<BranchOrderWorkTrayV1> {
    return this.map(() => this.tray.list(getAuthenticatedPrincipal(request), body));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (!(error instanceof BranchOrderWorkTrayError)) throw unavailable();
      if (error.code === "request") throw new BadRequestException({ code: "BRANCH_ORDER_WORK_TRAY_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "BRANCH_ORDER_WORK_TRAY_UNAVAILABLE" });
}
