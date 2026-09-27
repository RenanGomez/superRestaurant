import assert from "node:assert/strict";
import test from "node:test";

import {
  MigrationRollbackProbeError,
  runMigrationRollbackProbe,
  type MigrationRollbackProbeSession,
} from "./run-migration-rollback-probe.js";
import type { SchemaVerificationConfig } from "./schema-verification.js";

const config: SchemaVerificationConfig = Object.freeze({
  caCertificate: "TEST CA",
  connectionString: "postgresql://redacted.invalid/postgres",
  expectedProjectRef: "test",
});

const migrationSql = `begin;
create table app.rollback_probe_fixture (id uuid primary key);
commit;
`;

function fakeSession(queries: string[], onQuery?: (sql: string) => void): MigrationRollbackProbeSession {
  return {
    async connect(): Promise<void> {},
    async query(sql: string): Promise<unknown> {
      queries.push(sql);
      onQuery?.(sql);
      return undefined;
    },
    async end(): Promise<void> {},
  };
}

test("runs each migration statement inside BEGIN/ROLLBACK and reports the statement count", async () => {
  const queries: string[] = [];
  const result = await runMigrationRollbackProbe(migrationSql, config, () => fakeSession(queries));
  assert.deepEqual(result, { statementCount: 1, status: "ok" });
  assert.deepEqual(queries, ["BEGIN", "create table app.rollback_probe_fixture (id uuid primary key)", "ROLLBACK"]);
});

test("reports the failing statement index, sqlState and message, then still rolls back", async () => {
  const queries: string[] = [];
  const failure = Object.assign(new Error("relation \"missing\" does not exist"), { code: "42P01" });
  await assert.rejects(
    runMigrationRollbackProbe(migrationSql, config, () => fakeSession(queries, (sql) => {
      if (sql.startsWith("create table")) throw failure;
    })),
    (error: unknown) => {
      assert.ok(error instanceof MigrationRollbackProbeError);
      assert.equal(error.stage, "migration");
      assert.equal(error.statementIndex, 1);
      assert.equal(error.sqlState, "42P01");
      assert.equal(error.message, "relation \"missing\" does not exist");
      return true;
    },
  );
  assert.deepEqual(queries, ["BEGIN", "create table app.rollback_probe_fixture (id uuid primary key)", "ROLLBACK"]);
});

test("never commits: ROLLBACK is unconditional even without a migration failure", async () => {
  const queries: string[] = [];
  await runMigrationRollbackProbe(migrationSql, config, () => fakeSession(queries));
  assert.equal(queries.includes("COMMIT"), false);
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("rejects a malformed migration body before ever connecting", async () => {
  await assert.rejects(
    runMigrationRollbackProbe("create table app.missing_wrapper (id uuid);", config, () => {
      throw new Error("MUST_NOT_CONNECT");
    }),
  );
});
