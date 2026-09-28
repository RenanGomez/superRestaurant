import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMigrationHistory,
  runMigrationPostcheck,
  MigrationPostcheckError,
} from "./run-migration-postcheck.js";
import type { SchemaVerificationConfig, SchemaVerificationSession } from "./schema-verification.js";

const config: SchemaVerificationConfig = Object.freeze({
  caCertificate: "TEST CA",
  connectionString: "postgresql://redacted.invalid/postgres",
  expectedProjectRef: "test",
});

const summary = { policies: 5, securedTables: 5, securityDefinerFunctions: 4 };

function fakeSession(
  queries: string[],
  remoteVersions: readonly string[],
  privileges: { appApi: boolean; authenticated: boolean; owner: boolean } = { appApi: true, authenticated: false, owner: true },
  onQuery?: (sql: string) => void,
): SchemaVerificationSession {
  return {
    async connect(): Promise<void> {},
    async query(sql: string): Promise<{ rows: readonly unknown[] }> {
      queries.push(sql);
      onQuery?.(sql);
      if (sql.includes("schema_migrations")) return { rows: remoteVersions.map((version) => ({ version })) };
      if (sql.includes("has_function_privilege")) return { rows: [privileges] };
      if (sql.includes("securedTables")) return { rows: [summary] };
      return { rows: [] };
    },
    async close(): Promise<void> {},
  };
}

test("evaluateMigrationHistory reports missing/duplicate versions and upToDate", () => {
  const ok = evaluateMigrationHistory(["20260101000100"], ["20260101000100"]);
  assert.deepEqual(ok, { duplicateVersions: [], missingVersions: [], upToDate: true });

  const missing = evaluateMigrationHistory(["20260101000100", "20260102000100"], ["20260101000100"]);
  assert.deepEqual(missing.missingVersions, ["20260102000100"]);
  assert.equal(missing.upToDate, false);

  const duplicate = evaluateMigrationHistory(["20260101000100"], ["20260101000100", "20260101000100"]);
  assert.deepEqual(duplicate.duplicateVersions, ["20260101000100"]);
  assert.equal(duplicate.upToDate, false);

  const stale = evaluateMigrationHistory(["20260101000100"], ["20260101000100", "20260102000100"]);
  assert.equal(stale.upToDate, false);
});

test("passes when the requested version is the sole, newest history entry", async () => {
  const queries: string[] = [];
  const result = await runMigrationPostcheck(config, ["20260101000100"], [], () => fakeSession(queries, ["20260101000100"]));
  assert.equal(result.upToDate, true);
  assert.deepEqual(result.summary, summary);
  assert.equal(queries[0], "BEGIN TRANSACTION READ ONLY");
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(queries.includes("COMMIT"), false);
});

test("exits with a rejection when a requested version is missing from history, and still rolls back", async () => {
  const queries: string[] = [];
  await assert.rejects(
    runMigrationPostcheck(config, ["20260102000100"], [], () => fakeSession(queries, ["20260101000100"])),
    (error: unknown) => {
      assert.ok(error instanceof MigrationPostcheckError);
      return true;
    },
  );
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("exits with a rejection when a requested version appears twice in history", async () => {
  const queries: string[] = [];
  await assert.rejects(
    runMigrationPostcheck(config, ["20260101000100"], [], () => fakeSession(queries, ["20260101000100", "20260101000100"])),
    (error: unknown) => {
      assert.ok(error instanceof MigrationPostcheckError);
      return true;
    },
  );
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("reports EXECUTE privileges for app_api/authenticated/owner on named functions", async () => {
  const queries: string[] = [];
  const result = await runMigrationPostcheck(
    config,
    ["20260101000100"],
    ["some_private_fn"],
    () => fakeSession(queries, ["20260101000100"], { appApi: true, authenticated: false, owner: true }),
  );
  assert.deepEqual(result.functionPrivileges, [
    { appApi: true, authenticated: false, functionName: "some_private_fn", owner: true },
  ]);
});

test("never leaks the connection string in a failure message", async () => {
  const queries: string[] = [];
  await assert.rejects(
    runMigrationPostcheck(config, ["20260101000100"], [], () => fakeSession(queries, ["20260101000100"], undefined, (sql) => {
      if (sql.includes("schema_migrations")) throw new Error("connection refused");
    })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(config.connectionString), false);
      return true;
    },
  );
  assert.equal(queries.at(-1), "ROLLBACK");
});
