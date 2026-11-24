import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Client, Pool, type QueryResultRow } from "pg";

import { calculateOrderTotals, Money } from "@super-restaurant/domain";

import { configureApiApp } from "../app-setup.js";
import { AppModule } from "../app.module.js";
import { AUTH_PRINCIPAL_VERIFIER, AccessTokenRejectedError, type AuthenticatedPrincipal } from "../auth/authentication.js";
import { DATABASE_CLIENT, guardPostgresPool, runDatabaseTransaction, type DatabaseClientPort, type TransactionalDatabaseClientPort } from "../database.js";
import {
  assertSyncConflictScenariosCovered,
  listSyncManualReviews,
  pullSyncChanges,
  pushSyncEvents,
  registerSyncDevice,
  resolveSyncManualReview,
  syncPullChanges,
  syncPushResults,
  type SyncConflictHttpTransport,
} from "../operations/http-flow-sync-conflicts.js";
import { HTTP_TEST_ACTORS, provisionHttpFixtures, type HttpTestActorName } from "../operations/http-test-fixtures.js";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres } from "../operations/local-postgres.js";
import { SyncCursor } from "./sync-cursor.js";

// Multi-device sync conflict coverage against a disposable local PostgreSQL 17 cluster (never
// remote), at both boundaries the product uses:
//  - `ledger`: the security-definer functions (`sync_record_event`, `sync_append_change`,
//    `sync_open_review`) are driven directly for the business effects the sync push executor does not
//    model yet (order lines and totals, KDS tickets, payments). Two active devices per branch,
//    cross-tenant/cross-branch isolation, event/idempotency/sequence dedup (including clock skew vs
//    sequence), 20 concurrent resends, cursor/tombstone ordering and manual_review with compensation.
//  - `http`: once the AppModule routes exist, the real `POST /sync/devices`, `POST /sync/push`,
//    `POST /sync/pull`, `GET|POST /sync/manual-review` surface is exercised end to end for
//    registration, accepted/duplicate/stale push, revocation, 20 concurrent resends, cursor isolation,
//    tombstones, manual review and the absence of LAN visibility between devices.
// Opt-in only: `pnpm --filter @super-restaurant/api run test:sync-conflicts:local` (the script pins
// `--local-disposable-only`; it never targets a shared or remote database).

type Json = Record<string, unknown>;

const marker = "LOCAL_SYNC_CONFLICTS_ONLY";
const argv = process.argv.filter((argument) => argument !== "--");
/** Deterministic default so the suite never depends on the wall clock. */
const DEFAULT_OCCURRED_AT = "2026-11-23T00:00:00.000Z";
/** A well-formed recorded result; the ledger stores it verbatim and review reads `status: accepted`. */
const ACCEPTED_RESULT: Json = Object.freeze({ status: "accepted", code: null, canonicalVersion: 1, auditId: null });

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

async function record(client: Client, actorId: string, event: Json, result: Json = ACCEPTED_RESULT): Promise<Json> {
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

interface LocalHttpApp {
  close(): Promise<void>;
  request(token: string | null, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<{ readonly body: unknown; readonly status: number }>;
}

/**
 * Boots the real AppModule with a transaction-capable `app_api` client. The shared HTTP harness only
 * exposes `query`, and the pull/review routes need `transaction`; everything else is identical, so
 * membership, device, review and scope authorization still run against the disposable database and
 * only Supabase Auth is stubbed.
 */
async function bootstrapTransactionalHttpApp(appApiUrl: string, principals: ReadonlyMap<string, string>): Promise<LocalHttpApp> {
  const pool = guardPostgresPool(new Pool({ application_name: "super-restaurant-sync-conflicts-http", connectionString: appApiUrl, connectionTimeoutMillis: 5_000, max: 5, query_timeout: 10_000, statement_timeout: 10_000 }));
  const database: TransactionalDatabaseClientPort = {
    async query(sql, parameters) {
      const result = await pool.query<QueryResultRow>(sql, [...parameters]);
      return Object.freeze({ rows: Object.freeze([...result.rows]) });
    },
    async transaction<T>(operation: (connection: DatabaseClientPort) => Promise<T>): Promise<T> {
      return runDatabaseTransaction(await pool.connect(), operation);
    },
  };
  const verifier = {
    async verifyAccessToken(accessToken: string): Promise<AuthenticatedPrincipal> {
      const actorId = principals.get(accessToken);
      if (actorId === undefined) throw new AccessTokenRejectedError();
      return Object.freeze({ actorId });
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_CLIENT).useValue(database)
    .overrideProvider(SyncCursor).useValue(new SyncCursor("test-cursor-secret-only-for-tests-12345"))
    .overrideProvider(AUTH_PRINCIPAL_VERIFIER).useValue(verifier)
    .compile();
  const nestApp = module.createNestApplication<NestExpressApplication>({ logger: false });
  configureApiApp(nestApp);
  await nestApp.listen(0, "127.0.0.1");
  const baseUrl = `${await nestApp.getUrl()}/api/v1`;
  return {
    async close() { await nestApp.close(); await pool.end(); },
    async request(token, method, path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { body: text.length === 0 ? null : JSON.parse(text) as unknown, status: response.status };
    },
  };
}

test("sync conflicts: device revocation, two active devices, dedup, isolation, cursor, manual review", async () => {
  if (process.env.HTTP_TEST_MODE !== undefined && process.env.HTTP_TEST_MODE !== "local") throw new Error("LOCAL_CONFIRMATION_REQUIRED");
  assertLocalConfirmation(argv);
  // SYNC_CURSOR_SECRET is required (>= 32 chars) wherever the cursor codec is constructed. The HTTP
  // harness overrides SyncCursor, but the suite still pins the same requirement as production.
  if (process.env.SYNC_CURSOR_SECRET === undefined) process.env.SYNC_CURSOR_SECRET = "local-sync-conflicts-cursor-secret-0123456789";
  assert.ok(process.env.SYNC_CURSOR_SECRET.length >= 32, "SYNC_CURSOR_SECRET must be at least 32 characters");
  const local = new LocalPostgres({ marker, databasePrefix: "superrestaurant_sync_conflicts", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
  let app: LocalHttpApp | undefined;
  const extraClients: Client[] = [];
  const checks: string[] = [];
  const check = (name: string): void => { checks.push(name); };
  // Every catalogued conflict scenario must be reported; `assertSyncConflictScenariosCovered` closes the loop.
  const coveredScenarios: string[] = [];
  const cover = (scenario: string): void => { coveredScenarios.push(scenario); };
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
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create", payload: { amountMinor: 25_000, currency: "MXN" }, scope: scopeA1 });
    const concurrent = await openClients(apiUrl, 20);
    try {
      const outcomes = await Promise.all(concurrent.map((client) => record(client, managerA, concurrentEvent)));
      const statuses = outcomes.map((outcome) => String(outcome.status));
      assert.equal(statuses.filter((status) => status === "recorded").length, 1, `exactly one resend records: ${statuses.join(",")}`);
      assert.ok(statuses.every((status) => status === "recorded" || status === "duplicate"), `resends are recorded/duplicate: ${statuses.join(",")}`);
      for (const outcome of outcomes) assert.deepEqual(outcome.result, ACCEPTED_RESULT, "every resend returns the original result");
    } finally {
      for (const client of concurrent) { try { await client.end(); } catch { process.exitCode = 1; } }
    }
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where event_id = $1", [concurrentEvent["eventId"]]), 1);
    assert.equal(await count(admin, "select count(*) from app.sync_event_receipts where event_id = $1", [concurrentEvent["eventId"]]), 1);
    const lateResend = await record(api, managerA, concurrentEvent);
    assert.equal(lateResend.status, "duplicate");
    assert.deepEqual(lateResend.result, ACCEPTED_RESULT);
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
    cover("repeat_payment_same_key");

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
      localSequence: 0, operation: "create", payload: { amountMinor: 25_000, currency: "MXN" }, scope: scopeB });
    assert.equal((await record(api, managerB, mirrored)).status, "recorded", "the same event id/key is scoped to its branch");
    assert.equal((await record(api, managerB, mirrored)).status, "duplicate");
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where event_id = $1", [concurrentEvent["eventId"]]), 2);
    check("cross_branch_and_cross_restaurant_device_isolation");

    // 7. Changelog cursor and tombstones are per scope and strictly increasing per entity.
    const append = async (actor: string, scope: { branchId: string; restaurantId: string }, entityId: string, version: number,
      tombstone: boolean, operation: string, entityType = "MenuCatalog", snapshot?: Json): Promise<number | null> => {
      const query = await api.query("select app_private.sync_append_change($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) as out",
        [actor, scope.restaurantId, scope.branchId, entityType, entityId, version, tombstone, tombstone ? null : JSON.stringify(snapshot ?? { version }), operation]);
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

    // 9. Manual review uses the product command `sync_resolve_review_command` (the plain resolver is
    // no longer executable by app_api): one open case per event, active non-supervisor denial,
    // mandatory reason, cross-entity compensation refused, a real compensating event for the same
    // entity, command idempotency/conflict, closed-case and compensation-reuse outcomes, and no
    // cross-tenant resolution.
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
    const resolve = async (actor: string, scope: { branchId: string; restaurantId: string }, target: string,
      decision: "reject" | "compensate", reason: string | null, compensating: string | null, key: string,
      device: string = managerEntityDevice, occurredAt: string = DEFAULT_OCCURRED_AT): Promise<string> => {
      const query = await api.query("select app_private.sync_resolve_review_command($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text) as out",
        [actor, scope.restaurantId, scope.branchId, target, decision, reason, compensating, key, device, occurredAt]);
      return query.rows[0].out as string;
    };
    assert.equal(await resolve(fixtures.actorIds.viewer, scopeA1, caseId as string, "reject", "duplicate", null, randomUUID()), "denied",
      "an active non-supervisor is denied by role, not by a missing membership");
    assert.equal(await reviewStatus(caseId as string), "open", "a denied resolution leaves the case open");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "reject", "   ", null, randomUUID()), "invalid");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "compensate", "compensate", null, randomUUID()), "invalid");
    assert.equal(await resolve(managerB, scopeB, caseId as string, "reject", "foreign", null, randomUUID(), deviceB), "not_found");
    // The second charge (different key) is recorded before the compensation so the same compensating
    // event is later valid for both cases; reusing it must then fail on the unique compensation index.
    const secondPaymentEvent = envelope({ actorId: cashierA, baseVersion: null, deviceId: secondDevice, entityId: concurrentEvent["entityId"] as string,
      entityType: "Payment", eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 3, operation: "create",
      payload: { amountMinor: 25_000, currency: "MXN" }, scope: scopeA1 });
    assert.equal((await record(api, cashierA, secondPaymentEvent)).status, "recorded");
    const otherEntityCompensation = envelope({ actorId: managerA, baseVersion: 1, deviceId: managerEntityDevice, entityId: randomUUID(), entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 1, operation: "compensate",
      payload: { amountMinor: -1, currency: "MXN", reason: "other-entity" }, scope: scopeA1 });
    assert.equal((await record(api, managerA, otherEntityCompensation)).status, "recorded");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "compensate", "wrong entity", otherEntityCompensation["eventId"] as string, randomUUID()),
      "invalid", "a compensation for another entity cannot close the case");
    const compensation = envelope({ actorId: managerA, baseVersion: 1, deviceId: managerEntityDevice, entityId: concurrentEvent["entityId"] as string,
      entityType: "Payment", eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 2, operation: "compensate",
      payload: { amountMinor: -25_000, currency: "MXN", reason: "manual_review" }, scope: scopeA1 });
    assert.equal((await record(api, managerA, compensation)).status, "recorded");
    const compensationKey = randomUUID();
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "compensate", "compensated once", compensation["eventId"] as string, compensationKey), "resolved");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "compensate", "compensated once", compensation["eventId"] as string, compensationKey), "duplicate",
      "an identical command replay is a duplicate");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "reject", "late change", null, compensationKey), "idempotency_conflict",
      "the same key with a different intent is rejected");
    assert.equal(await resolve(managerA, scopeA1, caseId as string, "reject", "late change", null, randomUUID()), "already_resolved",
      "a closed case cannot change decision");
    assert.equal(await count(admin, "select count(*) from app.sync_manual_review_cases where status = 'resolved_compensated' and event_id = $1", [originalEventId]), 1);
    const secondCaseId = await openReview(managerA, scopeA1, secondPaymentEvent["eventId"] as string, "CONCURRENT_EDIT");
    assert.equal(typeof secondCaseId, "string");
    assert.equal(await resolve(managerA, scopeA1, secondCaseId as string, "compensate", "reuse", compensation["eventId"] as string, randomUUID()),
      "compensation_in_use", "one compensating event cannot close two cases");
    assert.equal(await reviewStatus(secondCaseId as string), "open", "the rejected reuse leaves the second case open");
    check("manual_review_negatives_and_compensation_reuse");
    cover("concurrent_same_line_edit");
    cover("surplus_payment_new_key");

    // 9b. Business conflict outcomes at the ledger boundary. The sync push executor only creates
    // orders and transitions them to open; order lines/totals, KDS tickets and payments are written by
    // the business writers that own those tables. The suite asserts the invariants the sync layer must
    // preserve so those writers can neither double-apply, regress nor merge silently.
    const orderEntity = randomUUID();
    const lineA = randomUUID();
    const lineB = randomUUID();
    const snapshot = (productId: string, name: string, unitPriceMinor: number) => ({
      catalogVersion: randomUUID(), productId, name, stationId: "kitchen", unit: "piece",
      unitPrice: new Money(unitPriceMinor, "MXN"), modifiers: [],
    });
    const lineAEvent = envelope({ actorId: managerA, baseVersion: null, deviceId: managerEntityDevice, entityType: "OrderItem", entityId: lineA,
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 3, operation: "create",
      payload: { orderId: orderEntity, quantity: 2, unitPriceMinor: 12_500, currency: "MXN" }, scope: scopeA1 });
    const lineBEvent = envelope({ actorId: cashierA, baseVersion: null, deviceId: secondDevice, entityType: "OrderItem", entityId: lineB,
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 4, operation: "create",
      payload: { orderId: orderEntity, quantity: 1, unitPriceMinor: 5_000, currency: "MXN" }, scope: scopeA1 });
    assert.equal((await record(api, managerA, lineAEvent)).status, "recorded", "device 1 adds its line");
    assert.equal((await record(api, cashierA, lineBEvent)).status, "recorded", "device 2 adds its own line");
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where restaurant_id = $1 and branch_id = $2 and entity_type = 'OrderItem' and entity_id = any($3::text[])",
      [scopeA1.restaurantId, scopeA1.branchId, [lineA, lineB]]), 2, "both device intents coexist without overwriting each other");
    // The canonical snapshot is the single source of truth; the server calculates the combined total
    // from the frozen line prices, never from a client-supplied amount.
    const combined = calculateOrderTotals({ currency: "MXN", timeZone: "America/Hermosillo", lines: [
      { orderItemId: lineA, quantity: 2, snapshot: snapshot(randomUUID(), "Hamburguesa", 12_500) },
      { orderItemId: lineB, quantity: 1, snapshot: snapshot(randomUUID(), "Refresco", 5_000) },
    ] });
    assert.equal(combined.total.amountMinor, 30_000, "2 x 12500 + 1 x 5000 = 30000 minor units, server side");
    const combinedSnapshot = { orderId: orderEntity, currency: "MXN",
      lines: [{ orderItemId: lineA, quantity: 2, unitPriceMinor: 12_500 }, { orderItemId: lineB, quantity: 1, unitPriceMinor: 5_000 }],
      totalMinor: combined.total.amountMinor };
    assert.equal(typeof await append(managerA, scopeA1, orderEntity, 1, false, "create", "Order", combinedSnapshot), "number");
    const storedOrder = await admin.query("select snapshot from app.sync_changelog where restaurant_id = $1 and branch_id = $2 and entity_type = 'Order' and entity_id = $3",
      [scopeA1.restaurantId, scopeA1.branchId, orderEntity]);
    assert.deepEqual(storedOrder.rows[0].snapshot, combinedSnapshot, "the merged order snapshot carries both lines and the server total");
    cover("two_devices_add_lines");

    // Cancellation racing a KDS ticket in preparation: the changelog refuses a lower canonical
    // version for the same ticket, so the ticket cannot move backwards after it is preparing.
    const ticket = randomUUID();
    assert.equal(typeof await append(managerA, scopeA1, ticket, 1, false, "create", "KdsTicket"), "number");
    assert.equal(typeof await append(managerA, scopeA1, ticket, 2, false, "transition", "KdsTicket"), "number");
    await assert.rejects(append(managerA, scopeA1, ticket, 1, false, "transition", "KdsTicket"), assertPgError("23514"),
      "a cancellation cannot regress the KDS ticket to an earlier version");
    const latestTicket = await admin.query("select canonical_version, tombstone from app.sync_changelog where restaurant_id = $1 and branch_id = $2 and entity_type = 'KdsTicket' and entity_id = $3 order by canonical_sequence desc limit 1",
      [scopeA1.restaurantId, scopeA1.branchId, ticket]);
    assert.equal(Number(latestTicket.rows[0].canonical_version), 2, "the preparing version stays canonical");
    assert.equal(latestTicket.rows[0].tombstone, false);
    cover("cancel_vs_kds_preparing");

    // 10. The API role cannot read the ledger, receipts, changelog, review or cursor tables directly;
    // everything must go through the audited functions, which also keeps tenant filters server-side.
    for (const table of ["app.sync_event_ledger", "app.sync_event_receipts", "app.sync_changelog", "app.sync_manual_review_cases", "app.sync_devices", "app_private.sync_cursor_counter"]) {
      await assert.rejects(api.query(`select count(*) from ${table}`), assertPgError("42501"), `${table} must not be readable by app_api`);
    }
    check("sync_tables_not_readable_by_app_api");

    // 11. HTTP surface: the real AppModule routes. The same disposable PostgreSQL drives the NestJS
    // controllers, so registration, push, pull, cursor, tombstone and manual review are exercised over
    // the wire exactly as a POS client would, not only through the SQL functions.
    const revokedActorToken = "sync-revoked-actor-token";
    const principals = new Map<string, string>((Object.keys(HTTP_TEST_ACTORS) as HttpTestActorName[]).map((name) => [fixtures.tokens[name], fixtures.actorIds[name]]));
    principals.set(revokedActorToken, revokedActor);
    app = await bootstrapTransactionalHttpApp(apiUrl, principals);
    const http = app;
    const tokenFor = (actor: string): string => actor === "revoked_actor" ? revokedActorToken : fixtures.tokens[actor as HttpTestActorName];
    const transport: SyncConflictHttpTransport = {
      send: async (actor, method, path, body) => {
        const response = await http.request(tokenFor(actor), method, path, body);
        return { status: response.status, body: (response.body ?? {}) as Json };
      },
    };
    const firstResult = (body: Json): Json => {
      const results = syncPushResults(body);
      assert.equal(results.length, 1, "one event produces one result");
      const result = results[0];
      assert.ok(result !== undefined);
      return result;
    };
    const nextCursorOf = (body: Json): string => {
      const cursor = body["nextCursor"];
      assert.equal(typeof cursor, "string");
      return cursor as string;
    };

    // 11a. Device registration over HTTP is scoped, idempotent, non-transferable and refuses a
    // revoked device.
    const httpDevice1 = randomUUID();
    const httpDevice2 = randomUUID();
    const httpDeviceA2 = randomUUID();
    assert.deepEqual((await registerSyncDevice(transport, "manager", scopeA1, httpDevice1)).body, { status: "active" });
    assert.deepEqual((await registerSyncDevice(transport, "manager", scopeA1, httpDevice1)).body, { status: "active" }, "registration is idempotent");
    assert.equal((await registerSyncDevice(transport, "cashier", scopeA1, httpDevice1)).status, 403, "a device cannot be re-registered to another actor");
    assert.equal((await registerSyncDevice(transport, "manager", scopeB, randomUUID())).status, 403, "an actor cannot register inside a foreign restaurant");
    assert.equal((await registerSyncDevice(transport, "manager", scopeA1, revokeDevice)).status, 403, "a revoked device cannot come back over HTTP");
    assert.deepEqual((await registerSyncDevice(transport, "cashier", scopeA1, httpDevice2)).body, { status: "active" });
    assert.deepEqual((await registerSyncDevice(transport, "manager", scopeA2, httpDeviceA2)).body, { status: "active" });
    check("http_device_registration_scoped_idempotent_non_transferable");
    cover("two_device_registration");

    // 11b. Revoked device and revoked actor pushes are rejected over HTTP before any effect.
    const revokedPushEvent = envelope({ actorId: managerA, baseVersion: null, deviceId: revokeDevice, entityId: randomUUID(), entityType: "Order",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 9, operation: "create",
      payload: { channel: "counter", currency: "MXN", timeZone: "America/Hermosillo" }, scope: scopeA1 });
    const revokedPush = await pushSyncEvents(transport, "manager", revokeDevice, scopeA1, [revokedPushEvent]);
    assert.equal(revokedPush.status, 200);
    assert.deepEqual(firstResult(revokedPush.body), { eventId: revokedPushEvent["eventId"], idempotencyKey: revokedPushEvent["idempotencyKey"],
      status: "rejected", code: "DEVICE_REVOKED", canonicalVersion: null, auditId: null });
    const revokedActorPushEvent = envelope({ actorId: revokedActor, baseVersion: null, deviceId: revokedActorDevice, entityId: randomUUID(), entityType: "Order",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 2, operation: "create",
      payload: { channel: "counter", currency: "MXN", timeZone: "America/Hermosillo" }, scope: scopeA1 });
    assert.equal(firstResult((await pushSyncEvents(transport, "revoked_actor", revokedActorDevice, scopeA1, [revokedActorPushEvent])).body).status, "rejected");
    assert.equal(firstResult((await pushSyncEvents(transport, "revoked_actor", revokedActorDevice, scopeA1, [revokedActorPushEvent])).body)["code"], "AUTH_REVOKED");
    check("http_revoked_device_and_actor_rejected");
    cover("revoked_actor_and_device");

    // 11c. Accepted push needs a published catalog (currency/timezone are revalidated server-side).
    const categoryId = randomUUID();
    const productId = randomUUID();
    const catalogBody = { deviceId: httpDevice1, eventId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: DEFAULT_OCCURRED_AT,
      schemaVersion: 1, scope: scopeA1, expectedVersion: 0, catalogVersion: randomUUID(), currency: "MXN",
      categories: [{ categoryId, name: "Platos", active: true, displayOrder: 0 }],
      products: [{ productId, categoryId, name: "Hamburguesa", sku: "HAM-001", active: true, displayOrder: 0, stationId: "kitchen", unit: "piece", unitPriceMinor: 12_500, tax: null }],
      modifierGroups: [] };
    assert.equal((await http.request(fixtures.tokens.manager, "PUT", "/catalog/menu", catalogBody)).status, 200);
    const orderA = randomUUID();
    const createOrderEvent = envelope({ actorId: managerA, baseVersion: null, deviceId: httpDevice1, entityId: orderA, entityType: "Order",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create",
      payload: { channel: "counter", currency: "MXN", timeZone: "America/Hermosillo" }, scope: scopeA1 });
    const created = firstResult((await pushSyncEvents(transport, "manager", httpDevice1, scopeA1, [createOrderEvent])).body);
    assert.equal(created["status"], "accepted", `an active device pushes a new order over HTTP: ${JSON.stringify(created)}`);
    assert.equal(firstResult((await pushSyncEvents(transport, "manager", httpDevice1, scopeA1, [createOrderEvent])).body)["status"], "duplicate",
      "an identical replay is a duplicate");
    const transitionEvent = envelope({ actorId: managerA, baseVersion: 1, deviceId: httpDevice1, entityId: orderA, entityType: "Order",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 1, operation: "transition",
      payload: { targetStatus: "open" }, scope: scopeA1 });
    assert.equal(firstResult((await pushSyncEvents(transport, "manager", httpDevice1, scopeA1, [transitionEvent])).body)["status"], "accepted");
    const staleTransition = envelope({ ...readEnvelope(transitionEvent), eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 2 });
    const staleResult = firstResult((await pushSyncEvents(transport, "manager", httpDevice1, scopeA1, [staleTransition])).body);
    assert.equal(staleResult["status"], "rejected");
    assert.equal(staleResult["code"], "STALE_BASE_VERSION", "a stale base version cannot reopen the order");
    check("http_push_accepted_duplicate_and_stale");

    // 11d. Twenty concurrent HTTP resends of the same event produce a single ledger effect.
    const resendOrder = randomUUID();
    const resendEvent = envelope({ actorId: cashierA, baseVersion: null, deviceId: httpDevice2, entityId: resendOrder, entityType: "Order",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 0, operation: "create",
      payload: { channel: "counter", currency: "MXN", timeZone: "America/Hermosillo" }, scope: scopeA1 });
    const resends = await Promise.all(Array.from({ length: 20 }, () => pushSyncEvents(transport, "cashier", httpDevice2, scopeA1, [resendEvent])));
    const resendStatuses = resends.map((response) => String(firstResult(response.body)["status"]));
    assert.equal(resendStatuses.filter((status) => status === "accepted").length, 1, `exactly one resend records: ${resendStatuses.join(",")}`);
    assert.ok(resendStatuses.every((status) => status === "accepted" || status === "duplicate"), `resends are accepted/duplicate: ${resendStatuses.join(",")}`);
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where event_id = $1", [resendEvent["eventId"]]), 1);
    check("http_twenty_concurrent_resends_single_effect");
    cover("twenty_concurrent_resends");

    // 11e. Cross-scope push dedup isolation: the same event id/key is an independent record in another
    // scope (unsupported entity types are used so the assertion does not depend on a second catalog).
    const crossEventId = randomUUID();
    const crossKey = randomUUID();
    const crossA = envelope({ actorId: managerA, baseVersion: null, deviceId: httpDevice1, entityId: randomUUID(), entityType: "Payment",
      eventId: crossEventId, idempotencyKey: crossKey, localSequence: 3, operation: "create", payload: { amountMinor: 1, currency: "MXN" }, scope: scopeA1 });
    const crossB = envelope({ actorId: managerB, baseVersion: null, deviceId: deviceB, entityId: crossA["entityId"] as string, entityType: "Payment",
      eventId: crossEventId, idempotencyKey: crossKey, localSequence: 1, operation: "create", payload: { amountMinor: 1, currency: "MXN" }, scope: scopeB });
    assert.equal(firstResult((await pushSyncEvents(transport, "manager", httpDevice1, scopeA1, [crossA])).body)["code"], "UNSUPPORTED_ENTITY");
    assert.equal(firstResult((await pushSyncEvents(transport, "other_restaurant_manager", deviceB, scopeB, [crossB])).body)["code"], "UNSUPPORTED_ENTITY");
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where event_id = $1", [crossEventId]), 2,
      "the same event id/key is scoped, never shared across restaurantes");
    assert.equal(firstResult((await pushSyncEvents(transport, "manager", httpDevice1, scopeA1, [crossA])).body)["code"], "UNSUPPORTED_ENTITY");
    assert.equal(await count(admin, "select count(*) from app.sync_event_ledger where event_id = $1", [crossEventId]), 2);
    check("http_cross_scope_push_dedup_isolation");

    // 11f. Pull: cursor, branch/cross-restaurant isolation and tombstones. A device sees only its own
    // branch; a foreign device and a foreign cursor are rejected.
    const baselinePull = await pullSyncChanges(transport, "manager", httpDevice1, scopeA1, null, 500);
    assert.equal(baselinePull.status, 200);
    assert.equal((baselinePull.body["scope"] as Json)["branchId"], scopeA1.branchId);
    const baselineCursor = nextCursorOf(baselinePull.body);
    const noLanEntity = randomUUID();
    const noLanEvent = envelope({ actorId: cashierA, baseVersion: null, deviceId: httpDevice2, entityId: noLanEntity, entityType: "Payment",
      eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 1, operation: "create", payload: { amountMinor: 7, currency: "MXN" }, scope: scopeA1 });
    assert.equal((await record(api, cashierA, noLanEvent)).status, "recorded");
    const invisible = await pullSyncChanges(transport, "manager", httpDevice1, scopeA1, baselineCursor, 500);
    assert.equal(syncPullChanges(invisible.body).some((change) => change["entityId"] === noLanEntity), false,
      "another device's recorded edit is not visible until the business writer appends it (no LAN guarantee)");
    assert.equal(typeof await append(managerA, scopeA1, noLanEntity, 1, false, "create"), "number");
    const visible = await pullSyncChanges(transport, "manager", httpDevice1, scopeA1, baselineCursor, 500);
    assert.equal(syncPullChanges(visible.body).some((change) => change["entityId"] === noLanEntity), true, "the appended change is pulled");
    const visibleCursor = nextCursorOf(visible.body);
    cover("no_lan_visibility");

    const tombEntity = randomUUID();
    assert.equal(typeof await append(managerA, scopeA1, tombEntity, 1, false, "create"), "number");
    assert.equal(typeof await append(managerA, scopeA1, tombEntity, 2, true, "delete"), "number");
    const tombPull = await pullSyncChanges(transport, "manager", httpDevice1, scopeA1, visibleCursor, 500);
    const tombChange = syncPullChanges(tombPull.body).find((change) => change["entityId"] === tombEntity && change["tombstone"] === true);
    assert.ok(tombChange !== undefined, "the tombstone is pulled");
    assert.equal(tombChange["tombstone"], true);
    assert.equal(tombChange["snapshot"], null);

    const a2Pull = await pullSyncChanges(transport, "manager", httpDeviceA2, scopeA2, null, 500);
    assert.equal(a2Pull.status, 200);
    assert.ok(syncPullChanges(a2Pull.body).every((change) => change["branchId"] === scopeA2.branchId), "the A2 device only reads A2 changes");
    assert.equal(syncPullChanges(a2Pull.body).some((change) => change["entityId"] === noLanEntity), false, "A1 changes never leak to A2");
    assert.equal((await pullSyncChanges(transport, "manager", httpDevice1, scopeA2, null, 500)).status, 403, "a device active in A1 cannot pull A2");
    assert.equal((await pullSyncChanges(transport, "manager", httpDeviceA2, scopeA2, baselineCursor, 500)).status, 400, "a cursor from another scope is rejected");
    check("http_pull_cursor_tombstone_and_scope_isolation");
    cover("cross_scope_isolation");

    // 11g. Manual review over HTTP: supervisors list and resolve with command idempotency; cashiers,
    // viewers and foreign managers are refused.
    const reviewList = await listSyncManualReviews(transport, "manager", scopeA1);
    assert.equal(reviewList.status, 200);
    const listedCases = reviewList.body as unknown;
    assert.ok(Array.isArray(listedCases));
    assert.ok((listedCases as readonly Json[]).some((entry) => entry["caseId"] === secondCaseId), "the open case is listed");
    assert.equal((await listSyncManualReviews(transport, "cashier", scopeA1)).status, 403);
    const reviewDevice = httpDevice1;
    const reviewKey = randomUUID();
    const reviewCommand = { caseId: secondCaseId as string, decision: "reject" as const, reason: "reviewed over http", compensatingEventId: null,
      idempotencyKey: reviewKey, deviceId: reviewDevice, occurredAt: DEFAULT_OCCURRED_AT };
    assert.deepEqual((await resolveSyncManualReview(transport, "manager", scopeA1, reviewCommand)).body, { status: "resolved" });
    assert.deepEqual((await resolveSyncManualReview(transport, "manager", scopeA1, reviewCommand)).body, { status: "duplicate" }, "an identical command replay is a duplicate");
    const conflicting = await resolveSyncManualReview(transport, "manager", scopeA1, { ...reviewCommand, reason: "different intent" });
    assert.equal(conflicting.status, 409, "the same key with a different intent conflicts");
    assert.equal((await resolveSyncManualReview(transport, "other_restaurant_manager", scopeB, { ...reviewCommand, idempotencyKey: randomUUID(), deviceId: deviceB })).status, 404,
      "a foreign scope cannot resolve the case");
    assert.equal((await resolveSyncManualReview(transport, "viewer", scopeA1, { ...reviewCommand, idempotencyKey: randomUUID() })).status, 403,
      "a non-supervisor cannot resolve the case");
    check("http_manual_review_list_resolve_idempotency_and_isolation");
    cover("manual_review_http");

    assertSyncConflictScenariosCovered(coveredScenarios);
    process.stdout.write(`${JSON.stringify({ stage: "sync_conflicts", status: "ok", runId: local.runId, checks, coveredScenarios })}\n`);
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
