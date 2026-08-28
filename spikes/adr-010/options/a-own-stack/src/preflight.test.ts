import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { OwnStackPostgresAdr010Adapter, parseBackupForRestore } from "./adapter.js";
import { OwnStackAdr010ConfigurationError, readOwnStackAdr010ServerConfig, requireOwnStackIntegrationOptIn } from "./config.js";

const optionRoot = path.resolve(process.cwd(), "options", "a-own-stack");

test("[preflight/non-evidence] option-A configuration is server-only and opt-in", () => {
  assert.throws(() => readOwnStackAdr010ServerConfig({}), OwnStackAdr010ConfigurationError);
  assert.throws(
    () => readOwnStackAdr010ServerConfig({ ADR010_DATABASE_URL: "https://not-postgres.example" }),
    OwnStackAdr010ConfigurationError,
  );
  assert.throws(
    () => requireOwnStackIntegrationOptIn({ ADR010_DATABASE_URL: "postgresql://localhost/isolated" }),
    OwnStackAdr010ConfigurationError,
  );
  assert.deepEqual(readOwnStackAdr010ServerConfig({ ADR010_DATABASE_URL: "postgresql://localhost/isolated" }), {
    databaseUrl: "postgresql://localhost/isolated",
  });
});

test("[preflight/non-evidence] the adapter is PostgreSQL-backed and reports no client environment", async () => {
  assert.equal(OwnStackPostgresAdr010Adapter.prototype.option, undefined);
  assert.equal(typeof OwnStackPostgresAdr010Adapter.prototype.migrateFromEmpty, "function");
  assert.equal(typeof OwnStackPostgresAdr010Adapter.prototype.backup, "function");

  const source = await readFile(path.join(optionRoot, "src", "adapter.ts"), "utf8");
  assert.ok(source.includes('from "pg"'));
  assert.ok(source.includes("implements Adr010Adapter"));
  assert.ok(source.includes("create_order"));
  assert.equal(source.includes("new Map("), false);
});

test("[preflight/non-evidence] migration declares one transactional critical function with tenant-scoped idempotency", async () => {
  const sql = await readFile(path.join(optionRoot, "migrations", "0001_adr010_a_thin_slice.sql"), "utf8");
  assert.ok(sql.includes("create or replace function adr010_a.create_order"));
  assert.ok(sql.includes("for update"));
  assert.ok(sql.includes("v_session.revoked_at is not null"));
  assert.ok(sql.includes("unique (restaurant_id, branch_id, idempotency_key)"));
  assert.ok(sql.includes("raise exception 'INDUCED_WRITE_FAILURE'"));
});

test("[preflight/non-evidence] restore rejects backup-controlled SQL identifiers and partial shapes", () => {
  const valid = {
    kind: "adr010-a-logical-backup-v1",
    tables: {
      restaurants: [], branches: [], sessions: [], orders: [], order_lines: [], line_snapshots: [], audit_log: [], kds_events: [],
    },
  };
  assert.doesNotThrow(() => parseBackupForRestore(valid));
  assert.throws(() => parseBackupForRestore({ ...valid, tables: { ...valid.tables, "orders); drop schema public; --": [] } }));
  assert.throws(() => parseBackupForRestore({ ...valid, tables: { ...valid.tables, orders: [{ id: "x", "id); drop table adr010_a.orders; --": "x" }] } }));
});

test("[preflight/non-evidence] restore uses fixed table and column allowlists, not backup keys", async () => {
  const source = await readFile(path.join(optionRoot, "src", "adapter.ts"), "utf8");
  assert.ok(source.includes("const backupTableColumns"));
  assert.ok(source.includes("const values = columns.map((column) => row[column])"));
  assert.equal(source.includes("const entries = Object.entries(row)"), false);
  assert.equal(source.includes("on conflict do nothing", source.indexOf("const insertBackupRow")), false);
});
