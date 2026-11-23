import assert from "node:assert/strict";
import test from "node:test";

import { parseSyncScopeV1, type BranchScope } from "@super-restaurant/shared-types";

import {
  buildCapabilityPreconditions,
  commitOfflineOperation,
  describeCachedSnapshotFreshness,
  describeOfflinePosNotice,
  evaluateOfflinePosAction,
  explainOfflineBlock,
  getOfflinePosPort,
  OFFLINE_BLOCK_EXPLANATIONS,
  OFFLINE_POS_ACTIONS,
  OFFLINE_POS_DEFAULT_CASH_LIMIT_MINOR,
  OFFLINE_POS_MESSAGES,
  OFFLINE_PROHIBITED_OPERATIONS,
  PENDING_SYNC_TICKET_MARKER,
  registerOfflinePosPort,
  type CachedSnapshotInfo,
  type OfflinePosCommitOutcome,
  type OfflinePosPort,
  type OfflinePosSnapshot,
} from "./offline-pos.js";
import type { CapabilityBlockCode } from "@super-restaurant/sync-engine";

const SCOPE: BranchScope = parseSyncScopeV1({
  branchId: "11111111-1111-4111-8111-111111111111",
  restaurantId: "22222222-2222-4222-8222-222222222222",
})!;

const TECHNICAL_PATTERN = /\b(offline|STALE_|AUTH_|SCHEMA_|CLIENT_NOT_SUPPORTED|PHASE3|SESSION_REQUIRED|SNAPSHOTS_REQUIRED|UUID|WAN|LWW|outbox|local_pending)\b/u;

const menuSnapshot: CachedSnapshotInfo = {
  capturedAt: "2026-11-23T17:00:00Z",
  kind: "menu",
  version: 4,
};
const tablesSnapshot: CachedSnapshotInfo = {
  capturedAt: "2026-11-23T17:05:00Z",
  kind: "tables",
  version: 2,
};

function offlineSnapshot(overrides: Partial<OfflinePosSnapshot> = {}): OfflinePosSnapshot {
  return {
    cashRegisterOpen: true,
    cashierShiftOpen: true,
    catalog: menuSnapshot,
    connectivity: "offline",
    deviceId: "66666666-6666-4666-8666-666666666666",
    offlineCashLimitMinor: OFFLINE_POS_DEFAULT_CASH_LIMIT_MINOR,
    offlineCashUsedMinor: 0,
    tables: tablesSnapshot,
    ticketTemplateCached: true,
    ...overrides,
  };
}

test("buildCapabilityPreconditions maps the local snapshot to the capability guard", () => {
  const preconditions = buildCapabilityPreconditions(
    offlineSnapshot({ offlineCashUsedMinor: 150_000, ticketTemplateCached: false }),
    { originatedOnThisDevice: true },
  );
  assert.equal(preconditions.hasValidSession, true);
  assert.equal(preconditions.hasCatalogSnapshots, true);
  assert.equal(preconditions.originatedOnThisDevice, true);
  assert.equal(preconditions.templateCached, false);
  assert.equal(preconditions.withinOfflineCashLimit, true);

  const overLimit = buildCapabilityPreconditions(offlineSnapshot({ offlineCashUsedMinor: 250_000 }));
  assert.equal(overLimit.withinOfflineCashLimit, false);

  const noSnapshots = buildCapabilityPreconditions(offlineSnapshot({ catalog: null }));
  assert.equal(noSnapshots.hasCatalogSnapshots, false);
});

test("cached catalog/tables reads are allowed offline without the local-save copy", () => {
  const catalog = evaluateOfflinePosAction("catalog.read_cached", offlineSnapshot());
  assert.equal(catalog.allowed, true);
  assert.equal(catalog.message, "");

  const tables = evaluateOfflinePosAction("tables.read_cached", offlineSnapshot());
  assert.equal(tables.allowed, true);
});

test("local order creation offline requires cached snapshots and otherwise explains it in Spanish", () => {
  const blocked = evaluateOfflinePosAction("order.create_local", offlineSnapshot({ catalog: null }));
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.decision.reasonCode, "SNAPSHOTS_REQUIRED");
  assert.equal(blocked.message, OFFLINE_BLOCK_EXPLANATIONS.SNAPSHOTS_REQUIRED);

  const allowed = evaluateOfflinePosAction("order.create_local", offlineSnapshot());
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.message, OFFLINE_POS_MESSAGES.localSavedNotShared);
});

test("adding lines to a device-originated order is allowed, but remote-origin edits stay blocked", () => {
  const mismatch = evaluateOfflinePosAction("order.edit_local_origin", offlineSnapshot(), {
    originatedOnThisDevice: false,
  });
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.decision.reasonCode, "REMOTE_ORIGIN_OFFLINE_BLOCKED");
  assert.equal(mismatch.message, OFFLINE_BLOCK_EXPLANATIONS.REMOTE_ORIGIN_OFFLINE_BLOCKED);

  const localOrigin = evaluateOfflinePosAction("order.edit_local_origin", offlineSnapshot(), {
    originatedOnThisDevice: true,
  });
  assert.equal(localOrigin.allowed, true);

  const remote = evaluateOfflinePosAction("order.edit_remote_origin", offlineSnapshot());
  assert.equal(remote.allowed, false);
  assert.equal(remote.decision.reasonCode, "REMOTE_ORIGIN_OFFLINE_BLOCKED");
});

test("supervisor discounts are blocked offline and never queued", () => {
  const result = evaluateOfflinePosAction("discount.apply_supervisor_or_reopen", offlineSnapshot(), {
    requiresSupervisorApproval: true,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.decision.reasonCode, "SUPERVISOR_REQUIRED_ONLINE");
  assert.equal(result.message, OFFLINE_BLOCK_EXPLANATIONS.SUPERVISOR_REQUIRED_ONLINE);
});

test("offline cash collect enforces open register/shift and the local cash limit", () => {
  const noRegister = evaluateOfflinePosAction("payment.cash_collect", offlineSnapshot({ cashRegisterOpen: false }));
  assert.equal(noRegister.allowed, false);
  assert.equal(noRegister.decision.reasonCode, "CASH_REGISTER_REQUIRED");

  const noShift = evaluateOfflinePosAction("payment.cash_collect", offlineSnapshot({ cashierShiftOpen: false }));
  assert.equal(noShift.decision.reasonCode, "CASH_REGISTER_REQUIRED");

  const overLimit = evaluateOfflinePosAction("payment.cash_collect", offlineSnapshot({ offlineCashUsedMinor: 250_000 }));
  assert.equal(overLimit.allowed, false);
  assert.equal(overLimit.decision.reasonCode, "OFFLINE_CASH_LIMIT_EXCEEDED");

  const allowed = evaluateOfflinePosAction("payment.cash_collect", offlineSnapshot({ offlineCashUsedMinor: 50_000 }));
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.message, OFFLINE_POS_MESSAGES.localSavedNotShared);
});

test("prohibited Phase 3 operations are rejected offline with explicit Spanish explanations", () => {
  const closed = evaluateOfflinePosAction("cash_register.close_or_reopen", offlineSnapshot());
  assert.equal(closed.allowed, false);
  assert.equal(closed.decision.reasonCode, "OFFLINE_NOT_SUPPORTED");

  for (const action of ["payment.refund_or_void", "fiscal.cfdi_stamp", "inventory.adjust_or_receive", "payment.gateway_or_terminal_integrated"] as const) {
    const result = evaluateOfflinePosAction(action, offlineSnapshot());
    assert.equal(result.allowed, false, `${action} must stay blocked offline`);
    assert.equal(result.decision.reasonCode, "PHASE3_UNSUPPORTED", `${action} reason`);
    assert.equal(result.message, OFFLINE_BLOCK_EXPLANATIONS.PHASE3_UNSUPPORTED);
  }
});

test("online operation is not gated by offline-only preconditions", () => {
  const result = evaluateOfflinePosAction("order.create_local", offlineSnapshot({
    catalog: null,
    connectivity: "online",
    tables: null,
  }));
  assert.equal(result.allowed, true);
  assert.equal(result.message, "");
});

test("every capability block code has non-empty Spanish copy without technical jargon", () => {
  const codes = Object.keys(OFFLINE_BLOCK_EXPLANATIONS) as CapabilityBlockCode[];
  assert.ok(codes.length >= 16);
  for (const code of codes) {
    const text = explainOfflineBlock(code);
    assert.ok(text.length > 0, `${code} needs copy`);
    assert.equal(TECHNICAL_PATTERN.test(text), false, `${code} leaks jargon: ${text}`);
  }
});

test("OFFLINE_PROHIBITED_OPERATIONS are complete, unique and operator-facing", () => {
  const ids = new Set<string>();
  for (const operation of OFFLINE_PROHIBITED_OPERATIONS) {
    assert.equal(ids.has(operation.id), false, `duplicate ${operation.id}`);
    ids.add(operation.id);
    assert.ok(operation.label.length > 0);
    assert.ok(operation.message.length > 0);
    assert.equal(TECHNICAL_PATTERN.test(operation.message), false);
  }
  // Every evaluated action is declared in the shared action list.
  assert.ok(OFFLINE_POS_ACTIONS.includes("payment.cash_collect"));
});

test("describeCachedSnapshotFreshness shows version/date and flags stale snapshots", () => {
  const now = new Date("2026-11-23T18:00:00Z");
  const fresh = describeCachedSnapshotFreshness(menuSnapshot, now);
  assert.equal(fresh.stale, false);
  assert.match(fresh.label, /Menú en caché/u);
  assert.match(fresh.label, /versión 4/u);

  const stale = describeCachedSnapshotFreshness(
    { capturedAt: "2026-11-20T10:00:00Z", kind: "tables", version: 2 },
    now,
  );
  assert.equal(stale.stale, true);
  assert.match(stale.label, /desactualizados/u);
});

test("commitOfflineOperation only announces local_pending after a durable atomic commit", async () => {
  // No bridge registered yet -> honest unavailable, never pending.
  registerOfflinePosPort(undefined);
  assert.equal(getOfflinePosPort(), undefined);
  const unavailable = await commitOfflineOperation({
    deviceId: offlineSnapshot().deviceId,
    idempotencyKey: "op-1",
    kind: "order_create",
    occurredAt: "2026-11-23T18:00:00Z",
    scope: SCOPE,
  });
  assert.equal(unavailable.localState, "unavailable");
  assert.equal(unavailable.code, "STORAGE_UNAVAILABLE");

  const outcomeOf = (outcome: OfflinePosCommitOutcome | null, throws = false): OfflinePosPort => ({
    commitLocalOperation: async () => {
      if (throws) throw new Error("boom");
      return outcome;
    },
    getSnapshot: () => offlineSnapshot(),
  });

  const notCommitted = await commitOfflineOperation(
    { deviceId: "d", idempotencyKey: "op-2", kind: "cash_collect", occurredAt: "2026-11-23T18:00:00Z", scope: SCOPE },
    outcomeOf({ code: "STORAGE_COMMIT_FAILED", committed: false, eventId: "e1" }),
  );
  assert.equal(notCommitted.localState, "rejected");

  const missingEvent = await commitOfflineOperation(
    { deviceId: "d", idempotencyKey: "op-3", kind: "order_create", occurredAt: "2026-11-23T18:00:00Z", scope: SCOPE },
    outcomeOf({ code: null, committed: true, eventId: null }),
  );
  assert.equal(missingEvent.localState, "rejected");

  const committed = await commitOfflineOperation(
    { deviceId: "d", idempotencyKey: "op-4", kind: "order_create", occurredAt: "2026-11-23T18:00:00Z", scope: SCOPE },
    outcomeOf({ code: null, committed: true, eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  );
  assert.equal(committed.localState, "local_pending");
  assert.equal(committed.eventId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

  const threw = await commitOfflineOperation(
    { deviceId: "d", idempotencyKey: "op-5", kind: "order_create", occurredAt: "2026-11-23T18:00:00Z", scope: SCOPE },
    outcomeOf({ code: null, committed: true, eventId: "b" }, true),
  );
  assert.equal(threw.localState, "rejected");
});

test("describeOfflinePosNotice is hidden online and honest about storage when offline", () => {
  assert.equal(describeOfflinePosNotice({ browserOnline: true, snapshot: null }), null);
  assert.equal(
    describeOfflinePosNotice({ browserOnline: true, snapshot: offlineSnapshot({ connectivity: "online" }) }),
    null,
  );

  const noStorage = describeOfflinePosNotice({ browserOnline: false, snapshot: null });
  assert.ok(noStorage !== null);
  assert.equal(noStorage.tone, "warning");
  assert.equal(noStorage.message, OFFLINE_POS_MESSAGES.storageUnavailable);
  assert.equal(noStorage.allowed.length, 0);

  const ready = describeOfflinePosNotice({
    browserOnline: false,
    now: new Date("2026-11-23T18:00:00Z"),
    snapshot: offlineSnapshot(),
  });
  assert.ok(ready !== null);
  assert.equal(ready.tone, "info");
  assert.equal(ready.snapshots.length, 2);
  assert.equal(ready.allowed.length, 3);
  assert.ok(ready.blocked.length >= 5);
});

test("the pending ticket marker is the exact acceptance phrase", () => {
  assert.equal(PENDING_SYNC_TICKET_MARKER, "Pendiente de sincronizar (solo este dispositivo)");
  assert.equal(OFFLINE_POS_MESSAGES.localPending, PENDING_SYNC_TICKET_MARKER);
});
