import assert from "node:assert/strict";

import type { Json } from "./http-test-harness.js";

// HTTP conflict scenarios for the sync endpoints. The domain/ledger behavior they depend on is
// already covered against a disposable PostgreSQL 17 in `../sync/sync-conflicts.local.test.ts`;
// the end-to-end HTTP half stays deferred until `POST /sync` push and pull are integrated
// (backlog: m2-api-sync-push-merge and m2-api-sync-pull-review). This module probes the routes so
// the deferral is explicit and cannot silently rot: the day the endpoints answer, the probe turns
// red and this catalog becomes the checklist for the HTTP test.
export interface SyncConflictScenario {
  readonly id: string;
  readonly description: string;
  readonly endpoints: readonly string[];
}

export const SYNC_CONFLICT_HTTP_SCENARIOS: readonly SyncConflictScenario[] = Object.freeze([
  { id: "two_devices_add_lines", description: "two offline devices add distinct lines to one order and the server combines them with a server-side total",
    endpoints: ["POST /sync/push", "POST /orders/detail"] },
  { id: "concurrent_same_line_edit", description: "concurrent edits of the same line settle as conflict/manual_review without silently merging",
    endpoints: ["POST /sync/push", "GET /sync/manual-review"] },
  { id: "cancel_vs_kds_preparing", description: "cancellation racing a KDS ticket in preparation never moves the ticket backwards",
    endpoints: ["POST /sync/push", "POST /orders/cancel"] },
  { id: "repeat_payment_same_key", description: "a repeated charge with the same idempotency key returns duplicate and records exactly one payment",
    endpoints: ["POST /sync/push", "GET /payments/checkout"] },
  { id: "surplus_payment_new_key", description: "a second charge with a different key becomes manual_review without double charging",
    endpoints: ["POST /sync/push", "GET /sync/manual-review"] },
  { id: "revoked_actor_and_device", description: "revoked actor and revoked device pushes are rejected by the server",
    endpoints: ["POST /sync/push"] },
  { id: "twenty_concurrent_resends", description: "twenty concurrent resends of one event produce a single effect",
    endpoints: ["POST /sync/push"] },
  { id: "cross_scope_isolation", description: "push, pull, cursor, dedup and tombstone stay isolated across restaurants and branches",
    endpoints: ["POST /sync/push", "POST /sync/pull"] },
  { id: "no_lan_visibility", description: "a device cannot see another device's offline edits before they are synced (no LAN guarantee)",
    endpoints: ["POST /sync/pull"] },
]);

export interface SyncConflictProbeTransport {
  readonly scope: { readonly restaurantId: string; readonly branchId: string };
  send(actor: "manager", method: "POST", path: string, body: unknown): Promise<{ readonly status: number; readonly body: Json }>;
}

export interface SyncConflictProbeResult {
  readonly deferred: readonly string[];
  readonly implemented: boolean;
  readonly probes: readonly { readonly endpoint: string; readonly status: number }[];
}

const MISSING_ROUTE_STATUSES = new Set([404, 405]);

/**
 * Probes the two sync routes with an authenticated manager. A missing route (404/405) means the
 * endpoints are not integrated yet: only the database-level conflict suite can run, so the scenario
 * catalog is reported as deferred instead of being asserted vacuously.
 */
export async function probeSyncConflictEndpoints(transport: SyncConflictProbeTransport): Promise<SyncConflictProbeResult> {
  const probes: { endpoint: string; status: number }[] = [];
  for (const path of ["/sync/push", "/sync/pull"]) {
    const response = await transport.send("manager", "POST", path, {
      protocolVersion: 1, scope: transport.scope, events: [], cursor: null,
    });
    probes.push({ endpoint: path, status: response.status });
  }
  const implemented = probes.every((probe) => !MISSING_ROUTE_STATUSES.has(probe.status));
  return Object.freeze({
    deferred: implemented ? Object.freeze([]) : Object.freeze(SYNC_CONFLICT_HTTP_SCENARIOS.map((scenario) => scenario.id)),
    implemented,
    probes: Object.freeze(probes),
  });
}

/** Fails loudly once the routes exist: the HTTP half must then be implemented, not skipped. */
export function assertSyncConflictEndpointsDeferred(result: SyncConflictProbeResult): void {
  assert.equal(result.implemented, false,
    `sync endpoints now answer (${result.probes.map((probe) => `${probe.endpoint}=${probe.status}`).join(",")}); implement the HTTP conflict flow instead of deferring it`);
  assert.equal(result.deferred.length, SYNC_CONFLICT_HTTP_SCENARIOS.length);
}
