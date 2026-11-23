import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseSyncEnvelopeV1 } from "@super-restaurant/shared-types";
import { PostgresDatabaseClient } from "../database.js";
import type { TransactionalDatabaseClientPort } from "../database.js";
import { SyncMergeExecutor } from "../sync/sync-merge-executor.js";
import type { LocalPostgres } from "./local-postgres.js";

export async function verifySyncExecutor(local: LocalPostgres): Promise<void> {
  const actor = randomUUID(); const restaurant = randomUUID(); const branch = randomUUID();
  const foreignRestaurant = randomUUID(); const foreignBranch = randomUUID(); const membership = randomUUID();
  const device = randomUUID();
  await local.admin.query("insert into auth.users(id,email) values ($1,'sync-executor@invalid.test')", [actor]);
  await local.admin.query("insert into app.restaurants(id,name,time_zone) values ($1,'sync-executor','America/Hermosillo'),($2,'foreign','America/Hermosillo')", [restaurant, foreignRestaurant]);
  await local.admin.query("insert into app.branches(id,restaurant_id,name) values ($1,$2,'sync'),($3,$4,'foreign')", [branch, restaurant, foreignBranch, foreignRestaurant]);
  await local.admin.query("insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values ($1,$2,$3,$4,$2)", [membership, actor, restaurant, branch]);
  await local.admin.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values ($1,'cashier',$2)", [membership, actor]);
  const catalog = randomUUID();
  await local.admin.query("insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values ($1,$2,1,'MXN',$3)", [catalog, restaurant, actor]);
  await local.admin.query("insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by) values ($1,$2,1,clock_timestamp(),$3)", [restaurant, catalog, actor]);
  await local.admin.query("select app_private.sync_register_device($1,$2,$3,$4)", [actor, restaurant, branch, device]);
  await local.enableAppApiLogin();
  const database = new PostgresDatabaseClient({ connectionString: local.appApiUrl, caCertificate: "" });
  try {
    const executor = new SyncMergeExecutor(database, { verifyAccessToken: async () => ({ actorId: actor }) });
    const event = parseSyncEnvelopeV1({ eventId: randomUUID(), idempotencyKey: randomUUID(), deviceId: device,
      actorId: actor, restaurantId: restaurant, branchId: branch, entityType: "Order", entityId: randomUUID(),
      operation: "create", schemaVersion: "1", localSequence: 1, baseVersion: null,
      occurredAt: "2026-11-23T00:00:00.000Z", receivedAt: null, payload: { channel: "counter", currency: "MXN", timeZone: "America/Hermosillo" }, retryCount: 0, localState: "pending" });
    assert.ok(event);
    assert.equal(await executor.execute("token", { ...event, payload: { ...event.payload, currency: "USD" } }), null);
    assert.equal(await executor.execute("token", { ...event, payload: { ...event.payload, timeZone: "UTC" } }), null);
    assert.equal((await executor.execute("token", event))?.status, "accepted");
    assert.equal((await executor.execute("token", event))?.status, "duplicate");
    assert.equal((await executor.execute("token", { ...event, payload: { ...event.payload, channel: "table" } }))?.code, "EVENT_ID_REUSE");
    assert.equal((await executor.execute("token", { ...event, eventId: randomUUID(), entityId: randomUUID(), localSequence: 2 }))?.code, "IDEMPOTENCY_KEY_REUSE");
    const opening = { ...event, eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 2,
      operation: "transition" as const, baseVersion: 1, payload: { targetStatus: "open" } };
    assert.equal((await executor.execute("token", opening))?.status, "accepted");
    assert.equal((await executor.execute("token", opening))?.status, "duplicate");
    const next = { ...event, eventId: randomUUID(), idempotencyKey: randomUUID(), entityId: randomUUID(), localSequence: 3 };
    const failing: TransactionalDatabaseClientPort = {
      query: (sql, params) => database.query(sql, params),
      transaction: (operation) => database.transaction((db) => operation({ query: (sql, params) => {
        if (sql.includes("persist_order_mutation")) throw new Error("INJECTED_WRITE_FAILURE");
        return db.query(sql, params);
      } })),
    };
    const failingExecutor = new SyncMergeExecutor(failing, { verifyAccessToken: async () => ({ actorId: actor }) });
    await assert.rejects(failingExecutor.execute("token", next), /INJECTED_WRITE_FAILURE/u);
    const conflicting: TransactionalDatabaseClientPort = {
      query: (sql, params) => database.query(sql, params),
      transaction: (operation) => database.transaction((db) => operation({ query: (sql, params) =>
        sql.includes("persist_order_mutation") ? Promise.resolve({ rows: [{ result: { status: "conflict" } }] }) : db.query(sql, params) })),
    };
    await assert.rejects(new SyncMergeExecutor(conflicting, { verifyAccessToken: async () => ({ actorId: actor }) }).execute("token", next), /SYNC_CONCURRENT_RETRY/u);
    const afterRollback = await local.admin.query("select count(*)::int as count from app.sync_event_ledger where event_id=$1", [next.eventId]);
    assert.equal(afterRollback.rows[0]?.count, 0);
    assert.equal((await executor.execute("token", next))?.status, "accepted");
    const counts = await local.admin.query("select (select count(*)::int from app.orders where restaurant_id=$1) as orders, (select count(*)::int from app.sync_event_ledger where restaurant_id=$1) as ledger", [restaurant]);
    assert.deepEqual(counts.rows[0], { orders: 2, ledger: 3 });
    const stale = { ...opening, eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 4, baseVersion: 0 };
    const staleResult = await executor.execute("token", stale);
    assert.equal(staleResult?.status, "rejected");
    assert.equal(staleResult.code, "STALE_BASE_VERSION");
    const unsupported = { ...event, eventId: randomUUID(), idempotencyKey: randomUUID(), localSequence: 6, entityType: "Payment" as const };
    assert.equal((await executor.execute("token", unsupported))?.code, "UNSUPPORTED_ENTITY");
    assert.equal((await executor.execute("token", unsupported))?.code, "UNSUPPORTED_ENTITY");
    const outOfOrder = { ...event, eventId: randomUUID(), idempotencyKey: randomUUID(), entityId: randomUUID(), localSequence: 5 };
    assert.equal(await executor.execute("token", outOfOrder), null);
    const reusedSequence = { ...outOfOrder, localSequence: 6 };
    assert.equal((await executor.execute("token", reusedSequence))?.code, "LOCAL_SEQUENCE_REUSE");
    const foreign = { ...event, restaurantId: foreignRestaurant as typeof event.restaurantId, branchId: foreignBranch as typeof event.branchId };
    assert.equal((await executor.execute("token", foreign))?.code, "AUTH_REVOKED");
    await local.admin.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values ($1,'viewer',$2)", [membership, actor]);
    await local.admin.query("update app.membership_role_grants set revoked_at=clock_timestamp(),revoked_by=$1,revocation_reason='test' where membership_id=$2 and role_code='cashier'", [actor, membership]);
    assert.equal((await executor.execute("token", event))?.code, "AUTH_REVOKED");
    await local.admin.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values ($1,'cashier',$2)", [membership, actor]);
    await local.admin.query("update app.sync_devices set revoked_at=clock_timestamp(),revoked_by=$1 where restaurant_id=$2 and branch_id=$3 and device_id=$4", [actor, restaurant, branch, device]);
    assert.equal((await executor.execute("token", event))?.code, "DEVICE_REVOKED");
    await local.admin.query("update app.memberships set revoked_at=clock_timestamp(),revoked_by=$1,revocation_reason='test' where id=$2", [actor, membership]);
    assert.equal((await executor.execute("token", event))?.code, "AUTH_REVOKED");
  } finally { await database.onApplicationShutdown(); }
}
