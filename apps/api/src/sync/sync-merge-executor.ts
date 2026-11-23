import { Inject, Injectable } from "@nestjs/common";
import { createOrder, mergeOrderSyncEvent, transitionOrderStatus, type MergeOrderSyncEventInput } from "@super-restaurant/domain";
import { parseBranchScope, type SyncEnvelopeV1, type SyncEventResultV1 } from "@super-restaurant/shared-types";

import { AUTH_PRINCIPAL_VERIFIER, AccessTokenRejectedError, type AuthPrincipalVerifierPort } from "../auth/authentication.js";
import { DATABASE_CLIENT, type TransactionalDatabaseClientPort } from "../database.js";
import { PostgresBranchOperationalContext } from "../branch-operational-context.js";
import { PostgresMenuCatalogAdapter } from "../menu-catalog.js";
import { PostgresOrderPersistenceAdapter } from "../orders.js";
import { syncLedgerResult } from "./sync-result.js";
import type { SyncEventExecutor } from "./sync-push.service.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

@Injectable()
export class SyncMergeExecutor implements SyncEventExecutor {
  public constructor(
    @Inject(DATABASE_CLIENT) private readonly database: TransactionalDatabaseClientPort,
    @Inject(AUTH_PRINCIPAL_VERIFIER) private readonly verifier: AuthPrincipalVerifierPort,
  ) {}

  public async execute(token: string, event: SyncEnvelopeV1): Promise<SyncEventResultV1 | null> {
    let actor: string;
    try { actor = (await this.verifier.verifyAccessToken(token)).actorId; }
    catch (error: unknown) {
      if (!(error instanceof AccessTokenRejectedError)) throw error;
      return revoked(event, "AUTH_REVOKED");
    }
    if (actor !== event.actorId) return revoked(event, "AUTH_REVOKED");
    if (!uuid.test(event.restaurantId) || !uuid.test(event.branchId)) return revoked(event, "AUTH_REVOKED");
    return this.database.transaction(async (db) => {
      await db.query("SET LOCAL lock_timeout = '2s'", []);
      const auth = await db.query("select app_private.sync_authorized($1::uuid,$2::uuid,$3::uuid) as authorized, app_private.sync_device_state($2::uuid,$3::uuid,$4::text,$1::uuid) as device, app_private.sync_write_allowed($1::uuid,$2::uuid,$3::uuid,$5::text,$6::text) as allowed", [actor, event.restaurantId, event.branchId, event.deviceId, event.entityType, event.operation]);
      const row = auth.rows[0] as { authorized?: boolean; device?: string; allowed?: boolean } | undefined;
      if (row?.authorized !== true || row.allowed !== true) return revoked(event, "AUTH_REVOKED");
      if (row.device !== "active") return revoked(event, "DEVICE_REVOKED");
      const payload = event.payload;
      const creating = event.operation === "create" && event.baseVersion === null
        && !Object.keys(payload).some((key) => !["channel", "currency", "timeZone"].includes(key))
        && payload.channel === "counter" && typeof payload.currency === "string" && typeof payload.timeZone === "string";
      const opening = event.operation === "transition" && event.baseVersion !== null
        && Object.keys(payload).length === 1 && payload.targetStatus === "open";
      if (event.entityType !== "Order" || (!creating && !opening)) {
        const candidate: SyncEventResultV1 = { eventId: event.eventId, idempotencyKey: event.idempotencyKey,
          status: "rejected", code: event.entityType === "Order" ? "UNSUPPORTED_OPERATION" : "UNSUPPORTED_ENTITY",
          canonicalVersion: null, auditId: null };
        const recorded = await db.query("select app_private.sync_record_event($1::uuid,$2::jsonb,$3::jsonb) as result", [actor, JSON.stringify(event), JSON.stringify(candidate)]);
        return syncLedgerResult(event, (recorded.rows[0] as { result?: unknown } | undefined)?.result);
      }
      if (!uuid.test(event.entityId) || !uuid.test(event.eventId) || !uuid.test(event.deviceId)) return null;
      const scope = parseBranchScope({ restaurantId: event.restaurantId, branchId: event.branchId });
      if (scope === undefined) return null;
      const context = await new PostgresBranchOperationalContext(db).select(actor, scope);
      if (context === "forbidden" || (creating && context.timeZone !== payload.timeZone)) return null;
      if (creating) {
        const catalog = await new PostgresMenuCatalogAdapter(db).read(actor, scope);
        if (catalog === "forbidden" || catalog.catalog === null || catalog.catalog.currency !== payload.currency) return null;
      }
      const orders = new PostgresOrderPersistenceAdapter(db);
      const stored = await orders.read(actor, scope, event.entityId);
      const canonical = stored === "missing" ? null : { ...stored.order, version: stored.version };
      const meta = {
        eventId: event.eventId, idempotencyKey: event.idempotencyKey, deviceId: event.deviceId, actorId: actor,
        restaurantId: event.restaurantId, branchId: event.branchId, occurredAt: event.occurredAt, entityId: event.entityId,
      };
      const input: MergeOrderSyncEventInput = { canonical, event: creating
        ? { ...meta, operation: "create", baseVersion: null, channel: "counter", currency: payload.currency as string, timeZone: payload.timeZone as string }
        : { ...meta, operation: "transition", baseVersion: event.baseVersion as number, targetStatus: "open" } };
      const merged = mergeOrderSyncEvent(input);
      const candidate: SyncEventResultV1 = { eventId: event.eventId, idempotencyKey: event.idempotencyKey,
        status: opening && stored !== "missing" && event.baseVersion !== stored.version ? "rejected" : merged.status,
        code: opening && stored !== "missing" && event.baseVersion !== stored.version ? "STALE_BASE_VERSION" : merged.code,
        canonicalVersion: merged.canonicalVersion, auditId: merged.status === "accepted" && (!opening || stored === "missing" || event.baseVersion === stored.version) ? event.eventId : null };
      const recorded = await db.query("select app_private.sync_record_event($1::uuid,$2::jsonb,$3::jsonb) as result", [actor, JSON.stringify(event), JSON.stringify(candidate)]);
      const reply = (recorded.rows[0] as { result?: unknown } | undefined)?.result;
      const result = syncLedgerResult(event, reply);
      if (result?.status === "accepted" && (reply as { status?: string }).status === "recorded") {
        const audit = { eventId: event.eventId, idempotencyKey: event.idempotencyKey, actorId: actor, deviceId: event.deviceId, occurredAt: event.occurredAt };
        const mutation = creating
          ? createOrder({ orderId: event.entityId, restaurantId: event.restaurantId, branchId: event.branchId,
            channel: "counter", currency: payload.currency as string, timeZone: payload.timeZone as string }, audit)
          : stored === "missing" ? null : transitionOrderStatus(stored.order, "open", audit);
        if (mutation === null) throw Object.assign(new Error("SYNC_CONCURRENT_RETRY"), { code: "CONCURRENT_RETRY" });
        const saved = await orders.persist(actor, stored === "missing" ? 0 : stored.version, mutation);
        if (saved.status !== "saved") throw Object.assign(new Error("SYNC_CONCURRENT_RETRY"), { code: "CONCURRENT_RETRY" });
      }
      return result;
    });
  }
}

function revoked(event: SyncEnvelopeV1, code: "AUTH_REVOKED" | "DEVICE_REVOKED"): SyncEventResultV1 {
  return { eventId: event.eventId, idempotencyKey: event.idempotencyKey, status: "rejected", code, canonicalVersion: null, auditId: null };
}
