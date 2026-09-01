import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { DatabaseConfig } from "../database.js";
import type { AppApiProvisioningQueryResult, AppApiProvisioningSession } from "./app-api-provisioning.js";
import type { AppApiLifecycleTargetState } from "./app-api-recovery.js";
import type { AppApiStateVerificationConfig } from "./app-api-state-verification-config.js";
import {
  AppApiStateVerificationError,
} from "./app-api-state-verification-config.js";
import {
  verifyAppApiState,
  type AppApiStateVerificationDependencies,
} from "./app-api-state-verification.js";

const precheckAuditSql = readFileSync(
  new URL("../../../../supabase/tests/tenancy_memberships_catalog.sql", import.meta.url),
  "utf8",
);
const runtimeAuditSql = readFileSync(
  new URL("../../../../supabase/tests/tenancy_memberships_runtime_catalog.sql", import.meta.url),
  "utf8",
);
const postDiningZonesPrecheckAuditSql = readFileSync(
  new URL(
    "../../../../supabase/tests/tenancy_memberships_post_dining_zones_catalog.sql",
    import.meta.url,
  ),
  "utf8",
);
const postDiningZonesRuntimeAuditSql = readFileSync(
  new URL(
    "../../../../supabase/tests/tenancy_memberships_post_dining_zones_runtime_catalog.sql",
    import.meta.url,
  ),
  "utf8",
);
const postDiningTablesAuditSql = readFileSync(
  new URL(
    "../../../../supabase/tests/tenancy_memberships_post_dining_tables_catalog.sql",
    import.meta.url,
  ),
  "utf8",
);
const database: DatabaseConfig = Object.freeze({
  caCertificate: "TEST CA",
  connectionString: "postgresql://user:password@host.example/postgres",
});
const config: AppApiStateVerificationConfig = Object.freeze({
  adminDatabase: database,
  expectedProjectRef: "abcdefghijklmnopqrst",
});

test("audits the stable disabled and runtime states without mutating the role", async () => {
  for (const [target, expectedState, auditEvent] of [
    [targetState("safe_disabled"), "safe_disabled", "state:precheck"],
    [targetState("runtime"), "runtime", "state:runtime-audit"],
  ] as const) {
    const events: string[] = [];
    const result = await verifyAppApiState({
      config,
      dependencies: dependenciesFor(stateSession(events, target)),
      precheckAuditSql,
      runtimeAuditSql,
    });
    assert.deepEqual(result, {
      activeSessions: false,
      catalogAudit: true,
      state: expectedState,
      status: "ok",
    });
    assert.deepEqual(events, ["state:lock", "state:target", "state:sessions", auditEvent, "state:close"]);
    assert.equal(events.some((event) => event.includes("alter role")), false);
  }
});

test("pins the exact post-dining-zones audits for disabled and runtime states", async () => {
  for (const [target, expectedState, auditEvent] of [
    [targetState("safe_disabled"), "safe_disabled", "state:post-dining-precheck"],
    [targetState("runtime"), "runtime", "state:post-dining-runtime-audit"],
  ] as const) {
    const events: string[] = [];
    const result = await verifyAppApiState({
      auditProfile: "post_dining_zones_v1",
      config,
      dependencies: dependenciesFor(stateSession(events, target, 0, { postDiningZonesProfile: true })),
      precheckAuditSql: postDiningZonesPrecheckAuditSql,
      runtimeAuditSql: postDiningZonesRuntimeAuditSql,
    });
    assert.deepEqual(result, {
      activeSessions: false,
      catalogAudit: true,
      state: expectedState,
      status: "ok",
    });
    assert.deepEqual(events, ["state:lock", "state:target", "state:sessions", auditEvent, "state:close"]);
  }
});

test("pins the exact post-dining-tables audit for disabled and runtime states", async () => {
  for (const [target, expectedState] of [
    [targetState("safe_disabled"), "safe_disabled"],
    [targetState("runtime"), "runtime"],
  ] as const) {
    const events: string[] = [];
    const result = await verifyAppApiState({
      auditProfile: "post_dining_tables_v1",
      config,
      dependencies: dependenciesFor(stateSession(events, target, 0, { postDiningTablesProfile: true })),
      precheckAuditSql: postDiningTablesAuditSql,
      runtimeAuditSql: postDiningTablesAuditSql,
    });
    assert.deepEqual(result, {
      activeSessions: false,
      catalogAudit: true,
      state: expectedState,
      status: "ok",
    });
    assert.deepEqual(events, ["state:lock", "state:target", "state:sessions", "state:post-dining-tables-audit", "state:close"]);
  }
});

test("reports active sessions as attention for stable states without running a quiescent audit", async () => {
  for (const state of ["safe_disabled", "runtime"] as const) {
    const events: string[] = [];
    const result = await verifyAppApiState({
      config,
      dependencies: dependenciesFor(stateSession(events, targetState(state), 1)),
      precheckAuditSql,
      runtimeAuditSql,
    });
    assert.deepEqual(result, {
      activeSessions: true,
      catalogAudit: false,
      state,
      status: "attention",
    });
    assert.deepEqual(events, ["state:lock", "state:target", "state:sessions", "state:close"]);
  }
});

test("classifies temporary, expired and partial states as attention without forcing a mismatched audit", async () => {
  for (const state of ["temporary", "expired", "partial"] as const) {
    const events: string[] = [];
    const result = await verifyAppApiState({
      config,
      dependencies: dependenciesFor(stateSession(events, targetState(state), state === "temporary" ? 1 : 0)),
      precheckAuditSql,
      runtimeAuditSql,
    });
    assert.deepEqual(result, {
      activeSessions: state === "temporary",
      catalogAudit: false,
      state,
      status: "attention",
    });
    assert.equal(events.includes("state:precheck"), false);
    assert.equal(events.includes("state:runtime-audit"), false);
  }
});

test("fails closed for an unsafe fingerprint or occupied lifecycle lock", async () => {
  for (const options of [{ unsafe: true }, { lockAcquired: false }] as const) {
    const events: string[] = [];
    await assertVerificationFailure(
      () => verifyAppApiState({
        config,
        dependencies: dependenciesFor(stateSession(events, targetState("safe_disabled"), 0, options)),
        precheckAuditSql,
        runtimeAuditSql,
      }),
      options.lockAcquired === false
        ? "APP_API_STATE_CONNECTION_FAILED"
        : "APP_API_STATE_AUDIT_FAILED",
    );
  }
});

test("rejects altered audit SQL before creating a database session", async () => {
  let factoryCalled = false;
  const dependencies: AppApiStateVerificationDependencies = {
    createAdminSession: () => {
      factoryCalled = true;
      throw new Error("SHOULD_NOT_RUN");
    },
  };
  await assertVerificationFailure(
    () => verifyAppApiState({
      config,
      dependencies,
      precheckAuditSql: `${precheckAuditSql}\nselect 1;`,
      runtimeAuditSql,
    }),
    "APP_API_STATE_CONFIGURATION_REJECTED",
  );
  assert.equal(factoryCalled, false);
});

test("reports a close failure after an otherwise successful read-only audit", async () => {
  await assertVerificationFailure(
    () => verifyAppApiState({
      config,
      dependencies: dependenciesFor(stateSession([], targetState("safe_disabled"), 0, { closeFails: true })),
      precheckAuditSql,
      runtimeAuditSql,
    }),
    "APP_API_STATE_CLOSE_FAILED",
  );
});

function dependenciesFor(session: AppApiProvisioningSession): AppApiStateVerificationDependencies {
  return { createAdminSession: () => session };
}

function stateSession(
  events: string[],
  target: AppApiLifecycleTargetState,
  sessionCount = 0,
  options: Readonly<{
    closeFails?: boolean;
    lockAcquired?: boolean;
    postDiningTablesProfile?: boolean;
    postDiningZonesProfile?: boolean;
    unsafe?: boolean;
  }> = {},
): AppApiProvisioningSession {
  return session(async (sql) => {
    if (sql.includes("pg_try_advisory_lock")) {
      events.push("state:lock");
      return result([{ acquired: options.lockAcquired !== false }]);
    }
    if (sql.includes("roles.oid::text as oid")) {
      assert.match(sql, /roles\.rolconnlimit = -1/u);
      assert.equal(
        sql.includes("app_private.create_dining_zone"),
        options.postDiningZonesProfile === true || options.postDiningTablesProfile === true,
      );
      assert.equal(
        sql.includes("app_private.update_dining_table_layout"),
        options.postDiningTablesProfile === true,
      );
      events.push("state:target");
      return result([{ ...target, safe: options.unsafe !== true }]);
    }
    if (sql.includes("CATALOG_AUDIT_APP_API_MISSING")) {
      events.push("state:precheck");
      return emptyResult();
    }
    if (sql.includes("RUNTIME_AUDIT_APP_API_MISSING")) {
      events.push("state:runtime-audit");
      return emptyResult();
    }
    if (sql.includes("POST_DINING_CATALOG_REQUIRED_OBJECT_MISSING")) {
      events.push("state:post-dining-precheck");
      return emptyResult();
    }
    if (sql.includes("POST_DINING_RUNTIME_REQUIRED_OBJECT_MISSING")) {
      events.push("state:post-dining-runtime-audit");
      return emptyResult();
    }
    if (sql.includes("POST_DINING_TABLES_REQUIRED_OBJECT_MISSING")) {
      events.push("state:post-dining-tables-audit");
      return emptyResult();
    }
    if (sql.includes("pg_stat_activity")) {
      events.push("state:sessions");
      return result([{ count: sessionCount }]);
    }
    throw new Error(`UNEXPECTED_STATE_QUERY:${sql.slice(0, 30)}`);
  }, async () => {
    events.push("state:close");
    if (options.closeFails === true) throw new Error("sensitive close failure");
  });
}

function targetState(
  state: "safe_disabled" | "temporary" | "expired" | "runtime" | "partial",
): AppApiLifecycleTargetState {
  return Object.freeze({
    disabled: state === "safe_disabled",
    finiteExpiry: state === "temporary" || state === "expired",
    futureExpiry: state === "temporary",
    infiniteExpiry: state === "runtime" || state === "safe_disabled",
    login: state !== "safe_disabled",
    noExpiry: state === "runtime" || state === "safe_disabled",
    oid: "4242",
    passwordNull: state === "safe_disabled" || state === "partial",
    safe: true,
    scram: state !== "safe_disabled" && state !== "partial",
  });
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

async function assertVerificationFailure(
  action: () => Promise<unknown>,
  expectedCode: AppApiStateVerificationError["code"],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof AppApiStateVerificationError);
    assert.equal(error.code, expectedCode);
    assert.equal(JSON.stringify(error).includes("sensitive"), false);
    return true;
  });
}
