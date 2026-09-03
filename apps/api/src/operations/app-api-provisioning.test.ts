import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { DatabaseConfig } from "../database.js";
import {
  AppApiProvisioningError,
  type AppApiProvisioningConfig,
} from "./app-api-provisioning-config.js";
import {
  provisionAppApi,
  type AppApiProvisioningDependencies,
  type AppApiProvisioningQueryResult,
  type AppApiProvisioningSession,
} from "./app-api-provisioning.js";

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
  new URL("../../../../supabase/tests/tenancy_memberships_post_dining_tables_catalog.sql", import.meta.url),
  "utf8",
);
const postMenuAuditSql = readFileSync(
  new URL("../../../../supabase/tests/tenancy_memberships_post_menu_catalog.sql", import.meta.url),
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
const config: AppApiProvisioningConfig = Object.freeze({
  adminDatabase: database,
  appDatabase: database,
  expectedProjectRef: "abcdefghijklmnopqrst",
  password: "A-strong-private-password-1234567890!",
});

test("provisions a short-lived SCRAM credential, verifies it, then promotes it", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor([adminSession(events)], appSession(events));
  const result = await provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql });

  assert.deepEqual(result, {
    appApiLogin: true,
    crashExpiryProtected: true,
    runtimeAudit: true,
    status: "ok",
  });
  assert.deepEqual(events, [
    "admin:lock",
    "admin:BEGIN",
    "admin:precheck",
    "admin:role-oid",
    "admin:sessions",
    "admin:scram",
    "admin:create-temp-helper",
    "admin:bind-password",
    "admin:temporary-state",
    "admin:COMMIT",
    "app:identity",
    "app:lookup",
    "app:deny-table",
    "app:deny-rls",
    "app:deny-set-role",
    "app:close",
    "admin:BEGIN",
    "admin:disable",
    "admin:COMMIT",
    "admin:terminate",
    "admin:sessions",
    "admin:BEGIN",
    "admin:scram",
    "admin:bind-password",
    "admin:temporary-state",
    "admin:sessions",
    "admin:promote",
    "admin:runtime-audit",
    "admin:COMMIT",
    "admin:close",
  ]);
  assert.ok(events.indexOf("app:close") < events.indexOf("admin:disable"));
  assert.ok(events.indexOf("admin:disable") < events.indexOf("admin:terminate"));
  assert.ok(events.indexOf("admin:terminate") < events.indexOf("admin:runtime-audit"));
  assert.equal(events.join("|").includes(config.password), false);
});

test("accepts the pinned post-dining-zones audit pair for its explicit profile", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor([adminSession(events)], appSession(events));
  const result = await provisionAppApi({
    auditProfile: "post_dining_zones_v1",
    config,
    dependencies,
    precheckAuditSql: postDiningZonesPrecheckAuditSql,
    runtimeAuditSql: postDiningZonesRuntimeAuditSql,
  });
  assert.equal(result.status, "ok");
  assert.ok(events.includes("admin:runtime-audit"));
});

test("accepts the pinned post-dining-tables audit for its explicit profile", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor([adminSession(events)], appSession(events));
  const result = await provisionAppApi({
    auditProfile: "post_dining_tables_v1",
    config,
    dependencies,
    precheckAuditSql: postDiningTablesAuditSql,
    runtimeAuditSql: postDiningTablesAuditSql,
  });
  assert.equal(result.status, "ok");
  assert.ok(events.includes("admin:runtime-audit"));
});

test("accepts the pinned post-menu audit for its explicit profile", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor([adminSession(events)], appSession(events));
  const result = await provisionAppApi({
    auditProfile: "post_menu_v1",
    config,
    dependencies,
    precheckAuditSql: postMenuAuditSql,
    runtimeAuditSql: postMenuAuditSql,
  });
  assert.equal(result.status, "ok");
  assert.ok(events.includes("admin:runtime-audit"));
});

test("accepts the pinned post-orders audit for its explicit profile", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor([adminSession(events)], appSession(events));
  const result = await provisionAppApi({
    auditProfile: "post_orders_realtime_v1",
    config,
    dependencies,
    precheckAuditSql: postOrdersRealtimeAuditSql,
    runtimeAuditSql: postOrdersRealtimeAuditSql,
  });
  assert.equal(result.status, "ok");
  assert.ok(events.includes("admin:runtime-audit"));
});

test("accepts the pinned post-KDS audit for its explicit profile", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor([adminSession(events)], appSession(events));
  const result = await provisionAppApi({
    auditProfile: "post_kds_v1",
    config,
    dependencies,
    precheckAuditSql: postKdsAuditSql,
    runtimeAuditSql: postKdsAuditSql,
  });
  assert.equal(result.status, "ok");
  assert.ok(events.includes("admin:runtime-audit"));
});

test("retries bounded pooler credential propagation with fresh app sessions", async () => {
  const events: string[] = [];
  const waits: number[] = [];
  const dependencies = dependenciesFor(
    [adminSession(events)],
    appSession(events, { failConnection: true }),
    [appSession(events)],
  );
  dependencies.waitForAppCredentialPropagation = async (attempt) => { waits.push(attempt); };
  const result = await provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql });
  assert.equal(result.status, "ok");
  assert.deepEqual(waits, [1]);
  assert.equal(events.filter((event) => event === "app:close").length, 2);
});

test("rolls back without compensation when the immutable precheck fails", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor([adminSession(events, { failPrecheck: true })], appSession(events));
  await assertProvisioningFailure(
    () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
    "APP_API_PROVISIONING_PRECHECK_FAILED",
  );
  assert.deepEqual(events, [
    "admin:lock",
    "admin:BEGIN",
    "admin:precheck",
    "admin:ROLLBACK",
    "admin:close",
  ]);
});

test("refuses to mutate while the global app_api lifecycle lock is held", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor(
    [adminSession(events, { lockAcquired: false })],
    appSession(events),
  );
  await assertProvisioningFailure(
    () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
    "APP_API_PROVISIONING_PRECHECK_FAILED",
  );
  assert.deepEqual(events, ["admin:lock", "admin:close"]);
});

test("treats an ambiguous activation commit as changed and compensates", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor(
    [adminSession(events, { failFirstCommit: true }), compensationSession(events)],
    appSession(events),
  );
  await assertProvisioningFailure(
    () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
    "APP_API_PROVISIONING_CHANGE_FAILED",
  );
  assert.ok(events.includes("admin:ambiguous-commit"));
  assert.ok(events.includes("recovery:disable"));
});

test("uses a fresh locked session to compensate any attempted role change", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor(
    [adminSession(events, { failRuntimeAudit: true }), compensationSession(events)],
    appSession(events),
  );
  await assertProvisioningFailure(
    () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
    "APP_API_PROVISIONING_RUNTIME_AUDIT_FAILED",
  );
  assert.ok(events.includes("admin:ROLLBACK"));
  assert.ok(events.indexOf("admin:close") < events.indexOf("recovery:lock"));
  assert.ok(events.includes("recovery:disable"));
  assert.ok(events.indexOf("recovery:COMMIT") < events.indexOf("recovery:terminate"));
  assert.ok(events.includes("recovery:precheck"));
});

test("safe-disables before draining a pooler backend that reappears once", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor(
    [adminSession(events, { sessionCounts: [0, 1, 0, 0] })],
    appSession(events),
  );

  const result = await provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql });

  assert.equal(result.status, "ok");
  assert.equal(events.filter((event) => event === "admin:terminate").length, 2);
  assert.ok(events.indexOf("admin:disable") < events.indexOf("admin:terminate"));
  assert.ok(events.lastIndexOf("admin:sessions") < events.indexOf("admin:runtime-audit"));
});

test("fails closed when the pooler backend cannot be drained in the bounded attempts", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor(
    [
      adminSession(events, { sessionCounts: [0, 1, 1, 1] }),
      compensationSession(events),
    ],
    appSession(events),
  );

  await assertProvisioningFailure(
    () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
    "APP_API_PROVISIONING_RUNTIME_AUDIT_FAILED",
  );
  assert.equal(events.includes("admin:promote"), false);
  assert.equal(events.filter((event) => event === "admin:terminate").length, 3);
  assert.ok(events.includes("recovery:disable"));
});

test("fails closed when PostgreSQL cannot terminate the retained backend", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor(
    [adminSession(events, { terminationSucceeds: false }), compensationSession(events)],
    appSession(events),
  );

  await assertProvisioningFailure(
    () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
    "APP_API_PROVISIONING_RUNTIME_AUDIT_FAILED",
  );
  assert.ok(events.includes("recovery:disable"));
});

test("rolls back and compensates if a session appears before the final promotion", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor(
    [adminSession(events, { sessionCounts: [0, 0, 1] }), compensationSession(events)],
    appSession(events),
  );

  await assertProvisioningFailure(
    () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
    "APP_API_PROVISIONING_RUNTIME_AUDIT_FAILED",
  );
  assert.ok(events.includes("admin:ROLLBACK"));
  assert.equal(events.includes("admin:promote"), false);
  assert.ok(events.includes("recovery:disable"));
});

for (const commitNumber of [2, 3] as const) {
  test(`compensates an ambiguous lifecycle commit ${commitNumber}`, async () => {
    const events: string[] = [];
    const dependencies = dependenciesFor(
      [adminSession(events, { failCommitNumber: commitNumber }), compensationSession(events)],
      appSession(events),
    );

    await assertProvisioningFailure(
      () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
      "APP_API_PROVISIONING_RUNTIME_AUDIT_FAILED",
    );
    assert.ok(events.includes(`admin:ambiguous-commit-${commitNumber}`));
    assert.ok(events.includes("recovery:disable"));
  });
}

test("compensates a committed temporary login when the private identity is wrong", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor(
    [adminSession(events), compensationSession(events)],
    appSession(events, { wrongIdentity: true }),
  );
  await assertProvisioningFailure(
    () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
    "APP_API_PROVISIONING_CONNECTION_FAILED",
  );
  assert.ok(events.includes("admin:COMMIT"));
  assert.ok(events.includes("app:close"));
  assert.ok(events.indexOf("recovery:disable") > events.indexOf("app:close"));
});

test("reports compensation failure as the highest-priority error", async () => {
  const events: string[] = [];
  const dependencies = dependenciesFor(
    [adminSession(events, { failRuntimeAudit: true }), compensationSession(events, true)],
    appSession(events),
  );
  await assertProvisioningFailure(
    () => provisionAppApi({ config, dependencies, precheckAuditSql, runtimeAuditSql }),
    "APP_API_PROVISIONING_COMPENSATION_FAILED",
  );
});

test("rejects modified audit SQL before creating any session", async () => {
  let factoryCalled = false;
  const dependencies: AppApiProvisioningDependencies = {
    createAdminSession: () => {
      factoryCalled = true;
      throw new Error("SHOULD_NOT_RUN");
    },
    createAppSession: () => {
      factoryCalled = true;
      throw new Error("SHOULD_NOT_RUN");
    },
  };
  await assertProvisioningFailure(
    () => provisionAppApi({
      config,
      dependencies,
      precheckAuditSql: `${precheckAuditSql}\nselect 1;`,
      runtimeAuditSql,
    }),
    "APP_API_PROVISIONING_CONFIGURATION_REJECTED",
  );
  assert.equal(factoryCalled, false);
});

function dependenciesFor(
  adminSessions: readonly AppApiProvisioningSession[],
  app: AppApiProvisioningSession,
  retryApps: readonly AppApiProvisioningSession[] = [],
): AppApiProvisioningDependencies {
  let adminIndex = 0;
  let appIndex = 0;
  const apps = [app, ...retryApps];
  return {
    createAdminSession: () => {
      const selected = adminSessions[adminIndex];
      adminIndex += 1;
      if (selected === undefined) throw new Error("ADMIN_SESSION_MISSING");
      return selected;
    },
    createAppSession: () => apps[Math.min(appIndex++, apps.length - 1)] as AppApiProvisioningSession,
  };
}

function adminSession(
  events: string[],
  options: Readonly<{
    failFirstCommit?: boolean;
    failCommitNumber?: number;
    failPrecheck?: boolean;
    failRuntimeAudit?: boolean;
    lockAcquired?: boolean;
    sessionCounts?: readonly number[];
    terminationSucceeds?: boolean;
  }> = {},
): AppApiProvisioningSession {
  let commitNumber = 0;
  let sessionCountIndex = 0;
  return session(async (sql, parameters = []) => {
    if (sql.includes("pg_try_advisory_lock")) {
      events.push("admin:lock");
      return result([{ acquired: options.lockAcquired !== false }]);
    }
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      if (sql === "COMMIT") {
        commitNumber += 1;
        const shouldFail = options.failCommitNumber === commitNumber
          || (options.failFirstCommit === true && commitNumber === 1);
        if (shouldFail) {
          events.push(options.failFirstCommit === true
            ? "admin:ambiguous-commit"
            : `admin:ambiguous-commit-${commitNumber}`);
          throw new Error("sensitive commit result");
        }
      }
      events.push(`admin:${sql}`);
      return emptyResult();
    }
    if (
      sql.includes("CATALOG_AUDIT_APP_API_MISSING")
      || sql.includes("POST_DINING_CATALOG_REQUIRED_OBJECT_MISSING")
      || (sql.includes("POST_DINING_TABLES_TABLE_SURFACE_REJECTED") && !events.includes("admin:promote"))
      || (sql.includes("POST_MENU_TABLE_SURFACE_REJECTED") && !events.includes("admin:promote"))
      || (sql.includes("POST_ORDERS_SURFACE_REJECTED") && !events.includes("admin:promote"))
      || (sql.includes("POST_KDS_SURFACE_REJECTED") && !events.includes("admin:promote"))
    ) {
      events.push("admin:precheck");
      if (options.failPrecheck === true) throw new Error("sensitive precheck detail");
      return emptyResult();
    }
    if (sql.startsWith("select oid::text")) {
      events.push("admin:role-oid");
      return result([{ oid: "4242" }]);
    }
    if (
      sql.includes("RUNTIME_AUDIT_APP_API_MISSING")
      || sql.includes("POST_DINING_RUNTIME_REQUIRED_OBJECT_MISSING")
      || (sql.includes("POST_DINING_TABLES_TABLE_SURFACE_REJECTED") && events.includes("admin:promote"))
      || (sql.includes("POST_MENU_TABLE_SURFACE_REJECTED") && events.includes("admin:promote"))
      || (sql.includes("POST_ORDERS_SURFACE_REJECTED") && events.includes("admin:promote"))
      || (sql.includes("POST_KDS_SURFACE_REJECTED") && events.includes("admin:promote"))
    ) {
      events.push("admin:runtime-audit");
      if (options.failRuntimeAudit === true) throw new Error("sensitive runtime detail");
      return emptyResult();
    }
    if (sql.includes("pg_terminate_backend")) {
      events.push("admin:terminate");
      return result(options.terminationSucceeds === false ? [{ terminated: false }] : []);
    }
    if (sql.includes("pg_stat_activity")) {
      events.push("admin:sessions");
      const count = options.sessionCounts?.[sessionCountIndex] ?? 0;
      sessionCountIndex += 1;
      return result([{ count }]);
    }
    if (sql.startsWith("set local password_encryption")) {
      events.push("admin:scram");
      return emptyResult();
    }
    if (sql.includes("create function pg_temp.provision_app_api")) {
      events.push("admin:create-temp-helper");
      assert.equal(sql.includes(config.password), false);
      return emptyResult();
    }
    if (sql === "select pg_temp.provision_app_api($1::text)") {
      events.push("admin:bind-password");
      assert.deepEqual(parameters, [config.password]);
      assert.equal(sql.includes(config.password), false);
      return emptyResult();
    }
    if (sql.includes("roles.rolvaliduntil >")) {
      events.push("admin:temporary-state");
      return result([{ exactOid: true, login: true, scram: true, temporaryExpiry: true }]);
    }
    if (sql === "alter role app_api valid until 'infinity'") {
      events.push("admin:promote");
      return emptyResult();
    }
    if (sql === "alter role app_api nologin password null valid until 'infinity'") {
      events.push("admin:disable");
      return emptyResult();
    }
    throw new Error(`UNEXPECTED_ADMIN_QUERY:${sql.slice(0, 30)}`);
  }, async () => { events.push("admin:close"); });
}

function compensationSession(events: string[], failDisable = false): AppApiProvisioningSession {
  return session(async (sql) => {
    if (sql.includes("pg_try_advisory_lock")) {
      events.push("recovery:lock");
      return result([{ acquired: true }]);
    }
    if (
      sql.includes("CATALOG_AUDIT_APP_API_MISSING")
      || sql.includes("POST_DINING_CATALOG_REQUIRED_OBJECT_MISSING")
    ) {
      events.push("recovery:precheck");
      return emptyResult();
    }
    if (sql.includes("shobj_description")) {
      events.push("recovery:target");
      return result([{ safe: true }]);
    }
    if (sql.includes("pg_terminate_backend")) {
      events.push("recovery:terminate");
      return emptyResult();
    }
    if (sql.includes("pg_stat_activity")) {
      events.push("recovery:sessions");
      return result([{ count: 0 }]);
    }
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      events.push(`recovery:${sql}`);
      return emptyResult();
    }
    if (sql === "alter role app_api nologin password null valid until 'infinity'") {
      events.push("recovery:disable");
      if (failDisable) throw new Error("sensitive compensation detail");
      return emptyResult();
    }
    throw new Error("UNEXPECTED_RECOVERY_QUERY");
  }, async () => { events.push("recovery:close"); });
}

function appSession(
  events: string[],
  options: Readonly<{ failConnection?: boolean; wrongIdentity?: boolean }> = {},
): AppApiProvisioningSession {
  return session(async (sql) => {
    if (sql.includes("current_user")) {
      events.push("app:identity");
      if (options.failConnection === true) throw postgresError("28P01");
      return result([{
        currentUser: options.wrongIdentity === true ? "postgres" : "app_api",
        sessionUser: "app_api",
      }]);
    }
    if (sql.includes("find_active_branch_membership")) {
      events.push("app:lookup");
      return emptyResult();
    }
    if (sql.includes("from app.roles")) {
      events.push("app:deny-table");
      throw postgresError("42501");
    }
    if (sql.includes("has_active_restaurant_membership")) {
      events.push("app:deny-rls");
      throw postgresError("42501");
    }
    if (sql === "set role postgres") {
      events.push("app:deny-set-role");
      throw postgresError("42501");
    }
    throw new Error("UNEXPECTED_APP_QUERY");
  }, async () => { events.push("app:close"); });
}

function session(
  query: (sql: string, parameters?: readonly unknown[]) => Promise<AppApiProvisioningQueryResult>,
  close: AppApiProvisioningSession["close"],
): AppApiProvisioningSession {
  return {
    close,
    query: async <Row extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]) => {
      const response = await query(sql, parameters);
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

function postgresError(code: string): Error {
  return Object.assign(new Error("sensitive postgres detail"), { code });
}

async function assertProvisioningFailure(
  action: () => Promise<unknown>,
  expectedCode: AppApiProvisioningError["code"],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof AppApiProvisioningError);
    assert.equal(error.code, expectedCode);
    const serialized = JSON.stringify(error);
    assert.equal(serialized.includes(config.password), false);
    assert.equal(serialized.includes("sensitive"), false);
    return true;
  });
}
