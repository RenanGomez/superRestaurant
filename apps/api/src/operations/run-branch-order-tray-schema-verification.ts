import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

import { extractMigrationBody } from "./schema-verification.js";

const PROJECT_REF = "zwbyiefqeujstyzysydn";
const FUNCTION = "app_private.list_branch_active_orders(uuid,jsonb)";
const INDEX = "app.orders_branch_active_tray_idx";
let stage = "configuration";

async function main(): Promise<void> {
  if (process.env.BRANCH_ORDER_TRAY_VERIFICATION !== "ROLLBACK_ONLY") throw new Error("VERIFICATION_OPT_IN_REQUIRED");
  const rawUrl = process.env.ADR010_DATABASE_URL;
  if (rawUrl === undefined) throw new Error("DATABASE_URL_REQUIRED");
  const url = new URL(rawUrl);
  if (!url.username.endsWith(`.${PROJECT_REF}`) || url.pathname !== "/postgres"
    || url.searchParams.get("sslmode") !== "verify-full") throw new Error("TARGET_MISMATCH");
  url.searchParams.delete("sslrootcert");
  url.searchParams.delete("sslmode");
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: { ca: readFileSync(new URL("../../../../.certs/prod-ca-2021.crt", import.meta.url), "utf8"), rejectUnauthorized: true },
    application_name: "s9-branch-order-tray-rollback-verification",
  });
  await client.connect();
  try {
    stage = "preflight";
    const before = await catalog(client);
    assert.deepEqual(before, { functionExists: false, indexExists: false, ordersExist: true, shiftsExist: true });
    const migration = readFileSync(new URL("../../../../supabase/migrations/20260926000100_list_branch_active_orders.sql", import.meta.url), "utf8");
    await client.query("begin");
    try {
      stage = "migration";
      await client.query(extractMigrationBody(migration));
      stage = "catalog";
      const during = await catalog(client);
      assert.deepEqual(during, { functionExists: true, indexExists: true, ordersExist: true, shiftsExist: true });
      const malformed = await client.query("select app_private.list_branch_active_orders($1::uuid,$2::jsonb) as result", [
        "00000000-0000-4000-8000-000000000001", JSON.stringify({ schemaVersion: 1 }),
      ]);
      assert.deepEqual(malformed.rows[0]?.result, { status: "rejected" });
      stage = "denied";
      const denied = await client.query("select app_private.list_branch_active_orders($1::uuid,$2::jsonb) as result", [
        "00000000-0000-4000-8000-000000000001",
        JSON.stringify({ schemaVersion: 1, scope: {
          restaurantId: "00000000-0000-4000-8000-000000000002", branchId: "00000000-0000-4000-8000-000000000003",
        }, limit: 10, after: null }),
      ]);
      assert.deepEqual(denied.rows[0]?.result, { status: "denied" });
      stage = "privileges";
      const privileges = await client.query("select has_function_privilege('app_api',$1,'EXECUTE') as api, has_function_privilege('authenticated',$1,'EXECUTE') as authenticated", [FUNCTION]);
      assert.deepEqual(privileges.rows[0], { api: true, authenticated: false });
      stage = "pagination";
      await verifyRollbackPagination(client);
    } finally { await client.query("rollback"); }
    stage = "postcheck";
    assert.deepEqual(await catalog(client), before);
    process.stdout.write("BRANCH_ORDER_TRAY_ROLLBACK_VERIFIED\n");
  } finally { await client.end(); }
}

async function verifyRollbackPagination(client: pg.Client): Promise<void> {
  const member = await client.query(`select m.user_id, m.restaurant_id, m.branch_id, r.time_zone
    from app.memberships m join app.branches b on b.restaurant_id=m.restaurant_id and b.id=m.branch_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter','kitchen','viewer','auditor')
    limit 1`);
  assert.equal(member.rows.length, 1, "ROLLBACK_FIXTURE_MEMBER_REQUIRED");
  const actorId = member.rows[0]?.user_id as string;
  const restaurantId = member.rows[0]?.restaurant_id as string;
  const branchId = member.rows[0]?.branch_id as string;
  const timeZone = member.rows[0]?.time_zone as string;
  const first = randomUUID();
  const second = randomUUID();
  for (const [orderId, updatedAt] of [
    [first, "2099-01-01T00:00:00.123456Z"],
    [second, "2099-01-01T00:00:00.123455Z"],
  ]) {
    await client.query(`insert into app.orders
      (id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by,updated_at)
      values ($1::uuid,$2::uuid,$3::uuid,'counter','open',$4::jsonb,1,$5::uuid,$5::uuid,$6::timestamptz)`, [
      orderId, restaurantId, branchId,
      JSON.stringify({ schemaVersion: 1, orderId, restaurantId, branchId, channel: "counter", status: "open", items: [], timeZone }),
      actorId, updatedAt,
    ]);
  }
  const scope = { restaurantId, branchId };
  const read = async (after: unknown) => {
    const result = await client.query("select app_private.list_branch_active_orders($1::uuid,$2::jsonb) as result", [
      actorId, JSON.stringify({ schemaVersion: 1, scope, limit: 1, after }),
    ]);
    return result.rows[0]?.result as Record<string, unknown>;
  };
  const firstPage = await read(null);
  assert.equal((firstPage.orders as { orderId: string }[])[0]?.orderId, first);
  assert.deepEqual((firstPage.orders as { itemStatuses: string[] }[])[0]?.itemStatuses, []);
  assert.deepEqual(firstPage.next, { orderId: first, updatedAt: "2099-01-01T00:00:00.123456Z" });
  const secondPage = await read(firstPage.next);
  assert.equal((secondPage.orders as { orderId: string }[])[0]?.orderId, second);
  if (secondPage.next !== null) assert.deepEqual(secondPage.next,
    { orderId: second, updatedAt: "2099-01-01T00:00:00.123455Z" });
  const wrongBranch = await client.query("select app_private.list_branch_active_orders($1::uuid,$2::jsonb) as result", [
    actorId, JSON.stringify({ schemaVersion: 1, scope: { restaurantId, branchId: randomUUID() }, limit: 1, after: null }),
  ]);
  assert.deepEqual(wrongBranch.rows[0]?.result, { status: "denied" });
}

async function catalog(client: pg.Client): Promise<Record<string, boolean>> {
  const result = await client.query(
    "select to_regprocedure($1) is not null as \"functionExists\", to_regclass($2) is not null as \"indexExists\", to_regclass($3) is not null as \"ordersExist\", to_regclass($4) is not null as \"shiftsExist\"",
    [FUNCTION, INDEX, "app.orders", "app.order_operational_shifts"],
  );
  return result.rows[0] as Record<string, boolean>;
}

try { await main(); } catch (error: unknown) {
  const sqlState = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code : null;
  const constraint = typeof error === "object" && error !== null && "constraint" in error
    && typeof error.constraint === "string" ? error.constraint : null;
  process.stderr.write(`${JSON.stringify({ status: "failed", stage, sqlState, constraint })}\n`);
  process.exitCode = 1;
}
