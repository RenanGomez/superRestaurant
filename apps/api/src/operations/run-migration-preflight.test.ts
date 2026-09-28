import assert from "node:assert/strict";
import test from "node:test";

import {
  diffMigrationVersions,
  listLocalMigrationVersions,
  runMigrationPreflight,
  type MigrationPreflightResult,
} from "./run-migration-preflight.js";
import type { SchemaVerificationConfig, SchemaVerificationSession } from "./schema-verification.js";

const config: SchemaVerificationConfig = Object.freeze({
  caCertificate: "TEST CA",
  connectionString: "postgresql://redacted.invalid/postgres",
  expectedProjectRef: "test",
});

function fakeSession(
  queries: string[],
  remoteVersions: readonly string[],
  summary: { securedTables: number; policies: number; securityDefinerFunctions: number },
  onQuery?: (sql: string) => void,
): SchemaVerificationSession {
  return {
    async connect(): Promise<void> {},
    async query(sql: string): Promise<{ rows: readonly unknown[] }> {
      queries.push(sql);
      onQuery?.(sql);
      if (sql.includes("schema_migrations")) return { rows: remoteVersions.map((version) => ({ version })) };
      if (sql.includes("securedTables")) return { rows: [summary] };
      return { rows: [] };
    },
    async close(): Promise<void> {},
  };
}

test("diffMigrationVersions reports missing versions in both directions", () => {
  const diff = diffMigrationVersions(["20260101000100", "20260102000100"], ["20260101000100", "20250101000100"]);
  assert.deepEqual(diff.localMissingInRemote, ["20260102000100"]);
  assert.deepEqual(diff.remoteMissingLocally, ["20250101000100"]);
});

test("listLocalMigrationVersions reads only 14-digit sql version prefixes and sorts them", () => {
  const versions = listLocalMigrationVersions("supabase/migrations", () => [
    "20260101000100_a.sql",
    "20260102000100_b.sql",
    "README.md",
  ]);
  assert.deepEqual(versions, ["20260101000100", "20260102000100"]);
});

test("runs BEGIN TRANSACTION READ ONLY / ROLLBACK and returns the version diff plus summary", async () => {
  const queries: string[] = [];
  const summary = { policies: 5, securedTables: 5, securityDefinerFunctions: 4 };
  const result: MigrationPreflightResult = await runMigrationPreflight(
    config,
    ["20260101000100", "20260102000100"],
    () => fakeSession(queries, ["20260101000100"], summary),
  );
  assert.equal(result.lastRemote, "20260101000100");
  assert.deepEqual(result.localMissingInRemote, ["20260102000100"]);
  assert.deepEqual(result.remoteMissingLocally, []);
  assert.deepEqual(result.summary, summary);
  assert.equal(queries[0], "BEGIN TRANSACTION READ ONLY");
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(queries.includes("COMMIT"), false);
});

test("rolls back even when the history query fails, and never leaks the connection string", async () => {
  const queries: string[] = [];
  await assert.rejects(
    runMigrationPreflight(config, ["20260101000100"], () => fakeSession(queries, [], { policies: 0, securedTables: 0, securityDefinerFunctions: 0 }, (sql) => {
      if (sql.includes("schema_migrations")) throw new Error("connection lost");
    })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(config.connectionString), false);
      return true;
    },
  );
  assert.equal(queries.at(-1), "ROLLBACK");
});
