import assert from "node:assert/strict";

import type { Json } from "./http-test-harness.js";

// HTTP driver and coverage checklist for the multi-device sync conflict suite.
//
// Two boundaries coexist because they are reached by different transports:
//  - `http`: the real `POST /sync/devices`, `POST /sync/push`, `POST /sync/pull`,
//    `GET /sync/manual-review` and `POST /sync/manual-review` routes mounted by AppModule.
//  - `ledger`: the security-definer functions the business writers call for effects the sync push
//    executor does not model yet (order lines and totals, KDS tickets, payments). Those functions
//    (`sync_record_event`, `sync_append_change`, `sync_open_review`) are the conflict boundary the
//    suite drives directly, exactly as the future business writers will.
// Every scenario below must be reported by the test through `assertSyncConflictScenariosCovered`, so
// adding an endpoint or a conflict case without asserting it turns the suite red.

export interface SyncScope {
  readonly restaurantId: string;
  readonly branchId: string;
}

export type SyncHttpMethod = "GET" | "POST";

export interface SyncConflictHttpTransport {
  send(actor: string, method: SyncHttpMethod, path: string, body?: unknown): Promise<{ readonly status: number; readonly body: Json }>;
}

export type SyncConflictBoundary = "http" | "ledger";

export interface SyncConflictScenario {
  readonly id: string;
  readonly description: string;
  readonly boundary: SyncConflictBoundary;
  readonly endpoints: readonly string[];
}

export const SYNC_CONFLICT_SCENARIOS: readonly SyncConflictScenario[] = Object.freeze([
  { id: "two_devices_add_lines", boundary: "ledger",
    description: "two offline devices add distinct lines to one order and the canonical snapshot carries the server-side total",
    endpoints: ["app_private.sync_record_event", "app_private.sync_append_change", "POST /sync/pull"] },
  { id: "concurrent_same_line_edit", boundary: "ledger",
    description: "concurrent edits of the same line settle as one canonical version plus conflict/manual_review without silently merging",
    endpoints: ["app_private.sync_append_change", "app_private.sync_open_review", "GET /sync/manual-review"] },
  { id: "cancel_vs_kds_preparing", boundary: "ledger",
    description: "cancellation racing a KDS ticket in preparation never moves the ticket backwards",
    endpoints: ["app_private.sync_record_event", "app_private.sync_append_change", "POST /sync/pull"] },
  { id: "repeat_payment_same_key", boundary: "ledger",
    description: "a repeated charge with the same idempotency key returns duplicate and records exactly one ledger effect",
    endpoints: ["app_private.sync_record_event"] },
  { id: "surplus_payment_new_key", boundary: "ledger",
    description: "a second charge with a different key becomes manual_review without a second effect",
    endpoints: ["app_private.sync_record_event", "app_private.sync_open_review"] },
  { id: "revoked_actor_and_device", boundary: "http",
    description: "revoked actor and revoked device pushes are rejected by the server",
    endpoints: ["POST /sync/push"] },
  { id: "twenty_concurrent_resends", boundary: "http",
    description: "twenty concurrent resends of one event produce a single ledger effect",
    endpoints: ["POST /sync/push"] },
  { id: "cross_scope_isolation", boundary: "http",
    description: "push, pull, cursor, dedup and tombstone stay isolated across restaurants and branches",
    endpoints: ["POST /sync/push", "POST /sync/pull", "POST /sync/devices"] },
  { id: "no_lan_visibility", boundary: "http",
    description: "a device cannot see another device's offline edits before they are synced through the changelog (no LAN guarantee)",
    endpoints: ["POST /sync/pull"] },
  { id: "two_device_registration", boundary: "http",
    description: "device registration is scoped, idempotent and non-transferable over the HTTP route",
    endpoints: ["POST /sync/devices"] },
  { id: "manual_review_http", boundary: "http",
    description: "manual review cases are listed and resolved over HTTP with idempotency and tenant isolation",
    endpoints: ["GET /sync/manual-review", "POST /sync/manual-review"] },
]);

/** Fails when a catalogued scenario was not exercised or an unknown id is reported. */
export function assertSyncConflictScenariosCovered(covered: readonly string[]): void {
  const known = SYNC_CONFLICT_SCENARIOS.map((scenario) => scenario.id);
  const missing = known.filter((id) => !covered.includes(id));
  assert.deepEqual(missing, [], `uncovered sync conflict scenarios: ${missing.join(",")}`);
  const unknown = covered.filter((id) => !known.includes(id));
  assert.deepEqual(unknown, [], `unknown sync conflict scenarios: ${unknown.join(",")}`);
}

export function registerDeviceBody(deviceId: string, scope: SyncScope): Json {
  return { deviceId, scope };
}

export function pushBody(deviceId: string, scope: SyncScope, events: readonly Json[]): Json {
  return { protocolVersion: 1, deviceId, scope, events };
}

export function pullBody(deviceId: string, scope: SyncScope, cursor: string | null, limit = 10): Json {
  return { protocolVersion: 1, deviceId, scope, cursor, limit };
}

export interface ResolveReviewInput {
  readonly caseId: string;
  readonly decision: "compensate" | "reject";
  readonly reason: string;
  readonly compensatingEventId: string | null;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly occurredAt: string;
}

export function resolveReviewBody(scope: SyncScope, input: ResolveReviewInput): Json {
  return { schemaVersion: 1, scope, ...input };
}

export async function registerSyncDevice(transport: SyncConflictHttpTransport, actor: string, scope: SyncScope, deviceId: string): Promise<{ readonly status: number; readonly body: Json }> {
  return transport.send(actor, "POST", "/sync/devices", registerDeviceBody(deviceId, scope));
}

export async function pushSyncEvents(transport: SyncConflictHttpTransport, actor: string, deviceId: string, scope: SyncScope, events: readonly Json[]): Promise<{ readonly status: number; readonly body: Json }> {
  return transport.send(actor, "POST", "/sync/push", pushBody(deviceId, scope, events));
}

export async function pullSyncChanges(transport: SyncConflictHttpTransport, actor: string, deviceId: string, scope: SyncScope, cursor: string | null, limit = 10): Promise<{ readonly status: number; readonly body: Json }> {
  return transport.send(actor, "POST", "/sync/pull", pullBody(deviceId, scope, cursor, limit));
}

export async function listSyncManualReviews(transport: SyncConflictHttpTransport, actor: string, scope: SyncScope): Promise<{ readonly status: number; readonly body: Json }> {
  return transport.send(actor, "GET", `/sync/manual-review?${new URLSearchParams({ restaurantId: scope.restaurantId, branchId: scope.branchId }).toString()}`);
}

export async function resolveSyncManualReview(transport: SyncConflictHttpTransport, actor: string, scope: SyncScope, input: ResolveReviewInput): Promise<{ readonly status: number; readonly body: Json }> {
  return transport.send(actor, "POST", "/sync/manual-review", resolveReviewBody(scope, input));
}

/** Narrows the `results` array of a push response without trusting its element type. */
export function syncPushResults(body: Json): readonly Json[] {
  const results = body["results"];
  assert.ok(Array.isArray(results), "push response must carry a results array");
  return results as readonly Json[];
}

/** Narrows the `changes` array of a pull response. */
export function syncPullChanges(body: Json): readonly Json[] {
  const changes = body["changes"];
  assert.ok(Array.isArray(changes), "pull response must carry a changes array");
  return changes as readonly Json[];
}
