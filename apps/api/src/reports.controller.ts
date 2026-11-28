import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Query,
  Res,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { parseBranchDaySummaryRequestV1, type BranchDaySummaryV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { ReportsError, ReportsService } from "./reports.js";
import { daySummaryRows, serializeRfc4180 } from "./reports/export/csv.js";

@Controller("reports")
export class ReportsController {
  public constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Post("day-summary")
  @Header("Cache-Control", "private, no-store")
  public daySummary(@Req() request: unknown, @Body() body: unknown): Promise<BranchDaySummaryV1> {
    return this.map(() => this.reports.daySummary(getAuthenticatedPrincipal(request), body));
  }

  @Get("day-summary/export")
  @Header("Cache-Control", "private, no-store")
  @Header("Content-Type", "text/csv; charset=utf-8")
  public async exportDaySummary(
    @Req() request: unknown,
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<string> {
    const candidate = (value: string | undefined): boolean => typeof value === "string"
      && parseBranchDaySummaryRequestV1({ schemaVersion: 1, scope: validationScope, date: value }) !== undefined;
    const dates = typeof query.date === "string" ? query.date.split(",").filter(candidate) : [];
    if (query.from !== undefined || query.to !== undefined || !candidate(query.date) || dates.length !== 1) {
      throw new BadRequestException({ code: "REPORT_EXPORT_RANGE_REJECTED", acceptedDates: dates.slice(0, 1),
        message: "Una sucursal y un día por petición." });
    }
    if (query.format !== "csv") throw new BadRequestException({ code: "REPORT_EXPORT_FORMAT_REJECTED" });
    const input = { schemaVersion: 1, scope: { restaurantId: query.restaurantId, branchId: query.branchId }, date: query.date };
    if (parseBranchDaySummaryRequestV1(input) === undefined) {
      throw new BadRequestException({ code: "REPORTS_REQUEST_REJECTED" });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let summary: BranchDaySummaryV1;
    try {
      summary = await Promise.race([
        this.map(() => this.reports.daySummary(getAuthenticatedPrincipal(request), input)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new HttpException({ code: "REPORT_EXPORT_TIMEOUT" }, HttpStatus.GATEWAY_TIMEOUT)), 30_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const rows = daySummaryRows(summary);
    assertExportSize(rows.length, 0);
    const csv = serializeRfc4180(rows, { bom: query.bom === "1" });
    assertExportSize(rows.length, Buffer.byteLength(csv, "utf8"));
    const timestamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
    response.setHeader("Content-Disposition", `attachment; filename="day-summary_${query.branchId}_${query.date}_${timestamp}.csv"`);
    return csv;
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

const validationScope = { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" };

export function assertExportSize(rows: number, bytes: number): void {
  const maxRows = 50_000;
  if (rows > maxRows || bytes > 20 * 1024 * 1024) {
    throw new HttpException({ code: "REPORT_EXPORT_TOO_LARGE", rows, maxRows }, HttpStatus.PAYLOAD_TOO_LARGE);
  }
}
