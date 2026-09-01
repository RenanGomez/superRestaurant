import type { DatabaseConfig } from "../database.js";
import {
  acquireAppApiLifecycleLock,
  createAppApiPostgresSession,
  type AppApiProvisioningSession,
  validatePinnedAudit,
} from "./app-api-provisioning.js";
import {
  AppApiRecoveryError,
  type AppApiRecoveryConfig,
  type AppApiRecoveryStage,
} from "./app-api-recovery-config.js";

const PRECHECK_AUDIT_SHA256 = "a6485bcdcc1f54beee9f939187d374a449541343b426d59341870dda63ccd983";
const POST_DINING_ZONES_PRECHECK_AUDIT_SHA256 =
  "8bc25f26058ec8512d364404629b595c690b987edf5fdd891ce0496943b6b4bc";
const DISABLE_SQL = "alter role app_api nologin password null valid until 'infinity'";
const TERMINATE_SQL = `select pg_catalog.pg_terminate_backend(pid) as terminated
from pg_catalog.pg_stat_activity
where usename = 'app_api' and pid <> pg_catalog.pg_backend_pid()`;
const MAX_DRAIN_ATTEMPTS = 3;

export interface AppApiLifecycleTargetState {
  readonly disabled: boolean;
  readonly finiteExpiry: boolean;
  readonly futureExpiry: boolean;
  readonly infiniteExpiry: boolean;
  readonly login: boolean;
  readonly noExpiry: boolean;
  readonly oid: string;
  readonly passwordNull: boolean;
  readonly safe: boolean;
  readonly scram: boolean;
}

export type AppApiLifecycleCatalogProfile = "memberships_v1" | "post_dining_zones_v1";

export interface AppApiRecoveryDependencies {
  createAdminSession(config: DatabaseConfig): AppApiProvisioningSession;
}

export interface AppApiRecoverySummary {
  readonly appApiLogin: false;
  readonly credentialRemoved: true;
  readonly sessionsTerminated: true;
  readonly status: "ok";
}

export interface AppApiRecoveryOptions {
  readonly auditProfile?: AppApiLifecycleCatalogProfile;
  readonly config: AppApiRecoveryConfig;
  readonly precheckAuditSql: string;
  readonly dependencies?: AppApiRecoveryDependencies;
}

export async function recoverAppApi(
  options: AppApiRecoveryOptions,
): Promise<AppApiRecoverySummary> {
  const auditProfile = options.auditProfile ?? "memberships_v1";
  const precheckAuditSql = readPinnedPrecheck(options.precheckAuditSql, auditProfile);
  const dependencies = options.dependencies ?? postgresDependencies;
  let primary: AppApiProvisioningSession | undefined;
  let expectedOid: string | undefined;
  let changeAttempted = false;
  let initialStateWasDisabled = false;
  let initialFailure: unknown;

  try {
    primary = dependencies.createAdminSession(options.config.adminDatabase);
    await acquireAppApiLifecycleLock(primary);
    const state = await readAppApiLifecycleTarget(primary, "precheck", undefined, auditProfile);
    expectedOid = state.oid;
    initialStateWasDisabled = state.disabled;
    if (!state.disabled) {
      changeAttempted = true;
      await commitDisable(primary);
    }
  } catch (error: unknown) {
    initialFailure = error;
  }

  if (primary !== undefined) {
    try {
      await primary.close();
    } catch {
      if (!changeAttempted || expectedOid === undefined) throw recoveryError("close");
    }
  }

  if (initialFailure !== undefined && !changeAttempted) throw recoveryError("precheck");
  if (expectedOid === undefined) throw recoveryError("precheck");

  try {
    await reconcileAndVerify(
      dependencies,
      options.config.adminDatabase,
      precheckAuditSql,
      expectedOid,
      changeAttempted || !initialStateWasDisabled,
      auditProfile,
    );
  } catch (error: unknown) {
    if (error instanceof AppApiRecoveryError && error.stage === "postcheck") throw error;
    throw recoveryError("disable");
  }

  return Object.freeze({
    appApiLogin: false,
    credentialRemoved: true,
    sessionsTerminated: true,
    status: "ok",
  });
}

const postgresDependencies: AppApiRecoveryDependencies = Object.freeze({
  createAdminSession: (config: DatabaseConfig) => createAppApiPostgresSession(
    config,
    "super-restaurant-app-api-recovery-admin",
  ),
});

async function reconcileAndVerify(
  dependencies: AppApiRecoveryDependencies,
  adminDatabase: DatabaseConfig,
  precheckAuditSql: string,
  expectedOid: string,
  mayRetryDisable: boolean,
  auditProfile: AppApiLifecycleCatalogProfile,
): Promise<void> {
  let reconciliation = dependencies.createAdminSession(adminDatabase);
  let requiresFreshPostcheck = false;
  try {
    await acquireAppApiLifecycleLock(reconciliation);
    const state = await readAppApiLifecycleTarget(
      reconciliation,
      "postcheck",
      expectedOid,
      auditProfile,
    );
    if (!state.disabled) {
      if (!mayRetryDisable) throw recoveryError("postcheck");
      await commitDisable(reconciliation);
      requiresFreshPostcheck = true;
    } else {
      await drainAndVerify(reconciliation, precheckAuditSql, expectedOid, auditProfile);
    }
  } finally {
    try {
      await reconciliation.close();
    } catch {
      throw recoveryError(requiresFreshPostcheck ? "disable" : "postcheck");
    }
  }

  if (!requiresFreshPostcheck) return;
  reconciliation = dependencies.createAdminSession(adminDatabase);
  try {
    await acquireAppApiLifecycleLock(reconciliation);
    await drainAndVerify(reconciliation, precheckAuditSql, expectedOid, auditProfile);
  } finally {
    try {
      await reconciliation.close();
    } catch {
      throw recoveryError("postcheck");
    }
  }
}

async function commitDisable(session: AppApiProvisioningSession): Promise<void> {
  let transactionOpen = false;
  try {
    await session.query("BEGIN");
    transactionOpen = true;
    await session.query(DISABLE_SQL);
    await session.query("COMMIT");
    transactionOpen = false;
  } catch (error: unknown) {
    if (transactionOpen) await rollbackQuietly(session);
    throw error;
  }
}

async function drainAndVerify(
  session: AppApiProvisioningSession,
  precheckAuditSql: string,
  expectedOid: string,
  auditProfile: AppApiLifecycleCatalogProfile,
): Promise<void> {
  const state = await readAppApiLifecycleTarget(
    session,
    "postcheck",
    expectedOid,
    auditProfile,
  );
  if (!state.disabled) throw recoveryError("postcheck");
  for (let attempt = 0; attempt < MAX_DRAIN_ATTEMPTS; attempt += 1) {
    await terminateAppApiSessions(session);
    if (await hasZeroAppApiSessions(session)) {
      await session.query(precheckAuditSql);
      return;
    }
  }
  throw recoveryError("postcheck");
}

export async function readAppApiLifecycleTarget(
  session: AppApiProvisioningSession,
  stage: "precheck" | "postcheck",
  expectedOid?: string,
  catalogProfile: AppApiLifecycleCatalogProfile = "memberships_v1",
): Promise<AppApiLifecycleTargetState> {
  const allowedAppApiFunctionOids = readAllowedAppApiFunctionOids(catalogProfile);
  const result = await session.query<AppApiLifecycleTargetState>(
    `select
       roles.oid::text as oid,
       (
         not roles.rolsuper
         and not roles.rolcreatedb
         and not roles.rolcreaterole
         and not roles.rolinherit
         and not roles.rolreplication
         and not roles.rolbypassrls
         and roles.rolconnlimit = -1
         and roles.rolconfig is null
         and pg_catalog.shobj_description(roles.oid, 'pg_authid')
           = 'superRestaurant dedicated API capability role'
         and (
           select count(*) from pg_catalog.pg_auth_members
           where roleid = roles.oid or member = roles.oid
         ) = 1
         and exists (
           select 1
           from pg_catalog.pg_auth_members as membership
           join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
           join pg_catalog.pg_roles as grantor_role on grantor_role.oid = membership.grantor
           where membership.roleid = roles.oid
             and member_role.rolname = 'postgres'
             and grantor_role.rolname = 'supabase_admin'
             and membership.admin_option
             and not membership.inherit_option
             and not membership.set_option
         )
         and not exists (select 1 from pg_catalog.pg_class where relowner = roles.oid)
         and not exists (select 1 from pg_catalog.pg_proc where proowner = roles.oid)
         and not exists (select 1 from pg_catalog.pg_namespace where nspowner = roles.oid)
         and not exists (select 1 from pg_catalog.pg_type where typowner = roles.oid)
         and pg_catalog.has_schema_privilege(roles.oid, 'app_private', 'usage')
         and not pg_catalog.has_schema_privilege(roles.oid, 'app', 'usage')
         and not pg_catalog.has_schema_privilege(roles.oid, 'app_rls', 'usage')
         and pg_catalog.has_function_privilege(
           roles.oid,
           'app_private.find_active_branch_membership(uuid,uuid,uuid)',
           'execute'
         )
         and (
           pg_catalog.to_regprocedure(
             'app_private.list_active_branch_memberships(uuid)'
           ) is null
           or pg_catalog.has_function_privilege(
             roles.oid,
             'app_private.list_active_branch_memberships(uuid)',
             'execute'
           )
         )
         and not exists (
           select 1
           from pg_catalog.pg_proc as functions
           join pg_catalog.pg_namespace as schemas on schemas.oid = functions.pronamespace
           where schemas.nspname in ('app_private', 'app_rls')
             and functions.oid <> all (${allowedAppApiFunctionOids})
             and pg_catalog.has_function_privilege(roles.oid, functions.oid, 'execute')
         )
         and not exists (
           select 1
           from pg_catalog.pg_class as relations
           join pg_catalog.pg_namespace as schemas on schemas.oid = relations.relnamespace
           cross join (
             values ('select'), ('insert'), ('update'), ('delete'),
               ('truncate'), ('references'), ('trigger')
           ) as privileges(privilege_name)
           where schemas.nspname = 'app'
             and relations.relkind in ('r', 'p', 'v', 'm', 's')
             and pg_catalog.has_table_privilege(
               roles.oid,
               relations.oid,
               privileges.privilege_name
             )
         )
       ) as safe,
       roles.rolcanlogin as login,
       auth.rolpassword is null as "passwordNull",
       coalesce(auth.rolpassword like 'SCRAM-SHA-256$%', false) as scram,
       (
         roles.rolvaliduntil is null
         or roles.rolvaliduntil is not distinct from 'infinity'::timestamptz
       ) as "noExpiry",
       (
         roles.rolvaliduntil is not null
         and roles.rolvaliduntil is distinct from 'infinity'::timestamptz
       ) as "finiteExpiry",
       coalesce(roles.rolvaliduntil > pg_catalog.clock_timestamp(), false) as "futureExpiry",
       roles.rolvaliduntil is not distinct from 'infinity'::timestamptz as "infiniteExpiry",
       (
         not roles.rolcanlogin
         and auth.rolpassword is null
         and (
           roles.rolvaliduntil is null
           or roles.rolvaliduntil is not distinct from 'infinity'::timestamptz
         )
       ) as disabled
     from pg_catalog.pg_roles as roles
     join pg_catalog.pg_authid as auth on auth.oid = roles.oid
     where roles.rolname = 'app_api'`,
  );
  const state = result.rows[0];
  if (
    result.rows.length !== 1
    || state?.safe !== true
    || typeof state.oid !== "string"
    || !/^[0-9]+$/u.test(state.oid)
    || (expectedOid !== undefined && state.oid !== expectedOid)
    || typeof state.disabled !== "boolean"
    || typeof state.finiteExpiry !== "boolean"
    || typeof state.futureExpiry !== "boolean"
    || typeof state.infiniteExpiry !== "boolean"
    || typeof state.login !== "boolean"
    || typeof state.noExpiry !== "boolean"
    || typeof state.passwordNull !== "boolean"
    || typeof state.scram !== "boolean"
  ) throw recoveryError(stage);
  return state;
}

function readAllowedAppApiFunctionOids(catalogProfile: AppApiLifecycleCatalogProfile): string {
  if (catalogProfile === "memberships_v1") {
    return `pg_catalog.array_remove(
      array[
        pg_catalog.to_regprocedure(
          'app_private.find_active_branch_membership(uuid,uuid,uuid)'
        ),
        pg_catalog.to_regprocedure(
          'app_private.list_active_branch_memberships(uuid)'
        )
      ]::oid[],
      null::oid
    )`;
  }
  if (catalogProfile === "post_dining_zones_v1") {
    return `pg_catalog.array_remove(
      array[
        pg_catalog.to_regprocedure(
          'app_private.find_active_branch_membership(uuid,uuid,uuid)'
        ),
        pg_catalog.to_regprocedure(
          'app_private.list_active_branch_memberships(uuid)'
        ),
        pg_catalog.to_regprocedure(
          'app_private.create_dining_zone(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text)'
        )
      ]::oid[],
      null::oid
    )`;
  }
  throw recoveryError("precheck");
}

async function terminateAppApiSessions(session: AppApiProvisioningSession): Promise<void> {
  const result = await session.query<{ terminated: boolean }>(TERMINATE_SQL);
  if (result.rows.some((row) => row.terminated !== true)) throw recoveryError("postcheck");
}

async function hasZeroAppApiSessions(session: AppApiProvisioningSession): Promise<boolean> {
  const result = await session.query<{ count: number }>(
    "select count(*)::integer as count from pg_catalog.pg_stat_activity where usename = 'app_api'",
  );
  if (result.rows.length !== 1 || typeof result.rows[0]?.count !== "number") {
    throw recoveryError("postcheck");
  }
  return result.rows[0].count === 0;
}

async function rollbackQuietly(session: AppApiProvisioningSession): Promise<void> {
  try {
    await session.query("ROLLBACK");
  } catch {
    // Only stable, allowlisted recovery errors leave this module.
  }
}

function readPinnedPrecheck(
  sql: string,
  auditProfile: AppApiLifecycleCatalogProfile,
): string {
  try {
    const expectedHash = auditProfile === "memberships_v1"
      ? PRECHECK_AUDIT_SHA256
      : POST_DINING_ZONES_PRECHECK_AUDIT_SHA256;
    return validatePinnedAudit(sql, expectedHash);
  } catch {
    throw recoveryError("configuration");
  }
}

function recoveryError(stage: AppApiRecoveryStage): AppApiRecoveryError {
  const codes: Readonly<Record<AppApiRecoveryStage, AppApiRecoveryError["code"]>> = {
    close: "APP_API_RECOVERY_CLOSE_FAILED",
    configuration: "APP_API_RECOVERY_CONFIGURATION_REJECTED",
    disable: "APP_API_RECOVERY_DISABLE_FAILED",
    postcheck: "APP_API_RECOVERY_POSTCHECK_FAILED",
    precheck: "APP_API_RECOVERY_PRECHECK_FAILED",
  };
  return new AppApiRecoveryError(stage, codes[stage]);
}
