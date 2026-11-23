import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { TransactionalDatabaseClientPort } from "../database.js";
import { SyncManualReviewService } from "../sync/sync-manual-review.service.js";
import type { LocalPostgres } from "./local-postgres.js";

/** Runs the real service against app_api SQL functions in a transaction that is always rolled back. */
export async function verifySyncReviewHistorical(local: LocalPostgres): Promise<void> {
  const actor = randomUUID(); const restaurantId = randomUUID(); const branchId = randomUUID();
  const membership = randomUUID(); const deviceId = randomUUID();
  const eventIds = [randomUUID(), randomUUID()];
  await local.admin.query("BEGIN");
  try {
    await local.admin.query("insert into auth.users(id,email) values ($1,'sync-review-history@invalid.test')", [actor]);
    await local.admin.query("insert into app.restaurants(id,name,time_zone) values ($1,'review history','America/Hermosillo')", [restaurantId]);
    await local.admin.query("insert into app.branches(id,restaurant_id,name) values ($1,$2,'review history')", [branchId, restaurantId]);
    await local.admin.query("insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values ($1,$2,$3,$4,$2)", [membership, actor, restaurantId, branchId]);
    await local.admin.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values ($1,'manager',$2)", [membership, actor]);
    assert.equal((await local.admin.query("select app_private.sync_register_device($1,$2,$3,$4) as ok", [actor, restaurantId, branchId, deviceId])).rows[0]?.ok, true);
    const cases: string[] = [];
    for (let index = 0; index < eventIds.length; index += 1) {
      const event = { eventId: eventIds[index], idempotencyKey: `history-${index}`, deviceId, actorId: actor, restaurantId, branchId, entityType: "Payment", entityId: randomUUID(), operation: "create", schemaVersion: "1", localSequence: index, baseVersion: null, occurredAt: "2026-11-23T00:00:00.000Z", payload: { amountMinor: 100, currency: "MXN" } };
      const result = await local.admin.query("select app_private.sync_record_event($1,$2::jsonb,$3::jsonb) as value", [actor, JSON.stringify(event), JSON.stringify({ status: "manual_review", canonicalVersion: null, auditId: null })]);
      assert.equal(result.rows[0]?.value.status, "recorded");
      const opened = await local.admin.query("select app_private.sync_open_review($1,$2,$3,$4,'PAYMENT_UNCERTAIN') as case_id", [actor, restaurantId, branchId, event.eventId]);
      assert.equal(typeof opened.rows[0]?.case_id, "string");
      cases.push(opened.rows[0].case_id as string);
    }
    await local.admin.query("delete from app_private.sync_review_event_facts where restaurant_id=$1 and branch_id=$2 and event_id=$3", [restaurantId, branchId, eventIds[0]]);
    await local.admin.query("SET LOCAL ROLE app_api");
    const database: TransactionalDatabaseClientPort = {
      query: async (sql, parameters) => ({ rows: (await local.admin.query(sql, [...parameters])).rows }),
      transaction: async (operation) => operation(database),
    };
    const service = new SyncManualReviewService(database);
    const scope = { restaurantId, branchId };
    const listed = await service.list(actor, scope) as readonly { caseId: string; factsAvailable?: boolean; status: string }[];
    assert.equal(listed.length, 2);
    assert.equal(listed.find((item) => item.caseId === cases[0])?.factsAvailable, false);
    assert.equal(listed.find((item) => item.caseId === cases[1])?.factsAvailable, true);
    assert.equal((await service.resolve(actor, { schemaVersion: 1, scope, caseId: cases[0], decision: "reject", reason: "Registro histórico revisado", compensatingEventId: null, idempotencyKey: "history-resolution", deviceId, occurredAt: "2026-11-23T00:00:00.000Z" })).status, "resolved");
    const after = await service.list(actor, scope) as readonly { caseId: string; status: string }[];
    assert.equal(after.find((item) => item.caseId === cases[0])?.status, "resolved_rejected");
  } finally {
    await local.admin.query("ROLLBACK");
  }
  assert.equal((await local.admin.query("select count(*)::int as count from auth.users where id=$1", [actor])).rows[0]?.count, 0);
}
