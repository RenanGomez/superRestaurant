import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractMigrationBody,
  extractMigrationStatements,
  readSchemaVerificationConfig,
  runSchemaVerification,
  SchemaVerificationError,
  validateCatalogAuditSql,
  type SchemaVerificationConfig,
  type SchemaVerificationQueryResult,
  type SchemaVerificationSession,
} from "./schema-verification.js";

const projectRef = "abcdefghijklmnopqrst";
const validEnvironment = Object.freeze({
  SCHEMA_VERIFICATION_CA_CERT_PATH: "C:/private/supabase-root.crt",
  SCHEMA_VERIFICATION_CONFIRMATION: "ROLLBACK_ONLY",
  SCHEMA_VERIFICATION_DATABASE_URL: `postgresql://postgres.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF: projectRef,
});
const config: SchemaVerificationConfig = Object.freeze({
  caCertificate: "TEST CA",
  connectionString: "postgresql://redacted.invalid/postgres",
  expectedProjectRef: projectRef,
});

test("requires exact rollback opt-in and an administrative Supabase target", () => {
  const accepted = readSchemaVerificationConfig(validEnvironment, (path) => {
    assert.equal(path, "C:/private/supabase-root.crt");
    return "TEST CA";
  });
  assert.equal(new URL(accepted.connectionString).username, `postgres.${projectRef}`);
  assert.equal(new URL(accepted.connectionString).search, "");

  const direct = readSchemaVerificationConfig({
    ...validEnvironment,
    SCHEMA_VERIFICATION_DATABASE_URL: `postgresql://postgres:private-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
  }, () => "TEST CA");
  assert.equal(new URL(direct.connectionString).hostname, `db.${projectRef}.supabase.co`);

  for (const environment of [
    { ...validEnvironment, SCHEMA_VERIFICATION_CONFIRMATION: "ROLLBACK" },
    { ...validEnvironment, SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF: projectRef.toUpperCase() },
    { ...validEnvironment, SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF: "otherprojectref00000" },
    {
      ...validEnvironment,
      SCHEMA_VERIFICATION_DATABASE_URL: `postgresql://app_api.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    },
    {
      ...validEnvironment,
      SCHEMA_VERIFICATION_DATABASE_URL: `postgresql://postgres.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require`,
    },
    {
      ...validEnvironment,
      SCHEMA_VERIFICATION_DATABASE_URL: `postgresql://postgres.${projectRef}:private-password@pooler.supabase.com.evil.test:5432/postgres?sslmode=verify-full`,
    },
    {
      ...validEnvironment,
      SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF: "cxcnnhafchqslvgvkeye",
      SCHEMA_VERIFICATION_DATABASE_URL: "postgresql://postgres.cxcnnhafchqslvgvkeye:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full",
    },
  ]) {
    assert.throws(() => readSchemaVerificationConfig(environment, () => "TEST CA"), (error: unknown) => {
      assert.ok(error instanceof SchemaVerificationError);
      assert.equal(error.message, "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
      assert.equal(error.message.includes("private-password"), false);
      return true;
    });
  }

  assert.throws(
    () => readSchemaVerificationConfig(validEnvironment, () => { throw new Error("C:/private/supabase-root.crt"); }),
    (error: unknown) => error instanceof SchemaVerificationError && error.message === "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED",
  );
});

test("extracts only the outer transaction and rejects internal transaction control", () => {
  const body = extractMigrationBody(`
    -- envelope
    begin;
    do $block$
    begin
      perform 'commit; rollback;';
    end
    $block$;
    create table app.example (id text default 'savepoint hidden');
    commit;
  `);
  assert.match(body, /^do \$block\$/u);
  assert.match(body, /create table app\.example/u);
  assert.equal(body.includes("\n    begin;"), false);
  assert.equal(extractMigrationStatements("begin; select 1; select 2; commit;").length, 2);

  for (const sql of [
    "create table app.example (id integer);",
    "begin; create table app.example (id integer); savepoint unsafe; commit;",
    "begin; set transaction isolation level serializable; create table app.example (id integer); commit;",
    "begin; abort; commit;",
    "begin; create table app.example (id integer); commit; rollback;",
    "begin; create table app.example (id integer); commit; -- trailing\nselect 1;",
  ]) {
    assert.throws(() => extractMigrationBody(sql), SchemaVerificationError);
  }
});

test("accepts the checked-in migration and catalog audit without their own transaction control", () => {
  const migrationSql = readFileSync(
    new URL("../../../../supabase/migrations/20260830000100_create_tenancy_memberships.sql", import.meta.url),
    "utf8",
  );
  const catalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_catalog.sql", import.meta.url),
    "utf8",
  );
  const membershipDirectoryMigrationSql = readFileSync(
    new URL(
      "../../../../supabase/migrations/20260830000200_list_active_branch_memberships.sql",
      import.meta.url,
    ),
    "utf8",
  );

  const migrationBody = extractMigrationBody(migrationSql);
  assert.match(migrationBody, /create schema app/u);
  assert.doesNotMatch(migrationBody, /^\s*begin\s*;/iu);
  assert.doesNotMatch(migrationBody, /\bcommit\s*;\s*$/iu);
  assert.match(validateCatalogAuditSql(catalogAuditSql), /CATALOG_AUDIT_POLICIES/u);
  assert.match(
    extractMigrationBody(membershipDirectoryMigrationSql),
    /create function app_private\.list_active_branch_memberships/u,
  );

  assert.throws(
    () => validateCatalogAuditSql("begin; select 1; commit;"),
    (error: unknown) => error instanceof SchemaVerificationError
      && error.stage === "catalog_audit"
      && error.code === "SCHEMA_VERIFICATION_SQL_REJECTED",
  );
});

test("verifies the exact expanded five-function post-migration state and still rolls back", async () => {
  const session = new FakeSession(
    undefined,
    undefined,
    [{ policies: 5, securedTables: 5, securityDefinerFunctions: 5 }],
  );
  const summary = await runSchemaVerification({
    catalogAuditSql: "do $$ begin perform 1; end $$;",
    config,
    createSession: () => session,
    expectedSecurityDefinerFunctions: 5,
    migrationSql: "begin; create function app_private.example() returns void language sql as 'select'; commit;",
  });

  assert.deepEqual(summary, { policies: 5, securedTables: 5, securityDefinerFunctions: 5 });
  assert.equal(session.queries.at(-1), "ROLLBACK");
  assert.equal(session.closed, true);
});

test("supports an exact additive schema summary without weakening existing defaults", async () => {
  const session = new FakeSession(
    undefined,
    undefined,
    [{ policies: 5, securedTables: 7, securityDefinerFunctions: 6 }],
  );
  const summary = await runSchemaVerification({
    catalogAuditSql: "do $$ begin perform 1; end $$;",
    config,
    createSession: () => session,
    expectedSummary: { policies: 5, securedTables: 7, securityDefinerFunctions: 6 },
    migrationSql: "begin; create table app.dining_zones(id uuid); commit;",
  });
  assert.deepEqual(summary, { policies: 5, securedTables: 7, securityDefinerFunctions: 6 });
  assert.equal(session.queries.at(-1), "ROLLBACK");
  assert.equal(session.closed, true);
});

test("rejects an unsupported expected summary before opening a database session", async () => {
  let factoryCalled = false;
  await assert.rejects(
    runSchemaVerification({
      catalogAuditSql: "select 1;",
      config,
      createSession: () => {
        factoryCalled = true;
        return new FakeSession();
      },
      expectedSecurityDefinerFunctions: 6 as unknown as 4,
      migrationSql: "begin; select 1; commit;",
    }),
    (error: unknown) => error instanceof SchemaVerificationError
      && error.stage === "configuration"
      && error.code === "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED",
  );
  assert.equal(factoryCalled, false);

  for (const expectedSummary of [
    { policies: -1, securedTables: 7, securityDefinerFunctions: 6 },
    { policies: 5, securedTables: 7, securityDefinerFunctions: 101 },
    { policies: 5, securedTables: 7, securityDefinerFunctions: 6, extra: true },
  ]) {
    await assert.rejects(runSchemaVerification({
      catalogAuditSql: "select 1;",
      config,
      createSession: () => new FakeSession(),
      expectedSummary: expectedSummary as never,
      migrationSql: "begin; select 1; commit;",
    }), SchemaVerificationError);
  }
});

test("always rolls back and closes after a successful audit", async () => {
  const session = new FakeSession();
  const summary = await runSchemaVerification({
    catalogAuditSql: "do $$ begin perform 1; end $$;",
    config,
    createSession: () => session,
    migrationSql: "begin; create schema app; commit;",
  });

  assert.deepEqual(summary, { policies: 5, securedTables: 5, securityDefinerFunctions: 4 });
  assert.equal(session.connected, true);
  assert.equal(session.closed, true);
  assert.equal(session.queries[0], "BEGIN");
  assert.match(session.queries[1] ?? "", /create schema app/u);
  assert.match(session.queries[2] ?? "", /do \$\$/u);
  assert.match(session.queries[3] ?? "", /pg_catalog\.pg_policies/u);
  assert.equal(session.queries[4], "ROLLBACK");
});

test("always rolls back and closes after migration failure without exposing the driver error", async () => {
  const driverError = Object.assign(
    new Error("postgresql://postgres:secret@host/database"),
    { code: "42P01" },
  );
  const session = new FakeSession(3, driverError);

  await assert.rejects(
    runSchemaVerification({
      catalogAuditSql: "select 1;",
      config,
      createSession: () => session,
      migrationSql: "begin; create schema app; create table app.example(id uuid); commit;",
    }),
    (error: unknown) => {
      assert.ok(error instanceof SchemaVerificationError);
      assert.equal(error.stage, "migration");
      assert.equal(error.code, "SCHEMA_VERIFICATION_MIGRATION_FAILED");
      assert.equal(error.statementIndex, 2);
      assert.equal(error.sqlState, "42P01");
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );

  assert.equal(session.closed, true);
  assert.equal(session.queries.at(-1), "ROLLBACK");
});

test("rejects unsafe driver diagnostics instead of reflecting them", async () => {
  const session = new FakeSession(2, Object.assign(new Error("private"), { code: "secret-url" }));
  await assert.rejects(
    runSchemaVerification({
      catalogAuditSql: "select 1;",
      config,
      createSession: () => session,
      migrationSql: "begin; select 1; commit;",
    }),
    (error: unknown) => error instanceof SchemaVerificationError
      && error.statementIndex === 1
      && error.sqlState === undefined,
  );
  assert.equal(session.queries.at(-1), "ROLLBACK");
  assert.equal(session.closed, true);
});

test("reports rollback failure with a stable code and still closes", async () => {
  const session = new FakeSession(5, new Error("private rollback diagnostic"));
  await assert.rejects(
    runSchemaVerification({
      catalogAuditSql: "select 1;",
      config,
      createSession: () => session,
      migrationSql: "begin; create schema app; commit;",
    }),
    (error: unknown) => {
      assert.ok(error instanceof SchemaVerificationError);
      assert.equal(error.stage, "rollback");
      assert.equal(error.code, "SCHEMA_VERIFICATION_ROLLBACK_FAILED");
      assert.equal(error.message.includes("private"), false);
      return true;
    },
  );
  assert.equal(session.closed, true);
});

test("preserves a sanitized summary rejection and still rolls back", async () => {
  const session = new FakeSession(undefined, undefined, [{ policies: 4, securedTables: 5, securityDefinerFunctions: 4 }]);
  await assert.rejects(
    runSchemaVerification({
      catalogAuditSql: "select 1;",
      config,
      createSession: () => session,
      migrationSql: "begin; create schema app; commit;",
    }),
    (error: unknown) => error instanceof SchemaVerificationError
      && error.stage === "summary"
      && error.code === "SCHEMA_VERIFICATION_SUMMARY_REJECTED",
  );
  assert.equal(session.closed, true);
  assert.equal(session.queries.at(-1), "ROLLBACK");
});

test("rejects an expanded summary with extra fields or the old function count", async () => {
  for (const summaryRows of [
    [{ policies: 5, securedTables: 5, securityDefinerFunctions: 4 }],
    [{ policies: 5, securedTables: 5, securityDefinerFunctions: 5, unexpected: true }],
  ]) {
    const session = new FakeSession(undefined, undefined, summaryRows);
    await assert.rejects(
      runSchemaVerification({
        catalogAuditSql: "select 1;",
        config,
        createSession: () => session,
        expectedSecurityDefinerFunctions: 5,
        migrationSql: "begin; select 1; commit;",
      }),
      (error: unknown) => error instanceof SchemaVerificationError
        && error.stage === "summary"
        && error.code === "SCHEMA_VERIFICATION_SUMMARY_REJECTED",
    );
    assert.equal(session.queries.at(-1), "ROLLBACK");
    assert.equal(session.closed, true);
  }
});

class FakeSession implements SchemaVerificationSession {
  public closed = false;
  public connected = false;
  public readonly queries: string[] = [];
  readonly #failureCall: number | undefined;
  readonly #failure: Error;
  readonly #summaryRows: readonly unknown[];

  public constructor(
    failureCall?: number,
    failure = new Error("driver failure"),
    summaryRows: readonly unknown[] = [{ policies: 5, securedTables: 5, securityDefinerFunctions: 4 }],
  ) {
    this.#failureCall = failureCall;
    this.#failure = failure;
    this.#summaryRows = summaryRows;
  }

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async query(sql: string): Promise<SchemaVerificationQueryResult> {
    this.queries.push(sql);
    if (this.queries.length === this.#failureCall) throw this.#failure;
    if (sql.includes("pg_catalog.pg_policies")) {
      return { rows: this.#summaryRows };
    }
    return { rows: [] };
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}
