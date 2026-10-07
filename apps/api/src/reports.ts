import { Inject, Injectable } from "@nestjs/common";
import {
  parseBranchDaySummaryRequestV1,
  parseBranchDaySummaryV1,
  type BranchDaySummaryRequestV1,
  type BranchDaySummaryV1,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const daySummarySql = "select app_private.read_branch_day_summary($1::uuid, $2::jsonb) as result";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ReportsErrorCode = "authorization" | "request" | "unavailable";

export class ReportsError extends Error {
  public constructor(public readonly code: ReportsErrorCode) {
    super(`REPORTS_${code.toUpperCase()}`);
    this.name = "ReportsError";
  }
}

export interface BranchDaySummaryPort {
  daySummary(actorId: string, request: BranchDaySummaryRequestV1): Promise<unknown>;
}

export const BRANCH_DAY_SUMMARY_PORT = Symbol("BRANCH_DAY_SUMMARY_PORT");

@Injectable()
export class PostgresBranchDaySummary implements BranchDaySummaryPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async daySummary(actorId: string, input: BranchDaySummaryRequestV1): Promise<unknown> {
    const request = parseBranchDaySummaryRequestV1(input);
    if (!UUID_PATTERN.test(actorId) || request === undefined) throw new ReportsError("unavailable");
    let rows: readonly unknown[];
    try {
      rows = (await this.database.query(daySummarySql, [actorId, JSON.stringify(request)])).rows;
    } catch { throw new ReportsError("unavailable"); }
    if (rows.length !== 1) throw new ReportsError("unavailable");
    const row = rows[0];
    if (row === null || typeof row !== "object" || Array.isArray(row) || Object.getPrototypeOf(row) !== Object.prototype
      || Reflect.ownKeys(row).length !== 1) throw new ReportsError("unavailable");
    const descriptor = Object.getOwnPropertyDescriptor(row, "result");
    if (descriptor === undefined || !("value" in descriptor)) throw new ReportsError("unavailable");
    return descriptor.value;
  }
}

@Injectable()
export class ReportsService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(BRANCH_DAY_SUMMARY_PORT) private readonly summaries: BranchDaySummaryPort,
  ) {}

  /** `reports.read` in the exact Branch; the SQL reader revalidates membership and role before reading anything. */
  public async daySummary(principal: AuthenticatedPrincipal, input: unknown): Promise<BranchDaySummaryV1> {
    const request = parseBranchDaySummaryRequestV1(input);
    if (request === undefined) throw new ReportsError("request");
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, request.scope, "reports.read");
      actorId = authorized.principal.actorId;
    } catch { throw new ReportsError("authorization"); }
    let raw: unknown;
    try { raw = await this.summaries.daySummary(actorId, request); } catch { throw new ReportsError("unavailable"); }
    const status = statusOf(raw);
    if (status === "denied") throw new ReportsError("authorization");
    if (status === "rejected") throw new ReportsError("request");
    if (status !== undefined) throw new ReportsError("unavailable");
    const summary = parseBranchDaySummaryV1(raw);
    // Defence in depth: the answer must be about exactly the Branch and day that were asked for.
    if (summary === undefined || summary.date !== request.date
      || summary.scope.restaurantId !== request.scope.restaurantId
      || summary.scope.branchId !== request.scope.branchId) throw new ReportsError("unavailable");
    return summary;
  }
}

function statusOf(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== 1 || keys[0] !== "status") return undefined;
  const value = Object.getOwnPropertyDescriptor(raw, "status")?.value;
  return typeof value === "string" ? value : "unknown";
}
