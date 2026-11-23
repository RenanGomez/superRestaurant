import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Client } from "pg";

import { assertSyncConflictEndpointsDeferred, probeSyncConflictEndpoints } from "../operations/http-flow-sync-conflicts.js";
import { bootstrapHttpApp } from "../operations/http-test-app.js";
import { HTTP_TEST_ACTORS, provisionHttpFixtures, type HttpTestActorName } from "../operations/http-test-fixtures.js";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres } from "../operations/local-postgres.js";

// Multi-device sync conflict coverage against a disposable local PostgreSQL 17 cluster (never
// remote). The HTTP push/pull endpoints are not integrated yet (backlog m2-api-sync-push-merge and
// m2-api-sync-pull-review), so this suite drives the real server-side ledger functions the future
// endpoint will call: device registration/revocation, cross-tenant and cross-branch isolation,
// event/idempotency/sequence dedup, 20 concurrent resends, cursor/tombstone ordering,
// manual_review open/resolve with compensation, and the absence of LAN visibility between devices.
// The HTTP-only half (combined totals, KDS regression, single payment effect) is catalogued in
// `../operations/http-flow-sync-conflicts.ts` and reported as deferred.
// Opt-in only: `pnpm --filter @super-restaurant/api run test:sync-conflicts:local -- --local-disposable-only`.

type Json = Record<string, unknown>;

const marker = "LOCAL_SYNC_CONFLICTS_ONLY";
const argv = process.argv.filter((argument) => argument !== "--");
const nowIso = (): string => new Date().toISOString();

interface EnvelopeInput {
  readonly actorId: string;
  readonly baseVersion: number | null;
  readonly deviceId: string;
  readonly entityId: string;
  readonly entityType: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly localSequence: number;
  readonly operation: string;
  readonly payload: Json;
  readonly scope: { readonly branchId: string; readonly restaurantId: string };
}

function envelope(input: EnvelopeInput): Json {
  return {
    eventId: input.eventId, idempotencyKey: input.idempotencyKey, deviceId: input.deviceId, actorId: input.actorId,
    restaurantId: input.scope.restaurantId, branchId: input.scope.branchId, entityType: input.entityType, entityId: input.entityId,
    operation: input.operation, schemaVersion: "1", localSequence: input.localSequence, baseVersion: input.baseVersion,
    occurredAt: nowIso(), receivedAt: null, payload: input.payload, retryCount: 0, localState: "pending",
  };
}

async function record(client: Client, actorId: string, event: Json, result: Json = { effect: "payment-1" }): Promise<Json> {
  const query = await client.query("select app_private.sync_record_event($1,$2::jsonb,$3::jsonb) as out", [actorId, JSON.stringify(event), JSON.stringify(result)]);
  return query.rows[0].out as Json;
}

async function count(client: Client, sql: string, parameters: readonly unknown[] = []): Promise<number> {
  const query = await client.query(sql, [...parameters]);
  return Number(query.rows[0].count);
}

function assertPgError(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === code;
}

async function openClients(url: string, quantity: number): Promise<Client[]> {
  const clients = Array.from({ length: quantity }, () => new Client({
    connectionString: url, connectionTimeoutMillis: 5_000, query_timeout: 30_000, statement_timeout: 30_000,
  }));
  for (const client of clients) await client.connect();
  return clients;
}

test("sync conflicts: device revocation, dedup, concurrent resends, isolation, cursor, manual review", async () => {
  if (process.env.HTTP_TEST_MODE !== undefined && process.env.HTTP_TEST_MODE !== "local") throw new Error("LOCAL_CONFIRMATION_REQUIRED");
  assertLocalConfirmation(argv);
  const local = new LocalPostgres({ marker, databasePrefix: "superrestaurant_sync_conflicts", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
  let app: Awaited<ReturnType<typeof bootstrapHttpApp>> | undefined;
  const extraClients: Client[] = [];
  const checks: string[] = [];
  const check = (name: string): void => { checks.push(name); };
  try {
    await local.start();
    await local.applyMigrations(listMigrationNames());
    await local.enableAppApiLogin();
    const admin = local.admin;
    const fixtures = await provisionHttpFixtures(admin);
    const managerA = fixtures.actorIds.manager;
    const cashierA = fixtures.actorIds.cashier;
    const managerB = fixtures.actorIds.other_restaurant_manager;
    const branchA2 = randomUUID();
    await admin.query("insert into app.branches(id,restaurant_id,name) values ($1,$2,'http-flow branch A2')", [branchA2, fixtures.restaurantA]);
    for (const [name, role] of [["manager", "manager"], ["cashier", "cashier"]] as const) {
      const membershipId = randomUUID();
      await admin.query("insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values ($1,$2,$3,$4,$5)",
        [membershipId, fixtures.actorIds[name], fixtures.restaurantA, branchA2, managerA]);
      await admin.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values ($1,$2,$3)", [membershipId, role, managerA]);
    }
    const scopeA1 = { restaurantId: fixtures.restaurantA, branchId: fixtures.branchA };
    const scopeA2 = { restaurantId: fixtures.restaurantA, branchId: branchA2 };
    const scopeB = { restaurantId: fixtures.restaurantB, branchId: fixtures.branchB };
    const apiUrl = local.appApiUrl;
    const api = new Client({ connectionString: apiUrl, connectionTimeoutMillis: 5_000, query_timeout: 30_000, statement_timeout: 30_000 });
    await api.connect();
    extraClients.push(api);

    // 1. Device registration: scoped, idempotent, tied to its actor, and never transferable.
    const register = async (actor: string, scope: { branchId: string; restaurantId: string }, device: string): Promise<boolean> => {
      const query = await api.query("select app_private.sync_register_device($1,$2,$3,$4) as out", [actor, scope.restaurantId, scope.branchId, device]);
      return query.rows[0].out === true;
    };
    const dedupDevice = "sync-device-dedup";
    const revokeDevice = "sync-device-revoke";
    assert.equal(await register(managerA, scopeA1, dedupDevice), true);
    assert.equal(await register(managerA, scopeA1, dedupDevice), true);
    assert.equal(await register(managerA, scopeA1, revokeDevice), true);
    assert.equal(await register(cashierA, scopeA1, revokeDevice), false, "a device cannot be re-registered to another authorized actor");
    assert.equal(await register(managerA, scopeA2, "sync-device-a2"), true);
    assert.equal(await register(managerB, scopeB, "sync-device-b"), true);
    assert.equal(await register(managerB, scopeA1, "sync-device-cross"), false, "a foreign actor cannot register inside restaurant A");
    check("device_registration_scoped_and_non_transferable");

    // 2. Revocation: only the owner or a supervisor may revoke; a revoked device is rejected even
    // after re-registration, and a revoked membership no longer authorizes records.
    const revoke = async (actor: string, scope: { branchId: string; restaurantId: string }, device: string): Promise<boolean> => {
      const query = await api.query("select app_private.sync_revoke_device($1,$2,$3,$4) as out", [actor, scope.restaurantId, scope.branchId, device]);
      return query.rows[0].out === true;
    };
    assert.equal(await revoke(cashierA, scopeA1, revokeDevice), false, "cashier cannot revoke a manager's device");
    assert.equal(await revoke(managerA, scopeA1, revokeDevice), true);
    assert.equal(await revoke(managerA, scopeA1, revokeDevice), false, "second revocation is a no-op");
    assert.equal(await register(managerA, scopeA1, revokeDevice), false, "a revoked device cannot come back by re-registering");
    const revokedEvent = envelope({ actorId: managerA, baseVersion: null, deviceId: revokeDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 1 }, scope: scopeA1 });
    assert.deepEqual(await record(api, managerA, revokedEvent), { status: "denied" });
    const courierMembership = await admin.query("update app.memberships set revoked_at = now(), revoked_by = $1, revocation_reason = 'sync conflict test' where user_id = $2 and revoked_at is null",
      [managerA, fixtures.actorIds.courier]);
    assert.ok((courierMembership.rowCount ?? 0) > 0);
    const revokedActorEvent = envelope({ actorId: fixtures.actorIds.courier, baseVersion: null, deviceId: "sync-device-revoked-actor", entityId: randomUUID(),
      entityType: "Payment", eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 1 }, scope: scopeA1 });
    assert.deepEqual(await record(api, fixtures.actorIds.courier, revokedActorEvent), { status: "denied" });
    check("revoked_device_and_revoked_actor_rejected");

    // 3. Twenty concurrent resends of one event produce a single ledger effect; late duplicates
    // resolve to `duplicate` with the original result.
    const concurrentEvent = envelope({ actorId: managerA, baseVersion: null, deviceId: dedupDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 25_000 }, scope: scopeA1 });
    const concurrent = await openClients(apiUrl, 20);
    try {
      const outcomes = await Promise.all(concurrent.map((client) => record(client, managerA, concurrentEvent)));
      const statuses = outcomes.map((outcome) => String(outcome.status));
      assert.equal(statuses.filter((status) => status === "recorded").length, 1, `exactly one resend records: ${statuses.join(",")}`);
      assert.ok(statuses.every((status) => status === "recorded" || status === "duplicate"), `resends are recorded/duplicate: ${statuses.join(",")}`);
      assert.ok(outcomes.every((outcome) => outcome.result === undefined || JSON.stringify(outcome.result) === JSON.stringify({ effect: "payment-1" })));
    } finally {
      for (const client of concurrent) await client.end();
    }
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where event_id = $1", [concurrentEvent["eventId"]]), 1);
    assert.equal(await count(admin, "select count(*) from app.sync_event_receipts where event_id = $1", [concurrentEvent["eventId"]]), 1);
    const lateResend = await record(api, managerA, concurrentEvent);
    assert.equal(lateResend.status, "duplicate");
    assert.deepEqual(lateResend.result, { effect: "payment-1" });
    check("twenty_concurrent_resends_single_ledger_effect");

    // 4. Idempotency and event identity: same key with the same intent duplicates (a new event id
    // still gets a receipt but no second effect); divergent intent or reused event id is rejected.
    const sameKey = envelope({ ...readEnvelope(concurrentEvent), eventId: randomUUID(), localSequence: 1 });
    assert.equal((await record(api, managerA, sameKey)).status, "duplicate");
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where idempotency_key = $1", [concurrentEvent["idempotencyKey"]]), 1);
    assert.equal(await count(admin, "select count(*) from app.sync_event_receipts where ledger_event_id = $1", [concurrentEvent["eventId"]]), 2);
    const divergentIntent = { ...sameKey, eventId: randomUUID(), localSequence: 2, payload: { amountMinor: 25_001 } };
    assert.deepEqual(await record(api, managerA, divergentIntent), { status: "rejected", code: "IDEMPOTENCY_KEY_REUSE" });
    const reusedEvent = { ...concurrentEvent, payload: { amountMinor: 25_002 } };
    assert.deepEqual(await record(api, managerA, reusedEvent), { status: "rejected", code: "EVENT_ID_REUSE" });
    check("idempotency_key_and_event_id_reuse");

    // 5. Device local sequence: a reused non-zero sequence is rejected, a gap waits for the missing
    // one, and a lower-than-last sequence is never applied out of order.
    const ghostSequence = envelope({ actorId: managerA, baseVersion: null, deviceId: dedupDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 1 }, scope: scopeA1 });
    assert.deepEqual(await record(api, managerA, ghostSequence), { status: "rejected", code: "LOCAL_SEQUENCE_REUSE" });
    const gap = envelope({ actorId: managerA, baseVersion: null, deviceId: dedupDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 5, operation: "create", payload: { amountMinor: 2 }, scope: scopeA1 });
    assert.equal((await record(api, managerA, gap)).status, "recorded");
    const behind = envelope({ actorId: managerA, baseVersion: null, deviceId: dedupDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 3, operation: "create", payload: { amountMinor: 3 }, scope: scopeA1 });
    assert.deepEqual(await record(api, managerA, behind), { status: "retry_wait", code: "SEQUENCE_OUT_OF_ORDER" });
    const wrongActor = envelope({ actorId: cashierA, baseVersion: null, deviceId: dedupDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 6, operation: "create", payload: { amountMinor: 4 }, scope: scopeA1 });
    assert.deepEqual(await record(api, managerA, wrongActor), { status: "rejected" });
    check("local_sequence_out_of_order_and_actor_mismatch");

    // 6. Cross-branch and cross-restaurant isolation for devices, dedup and actor scope: the same
    // event id/key in another scope is an independent record, and a foreign device is not found.
    const crossBranchEvent = envelope({ actorId: managerA, baseVersion: null, deviceId: dedupDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 5 }, scope: scopeA2 });
    assert.deepEqual(await record(api, managerA, crossBranchEvent), { status: "denied" }, "device from branch A1 cannot write in A2");
    const foreignRestaurant = envelope({ actorId: managerB, baseVersion: null, deviceId: "sync-device-b", entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 6 }, scope: scopeA1 });
    assert.deepEqual(await record(api, managerB, foreignRestaurant), { status: "denied" });
    const mirrored = envelope({ actorId: managerB, baseVersion: null, deviceId: "sync-device-b", entityId: concurrentEvent["entityId"] as string,
      entityType: "Payment", eventId: concurrentEvent["eventId"] as string, idempotencyKey: concurrentEvent["idempotencyKey"] as string,
      localSequence: 0, operation: "create", payload: { amountMinor: 25_000 }, scope: scopeB });
    assert.equal((await record(api, managerB, mirrored)).status, "recorded", "the same event id/key is scoped to its branch");
    assert.equal((await record(api, managerB, mirrored)).status, "duplicate");
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where event_id = $1", [concurrentEvent["eventId"]]), 2);
    check("cross_branch_and_cross_restaurant_device_isolation");

    // 7. Changelog cursor and tombstones are per scope and strictly increasing per entity.
    const append = async (actor: string, scope: { branchId: string; restaurantId: string }, entityId: string, version: number,
      tombstone: boolean, operation: string): Promise<number | null> => {
      const query = await api.query("select app_private.sync_append_change($1,$2,$3,'MenuCatalog',$4,$5,$6,$7::jsonb,$8) as out",
        [actor, scope.restaurantId, scope.branchId, entityId, version, tombstone, tombstone ? null : JSON.stringify({ version }), operation]);
      return query.rows[0].out === null ? null : Number(query.rows[0].out);
    };
    const catalogEntity = randomUUID();
    assert.equal(await append(managerA, scopeA1, catalogEntity, 1, false, "update"), 1);
    assert.equal(await append(managerA, scopeA2, catalogEntity, 1, false, "update"), 1, "A2 cursor starts at 1 independently");
    assert.equal(await append(managerB, scopeB, catalogEntity, 1, false, "update"), 1, "B cursor starts at 1 independently");
    await assert.rejects(append(managerA, scopeA1, catalogEntity, 1, false, "update"), assertPgError("23514"));
    assert.equal(await append(managerA, scopeA1, catalogEntity, 2, false, "update"), 2);
    assert.equal(await append(managerA, scopeA1, catalogEntity, 3, true, "delete"), 3);
    await assert.rejects(append(managerA, scopeA1, catalogEntity, 4, false, "update"), assertPgError("23514"), "a tombstone blocks later versions");
    assert.equal(await append(managerB, scopeA1, randomUUID(), 1, false, "update"), null, "a foreign actor cannot append to restaurant A");
    const summary = await admin.query("select restaurant_id, branch_id, value from app_private.sync_cursor_counter order by restaurant_id, branch_id");
    assert.ok(summary.rows.every((row: Json) => Number(row.value) >= 1));
    check("cursor_and_tombstone_scoped_monotonic");

    // 8. No LAN visibility: recording an event does not publish it; only the business writer's
    // append_change makes it visible in its own branch, and never in another branch.
    const beforeVisible = await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA1.restaurantId, scopeA1.branchId]);
    const beforeA2Visible = await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA2.restaurantId, scopeA2.branchId]);
    const a2Device = "sync-device-a2";
    const a2Event = envelope({ actorId: managerA, baseVersion: null, deviceId: a2Device, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 7 }, scope: scopeA2 });
    assert.equal((await record(api, managerA, a2Event)).status, "recorded");
    assert.equal(await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA1.restaurantId, scopeA1.branchId]), beforeVisible,
      "branch A1 cannot see an event from branch A2");
    assert.equal(await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA2.restaurantId, scopeA2.branchId]), beforeA2Visible,
      "an event is not in the changelog until the business writer appends the change");
    await append(managerA, scopeA2, randomUUID(), 1, false, "update");
    assert.equal(await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA2.restaurantId, scopeA2.branchId]), beforeA2Visible + 1);
    check("no_visibility_before_sync_and_branch_isolation");

    // 9. Manual review: one open case per event, supervisor-only resolution with a mandatory reason,
    // a real compensating event for the same entity, and no cross-tenant resolution.
    const originalEventId = concurrentEvent["eventId"] as string;
    const openReview = async (actor: string, scope: { branchId: string; restaurantId: string }, eventId: string, reason: string): Promise<string | null> => {
      const query = await api.query("select app_private.sync_open_review($1,$2,$3,$4,$5) as out", [actor, scope.restaurantId, scope.branchId, eventId, reason]);
      return query.rows[0].out as string | null;
    };
    const caseId = await openReview(managerA, scopeA1, originalEventId, "CONCURRENT_EDIT");
    assert.equal(typeof caseId, "string");
    await assert.rejects(openReview(managerA, scopeA1, originalEventId, "CONCURRENT_EDIT"), assertPgError("23505"), "only one open case per event");
    assert.equal(await openReview(managerA, scopeB, originalEventId, "CONCURRENT_EDIT"), null, "a case cannot be opened in a foreign scope");
    const resolve = async (actor: string, scope: { branchId: string; restaurantId: string }, target: string, decision: string,
      reason: string | null, compensating: string | null): Promise<string> => {
      const query = await api.query("select app_private.sync_resolve_review($1,$2,$3,$4,$5,$6,$7) as out",
        [actor, scope.restaurantId, scope.branchId, target, decision, reason, compensating]);
      return query.rows[0].out as string;
    };
    assert.equal(await resolve(fixtures.actorIds.courier as string, scopeA1, caseId as string, "resolved_rejected", "duplicate", null), "denied");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_rejected", "   ", null), "invalid");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_compensated", "compensate", null), "invalid");
    assert.equal(await resolve(managerB, scopeB, caseId as string, "resolved_rejected", "foreign", null), "not_found");
    const compensation = envelope({ actorId: managerA, baseVersion: 1, deviceId: dedupDevice, entityId: concurrentEvent["entityId"] as string,
      entityType: "Payment", eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 6, operation: "compensate",
      payload: { amountMinor: -25_000, reason: "manual_review" }, scope: scopeA1 });
    assert.equal((await record(api, managerA, compensation)).status, "recorded");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_compensated", "compensated once", compensation["eventId"] as string), "resolved");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_compensated", "compensated once", compensation["eventId"] as string), "duplicate");
    assert.equal(await count(admin, "select count(*) from app.sync_manual_review_cases where status = 'resolved_compensated' and event_id = $1", [originalEventId]), 1);
    check("manual_review_open_resolve_compensation_tenant_scoped");

    // 10. The API role cannot read the ledger, receipts, changelog, review or cursor tables directly;
    // everything must go through the audited functions, which also keeps tenant filters server-side.
    for (const table of ["app.sync_event_ledger", "app.sync_event_receipts", "app.sync_changelog", "app.sync_manual_review_cases", "app.sync_devices", "app_private.sync_cursor_counter"]) {
      await assert.rejects(api.query(`select count(*) from ${table}`), assertPgError("42501"), `${table} must not be readable by app_api`);
    }
    check("sync_tables_not_readable_by_app_api");

    // 11. HTTP surface: the conflict endpoints are still absent, so the end-to-end HTTP half is
    // explicitly deferred instead of silently skipped.
    const principals = new Map<string, string>((Object.keys(HTTP_TEST_ACTORS) as HttpTestActorName[]).map((name) => [fixtures.tokens[name], fixtures.actorIds[name]]));
    app = await bootstrapHttpApp(apiUrl, principals);
    const http = app;
    const probe = await probeSyncConflictEndpoints({
      scope: scopeA1,
      send: async (actor, method, path, body) => {
        const response = await http.request(fixtures.tokens[actor], method, path, body);
        return { status: response.status, body: (response.body ?? {}) as Json };
      },
    });
    assertSyncConflictEndpointsDeferred(probe);
    check("http_sync_endpoints_deferred_and_catalogued");

    process.stdout.write(`${JSON.stringify({ stage: "sync_conflicts", status: "ok", runId: local.runId, checks,
      deferredHttpScenarios: probe.deferred, probes: probe.probes })}\n`);
  } finally {
    for (const client of extraClients) { try { await client.end(); } catch { process.exitCode = 1; } }
    try { await app?.close(); } catch { process.exitCode = 1; }
    const cleanup = await local.stop();
    process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: cleanup.failed ? "failed" : "ok", stopped: cleanup.stopped, runId: local.runId, marker })}\n`);
    if (cleanup.failed) process.exitCode = 1;
  }
});

/** Re-reads the envelope identity fields so a duplicate can reuse its intent with a new event id. */
function readEnvelope(event: Json): EnvelopeInput {
  return {
    actorId: event["actorId"] as string,
    baseVersion: event["baseVersion"] as number | null,
    deviceId: event["deviceId"] as string,
    entityId: event["entityId"] as string,
    entityType: event["entityType"] as string,
    eventId: event["eventId"] as string,
    idempotencyKey: event["idempotencyKey"] as string,
    localSequence: event["localSequence"] as number,
    operation: event["operation"] as string,
    payload: event["payload"] as Json,
    scope: { restaurantId: event["restaurantId"] as string, branchId: event["branchId"] as string },
  };
}
