import { readFileSync } from "node:fs";

import { randomUUID } from "node:crypto";
import { Client } from "pg";

import type { DatabaseClientPort } from "../database.js";
import { verifyCaptureTrayHttp } from "./capture-tray-http-verification.js";
import { buildCaptureTrayCatalogAudit } from "./post-bootstrap-catalog.js";
import { readSchemaVerificationConfig, runReadOnlySchemaAudit, type SchemaVerificationSession } from "./schema-verification.js";

const CONFIRMATION = "ROLLBACK_ONLY_APP_API_HTTP";

let client: Client | undefined;
let captureDraftId: string | undefined;
let actorId: string | undefined;
let transactionOpen = false;
let stage = "configuration";
let auditInput: Parameters<typeof runReadOnlySchemaAudit>[0] | undefined;
try {
  if (process.env.CAPTURE_TRAY_HTTP_CONFIRMATION !== CONFIRMATION) throw new Error("CAPTURE_TRAY_HTTP_CONFIGURATION_REJECTED");
  const config = readSchemaVerificationConfig(process.env);
  const base = readFileSync(new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url), "utf8");
  const capture = readFileSync(new URL("../../../../supabase/tests/capture_drafts_catalog.sql", import.meta.url), "utf8");
  const directory = readFileSync(new URL("../../../../supabase/tests/customer_directory_catalog.sql", import.meta.url), "utf8");
  const catalogAuditSql = buildCaptureTrayCatalogAudit(base, capture, directory);
  const expectedSummary = { policies: 5, securedTables: 35, securityDefinerFunctions: 44 } as const;
  auditInput = { catalogAuditSql, config, expectedSummary };
  stage = "precheck";
  const precheck = await runReadOnlySchemaAudit(auditInput);
  stage = "connect";
  client = new Client({
    application_name: "superrestaurant-capture-tray-rollback-http",
    connectionString: config.connectionString,
    connectionTimeoutMillis: 15_000,
    query_timeout: 15_000,
    ssl: { ca: config.caCertificate, rejectUnauthorized: true },
    statement_timeout: 12_000,
  });
  await client.connect();
  const session: SchemaVerificationSession = {
    close: async () => undefined,
    connect: async () => undefined,
    query: async (sql, parameters) => client!.query(sql, parameters === undefined ? [] : [...parameters]),
  };
  const database: DatabaseClientPort = { query: async (sql, parameters) => session.query(sql, parameters) };
  await client.query("BEGIN");
  transactionOpen = true;
  stage = "fixture";
  actorId = randomUUID();
  captureDraftId = randomUUID();
  const restaurantId = randomUUID(), branchId = randomUUID(), membershipId = randomUUID();
  await client.query("insert into auth.users(id,email) values($1,$2)", [actorId, `capture-tray-${actorId}@example.invalid`]);
  await client.query("insert into app.restaurants(id,name,time_zone) values($1,'rollback-only Capture tray','America/Hermosillo')", [restaurantId]);
  await client.query("insert into app.branches(id,restaurant_id,name) values($1,$2,'rollback-only Capture tray')", [branchId, restaurantId]);
  await client.query("insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values($1,$2,$3,$4,$2)",
    [membershipId, actorId, restaurantId, branchId]);
  await client.query("insert into app.membership_role_grants(membership_id,role_code,granted_by) values($1,'cashier',$2)", [membershipId, actorId]);
  await client.query(`DO $guard$ BEGIN
    IF current_user <> 'postgres' OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
      JOIN pg_catalog.pg_roles u ON u.oid = m.member
      WHERE r.rolname = 'app_api' AND u.rolname = 'postgres'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
    ) THEN RAISE EXCEPTION 'CAPTURE_TRAY_HTTP_MEMBERSHIP_REJECTED'; END IF;
  END $guard$`);
  await client.query("GRANT app_api TO postgres WITH SET TRUE");
  await client.query("SET LOCAL ROLE app_api");
  stage = "http_start";
  const verified = await verifyCaptureTrayHttp(session, database, { actorId, branchId, captureDraftId, membershipId, restaurantId }, (next) => { stage = next; });
  stage = "rollback";
  await client.query("RESET ROLE");
  await client.query("ROLLBACK");
  transactionOpen = false;
  stage = "residual";
  const residual = await client.query<{ actors: number; captures: number }>(
    `select
      (select count(*)::integer from auth.users where id=$1) as actors,
      (select count(*)::integer from app.capture_drafts where id=$2) as captures`,
    [actorId, captureDraftId],
  );
  if (residual.rows[0]?.actors !== 0 || residual.rows[0]?.captures !== 0) throw new Error("CAPTURE_TRAY_HTTP_POSTCHECK_REJECTED");
  stage = "postcheck";
  const postcheck = await runReadOnlySchemaAudit(auditInput);
  process.stdout.write(`${JSON.stringify({ stage: "capture_tray_http", status: "ok", checks: verified.checks,
    fixtureRowsRemoved: true, precheck, postcheck })}\n`);
} catch {
  let rollbackOk = !transactionOpen;
  let residualOk = false;
  let catalogOk = false;
  if (client !== undefined && transactionOpen) {
    try { await client.query("RESET ROLE"); } catch { /* continue rollback */ }
    try { await client.query("ROLLBACK"); rollbackOk = true; transactionOpen = false; } catch { /* close below */ }
  }
  if (client !== undefined && rollbackOk && actorId !== undefined && captureDraftId !== undefined) {
    try {
      const residual = await client.query<{ actors: number; captures: number }>(
        `select
          (select count(*)::integer from auth.users where id=$1) as actors,
          (select count(*)::integer from app.capture_drafts where id=$2) as captures`,
        [actorId, captureDraftId],
      );
      residualOk = residual.rows[0]?.actors === 0 && residual.rows[0]?.captures === 0;
    } catch { /* report false */ }
  }
  if (auditInput !== undefined && rollbackOk) {
    try { await runReadOnlySchemaAudit(auditInput); catalogOk = true; } catch { /* report false */ }
  }
  process.stderr.write(`${JSON.stringify({ code: "CAPTURE_TRAY_HTTP_VERIFICATION_FAILED", stage, status: "failed",
    rollbackOk, residualOk, catalogOk })}\n`);
  process.exitCode = 1;
} finally {
  if (client !== undefined) {
    if (transactionOpen) { try { await client.query("RESET ROLE"); } catch { /* continue rollback */ }
      try { await client.query("ROLLBACK"); } catch { /* close below */ } }
    try { await client.end(); } catch { process.exitCode = 1; }
  }
}
