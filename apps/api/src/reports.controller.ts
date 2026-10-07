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
import type { BranchDaySummaryV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { ReportsError, ReportsService } from "./reports.js";

@Controller("reports")
export class ReportsController {
  public constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Post("day-summary")
  @Header("Cache-Control", "private, no-store")
  public daySummary(@Req() request: unknown, @Body() body: unknown): Promise<BranchDaySummaryV1> {
    return this.map(() => this.reports.daySummary(getAuthenticatedPrincipal(request), body));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (!(error instanceof ReportsError)) throw unavailable();
      if (error.code === "request") throw new BadRequestException({ code: "REPORTS_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "REPORTS_UNAVAILABLE" });
}
