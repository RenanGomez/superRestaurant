import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { parseBranchScope } from "@super-restaurant/shared-types";
import { PostgresCaptureCreator } from "../captures.js";
import { assertLocalCustomerConcurrencyConfig, type CustomerConcurrencyConfig } from "./customer-directory-concurrency-verification.js";

interface CaptureOutcome {
  readonly status: string;
  readonly record: { readonly detail: { readonly version: number; readonly attentionLeaseId: string;
    readonly ownerMembershipId: string; readonly attentionStatus: string } };
}

/** Only the dedicated, marked disposable PG17 cluster accepts fixture commits. */
export async function verifyCaptureConcurrency(config: CustomerConcurrencyConfig) {
  assertLocalCustomerConcurrencyConfig(config);
  const clients = Array.from({ length: 3 }, () => new Client({ host: config.host, port: config.port,
    database: config.database, user: config.user, password: config.password ?? "", ssl: false,
    connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 15000,
    application_name: "superrestaurant-local-capture-concurrency" }));
  const [first, second, observer] = clients;
  assert.ok(first && second && observer);
  try {
    await Promise.all(clients.map((client) => client.connect()));
    for (const client of clients) {
      const guard = await client.query<{ database: string; marker: string; version: string; address: string }>(
        "select current_database() as database, marker,current_setting('server_version_num') as version,host(inet_server_addr()) as address from app_private.local_concurrency_guard",
      );
      assert.equal(guard.rows.length, 1);
      assert.equal(guard.rows[0]?.database, config.database);
      assert.equal(guard.rows[0]?.marker, config.marker);
      assert.equal(guard.rows[0]?.address, "127.0.0.1");
      assert.ok(Number(guard.rows[0]?.version) >= 170000 && Number(guard.rows[0]?.version) < 180000);
    }
    const secondActor = randomUUID(), secondMembership = randomUUID();
    await observer.query("BEGIN");
    try {
      await observer.query("insert into auth.users(id,email) values($1,'local-capture-second@invalid.test')", [secondActor]);
      await observer.query("insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values($1,$2,$3,$4,$5)",
        [secondMembership, secondActor, config.restaurantId, config.branchId, config.actorId]);
      await observer.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values($1,'cashier',$2)", [secondMembership, config.actorId]);
      await observer.query("COMMIT");
    } catch (error: unknown) { await observer.query("ROLLBACK"); throw error; }
    const membership = await observer.query<{ id: string }>(
      "select id::text as id from app.memberships where user_id=$1 and restaurant_id=$2 and branch_id=$3 and revoked_at is null",
      [config.actorId, config.restaurantId, config.branchId],
    );
    assert.equal(membership.rows.length, 1);
    const ownerId = membership.rows[0]?.id;
    const scope = parseBranchScope({ restaurantId: config.restaurantId, branchId: config.branchId });
    assert.ok(scope && ownerId);
    const captureDraftId = randomUUID(), deviceId = randomUUID();
    const common = (expectedVersion: number) => ({ schemaVersion: 1 as const, captureDraftId, expectedVersion,
      scope, deviceId, eventId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: new Date().toISOString() });
    const writers = [first, second].map((client) => new PostgresCaptureCreator({ query: (sql, parameters) => client.query(sql, [...parameters]) }));
    const [writerA, writerB] = writers;
    assert.ok(writerA && writerB);
    const begin = async (client: Client) => {
      await client.query("BEGIN"); await client.query("SET LOCAL ROLE app_api");
      assert.equal((await client.query<{ role: string }>("select current_user as role")).rows[0]?.role, "app_api");
    };
    const pids = await Promise.all([first, second].map(async (client) => (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid));
    assert.ok(pids[0] && pids[1]);
    let blockedPairs = 0;
    const race = async (a: () => Promise<unknown>, b: () => Promise<unknown>, status: string) => {
      await begin(first); await begin(second);
      const winner = await a() as CaptureOutcome;
      assert.equal(winner.status, "applied");
      const pending = b().then((value) => ({ value }), (error: unknown) => ({ error }));
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const locks = await observer.query<{ blocked: boolean }>("select $1::int=any(pg_blocking_pids($2::int)) as blocked", pids);
        if (locks.rows[0]?.blocked) { blocked = true; break; }
        await delay(20);
      }
      if (!blocked) { await first.query("ROLLBACK"); await pending; throw new Error("LOCAL_CAPTURE_CONCURRENCY_BLOCK_NOT_OBSERVED"); }
      blockedPairs += 1;
      await first.query("COMMIT");
      const loser = await pending;
      if ("error" in loser) throw loser.error;
      assert.equal((loser.value as CaptureOutcome).status, status);
      if (status === "replayed") assert.deepEqual((loser.value as CaptureOutcome).record, winner.record);
      await second.query("COMMIT");
      return winner;
    };
    const creation = { ...common(0), expectedVersion: 0 as const, sourceChannel: "phone" as const, fulfillmentChannel: "pickup" as const };
    const created = await race(() => writerA.createDraft(config.actorId, creation), () => writerB.createDraft(config.actorId, creation), "replayed");
    await begin(first);
    const held = await writerA.mutateAttention(config.actorId, "capture.held", { ...common(1), attentionLeaseId: created.record.detail.attentionLeaseId }) as CaptureOutcome;
    assert.equal(held.status, "applied");
    await first.query("COMMIT");
    const claimed = await race(() => writerA.mutateAttention(config.actorId, "capture.claimed", common(2)),
      () => writerB.mutateAttention(secondActor, "capture.claimed", common(2)), "conflict");
    assert.equal(claimed.record.detail.ownerMembershipId, ownerId);
    assert.equal(claimed.record.detail.attentionStatus, "claimed");
    await begin(first);
    const heldAgain = await writerA.mutateAttention(config.actorId, "capture.held", { ...common(3), attentionLeaseId: claimed.record.detail.attentionLeaseId }) as CaptureOutcome;
    assert.equal(heldAgain.status, "applied");
    await first.query("COMMIT");
    const resume = common(4);
    const resumed = await race(() => writerA.mutateAttention(config.actorId, "capture.resumed", resume),
      () => writerB.mutateAttention(secondActor, "capture.resumed", common(4)), "conflict");
    assert.equal(resumed.record.detail.ownerMembershipId, ownerId);
    await begin(second);
    const replay = await writerB.mutateAttention(config.actorId, "capture.resumed", resume) as CaptureOutcome;
    assert.equal(replay.status, "replayed");
    assert.deepEqual(replay.record, resumed.record);
    await second.query("COMMIT");
    const state = await observer.query<{ version: string; owner: string; lease: string; events: string; attention: string }>(
      `select c.version::text as version,c.owner_membership_id::text as owner,c.attention_lease_id::text as lease,
       c.attention_status as attention,(select count(*)::text from app.capture_command_events e
       where e.restaurant_id=c.restaurant_id and e.branch_id=c.branch_id and e.capture_draft_id=c.id) as events
       from app.capture_drafts c where c.restaurant_id=$1 and c.branch_id=$2 and c.id=$3`,
      [config.restaurantId, config.branchId, captureDraftId],
    );
    assert.deepEqual(state.rows, [{ version: "5", owner: ownerId, lease: resumed.record.detail.attentionLeaseId, attention: "claimed", events: "5" }]);
    return Object.freeze({ checks: 8, blockedPairs, version: 5, journalEvents: 5,
      cases: Object.freeze(["create_same_key_replay", "claim_two_actors_cas", "resume_two_actors_cas", "resume_exact_replay"]) });
  } finally {
    const cleanup = await Promise.allSettled(clients.map(async (client) => { try { await client.query("ROLLBACK"); } finally { await client.end(); } }));
    if (cleanup.some((result) => result.status === "rejected")) throw new Error("LOCAL_CAPTURE_CONCURRENCY_CONNECTION_CLEANUP_FAILED");
  }
}
