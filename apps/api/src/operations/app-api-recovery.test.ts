import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { DatabaseConfig } from "../database.js";
import type { AppApiProvisioningQueryResult, AppApiProvisioningSession } from "./app-api-provisioning.js";
import { recoverAppApi, type AppApiRecoveryDependencies } from "./app-api-recovery.js";
import {
  AppApiRecoveryError,
  type AppApiRecoveryConfig,
} from "./app-api-recovery-config.js";

const precheckAuditSql = readFileSync(
  new URL("../../../../supabase/tests/tenancy_memberships_catalog.sql", import.meta.url),
  "utf8",
);
const postDiningZonesPrecheckAuditSql = readFileSync(
  new URL(
    "../../../../supabase/tests/tenancy_memberships_post_dining_zones_catalog.sql",
    import.meta.url,
  ),
  "utf8",
);
const postOrdersRealtimeAuditSql = readFileSync(
  new URL("../../../../supabase/tests/tenancy_memberships_post_orders_realtime.sql", import.meta.url),
  "utf8",
);
const postKdsAuditSql = readFileSync(
  new URL("../../../../supabase/tests/tenancy_memberships_post_kds.sql", import.meta.url),
  "utf8",
);
const database: DatabaseConfig = Object.freeze({
  caCertificate: "TEST CA",
  connectionString: "postgresql://user:password@host.example/postgres",
});
const config: AppApiRecoveryConfig = Object.freeze({
  adminDatabase: database,
  expectedProjectRef: "abcdefghijklmnopqrst",
});

test("commits disable before draining sessions and verifies from a fresh session", async () => {
  const events: string[] = [];
  const result = await recoverAppApi({
    config,
    dependencies: dependenciesFor([
      recoverySession(events, { disabled: false, label: "primary" }),
      recoverySession(events, { disabled: true, label: "verify", sessionCounts: [0] }),
    ]),
    precheckAuditSql,
  });

  assert.deepEqual(result, {
    appApiLogin: false,
    credentialRemoved: true,
    sessionsTerminated: true,
    status: "ok",
  });
  assert.deepEqual(events, [
    "primary:lock",
    "primary:target-enabled",
    "primary:BEGIN",
    "primary:disable",
    "primary:COMMIT",
    "primary:close",
    "verify:lock",
    "verify:target-disabled",
    "verify:target-disabled",
    "verify:terminate-empty",
    "verify:sessions-0",
    "verify:precheck",
    "verify:close",
  ]);
  assert.ok(events.indexOf("primary:COMMIT") < events.indexOf("verify:terminate-empty"));
});

test("is idempotent when app_api is already disabled", async () => {
  const events: string[] = [];
  await recoverAppApi({
    config,
    dependencies: dependenciesFor([
      recoverySession(events, { disabled: true, label: "primary" }),
      recoverySession(events, { disabled: true, label: "verify", sessionCounts: [0] }),
    ]),
    precheckAuditSql,
  });
  assert.equal(events.some((event) => event.endsWith(":disable")), false);
  assert.ok(events.includes("verify:precheck"));
});

test("accepts only the pinned post-dining-zones catalog for its explicit profile", async () => {
  const events: string[] = [];
  await recoverAppApi({
    auditProfile: "post_dining_zones_v1",
    config,
    dependencies: dependenciesFor([
      recoverySession(events, { disabled: true, label: "primary" }),
      recoverySession(events, { disabled: true, label: "verify", sessionCounts: [0] }),
    ]),
    precheckAuditSql: postDiningZonesPrecheckAuditSql,
  });
  assert.ok(events.includes("verify:precheck"));
});

test("accepts the pinned post-orders and post-KDS catalogs for their explicit profiles", async () => {
  for (const [auditProfile, auditSql] of [
    ["post_orders_realtime_v1", postOrdersRealtimeAuditSql],
    ["post_kds_v1", postKdsAuditSql],
  ] as const) {
    const events: string[] = [];
    await recoverAppApi({
      auditProfile,
      config,
      dependencies: dependenciesFor([
        recoverySession(events, { disabled: true, label: "primary", auditProfile }),
        recoverySession(events, { disabled: true, label: "verify", sessionCounts: [0], auditProfile }),
      ]),
      precheckAuditSql: auditSql,
    });
    assert.ok(events.includes("verify:precheck"));
  }
});

test("drains a session that reappears and requires a bounded zero-session proof", async () => {
  const events: string[] = [];
  await recoverAppApi({
    config,
    dependencies: dependenciesFor([
      recoverySession(events, { disabled: true, label: "primary" }),
      recoverySession(events, { disabled: true, label: "verify", sessionCounts: [1, 0] }),
    ]),
    precheckAuditSql,
  });
  assert.equal(events.filter((event) => event === "verify:terminate-active").length, 1);
  assert.equal(events.filter((event) => event === "verify:terminate-empty").length, 1);
  assert.ok(events.includes("verify:sessions-1"));
  assert.ok(events.includes("verify:sessions-0"));
});

test("refuses a contaminated target or occupied lifecycle lock before mutation", async () => {
  for (const options of [{ unsafeTarget: true }, { lockAcquired: false }] as const) {
    const events: string[] = [];
    await assertRecoveryFailure(
      () => recoverAppApi({
        config,
        dependencies: dependenciesFor([recoverySession(events, { ...options, disabled: false })]),
        precheckAuditSql,
      }),
      "APP_API_RECOVERY_PRECHECK_FAILED",
    );
    assert.equal(events.some((event) => event.endsWith(":disable")), false);
  }
});

test("reconciles an ambiguous commit that was already applied", async () => {
  const events: string[] = [];
  const result = await recoverAppApi({
    config,
    dependencies: dependenciesFor([
      recoverySession(events, {
        ambiguousCommit: true,
        ambiguousCommitApplied: true,
        disabled: false,
        label: "primary",
      }),
      recoverySession(events, { disabled: true, label: "verify", sessionCounts: [0] }),
    ]),
    precheckAuditSql,
  });
  assert.equal(result.status, "ok");
  assert.ok(events.includes("primary:ambiguous-commit-applied"));
  assert.ok(events.includes("verify:precheck"));
});

test("retries once when an ambiguous commit was not applied, then uses a third fresh postcheck", async () => {
  const events: string[] = [];
  const result = await recoverAppApi({
    config,
    dependencies: dependenciesFor([
      recoverySession(events, {
        ambiguousCommit: true,
        ambiguousCommitApplied: false,
        disabled: false,
        label: "primary",
      }),
      recoverySession(events, { disabled: false, label: "retry" }),
      recoverySession(events, { disabled: true, label: "verify", sessionCounts: [0] }),
    ]),
    precheckAuditSql,
  });
  assert.equal(result.status, "ok");
  assert.ok(events.includes("retry:disable"));
  assert.ok(events.indexOf("retry:close") < events.indexOf("verify:lock"));
});

test("fails closed when a session cannot be terminated or the role OID changes", async () => {
  const terminationEvents: string[] = [];
  await assertRecoveryFailure(
    () => recoverAppApi({
      config,
      dependencies: dependenciesFor([
        recoverySession(terminationEvents, { disabled: true, label: "primary" }),
        recoverySession(terminationEvents, {
          disabled: true,
          label: "verify",
          terminateDenied: true,
        }),
      ]),
      precheckAuditSql,
    }),
    "APP_API_RECOVERY_POSTCHECK_FAILED",
  );

  const oidEvents: string[] = [];
  await assertRecoveryFailure(
    () => recoverAppApi({
      config,
      dependencies: dependenciesFor([
        recoverySession(oidEvents, { disabled: true, label: "primary", oid: "4242" }),
        recoverySession(oidEvents, { disabled: true, label: "verify", oid: "9999" }),
      ]),
      precheckAuditSql,
    }),
    "APP_API_RECOVERY_POSTCHECK_FAILED",
  );
});

test("rejects a modified audit before creating any session", async () => {
  let factoryCalled = false;
  await assertRecoveryFailure(
    () => recoverAppApi({
      config,
      dependencies: {
        createAdminSession: () => {
          factoryCalled = true;
          throw new Error("SHOULD_NOT_RUN");
        },
      },
      precheckAuditSql: `${precheckAuditSql}\nselect 1;`,
    }),
    "APP_API_RECOVERY_CONFIGURATION_REJECTED",
  );
  assert.equal(factoryCalled, false);
});

function dependenciesFor(sessions: readonly AppApiProvisioningSession[]): AppApiRecoveryDependencies {
  let index = 0;
  return {
    createAdminSession: () => {
      const selected = sessions[index];
      index += 1;
      if (selected === undefined) throw new Error("SESSION_MISSING");
      return selected;
    },
  };
}

function recoverySession(
  events: string[],
  options: Readonly<{
    ambiguousCommit?: boolean;
    ambiguousCommitApplied?: boolean;
    disabled: boolean;
    label?: string;
    lockAcquired?: boolean;
    oid?: string;
    sessionCounts?: readonly number[];
    terminateDenied?: boolean;
    unsafeTarget?: boolean;
    auditProfile?: "post_orders_realtime_v1" | "post_kds_v1";
  }>,
): AppApiProvisioningSession {
  const label = options.label ?? "recovery";
  let disabled = options.disabled;
  let pendingDisable = false;
  let sessionCountIndex = 0;
  const sessionCounts = options.sessionCounts ?? [0];
  return session(async (sql) => {
    if (sql.includes("pg_try_advisory_lock")) {
      events.push(`${label}:lock`);
      return result([{ acquired: options.lockAcquired !== false }]);
    }
    if (sql.includes("roles.oid::text as oid")) {
      assert.equal(
        sql.includes("app_private.list_kds_tickets"),
        options.auditProfile === "post_kds_v1",
      );
      events.push(`${label}:target-${disabled ? "disabled" : "enabled"}`);
      return result([{
        disabled,
        finiteExpiry: false,
        futureExpiry: false,
        infiniteExpiry: true,
        login: !disabled,
        noExpiry: true,
        oid: options.oid ?? "4242",
        passwordNull: disabled,
        safe: options.unsafeTarget !== true,
        scram: !disabled,
      }]);
    }
    if (sql === "BEGIN" || sql === "ROLLBACK") {
      events.push(`${label}:${sql}`);
      if (sql === "ROLLBACK") pendingDisable = false;
      return emptyResult();
    }
    if (sql.startsWith("alter role app_api nologin")) {
      events.push(`${label}:disable`);
      pendingDisable = true;
      return emptyResult();
    }
    if (sql === "COMMIT") {
      if (options.ambiguousCommit === true) {
        disabled = options.ambiguousCommitApplied === true;
        pendingDisable = false;
        events.push(`${label}:ambiguous-commit-${disabled ? "applied" : "not-applied"}`);
        throw new Error("sensitive commit result");
      }
      disabled = pendingDisable ? true : disabled;
      pendingDisable = false;
      events.push(`${label}:COMMIT`);
      return emptyResult();
    }
    if (sql.includes("pg_terminate_backend")) {
      const currentCount = sessionCounts[Math.min(sessionCountIndex, sessionCounts.length - 1)] ?? 0;
      events.push(`${label}:terminate-${currentCount > 0 ? "active" : "empty"}`);
      if (options.terminateDenied === true) return result([{ terminated: false }]);
      return currentCount > 0 ? result([{ terminated: true }]) : emptyResult();
    }
    if (
      sql.includes("CATALOG_AUDIT_APP_API_MISSING")
      || sql.includes("POST_DINING_CATALOG_REQUIRED_OBJECT_MISSING")
      || sql.includes("POST_ORDERS_REQUIRED_OBJECT_MISSING")
      || sql.includes("POST_KDS_REQUIRED_OBJECT_MISSING")
    ) {
      events.push(`${label}:precheck`);
      return emptyResult();
    }
    if (sql.includes("pg_stat_activity")) {
      const currentCount = sessionCounts[Math.min(sessionCountIndex, sessionCounts.length - 1)] ?? 0;
      sessionCountIndex += 1;
      events.push(`${label}:sessions-${currentCount}`);
      return result([{ count: currentCount }]);
    }
    throw new Error(`UNEXPECTED_RECOVERY_QUERY:${sql.slice(0, 30)}`);
  }, async () => { events.push(`${label}:close`); });
}

function session(
  query: (sql: string) => Promise<AppApiProvisioningQueryResult>,
  close: AppApiProvisioningSession["close"],
): AppApiProvisioningSession {
  return {
    close,
    query: async <Row extends Record<string, unknown>>(sql: string) => {
      const response = await query(sql);
      return response as AppApiProvisioningQueryResult<Row>;
    },
  };
}

function emptyResult(): AppApiProvisioningQueryResult {
  return Object.freeze({ rowCount: 0, rows: Object.freeze([]) });
}

function result<Row extends Record<string, unknown>>(rows: readonly Row[]): AppApiProvisioningQueryResult<Row> {
  return Object.freeze({ rowCount: rows.length, rows: Object.freeze([...rows]) });
}

async function assertRecoveryFailure(
  action: () => Promise<unknown>,
  expectedCode: AppApiRecoveryError["code"],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof AppApiRecoveryError);
    assert.equal(error.code, expectedCode);
    assert.equal(JSON.stringify(error).includes("sensitive"), false);
    return true;
  });
}
