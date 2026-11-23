import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { parseBranchScope, parseManualReviewCaseV1, parseResolveManualReviewCaseCommandV1 } from "@super-restaurant/shared-types";
import { DATABASE_CLIENT, type TransactionalDatabaseClientPort } from "../database.js";

@Injectable()
export class SyncManualReviewService {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: TransactionalDatabaseClientPort) {}
  public async list(actor: string, input: unknown): Promise<readonly unknown[]> {
    const scope = parseBranchScope(input);
    if (!scope) throw new BadRequestException({ code: "SYNC_REQUEST_INVALID" });
    try {
      return await this.database.transaction(async (db) => {
        const result = await db.query("select * from app_private.sync_read_reviews($1::uuid,$2::uuid,$3::uuid)", [actor, scope.restaurantId, scope.branchId]);
        return result.rows.map((row) => {
          const record = row as { case_data?: Record<string, unknown>; event_data?: Record<string, unknown>; facts?: Record<string, unknown> | null };
          const c = record.case_data; const e = record.event_data; const f = record.facts;
          if (!c || !e || !f) throw new ServiceUnavailableException({ code: "SYNC_REVIEW_FACTS_UNAVAILABLE" });
          const timestamp = (value: unknown): string | null => value === null ? null : new Date(String(value)).toISOString();
          const parsed = parseManualReviewCaseV1({ schemaVersion: 1, caseId: c["case_id"], scope, eventId: c["event_id"], idempotencyKey: e["idempotency_key"], deviceId: e["device_id"], actorId: e["actor_id"], entityType: e["entity_type"], entityId: e["entity_id"], operation: e["operation"], reasonCode: c["reason_code"], financial: e["financial"], status: c["status"], baseVersion: f["base_version"], canonicalVersion: (e["result"] as Record<string, unknown> | undefined)?.["canonicalVersion"] ?? null, amountMinor: f["amount_minor"] ?? null, currency: f["currency"] ?? null, openedAt: timestamp(c["opened_at"]), resolvedAt: timestamp(c["resolved_at"]), resolvedByActorId: c["resolved_by_actor_id"], resolutionReason: c["resolution_reason"], compensatingEventId: c["compensating_event_id"], auditId: (e["result"] as Record<string, unknown> | undefined)?.["auditId"] ?? null });
          if (!parsed) throw new ServiceUnavailableException({ code: "SYNC_REVIEW_FACTS_INVALID" });
          return parsed;
        });
      });
    } catch (error) { return this.handle(error); }
  }
  public async resolve(actor: string, input: unknown): Promise<{ status: string }> {
    const command = parseResolveManualReviewCaseCommandV1(input);
    if (!command) throw new BadRequestException({ code: "SYNC_REQUEST_INVALID" });
    try {
      return await this.database.transaction(async (db) => {
        const response = await db.query("select app_private.sync_resolve_review_command($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text) as result", [actor, command.scope.restaurantId, command.scope.branchId, command.caseId, command.decision, command.reason, command.compensatingEventId, command.idempotencyKey, command.deviceId, command.occurredAt]);
        const result = (response.rows[0] as { result?: string } | undefined)?.result;
        if (result === "denied") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (result !== "resolved" && result !== "duplicate") throw new ConflictException({ code: "SYNC_REVIEW_CONFLICT" });
        return { status: result };
      });
    } catch (error) { return this.handle(error); }
  }
  private handle(error: unknown): never {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "42501") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
    throw error;
  }
}
