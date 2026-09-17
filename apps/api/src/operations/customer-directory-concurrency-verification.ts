import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { parseBranchScope } from "@super-restaurant/shared-types";
import { PostgresCustomerDirectoryWriter } from "../customer-directory.js";

export const LOCAL_CUSTOMER_CONCURRENCY_MARKER = "LOCAL_CUSTOMER_CONCURRENCY_ONLY";
export interface CustomerConcurrencyConfig {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password?: string;
  readonly marker: string;
  readonly actorId: string;
  readonly restaurantId: string;
  readonly branchId: string;
}
/** Explicit local configuration only: never reads process.env or remote configuration. */
export function assertLocalCustomerConcurrencyConfig(config: CustomerConcurrencyConfig): void {
  assert.equal(config.host, "127.0.0.1");
  assert.match(config.database, /^superrestaurant_concurrency_[a-z0-9_]+$/u);
  assert.equal(config.marker, LOCAL_CUSTOMER_CONCURRENCY_MARKER);
  assert.ok(Number.isInteger(config.port) && config.port >= 1024 && config.port <= 65535);
  assert.match(config.user, /^[a-z][a-z0-9_]*$/u);
  for (const id of [config.actorId, config.restaurantId, config.branchId]) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  }
}

/** Caller owns the disposable local cluster and committed baseline/fixtures. */
export async function verifyCustomerDirectoryConcurrency(config: CustomerConcurrencyConfig) {
  assertLocalCustomerConcurrencyConfig(config);
  const clients = Array.from({ length: 3 }, () => new Client({
    host: config.host, port: config.port, database: config.database, user: config.user,
    password: config.password ?? "", ssl: false, connectionTimeoutMillis: 5000,
    statement_timeout: 10000, query_timeout: 15000, application_name: "superrestaurant-local-customer-concurrency",
  }));
  const [first, second, observer] = clients;
  assert.ok(first && second && observer);
  try {
    await Promise.all(clients.map((client) => client.connect()));
    process.stdout.write('{"stage":"customer_concurrency_connect","status":"ok"}\n');
    for (const client of clients) {
      const guard = await client.query<{ version: string; address: string; marker: string; database: string }>(
        "select current_database() as database, current_setting('server_version_num') as version, host(inet_server_addr()) as address, marker from app_private.local_concurrency_guard",
      );
      process.stdout.write(`${JSON.stringify({ stage: "customer_concurrency_guard_observed", database: guard.rows[0]?.database,
        address: guard.rows[0]?.address, version: guard.rows[0]?.version, markerMatches: guard.rows[0]?.marker === config.marker })}\n`);
      assert.equal(guard.rows.length, 1);
      assert.equal(guard.rows[0]?.address, "127.0.0.1");
      assert.equal(guard.rows[0]?.marker, config.marker);
      assert.equal(guard.rows[0]?.database, config.database);
      assert.ok(Number(guard.rows[0]?.version) >= 170000 && Number(guard.rows[0]?.version) < 180000);
    }
    process.stdout.write('{"stage":"customer_concurrency_guard","status":"ok"}\n');
    const scope = parseBranchScope({ restaurantId: config.restaurantId, branchId: config.branchId });
    assert.ok(scope);
    const customerId = randomUUID(), addressId = randomUUID(), deviceId = randomUUID();
    const common = (expectedVersion: number) => ({ schemaVersion: 1 as const, scope, customerId,
      expectedVersion, eventId: randomUUID(), deviceId, idempotencyKey: randomUUID(), occurredAt: new Date().toISOString() });
    const writers = [first, second].map((client) => new PostgresCustomerDirectoryWriter({ query: (sql, parameters) => client.query(sql, [...parameters]) }));
    const [writerA, writerB] = writers;
    assert.ok(writerA && writerB);
    const pids = await Promise.all([first, second].map(async (client) => (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid));
    assert.ok(pids[0] && pids[1]);
    const begin = async (client: Client) => {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_api");
      assert.equal((await client.query<{ role: string }>("select current_user as role")).rows[0]?.role, "app_api");
    };
    let blockedPairs = 0;
    const race = async (a: () => Promise<unknown>, b: () => Promise<unknown>, expectedB: string) => {
      await begin(first);
      await begin(second);
      const resultA = await a();
      assert.equal((resultA as { status: string }).status, "applied");
      // Attach rejection handler immediately so deadline failures cannot cause an unhandled rejection.
      const pending = b().then((value) => ({ value }), (error: unknown) => ({ error }));
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const observation = await observer.query<{ blocked: boolean }>(
          "select $1::int = any(pg_blocking_pids($2::int)) as blocked", [pids[0], pids[1]],
        );
        if (observation.rows[0]?.blocked) { blocked = true; break; }
        await delay(20);
      }
      if (!blocked) {
        await first.query("ROLLBACK");
        await pending;
        throw new Error("LOCAL_CUSTOMER_CONCURRENCY_BLOCK_NOT_OBSERVED");
      }
      blockedPairs += 1;
      await first.query("COMMIT");
      const resultB = await pending;
      if ("error" in resultB) throw resultB.error;
      assert.equal((resultB.value as { status: string }).status, expectedB);
      await second.query("COMMIT");
      return resultA as { record: { version: number } };
    };
    const initial = { ...common(0), displayName: "Local concurrency customer", phones: [] };
    await race(() => writerA.saveProfile(config.actorId, initial), () => writerB.saveProfile(config.actorId, initial), "replayed");
    process.stdout.write('{"stage":"customer_concurrency_replay","status":"ok"}\n');
    const collisionId = randomUUID();
    const collision = { ...common(0), customerId: collisionId, displayName: "Collision winner", phones: [] };
    await race(() => writerA.saveProfile(config.actorId, collision),
      () => writerB.saveProfile(config.actorId, { ...common(0), customerId: collisionId, displayName: "Collision loser", phones: [] }), "conflict");
    const collisionState = await observer.query<{ version: string; events: string }>(
      `select version::text as version,(select count(*)::text from app.customer_command_events e
         where e.restaurant_id=c.restaurant_id and e.customer_id=c.id) as events
       from app.customers c where c.restaurant_id=$1 and c.id=$2`, [config.restaurantId, collisionId],
    );
    assert.deepEqual(collisionState.rows, [{ version: "1", events: "1" }]);
    process.stdout.write('{"stage":"customer_concurrency_uuid_collision","status":"ok"}\n');
    const divergent = { ...common(1), displayName: "Winner", phones: [] };
    await race(() => writerA.saveProfile(config.actorId, divergent),
      () => writerB.saveProfile(config.actorId, { ...divergent, displayName: "Divergent" }), "conflict");
    process.stdout.write('{"stage":"customer_concurrency_divergence","status":"ok"}\n');
    const cas = { ...common(2), displayName: "CAS winner", phones: [] };
    await race(() => writerA.saveProfile(config.actorId, cas),
      () => writerB.saveProfile(config.actorId, { ...common(2), displayName: "CAS stale", phones: [] }), "conflict");
    process.stdout.write('{"stage":"customer_concurrency_profile_cas","status":"ok"}\n');
    const address = { label: "Casa", streetLine: "Local 10", unit: null, neighborhood: null, locality: "Navojoa",
      region: null, countryCode: "MX", postalCode: null, references: null, instructions: null, coordinates: null };
    await begin(first);
    const saved = await writerA.saveAddress(config.actorId, { ...common(0), addressId, address });
    assert.equal((saved as { status: string }).status, "applied");
    await first.query("COMMIT");
    await race(() => writerA.validateAddress(config.actorId, { ...common(1), addressId }),
      () => writerB.saveAddress(config.actorId, { ...common(1), addressId, address: { ...address, streetLine: "Stale edit" } }), "conflict");
    process.stdout.write('{"stage":"customer_concurrency_address_cas","status":"ok"}\n');
    // A successful edit at the new version must clear the previously committed validation.
    await begin(first);
    const edited = await writerA.saveAddress(config.actorId, { ...common(2), addressId, address: { ...address, streetLine: "Current edit" } });
    assert.equal((edited as { status: string }).status, "applied");
    assert.equal((edited as { record: { validation: unknown } }).record.validation, null);
    await first.query("COMMIT");
    const state = await observer.query<{ profile_version: string; address_version: string; validated: boolean; events: string }>(
      `select c.version::text as profile_version,a.version::text as address_version,
        a.validated_at is not null as validated,
        (select count(*)::text from app.customer_command_events e where e.restaurant_id=c.restaurant_id and e.customer_id=c.id) as events
       from app.customers c join app.customer_addresses a on a.restaurant_id=c.restaurant_id and a.customer_id=c.id
       where c.restaurant_id=$1 and c.id=$2 and a.id=$3`, [config.restaurantId, customerId, addressId],
    );
    assert.equal(state.rows.length, 1);
    assert.deepEqual(state.rows[0], { profile_version: "3", address_version: "3", validated: false, events: "6" });
    return Object.freeze({ checks: 11, blockedPairs, profileVersion: 3, addressVersion: 3, journalEvents: 6, collisionJournalEvents: 1,
      cases: Object.freeze(["same_key_replay", "create_uuid_collision", "same_key_divergence", "profile_cas", "validation_edit_cas", "edit_clears_validation"]) });
  } finally {
    const cleanup = await Promise.allSettled(clients.map(async (client) => { try { await client.query("ROLLBACK"); } finally { await client.end(); } }));
    if (cleanup.some((result) => result.status === "rejected")) throw new Error("LOCAL_CUSTOMER_CONCURRENCY_CONNECTION_CLEANUP_FAILED");
  }
}
