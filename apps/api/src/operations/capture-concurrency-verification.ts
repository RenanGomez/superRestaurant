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
    readonly ownerMembershipId: string; readonly attentionStatus: string; readonly customerSnapshotRef: string | null;
    readonly fulfillmentSnapshotRef?: string | null; readonly sourceChannel?: string; readonly fulfillmentChannel?: string | null } };
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
      if (winner.status !== "applied") process.stdout.write(`${JSON.stringify({ stage: "capture_race_winner", status: winner.status })}\n`);
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
    // S2.1 uses real private writers as app_api; only this guarded local cluster
    // receives committed fixtures. Capture CAS and snapshot/journal are atomic.
    const customerId = randomUUID(), contactId = randomUUID();
    await observer.query("insert into app.customers(id,restaurant_id,display_name,created_by,updated_by) values($1,$2,'Snapshot original',$3,$3)",
      [customerId, config.restaurantId, config.actorId]);
    await observer.query("insert into app.customer_phones(restaurant_id,customer_id,contact_id,label,display_value,normalized_value) values($1,$2,$3,'Local','642 100 2000','6421002000')",
      [config.restaurantId, customerId, contactId]);
    const selection = (version: number, customerVersion = 1) => ({ ...common(version),
      attentionLeaseId: resumed.record.detail.attentionLeaseId, customerId, contactId, expectedCustomerVersion: customerVersion });
    const selectedCommand = selection(5);
    const selected = await race(() => writerA.setCustomer(config.actorId, selectedCommand),
      () => writerB.setCustomer(config.actorId, selectedCommand), "replayed");
    assert.ok(selected.record.detail.customerSnapshotRef);
    const snapshotRows = async () => (await observer.query(
      "select id::text,customer_id::text,contact_id::text,display_name,phone_display_value,phone_normalized_value from app.customer_party_snapshots where restaurant_id=$1 and customer_id=$2 order by id",
      [config.restaurantId, customerId])).rows;
    const originalSnapshot = await snapshotRows();
    assert.equal(originalSnapshot.length, 1);
    assert.equal(originalSnapshot[0]?.id, selected.record.detail.customerSnapshotRef);
    const divergent = selection(6);
    await race(() => writerA.setCustomer(config.actorId, divergent),
      () => writerB.setCustomer(config.actorId, { ...divergent, customerId: null, contactId: null, expectedCustomerVersion: null }), "conflict");
    await race(() => writerA.setCustomer(config.actorId, selection(7)),
      () => writerB.setCustomer(config.actorId, selection(7)), "conflict");
    assert.equal((await snapshotRows()).length, 3);
    await observer.query("update app.customers set display_name='Snapshot changed',version=2,updated_at=clock_timestamp() where restaurant_id=$1 and id=$2",
      [config.restaurantId, customerId]);
    await observer.query("update app.customer_phones set display_value='642 300 4000',normalized_value='6423004000',updated_at=clock_timestamp() where restaurant_id=$1 and customer_id=$2",
      [config.restaurantId, customerId]);
    const frozenAfterEdit = await snapshotRows();
    assert.deepEqual(frozenAfterEdit.find((row) => row.id === selected.record.detail.customerSnapshotRef), originalSnapshot[0]);
    const counts = async () => (await observer.query(
      `select version::text,(select count(*)::text from app.capture_command_events where capture_draft_id=$1) as events,
       (select count(*)::text from app.customer_party_snapshots where restaurant_id=$2 and customer_id=$3) as snapshots
       from app.capture_drafts where id=$1 and restaurant_id=$2 and branch_id=$4`,
      [captureDraftId, config.restaurantId, customerId, config.branchId])).rows;
    const unchanged = await counts();
    const failure = async (actor: string, command: ReturnType<typeof selection>, expectedStatus: string) => {
      await begin(first);
      const result = await writerA.setCustomer(actor, command) as CaptureOutcome;
      assert.equal(result.status, expectedStatus);
      await first.query("COMMIT");
      assert.deepEqual(await counts(), unchanged);
    };
    await failure(config.actorId, selection(8), "conflict"); // stale customer version
    await failure(config.actorId, { ...selection(8, 2), attentionLeaseId: randomUUID() }, "conflict");
    await failure(secondActor, selection(8, 2), "conflict"); // valid membership, wrong owner
    await failure(config.actorId, { ...selection(8, 2), scope: parseBranchScope({ restaurantId: randomUUID(), branchId: randomUUID() })! }, "denied");
    // An event UUID already accepted by another operation must not leave the
    // newly derived snapshot or incremented Capture behind.
    await failure(config.actorId, { ...selection(8, 2), eventId: creation.eventId }, "conflict");
    await observer.query("update app.memberships set revoked_at=clock_timestamp(),revoked_by=$1,revocation_reason='Local verification' where id=$2", [config.actorId, ownerId]);
    await failure(config.actorId, selectedCommand, "denied"); // replay renews authorization
    await observer.query("update app.memberships set revoked_at=null,revoked_by=null,revocation_reason=null where id=$1", [ownerId]);
    await begin(first);
    const replacement = await writerA.setCustomer(config.actorId, selection(8, 2)) as CaptureOutcome;
    assert.equal(replacement.status, "applied");
    await first.query("COMMIT");
    assert.notEqual(replacement.record.detail.customerSnapshotRef, selected.record.detail.customerSnapshotRef);
    const replacementSnapshot = (await snapshotRows()).find((row) => row.id === replacement.record.detail.customerSnapshotRef);
    assert.equal(replacementSnapshot?.display_name, "Snapshot changed");
    assert.equal(replacementSnapshot?.phone_normalized_value, "6423004000");
    const addressId = randomUUID(), validationEventId = randomUUID(), validationDeviceId = randomUUID();
    process.stdout.write(`${JSON.stringify({ stage: "capture_fulfillment_fixture", status: "started" })}\n`);
    const validatedAt = new Date().toISOString();
    await observer.query(`insert into app.customer_addresses(id,restaurant_id,customer_id,label,street_line,locality,country_code,
      validation_branch_id,validation_event_id,validated_by,validation_device_id,validated_at,created_at,created_by,updated_at,updated_by)
      values($1,$2,$3,'Home','Original street','Navojoa','MX',$4,$5,$6,$7,$8,$8,$6,$8,$6)`,
      [addressId, config.restaurantId, customerId, config.branchId, validationEventId, config.actorId, validationDeviceId, validatedAt]);
    process.stdout.write(`${JSON.stringify({ stage: "capture_fulfillment_fixture", status: "ok" })}\n`);
    const fulfillment = (version: number) => ({ ...common(version), attentionLeaseId: resumed.record.detail.attentionLeaseId,
      customerSnapshotRef: replacement.record.detail.customerSnapshotRef!, addressId, expectedAddressVersion: 1 });
    const fulfillmentCommand = fulfillment(9);
    await begin(first);
    let selectedFulfillment: CaptureOutcome;
    try { selectedFulfillment = await writerA.setFulfillment(config.actorId, fulfillmentCommand) as CaptureOutcome;
      process.stdout.write(`${JSON.stringify({ stage: "capture_fulfillment_writer", status: selectedFulfillment.status })}\n`);
    } catch (error: unknown) { process.stdout.write(`${JSON.stringify({ stage: "capture_fulfillment_writer", status: "failed",
      code: typeof error === "object" && error !== null && "code" in error ? error.code : "unknown" })}\n`); throw error; }
    await first.query("COMMIT");
    assert.ok(selectedFulfillment.record.detail.fulfillmentSnapshotRef);
    await begin(second);
    const fulfillmentReplay = await writerB.setFulfillment(config.actorId, fulfillmentCommand) as CaptureOutcome;
    process.stdout.write(`${JSON.stringify({ stage: "capture_fulfillment_direct_replay", status: fulfillmentReplay.status })}\n`);
    assert.equal(fulfillmentReplay.status, "replayed");
    assert.deepEqual(fulfillmentReplay.record, selectedFulfillment.record);
    await second.query("COMMIT");
    process.stdout.write(`${JSON.stringify({ stage: "capture_fulfillment_replay", status: "ok" })}\n`);
    const fulfillmentCas = fulfillment(10);
    const racedFulfillment = await race(() => writerA.setFulfillment(config.actorId, fulfillmentCas),
      () => writerB.setFulfillment(config.actorId, { ...fulfillmentCas, idempotencyKey: randomUUID(), eventId: randomUUID() }), "conflict");
    process.stdout.write(`${JSON.stringify({ stage: "capture_fulfillment_cas", status: "ok" })}\n`);
    await begin(first);
    const workspace = await writerA.readWorkspace(config.actorId, { schemaVersion: 1, scope, captureDraftId }) as {
      readonly detail: { readonly customerSnapshotRef: string; readonly fulfillmentSnapshotRef: string; readonly version: number };
      readonly customerSnapshot: { readonly displayName: string; readonly snapshotRef: string };
      readonly fulfillmentSnapshot: { readonly streetLine: string; readonly snapshotRef: string };
    };
    await first.query("COMMIT");
    assert.equal(workspace.detail.version, 11);
    assert.equal(workspace.customerSnapshot.snapshotRef, racedFulfillment.record.detail.customerSnapshotRef);
    assert.equal(workspace.customerSnapshot.displayName, "Snapshot changed");
    assert.equal(workspace.fulfillmentSnapshot.snapshotRef, racedFulfillment.record.detail.fulfillmentSnapshotRef);
    assert.equal(workspace.fulfillmentSnapshot.streetLine, "Original street");
    const autosaveCommand = { ...common(11), attentionLeaseId: resumed.record.detail.attentionLeaseId,
      sourceChannel: "whatsapp_manual" as const, fulfillmentChannel: "delivery" as const,
      customerSnapshotRef: racedFulfillment.record.detail.customerSnapshotRef,
      fulfillmentSnapshotRef: racedFulfillment.record.detail.fulfillmentSnapshotRef ?? null };
    const autosaved = await race(() => writerA.autosaveDraft(config.actorId, autosaveCommand),
      () => writerB.autosaveDraft(config.actorId, { ...autosaveCommand, idempotencyKey: randomUUID(), eventId: randomUUID() }), "conflict");
    assert.equal(autosaved.record.detail.version, 12);
    assert.equal(autosaved.record.detail.sourceChannel, "whatsapp_manual");
    assert.equal(autosaved.record.detail.fulfillmentChannel, "delivery");
    await begin(second);
    const autosaveReplay = await writerB.autosaveDraft(config.actorId, autosaveCommand) as CaptureOutcome;
    assert.equal(autosaveReplay.status, "replayed");
    assert.deepEqual(autosaveReplay.record, autosaved.record);
    await second.query("COMMIT");
    await observer.query(`update app.customer_addresses set street_line='Changed street',validation_branch_id=null,validation_event_id=null,
      validated_by=null,validation_device_id=null,validated_at=null,version=2,updated_at=clock_timestamp(),updated_by=$1
      where restaurant_id=$2 and customer_id=$3 and id=$4`, [config.actorId, config.restaurantId, customerId, addressId]);
    assert.deepEqual((await observer.query("select street_line from app.customer_fulfillment_snapshots where restaurant_id=$1 and id=$2",
      [config.restaurantId, selectedFulfillment.record.detail.fulfillmentSnapshotRef])).rows, [{ street_line: "Original street" }]);
    await begin(first);
    const staleFulfillment = await writerA.setFulfillment(config.actorId, fulfillment(12)) as CaptureOutcome;
    assert.equal(staleFulfillment.status, "conflict");
    await first.query("COMMIT");
    await begin(first);
    const customerHeld = await writerA.mutateAttention(config.actorId, "capture.held", { ...common(12), attentionLeaseId: resumed.record.detail.attentionLeaseId }) as CaptureOutcome;
    assert.equal(customerHeld.status, "applied");
    assert.equal(customerHeld.record.detail.customerSnapshotRef, replacement.record.detail.customerSnapshotRef);
    await first.query("COMMIT");
    await begin(first);
    const customerResumed = await writerA.mutateAttention(config.actorId, "capture.resumed", common(13)) as CaptureOutcome;
    assert.equal(customerResumed.status, "applied");
    assert.equal(customerResumed.record.detail.customerSnapshotRef, replacement.record.detail.customerSnapshotRef);
    await first.query("COMMIT");
    await begin(first);
    const removed = await writerA.setCustomer(config.actorId, { ...common(14), attentionLeaseId: customerResumed.record.detail.attentionLeaseId,
      customerId: null, contactId: null, expectedCustomerVersion: null }) as CaptureOutcome;
    assert.equal(removed.status, "applied");
    assert.equal(removed.record.detail.customerSnapshotRef, null);
    assert.equal(removed.record.detail.fulfillmentSnapshotRef, null);
    await first.query("COMMIT");
    assert.deepEqual(await counts(), [{ version: "15", events: "15", snapshots: "4" }]);
    await begin(first);
    const tray = await writerA.list(config.actorId, { schemaVersion: 1, scope, limit: 20 }) as {
      readonly schemaVersion: number; readonly items: readonly { readonly captureDraftId: string; readonly version: number }[];
    };
    await first.query("COMMIT");
    assert.equal(tray.schemaVersion, 1);
    assert.deepEqual(tray.items.map(({ captureDraftId: id, version }) => ({ id, version })), [{ id: captureDraftId, version: 15 }]);
    const priorLease = customerResumed.record.detail.attentionLeaseId;
    const reclaimed = await race(() => writerA.mutateAttention(config.actorId, "capture.claimed", common(15)),
      () => writerB.mutateAttention(secondActor, "capture.claimed", common(15)), "conflict");
    assert.equal(reclaimed.record.detail.ownerMembershipId, ownerId);
    assert.equal(reclaimed.record.detail.attentionStatus, "claimed");
    assert.notEqual(reclaimed.record.detail.attentionLeaseId, priorLease);
    assert.deepEqual(await counts(), [{ version: "16", events: "16", snapshots: "4" }]);
    return Object.freeze({ checks: 44, blockedPairs, version: 16, journalEvents: 16, partySnapshots: 4,
      cases: Object.freeze(["create_same_key_replay", "claim_two_actors_cas", "resume_two_actors_cas", "resume_exact_replay",
        "customer_same_key_replay", "customer_divergence", "customer_two_connections_cas", "snapshot_immutable_after_edit",
        "stale_customer", "wrong_lease", "wrong_owner", "tenant_isolation", "event_collision_atomicity", "revoked_replay",
        "customer_replace", "fulfillment_exact_replay", "fulfillment_two_connections_cas", "fulfillment_snapshot_immutable", "stale_address",
        "attention_preserves_snapshot", "workspace_rehydrates_immutable_snapshots", "autosave_two_connections_cas",
        "autosave_exact_replay", "customer_remove_clears_fulfillment", "tray_scope_and_version",
        "same_owner_reclaim_rotates_lease", "same_owner_reclaim_two_connections_cas"]) });
  } finally {
    const cleanup = await Promise.allSettled(clients.map(async (client) => { try { await client.query("ROLLBACK"); } finally { await client.end(); } }));
    if (cleanup.some((result) => result.status === "rejected")) throw new Error("LOCAL_CAPTURE_CONCURRENCY_CONNECTION_CLEANUP_FAILED");
  }
}
