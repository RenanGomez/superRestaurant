import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { DatabaseClientPort } from "../database.js";
import { verifyCaptureTrayHttp } from "./capture-tray-http-verification.js";
import { verifyCustomerDirectoryHttp } from "./customer-directory-http-verification.js";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres } from "./local-postgres.js";
import type { SchemaVerificationSession } from "./schema-verification.js";

test("rollback HTTP verifiers start without a configured sync cursor secret", async () => {
  assertLocalConfirmation(process.argv.filter((argument) => argument !== "--"));
  const previous = process.env.SYNC_CURSOR_SECRET;
  delete process.env.SYNC_CURSOR_SECRET;
  const local = new LocalPostgres({ marker: "LOCAL_HTTP_VERIFIERS_ONLY", databasePrefix: "superrestaurant_verifiers", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
  try {
    await local.start();
    await local.applyMigrations(listMigrationNames());
    const session: SchemaVerificationSession = {
      connect: async () => undefined,
      close: async () => undefined,
      query: async (sql, parameters) => ({ rows: (await local.admin.query(sql, parameters === undefined ? [] : [...parameters])).rows }),
    };
    const database: DatabaseClientPort = { query: async (sql, parameters) => session.query(sql, parameters) };
    for (const verifier of ["capture", "customer"] as const) {
      const actorId = randomUUID(), restaurantId = randomUUID(), branchId = randomUUID(), membershipId = randomUUID();
      await local.admin.query("BEGIN");
      try {
        await local.admin.query("insert into auth.users(id,email) values($1,'verifier@invalid.test')", [actorId]);
        await local.admin.query("insert into app.restaurants(id,name,time_zone) values($1,'verifier','America/Hermosillo')", [restaurantId]);
        await local.admin.query("insert into app.branches(id,restaurant_id,name) values($1,$2,'verifier')", [branchId, restaurantId]);
        await local.admin.query("insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values($1,$2,$3,$4,$2)", [membershipId, actorId, restaurantId, branchId]);
        await local.admin.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values($1,'cashier',$2)", [membershipId, actorId]);
        await local.admin.query("SET LOCAL ROLE app_api");
        if (verifier === "capture") {
          const result = await verifyCaptureTrayHttp(session, database, { actorId, restaurantId, branchId, membershipId, captureDraftId: randomUUID() });
          assert.ok(result.checks > 0);
        } else {
          await verifyCustomerDirectoryHttp(session, database, { actorId, restaurantId, branchId, membershipId });
        }
      } finally {
        await local.admin.query("ROLLBACK");
      }
      assert.equal((await local.admin.query("select count(*)::int as count from auth.users where id=$1", [actorId])).rows[0]?.count, 0);
    }
  } finally {
    const cleanup = await local.stop();
    if (previous === undefined) delete process.env.SYNC_CURSOR_SECRET;
    else process.env.SYNC_CURSOR_SECRET = previous;
    assert.equal(cleanup.failed, false);
    assert.equal(cleanup.stopped, true);
  }
});
