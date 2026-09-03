import { createHash } from "node:crypto";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import type { DatabaseConfig } from "../database.js";
import {
  AppApiProvisioningError,
  type AppApiProvisioningConfig,
  type AppApiProvisioningStage,
} from "./app-api-provisioning-config.js";
import { appApiLifecycleAdvisoryLockKey } from "./tenancy-fixture-markers.js";
import type { AppApiLifecycleCatalogProfile } from "./app-api-recovery.js";

const PRECHECK_AUDIT_SHA256 = "a6485bcdcc1f54beee9f939187d374a449541343b426d59341870dda63ccd983";
const RUNTIME_AUDIT_SHA256 = "e4d89b714336edda12441567d9738507abcb807abe173413f1095a16ca7321e2";
const POST_DINING_ZONES_PRECHECK_AUDIT_SHA256 =
  "8bc25f26058ec8512d364404629b595c690b987edf5fdd891ce0496943b6b4bc";
const POST_DINING_ZONES_RUNTIME_AUDIT_SHA256 =
  "c0648eecde4df52cf92e581bb1667b7fc10b904725803271767192ec50ebe688";
const POST_DINING_TABLES_AUDIT_SHA256 =
  "fb6a8a827475623dce277a6670232b630177fb0ae7db2e04502b44cfe00c9052";
const POST_MENU_AUDIT_SHA256 =
  "2893432b8122de814e42ce967e6053f6519856f64b15b30fa873f21e6473b2a2";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const SESSION_DRAIN_ATTEMPTS = 3;
const APP_CONNECTION_ATTEMPTS = 3;

const CREATE_TEMP_PROVISIONER_SQL = `
create function pg_temp.provision_app_api(password_value text)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  execute pg_catalog.format(
    'alter role app_api login password %L valid until %L',
    password_value,
    pg_catalog.clock_timestamp() + interval '10 minutes'
  );
end
$function$
`;

export interface AppApiProvisioningQueryResult<Row extends QueryResultRow = QueryResultRow> {
  readonly rowCount: number | null;
  readonly rows: readonly Row[];
}

export interface AppApiProvisioningSession {
  close(): Promise<void>;
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<AppApiProvisioningQueryResult<Row>>;
}

export interface AppApiProvisioningDependencies {
  createAdminSession(config: DatabaseConfig): AppApiProvisioningSession;
  createAppSession(config: DatabaseConfig): AppApiProvisioningSession;
  waitForAppCredentialPropagation?(attempt: number): Promise<void>;
}

export interface AppApiProvisioningSummary {
  readonly appApiLogin: true;
  readonly crashExpiryProtected: true;
  readonly runtimeAudit: true;
  readonly status: "ok";
}

export interface AppApiProvisioningOptions {
  readonly auditProfile?: AppApiLifecycleCatalogProfile;
  readonly config: AppApiProvisioningConfig;
  readonly precheckAuditSql: string;
  readonly runtimeAuditSql: string;
  readonly dependencies?: AppApiProvisioningDependencies;
}

export async function provisionAppApi(
  options: AppApiProvisioningOptions,
): Promise<AppApiProvisioningSummary> {
  const hashes = auditHashes(options.auditProfile ?? "memberships_v1");
  const precheckAuditSql = validatePinnedAudit(options.precheckAuditSql, hashes.precheck);
  const runtimeAuditSql = validatePinnedAudit(options.runtimeAuditSql, hashes.runtime);
  const dependencies = options.dependencies ?? postgresDependencies;
  let admin: AppApiProvisioningSession | undefined;
  let app: AppApiProvisioningSession | undefined;
  let transactionOpen = false;
  let roleChangeAttempted = false;
  let expectedRoleOid: string | undefined;
  let stage: AppApiProvisioningStage = "precheck";
  let failure: AppApiProvisioningError | undefined;

  try {
    admin = dependencies.createAdminSession(options.config.adminDatabase);
    await acquireAppApiLifecycleLock(admin);
    await admin.query("BEGIN");
    transactionOpen = true;
    await admin.query(precheckAuditSql);
    expectedRoleOid = await readExactRoleOid(admin);
    await assertZeroAppApiSessions(admin, "precheck");

    stage = "provision";
    await admin.query("set local password_encryption = 'scram-sha-256'");
    await admin.query(CREATE_TEMP_PROVISIONER_SQL);
    roleChangeAttempted = true;
    await admin.query("select pg_temp.provision_app_api($1::text)", [options.config.password]);
    await assertTemporaryCredential(admin, expectedRoleOid);
    await admin.query("COMMIT");
    transactionOpen = false;

    stage = "connection";
    for (let attempt = 1; attempt <= APP_CONNECTION_ATTEMPTS; attempt += 1) {
      const attemptSession = dependencies.createAppSession(options.config.appDatabase);
      app = attemptSession;
      try {
        await verifyAppApiConnection(attemptSession);
        await attemptSession.close();
        app = undefined;
        break;
      } catch (error: unknown) {
        try { await attemptSession.close(); } catch { /* Compensation below remains authoritative. */ }
        app = undefined;
        if (attempt === APP_CONNECTION_ATTEMPTS) throw error;
        await dependencies.waitForAppCredentialPropagation?.(attempt);
      }
    }

    stage = "runtime_audit";
    await admin.query("BEGIN");
    transactionOpen = true;
    await admin.query("alter role app_api nologin password null valid until 'infinity'");
    await admin.query("COMMIT");
    transactionOpen = false;
    await drainAppApiSessions(admin, "runtime_audit");

    await admin.query("BEGIN");
    transactionOpen = true;
    await admin.query("set local password_encryption = 'scram-sha-256'");
    await admin.query("select pg_temp.provision_app_api($1::text)", [options.config.password]);
    await assertTemporaryCredential(admin, expectedRoleOid);
    await assertZeroAppApiSessions(admin, "runtime_audit");
    await admin.query("alter role app_api valid until 'infinity'");
    await admin.query(runtimeAuditSql);
    await admin.query("COMMIT");
    transactionOpen = false;
  } catch (error: unknown) {
    failure = error instanceof AppApiProvisioningError ? error : provisioningError(stage);
    if (app !== undefined) {
      try {
        await app.close();
      } catch {
        // Compensation is authoritative; continue to the disable path.
      }
      app = undefined;
    }
    if (transactionOpen && admin !== undefined) await rollbackQuietly(admin);
    if (admin !== undefined) {
      try {
        await admin.close();
      } catch {
        // A fresh administrative connection performs compensation below.
      }
      admin = undefined;
    }
    if (roleChangeAttempted) {
      try {
        await compensateProvisioning(
          dependencies,
          options.config.adminDatabase,
          precheckAuditSql,
          expectedRoleOid,
        );
      } catch {
        failure = provisioningError("compensation");
      }
    }
  } finally {
    const closeFailed = await closeSessions(app, admin);
    if (closeFailed && failure === undefined) failure = provisioningError("close");
  }

  if (failure !== undefined) throw failure;
  return Object.freeze({
    appApiLogin: true,
    crashExpiryProtected: true,
    runtimeAudit: true,
    status: "ok",
  });
}

function auditHashes(
  profile: AppApiLifecycleCatalogProfile,
): Readonly<{ precheck: string; runtime: string }> {
  if (profile === "memberships_v1") {
    return { precheck: PRECHECK_AUDIT_SHA256, runtime: RUNTIME_AUDIT_SHA256 };
  }
  if (profile === "post_dining_zones_v1") {
    return {
      precheck: POST_DINING_ZONES_PRECHECK_AUDIT_SHA256,
      runtime: POST_DINING_ZONES_RUNTIME_AUDIT_SHA256,
    };
  }
  if (profile === "post_dining_tables_v1") {
    return { precheck: POST_DINING_TABLES_AUDIT_SHA256, runtime: POST_DINING_TABLES_AUDIT_SHA256 };
  }
  return { precheck: POST_MENU_AUDIT_SHA256, runtime: POST_MENU_AUDIT_SHA256 };
}

const postgresDependencies: AppApiProvisioningDependencies = Object.freeze({
  createAdminSession: (config: DatabaseConfig) => createAppApiPostgresSession(config, "super-restaurant-app-api-provisioning-admin"),
  createAppSession: (config: DatabaseConfig) => createAppApiPostgresSession(config, "super-restaurant-app-api-provisioning-runtime"),
  waitForAppCredentialPropagation: async (attempt: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, attempt * 1_000);
  }),
});

export function createAppApiPostgresSession(
  config: DatabaseConfig,
  applicationName: string,
): AppApiProvisioningSession {
  const pool = new Pool({
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    connectionString: config.connectionString,
    idleTimeoutMillis: 5_000,
    max: 1,
    query_timeout: 10_000,
    ssl: { ca: config.caCertificate, rejectUnauthorized: true },
    statement_timeout: 10_000,
  });
  let client: PoolClient | undefined;
  return Object.freeze({
    close: async () => {
      client?.release();
      client = undefined;
      await pool.end();
    },
    query: async <Row extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
      client ??= await pool.connect();
      const result = await client.query<Row>(sql, [...parameters]);
      return Object.freeze({ rowCount: result.rowCount, rows: Object.freeze([...result.rows]) });
    },
  });
}

export async function acquireAppApiLifecycleLock(session: AppApiProvisioningSession): Promise<void> {
  const result = await session.query<{ acquired: boolean }>(
    "select pg_try_advisory_lock(pg_catalog.hashtextextended($1::text, 0)) as acquired",
    [appApiLifecycleAdvisoryLockKey],
  );
  if (result.rows.length !== 1 || result.rows[0]?.acquired !== true) {
    throw provisioningError("precheck");
  }
}

async function readExactRoleOid(session: AppApiProvisioningSession): Promise<string> {
  const result = await session.query<{ oid: string }>(
    "select oid::text from pg_catalog.pg_roles where rolname = 'app_api'",
  );
  const oid = result.rows[0]?.oid;
  if (result.rows.length !== 1 || typeof oid !== "string" || !/^[0-9]+$/u.test(oid)) {
    throw provisioningError("precheck");
  }
  return oid;
}

async function assertZeroAppApiSessions(
  session: AppApiProvisioningSession,
  stage: "precheck" | "runtime_audit" | "compensation",
): Promise<void> {
  const result = await session.query<{ count: number }>(
    "select count(*)::integer as count from pg_catalog.pg_stat_activity where usename = 'app_api'",
  );
  if (result.rows.length !== 1 || result.rows[0]?.count !== 0) throw provisioningError(stage);
}

async function assertTemporaryCredential(
  session: AppApiProvisioningSession,
  expectedRoleOid: string,
): Promise<void> {
  const result = await session.query<{
    exactOid: boolean;
    login: boolean;
    scram: boolean;
    temporaryExpiry: boolean;
  }>(
    `select
       roles.oid::text = $1::text as "exactOid",
       roles.rolcanlogin as login,
       auth.rolpassword like 'SCRAM-SHA-256$%' as scram,
       roles.rolvaliduntil > pg_catalog.clock_timestamp()
         and roles.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '10 minutes' as "temporaryExpiry"
     from pg_catalog.pg_roles as roles
     join pg_catalog.pg_authid as auth on auth.oid = roles.oid
     where roles.rolname = 'app_api'`,
    [expectedRoleOid],
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1
    || row?.exactOid !== true
    || row.login !== true
    || row.scram !== true
    || row.temporaryExpiry !== true
  ) throw provisioningError("provision");
}

async function verifyAppApiConnection(session: AppApiProvisioningSession): Promise<void> {
  const identity = await session.query<{ currentUser: string; sessionUser: string }>(
    `select current_user::text as "currentUser", session_user::text as "sessionUser"`,
  );
  if (
    identity.rows.length !== 1
    || identity.rows[0]?.currentUser !== "app_api"
    || identity.rows[0]?.sessionUser !== "app_api"
  ) throw provisioningError("connection");

  const lookup = await session.query(
    "select roles from app_private.find_active_branch_membership($1::uuid, $2::uuid, $3::uuid)",
    [NIL_UUID, NIL_UUID, NIL_UUID],
  );
  if (lookup.rows.length !== 0) throw provisioningError("connection");
  await expectPrivilegeDenied(session, "select * from app.roles limit 1");
  await expectPrivilegeDenied(
    session,
    "select app_rls.has_active_restaurant_membership($1::uuid)",
    [NIL_UUID],
  );
  await expectPrivilegeDenied(session, "set role postgres");
}

async function expectPrivilegeDenied(
  session: AppApiProvisioningSession,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<void> {
  let code: string | undefined;
  try {
    await session.query(sql, parameters);
  } catch (error: unknown) {
    code = readPostgresCode(error);
  }
  if (code !== "42501") throw provisioningError("connection");
}

async function compensateProvisioning(
  dependencies: AppApiProvisioningDependencies,
  adminConfig: DatabaseConfig,
  precheckAuditSql: string,
  expectedRoleOid: string | undefined,
): Promise<void> {
  if (expectedRoleOid === undefined) throw provisioningError("compensation");
  const recovery = dependencies.createAdminSession(adminConfig);
  let transactionOpen = false;
  try {
    await acquireAppApiLifecycleLock(recovery);
    await assertCompensationTarget(recovery, expectedRoleOid);
    await recovery.query("BEGIN");
    transactionOpen = true;
    await recovery.query("alter role app_api nologin password null valid until 'infinity'");
    await recovery.query("COMMIT");
    transactionOpen = false;
    await drainAppApiSessions(recovery, "compensation");
    await recovery.query(precheckAuditSql);
  } catch {
    if (transactionOpen) await rollbackQuietly(recovery);
    throw provisioningError("compensation");
  } finally {
    try {
      await recovery.close();
    } catch {
      throw provisioningError("compensation");
    }
  }
}

async function drainAppApiSessions(
  session: AppApiProvisioningSession,
  stage: "runtime_audit" | "compensation",
): Promise<void> {
  for (let attempt = 0; attempt < SESSION_DRAIN_ATTEMPTS; attempt += 1) {
    const termination = await session.query<{ terminated: boolean }>(
      `select pg_catalog.pg_terminate_backend(pid, 5000::bigint) as terminated
       from pg_catalog.pg_stat_activity
       where usename = 'app_api' and pid <> pg_catalog.pg_backend_pid()`,
    );
    if (termination.rows.some((row) => row.terminated !== true)) {
      throw provisioningError(stage);
    }
    const sessions = await session.query<{ count: number }>(
      "select count(*)::integer as count from pg_catalog.pg_stat_activity where usename = 'app_api'",
    );
    if (sessions.rows.length !== 1 || typeof sessions.rows[0]?.count !== "number") {
      throw provisioningError(stage);
    }
    if (sessions.rows[0].count === 0) return;
  }
  throw provisioningError(stage);
}

async function assertCompensationTarget(
  session: AppApiProvisioningSession,
  expectedRoleOid: string,
): Promise<void> {
  const result = await session.query<{ safe: boolean }>(
    `select
       oid::text = $1::text
       and not rolsuper
       and not rolcreatedb
       and not rolcreaterole
       and not rolinherit
       and not rolreplication
       and not rolbypassrls
       and pg_catalog.shobj_description(oid, 'pg_authid')
         = 'superRestaurant dedicated API capability role' as safe
     from pg_catalog.pg_roles
     where rolname = 'app_api'`,
    [expectedRoleOid],
  );
  if (result.rows.length !== 1 || result.rows[0]?.safe !== true) {
    throw provisioningError("compensation");
  }
}

async function rollbackQuietly(session: AppApiProvisioningSession): Promise<void> {
  try {
    await session.query("ROLLBACK");
  } catch {
    // The caller returns only an allowlisted failure code.
  }
}

async function closeSessions(
  app: AppApiProvisioningSession | undefined,
  admin: AppApiProvisioningSession | undefined,
): Promise<boolean> {
  const results = await Promise.allSettled([
    ...(app === undefined ? [] : [app.close()]),
    ...(admin === undefined ? [] : [admin.close()]),
  ]);
  return results.some((result) => result.status === "rejected");
}

export function validatePinnedAudit(sql: string, expectedHash: string): string {
  if (typeof sql !== "string" || sql.length === 0 || sql.length > 64_000) {
    throw provisioningError("configuration");
  }
  const normalized = sql.replaceAll("\r\n", "\n");
  const actualHash = createHash("sha256").update(normalized, "utf8").digest("hex");
  if (actualHash !== expectedHash) throw provisioningError("configuration");
  return sql;
}

function readPostgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function provisioningError(stage: AppApiProvisioningStage): AppApiProvisioningError {
  const codes: Readonly<Record<AppApiProvisioningStage, AppApiProvisioningError["code"]>> = {
    close: "APP_API_PROVISIONING_CLOSE_FAILED",
    compensation: "APP_API_PROVISIONING_COMPENSATION_FAILED",
    configuration: "APP_API_PROVISIONING_CONFIGURATION_REJECTED",
    connection: "APP_API_PROVISIONING_CONNECTION_FAILED",
    precheck: "APP_API_PROVISIONING_PRECHECK_FAILED",
    provision: "APP_API_PROVISIONING_CHANGE_FAILED",
    runtime_audit: "APP_API_PROVISIONING_RUNTIME_AUDIT_FAILED",
  };
  return new AppApiProvisioningError(stage, codes[stage]);
}
