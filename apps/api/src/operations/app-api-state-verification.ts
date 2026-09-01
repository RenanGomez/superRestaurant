import type { DatabaseConfig } from "../database.js";
import {
  acquireAppApiLifecycleLock,
  createAppApiPostgresSession,
  type AppApiProvisioningSession,
  validatePinnedAudit,
} from "./app-api-provisioning.js";
import { readAppApiLifecycleTarget } from "./app-api-recovery.js";
import {
  AppApiStateVerificationError,
  type AppApiStateVerificationConfig,
  type AppApiStateVerificationStage,
} from "./app-api-state-verification-config.js";

const PRECHECK_AUDIT_SHA256 = "a6485bcdcc1f54beee9f939187d374a449541343b426d59341870dda63ccd983";
const RUNTIME_AUDIT_SHA256 = "e4d89b714336edda12441567d9738507abcb807abe173413f1095a16ca7321e2";
const POST_DINING_ZONES_PRECHECK_AUDIT_SHA256 = "8bc25f26058ec8512d364404629b595c690b987edf5fdd891ce0496943b6b4bc";
const POST_DINING_ZONES_RUNTIME_AUDIT_SHA256 = "c0648eecde4df52cf92e581bb1667b7fc10b904725803271767192ec50ebe688";

export type AppApiCatalogAuditProfile = "memberships_v1" | "post_dining_zones_v1";

export type AppApiObservedState = "safe_disabled" | "temporary" | "expired" | "runtime" | "partial";

export interface AppApiStateVerificationDependencies {
  createAdminSession(config: DatabaseConfig): AppApiProvisioningSession;
}

export interface AppApiStateVerificationSummary {
  readonly activeSessions: boolean;
  readonly catalogAudit: boolean;
  readonly state: AppApiObservedState;
  readonly status: "ok" | "attention";
}

export interface AppApiStateVerificationOptions {
  readonly auditProfile?: AppApiCatalogAuditProfile;
  readonly config: AppApiStateVerificationConfig;
  readonly precheckAuditSql: string;
  readonly runtimeAuditSql: string;
  readonly dependencies?: AppApiStateVerificationDependencies;
}

export async function verifyAppApiState(
  options: AppApiStateVerificationOptions,
): Promise<AppApiStateVerificationSummary> {
  const auditProfile = options.auditProfile ?? "memberships_v1";
  const hashes = auditHashes(auditProfile);
  const precheckAuditSql = readPinnedAudit(options.precheckAuditSql, hashes.precheck);
  const runtimeAuditSql = readPinnedAudit(options.runtimeAuditSql, hashes.runtime);
  const dependencies = options.dependencies ?? postgresDependencies;
  let session: AppApiProvisioningSession | undefined;
  let failure: AppApiStateVerificationError | undefined;
  let summary: AppApiStateVerificationSummary | undefined;
  let stage: AppApiStateVerificationStage = "connection";

  try {
    session = dependencies.createAdminSession(options.config.adminDatabase);
    await acquireAppApiLifecycleLock(session);
    stage = "audit";
    const target = await readAppApiLifecycleTarget(session, "precheck", undefined, auditProfile);
    const state = classifyState(target);
    const activeSessions = await readActiveSessionFlag(session);
    if (activeSessions) {
      summary = freezeSummary(state, true, false, "attention");
    } else if (state === "safe_disabled") {
      await session.query(precheckAuditSql);
      summary = freezeSummary(state, false, true, "ok");
    } else if (state === "runtime") {
      await session.query(runtimeAuditSql);
      summary = freezeSummary(state, false, true, "ok");
    } else {
      summary = freezeSummary(state, false, false, "attention");
    }
  } catch (error: unknown) {
    failure = error instanceof AppApiStateVerificationError ? error : verificationError(stage);
  } finally {
    if (session !== undefined) {
      try {
        await session.close();
      } catch {
        if (failure === undefined) failure = verificationError("close");
      }
    }
  }

  if (failure !== undefined) throw failure;
  if (summary === undefined) throw verificationError("audit");
  return summary;
}

function auditHashes(profile: AppApiCatalogAuditProfile): Readonly<{
  precheck: string;
  runtime: string;
}> {
  if (profile === "memberships_v1") {
    return Object.freeze({ precheck: PRECHECK_AUDIT_SHA256, runtime: RUNTIME_AUDIT_SHA256 });
  }
  if (profile === "post_dining_zones_v1") {
    return Object.freeze({
      precheck: POST_DINING_ZONES_PRECHECK_AUDIT_SHA256,
      runtime: POST_DINING_ZONES_RUNTIME_AUDIT_SHA256,
    });
  }
  throw verificationError("configuration");
}

const postgresDependencies: AppApiStateVerificationDependencies = Object.freeze({
  createAdminSession: (config: DatabaseConfig) => createAppApiPostgresSession(
    config,
    "super-restaurant-app-api-state-verification",
  ),
});

function classifyState(target: Awaited<ReturnType<typeof readAppApiLifecycleTarget>>): AppApiObservedState {
  if (target.disabled) return "safe_disabled";
  if (target.login && target.scram && !target.passwordNull) {
    if (target.infiniteExpiry) return "runtime";
    if (target.finiteExpiry) return target.futureExpiry ? "temporary" : "expired";
  }
  return "partial";
}

async function readActiveSessionFlag(session: AppApiProvisioningSession): Promise<boolean> {
  const result = await session.query<{ count: number }>(
    "select count(*)::integer as count from pg_catalog.pg_stat_activity where usename = 'app_api'",
  );
  const count = result.rows[0]?.count;
  if (result.rows.length !== 1 || typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw verificationError("audit");
  }
  return count > 0;
}

function readPinnedAudit(sql: string, hash: string): string {
  try {
    return validatePinnedAudit(sql, hash);
  } catch {
    throw verificationError("configuration");
  }
}

function freezeSummary(
  state: AppApiObservedState,
  activeSessions: boolean,
  catalogAudit: boolean,
  status: "ok" | "attention",
): AppApiStateVerificationSummary {
  return Object.freeze({ activeSessions, catalogAudit, state, status });
}

function verificationError(stage: AppApiStateVerificationStage): AppApiStateVerificationError {
  const codes: Readonly<Record<AppApiStateVerificationStage, AppApiStateVerificationError["code"]>> = {
    audit: "APP_API_STATE_AUDIT_FAILED",
    close: "APP_API_STATE_CLOSE_FAILED",
    configuration: "APP_API_STATE_CONFIGURATION_REJECTED",
    connection: "APP_API_STATE_CONNECTION_FAILED",
  };
  return new AppApiStateVerificationError(stage, codes[stage]);
}
