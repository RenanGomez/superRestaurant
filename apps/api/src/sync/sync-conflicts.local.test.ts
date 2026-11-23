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
// endpoint will call: device registration/revocation, two active devices per branch, cross-tenant
// and cross-branch isolation, event/idempotency/sequence dedup (including clock skew vs sequence),
// 20 concurrent resends, cursor/tombstone ordering, manual_review open/resolve with compensation,
// and the absence of LAN visibility between devices. The HTTP-only half (combined totals, KDS
// regression, single payment effect) is catalogued in `../operations/http-flow-sync-conflicts.ts`
// and reported as deferred.
// Opt-in only: `pnpm --filter @super-restaurant/api run test:sync-conflicts:local -- --local-disposable-only`.

type Json = Record<string, unknown>;

const marker = "LOCAL_SYNC_CONFLICTS_ONLY";
const argv = process.argv.filter((argument) => argument !== "--");
/** Deterministic default so the suite never depends on the wall clock. */
const DEFAULT_OCCURRED_AT = "2026-11-23T00:00:00.000Z";

interface EnvelopeInput {
  readonly actorId: string;
  readonly baseVersion: number | null;
  readonly deviceId: string;
  readonly entityId: string;
  readonly entityType: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly localSequence: number;
  readonly occurredAt?: string;
  readonly operation: string;
  readonly payload: Json;
  readonly scope: { readonly branchId: string; readonly restaurantId: string };
}

function envelope(input: EnvelopeInput): Json {
  return {
    eventId: input.eventId, idempotencyKey: input.idempotencyKey, deviceId: input.deviceId, actorId: input.actorId,
    restaurantId: input.scope.restaurantId, branchId: input.scope.branchId, entityType: input.entityType, entityId: input.entityId,
    operation: input.operation, schemaVersion: "1", localSequence: input.localSequence, baseVersion: input.baseVersion,
    occurredAt: input.occurredAt ?? DEFAULT_OCCURRED_AT, receivedAt: null, payload: input.payload, retryCount: 0, localState: "pending",
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
  const clients: Client[] = [];
  try {
    for (let index = 0; index < quantity; index += 1) {
      const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000, query_timeout: 30_000, statement_timeout: 30_000 });
      await client.connect();
      clients.push(client);
    }
    return clients;
  } catch (error: unknown) {
    for (const client of clients) { try { await client.end(); } catch { /* best-effort close */ } }
    throw error;
  }
}

test("sync conflicts: device revocation, two active devices, dedup, isolation, cursor, manual review", async () => {
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
    const dedupDevice = randomUUID();
    const revokeDevice = randomUUID();
    const a2Device = randomUUID();
    const deviceB = randomUUID();
    assert.equal(await register(managerA, scopeA1, dedupDevice), true);
    assert.equal(await register(managerA, scopeA1, dedupDevice), true);
    assert.equal(await register(managerA, scopeA1, revokeDevice), true);
    assert.equal(await register(cashierA, scopeA1, revokeDevice), false, "a device cannot be re-registered to another authorized actor");
    assert.equal(await register(managerA, scopeA2, a2Device), true);
    assert.equal(await register(managerB, scopeB, deviceB), true);
    assert.equal(await register(managerB, scopeA1, randomUUID()), false, "a foreign actor cannot register inside restaurant A");
    check("device_registration_scoped_and_non_transferable");

    // 2. Revocation: only the owner or a supervisor may revoke; a revoked device is rejected even
    // after re-registration. A dedicated cashier proves the *actor* path: it records a charge while
    // its membership is active, and both record and register are denied after the membership is
    // revoked. (A courier would be denied by role alone and would prove nothing.)
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
    const revokedActor = randomUUID();
    await admin.query("insert into auth.users(id,email) values ($1,$2)", [revokedActor, "sync-revoked-actor@invalid.test"]);
    const revokedMembership = randomUUID();
    await admin.query("insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values ($1,$2,$3,$4,$5)",
      [revokedMembership, revokedActor, fixtures.restaurantA, fixtures.branchA, managerA]);
    await admin.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values ($1,'cashier',$2)", [revokedMembership, managerA]);
    const revokedActorDevice = randomUUID();
    assert.equal(await register(revokedActor, scopeA1, revokedActorDevice), true);
    const whileActive = envelope({ actorId: revokedActor, baseVersion: null, deviceId: revokedActorDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 11 }, scope: scopeA1 });
    assert.equal((await record(api, revokedActor, whileActive)).status, "recorded", "the actor is authorized before revocation");
    await admin.query("update app.memberships set revoked_at = now(), revoked_by = $1, revocation_reason = 'sync conflict test' where id = $2",
      [managerA, revokedMembership]);
    const afterRevocation = envelope({ actorId: revokedActor, baseVersion: null, deviceId: revokedActorDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 1, operation: "create", payload: { amountMinor: 12 }, scope: scopeA1 });
    assert.deepEqual(await record(api, revokedActor, afterRevocation), { status: "denied" }, "the active device is denied once its actor loses membership");
    assert.equal(await register(revokedActor, scopeA1, randomUUID()), false, "a revoked actor cannot register a new device");
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
      assert.ok(outcomes.every((outcome) => JSON.stringify(outcome.result) === JSON.stringify({ effect: "payment-1" })), "every resend returns the original result");
    } finally {
      for (const client of concurrent) { try { await client.end(); } catch { process.exitCode = 1; } }
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

    // 5. Device local sequence, not the client timestamp, orders events. A reused sequence is
    // rejected, a deliberate gap is accepted, a lower sequence is deferred, and a clock-skewed
    // event with a lower sequence still waits while an older timestamp with a higher sequence is
    // accepted.
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
    const clockDevice = randomUUID();
    assert.equal(await register(managerA, scopeA1, clockDevice), true);
    const clockBase = envelope({ actorId: managerA, baseVersion: null, deviceId: clockDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, occurredAt: "2026-11-23T01:00:00.000Z",
      operation: "create", payload: { amountMinor: 21 }, scope: scopeA1 });
    assert.equal((await record(api, managerA, clockBase)).status, "recorded");
    const olderTimestampHigherSequence = envelope({ actorId: managerA, baseVersion: null, deviceId: clockDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 2, occurredAt: "1999-01-01T00:00:00.000Z",
      operation: "create", payload: { amountMinor: 22 }, scope: scopeA1 });
    assert.equal((await record(api, managerA, olderTimestampHigherSequence)).status, "recorded", "sequence wins over an older client clock");
    const newerTimestampLowerSequence = envelope({ actorId: managerA, baseVersion: null, deviceId: clockDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 1, occurredAt: "2099-01-01T00:00:00.000Z",
      operation: "create", payload: { amountMinor: 23 }, scope: scopeA1 });
    assert.deepEqual(await record(api, managerA, newerTimestampLowerSequence), { status: "retry_wait", code: "SEQUENCE_OUT_OF_ORDER" },
      "a newer client timestamp does not override the missing sequence");
    check("local_sequence_out_of_order_clock_skew_and_actor_mismatch");

    // 6. Cross-branch and cross-restaurant isolation for devices, dedup and actor scope: the same
    // event id/key in another scope is an independent record, and a foreign device is not found.
    const crossBranchEvent = envelope({ actorId: managerA, baseVersion: null, deviceId: dedupDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 5 }, scope: scopeA2 });
    assert.deepEqual(await record(api, managerA, crossBranchEvent), { status: "denied" }, "device from branch A1 cannot write in A2");
    const foreignRestaurant = envelope({ actorId: managerB, baseVersion: null, deviceId: deviceB, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 6 }, scope: scopeA1 });
    assert.deepEqual(await record(api, managerB, foreignRestaurant), { status: "denied" });
    const mirrored = envelope({ actorId: managerB, baseVersion: null, deviceId: deviceB, entityId: concurrentEvent["entityId"] as string,
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
    assert.equal(summary.rows.length, 3, "exactly one cursor counter per scope");
    assert.ok(summary.rows.every((row: Json) => Number(row.value) >= 1));
    check("cursor_and_tombstone_scoped_monotonic");

    // 7b. Two *active* devices inside the same branch. Both write the same entity; the ledger keeps
    // both intents, a cross-device key collision is rejected, and the canonical version collision
    // surfaces as 23514 for the losing writer while the winner stays in the changelog. Edits from
    // the second device are invisible to the branch until the business writer appends the change.
    const secondDevice = randomUUID();
    assert.equal(await register(cashierA, scopeA1, secondDevice), true);
    const managerEntityDevice = randomUUID();
    assert.equal(await register(managerA, scopeA1, managerEntityDevice), true);
    const sharedEntity = randomUUID();
    const managerEntityEvent = envelope({ actorId: managerA, baseVersion: null, deviceId: managerEntityDevice, entityId: sharedEntity, entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 30 }, scope: scopeA1 });
    assert.equal((await record(api, managerA, managerEntityEvent)).status, "recorded");
    const cashierEntityEvent = envelope({ actorId: cashierA, baseVersion: null, deviceId: secondDevice, entityId: sharedEntity, entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 31 }, scope: scopeA1 });
    assert.equal((await record(api, cashierA, cashierEntityEvent)).status, "recorded", "the second active device in A1 also records");
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where restaurant_id = $1 and branch_id = $2 and entity_id = $3",
      [scopeA1.restaurantId, scopeA1.branchId, sharedEntity]), 2, "two devices produced two distinct ledger intents");
    const crossDeviceKeyCollision = envelope({ actorId: cashierA, baseVersion: null, deviceId: secondDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: managerEntityEvent["idempotencyKey"] as string, localSequence: 1, operation: "create",
      payload: { amountMinor: 32 }, scope: scopeA1 });
    assert.deepEqual(await record(api, cashierA, crossDeviceKeyCollision), { status: "rejected", code: "IDEMPOTENCY_KEY_REUSE" },
      "a second device cannot reuse another device's idempotency key for a different intent");
    assert.equal(typeof await append(managerA, scopeA1, sharedEntity, 1, false, "update"), "number", "the first canonical version wins");
    await assert.rejects(append(managerA, scopeA1, sharedEntity, 1, false, "update"), assertPgError("23514"), "the concurrent writer's version 1 loses");
    const branchVisibleBefore = await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2",
      [scopeA1.restaurantId, scopeA1.branchId]);
    const secondDeviceEntity = randomUUID();
    const invisibleUntilSync = envelope({ actorId: cashierA, baseVersion: null, deviceId: secondDevice, entityId: secondDeviceEntity, entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 2, operation: "create", payload: { amountMinor: 33 }, scope: scopeA1 });
    assert.equal((await record(api, cashierA, invisibleUntilSync)).status, "recorded");
    assert.equal(await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2",
      [scopeA1.restaurantId, scopeA1.branchId]), branchVisibleBefore, "a same-branch device edit is invisible until append_change");
    assert.equal(await append(managerA, scopeA1, secondDeviceEntity, 1, false, "update"), branchVisibleBefore + 1);
    const a2Mirror = envelope({ actorId: managerA, baseVersion: null, deviceId: a2Device, entityId: sharedEntity, entityType: "Payment",
      eventId: managerEntityEvent["eventId"] as string, idempotencyKey: managerEntityEvent["idempotencyKey"] as string,
      localSequence: 0, operation: "create", payload: { amountMinor: 30 }, scope: scopeA2 });
    assert.equal((await record(api, managerA, a2Mirror)).status, "recorded", "the same event id/key is also independent between branches of one restaurant");
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where event_id = $1", [managerEntityEvent["eventId"]]), 2);
    check("two_active_devices_same_branch_conflict_and_visibility");

    // 8. No LAN visibility across branches: recording an event does not publish it; only the
    // business writer's append_change makes it visible in its own branch.
    const beforeVisible = await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA1.restaurantId, scopeA1.branchId]);
    const beforeA2Visible = await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA2.restaurantId, scopeA2.branchId]);
    const a2Event = envelope({ actorId: managerA, baseVersion: null, deviceId: a2Device, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 1, operation: "create", payload: { amountMinor: 7 }, scope: scopeA2 });
    assert.equal((await record(api, managerA, a2Event)).status, "recorded");
    assert.equal(await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA1.restaurantId, scopeA1.branchId]), beforeVisible,
      "branch A1 cannot see an event from branch A2");
    assert.equal(await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA2.restaurantId, scopeA2.branchId]), beforeA2Visible,
      "an event is not in the changelog until the business writer appends the change");
    await append(managerA, scopeA2, randomUUID(), 1, false, "update");
    assert.equal(await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA2.restaurantId, scopeA2.branchId]), beforeA2Visible + 1);
    assert.equal(await count(admin, "select count(*) from app.sync_changelog where restaurant_id = $1 and branch_id = $2", [scopeA1.restaurantId, scopeA1.branchId]), beforeVisible,
      "the A2 append stays invisible to A1");
    check("no_visibility_before_sync_and_branch_isolation");

    // 9. Manual review: one open case per event, active non-supervisor denial, mandatory reason,
    // cross-entity compensation refused, a real compensating event for the same entity, closed-case
    // and compensation-reuse outcomes, and no cross-tenant resolution.
    const originalEventId = concurrentEvent["eventId"] as string;
    const openReview = async (actor: string, scope: { branchId: string; restaurantId: string }, eventId: string, reason: string): Promise<string | null> => {
      const query = await api.query("select app_private.sync_open_review($1,$2,$3,$4,$5) as out", [actor, scope.restaurantId, scope.branchId, eventId, reason]);
      return query.rows[0].out as string | null;
    };
    const reviewStatus = async (caseId: string): Promise<string> => {
      const query = await admin.query("select status from app.sync_manual_review_cases where case_id = $1", [caseId]);
      return String(query.rows[0].status);
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
    assert.equal(await resolve(fixtures.actorIds.viewer, scopeA1, caseId as string, "resolved_rejected", "duplicate", null), "denied",
      "an active non-supervisor is denied by role, not by a missing membership");
    assert.equal(await reviewStatus(caseId as string), "open", "a denied resolution leaves the case open");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_rejected", "   ", null), "invalid");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_compensated", "compensate", null), "invalid");
    assert.equal(await resolve(managerB, scopeB, caseId as string, "resolved_rejected", "foreign", null), "not_found");
    const otherEntityCompensation = envelope({ actorId: managerA, baseVersion: 1, deviceId: managerEntityDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 1, operation: "compensate",
      payload: { amountMinor: -1, reason: "other-entity" }, scope: scopeA1 });
    assert.equal((await record(api, managerA, otherEntityCompensation)).status, "recorded");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_compensated", "wrong entity", otherEntityCompensation["eventId"] as string),
      "invalid", "a compensation for another entity cannot close the case");
    const compensation = envelope({ actorId: managerA, baseVersion: 1, deviceId: managerEntityDevice, entityId: concurrentEvent["entityId"] as string,
      entityType: "Payment", eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 2, operation: "compensate",
      payload: { amountMinor: -25_000, reason: "manual_review" }, scope: scopeA1 });
    assert.equal((await record(api, managerA, compensation)).status, "recorded");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_compensated", "compensated once", compensation["eventId"] as string), "resolved");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_compensated", "compensated once", compensation["eventId"] as string), "duplicate");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "resolved_rejected", "late change", null), "already_resolved",
      "a closed case cannot change decision");
    assert.equal(await count(admin, "select count(*) from app.sync_manual_review_cases where status = 'resolved_compensated' and event_id = $1", [originalEventId]), 1);
    const secondPaymentEvent = envelope({ actorId: cashierA, baseVersion: null, deviceId: secondDevice, entityId: concurrentEvent["entityId"] as string,
      entityType: "Payment", eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 3, operation: "create",
      payload: { amountMinor: 25_000 }, scope: scopeA1 });
    assert.equal((await record(api, cashierA, secondPaymentEvent)).status, "recorded");
    const secondCaseId = await openReview(managerA, scopeA1, secondPaymentEvent["eventId"] as string, "CONCURRENT_EDIT");
    assert.equal(typeof secondCaseId, "string");
    assert.equal(await resolve(managerA, scopeA1, secondCaseId as string, "resolved_compensated", "reuse", compensation["eventId"] as string),
      "compensation_in_use", "one compensating event cannot close two cases");
    assert.equal(await reviewStatus(secondCaseId as string), "open", "the rejected reuse leaves the second case open");
    check("manual_review_negatives_and_compensation_reuse");

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
    occurredAt: event["occurredAt"] as string,
    operation: event["operation"] as string,
    payload: event["payload"] as Json,
    scope: { restaurantId: event["restaurantId"] as string, branchId: event["branchId"] as string },
  };
}
