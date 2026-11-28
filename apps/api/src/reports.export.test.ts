import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException, HttpException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { parseBranchScope, type BranchDaySummaryV1 } from "@super-restaurant/shared-types";

import { SupabaseAuthGuard } from "./auth/authentication.js";
import { ReportsController, assertExportSize } from "./reports.controller.js";
import { daySummaryRows, serializeRfc4180 } from "./reports/export/csv.js";
import { ReportsError, type ReportsService } from "./reports.js";

const scope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const query = { ...scope, date: "2026-10-05", format: "csv" };
const summary: BranchDaySummaryV1 = {
  schemaVersion: 1, scope, date: query.date, timeZone: "America/Hermosillo", currency: "MXN",
  salesByChannel: [], salesByMethod: [], shifts: [],
  totals: { paymentCount: 0, salesMinor: 0, tipsMinor: 0, cashTipsMinor: 0 },
  ordersPaid: { count: 0, amountMinor: 0 }, deliveryFees: { orderCount: 0, amountMinor: 0 },
  deliveriesSettled: { count: 0, cashCollectedMinor: 0 }, cancellations: { orders: 0, captures: 0, refundPendingMinor: 0 },
};

async function authenticatedRequest(): Promise<object> {
  const request = { headers: { authorization: `Bearer ${"t".repeat(40)}` }, ip: "127.0.0.1" };
  const guard = new SupabaseAuthGuard({ verifyAccessToken: async () => ({ actorId: "aa9a25b7-3c6a-4c0e-8f2e-9e4c5a6b7c8d" }) }, new Reflector());
  await guard.canActivate({ getHandler: () => ReportsController.prototype.exportDaySummary, getClass: () => ReportsController,
    switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext);
  return request;
}

function setup(daySummary: ReportsService["daySummary"] = async () => summary) {
  const controller = new ReportsController({ daySummary } as ReportsService);
  const headers: Record<string, string> = {};
  const response = { setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; } };
  return { controller, headers, response };
}

function code(error: unknown): unknown {
  return error instanceof HttpException ? error.getResponse() : undefined;
}

test("CSV uses serializer, sets download headers and supports BOM", async () => {
  const { controller, headers, response } = setup();
  const request = await authenticatedRequest();
  const before = new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  const csv = await controller.exportDaySummary(request, query, response);
  const after = new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  const filename = headers["content-disposition"];
  assert.ok(filename === `attachment; filename="day-summary_${scope.branchId}_${query.date}_${before}.csv"`
    || filename === `attachment; filename="day-summary_${scope.branchId}_${query.date}_${after}.csv"`);
  const metadata = Reflect.getMetadata("__headers__", ReportsController.prototype.exportDaySummary) as { name: string; value: string }[];
  assert.ok(metadata.some((header) => header.name.toLowerCase() === "content-type" && header.value === "text/csv; charset=utf-8"));
  assert.equal(csv, serializeRfc4180(daySummaryRows(summary)));
  assert.ok(csv.length > 0);
  assert.ok(!csv.startsWith("\uFEFF"));
  assert.ok((await controller.exportDaySummary(request, { ...query, bom: "1" }, response)).startsWith("\uFEFF"));
});

test("authorization and invalid requests retain their error codes", async () => {
  const request = await authenticatedRequest();
  const { controller, response } = setup(async () => { throw new ReportsError("authorization"); });
  await assert.rejects(controller.exportDaySummary(request, query, response), (error: unknown) =>
    error instanceof ForbiddenException && (code(error) as { code: string }).code === "ACTION_NOT_AUTHORIZED");
  for (const invalid of [{ ...query, date: "2026-02-30" }, { ...query, from: query.date, to: query.date }]) {
    await assert.rejects(controller.exportDaySummary(request, invalid, response), (error: unknown) =>
      error instanceof BadRequestException && (code(error) as { code: string }).code === "REPORT_EXPORT_RANGE_REJECTED");
  }
  await assert.rejects(controller.exportDaySummary(request, { ...query, from: query.date }, response), (error: unknown) =>
    error instanceof BadRequestException && JSON.stringify((code(error) as { acceptedDates: string[] }).acceptedDates) === JSON.stringify([query.date]));
  await assert.rejects(controller.exportDaySummary(request, { ...query, format: "xlsx" }, response), (error: unknown) =>
    error instanceof BadRequestException && (code(error) as { code: string }).code === "REPORT_EXPORT_FORMAT_REJECTED");
  await assert.rejects(controller.exportDaySummary(request, { ...query, restaurantId: "bad" }, response), (error: unknown) =>
    error instanceof BadRequestException && (code(error) as { code: string }).code === "REPORTS_REQUEST_REJECTED");
});

test("size limits reject without serializing a partial response", () => {
  assert.doesNotThrow(() => assertExportSize(50_000, 20 * 1024 * 1024));
  for (const [rows, bytes] of [[50_001, 0], [1, 20 * 1024 * 1024 + 1]] as const) {
    assert.throws(() => assertExportSize(rows, bytes), (error: unknown) => error instanceof HttpException
      && error.getStatus() === 413 && JSON.stringify(code(error)) === JSON.stringify({ code: "REPORT_EXPORT_TOO_LARGE", rows, maxRows: 50_000 }));
  }
});
