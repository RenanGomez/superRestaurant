import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import { extractMigrationStatements, readSchemaVerificationConfig, type SchemaVerificationConfig } from "./schema-verification.js";

// Generic, migration-agnostic rollback-only probe. Runs BEGIN, one statement at a time from
// `extractMigrationStatements`, reports the first failure with its statement index/sqlState/message,
// and always issues ROLLBACK, success or failure. Never commits and never prints the connection
// URL/credentials. Intended for local PG17 (`SCHEMA_VERIFICATION_LOCAL_CLUSTER=1`) rehearsal and,
// once authorized per AGENTS.md 3.1, remote rollback-only inspection of a candidate migration --
// never an apply.
export interface MigrationRollbackProbeResult {
  readonly statementCount: number;
  readonly status: "ok";
}

export class MigrationRollbackProbeError extends Error {
  public readonly sqlState: string | undefined;
  public readonly stage: "configuration" | "connect" | "begin" | "migration" | "rollback" | "close";
  public readonly statementIndex: number | undefined;

  public constructor(
    stage: MigrationRollbackProbeError["stage"],
    message: string,
    diagnostics: { readonly sqlState?: string; readonly statementIndex?: number } = {},
  ) {
    super(message);
    this.name = "MigrationRollbackProbeError";
    this.sqlState = diagnostics.sqlState;
    this.stage = stage;
    this.statementIndex = diagnostics.statementIndex;
  }
}

function createProbeClient(config: SchemaVerificationConfig): Client {
  return new Client({
    application_name: "super-restaurant-migration-rollback-probe",
    connectionTimeoutMillis: 15_000,
    connectionString: config.connectionString,
    query_timeout: 120_000,
    ssl: config.caCertificate.length === 0 ? false : { ca: config.caCertificate, rejectUnauthorized: true },
    statement_timeout: 120_000,
  });
}

export async function runMigrationRollbackProbe(
  migrationSql: string,
  config: SchemaVerificationConfig,
  createClient: (config: SchemaVerificationConfig) => Client = createProbeClient,
): Promise<MigrationRollbackProbeResult> {
  const statements = extractMigrationStatements(migrationSql);
  const client = createClient(config);
  let stage: MigrationRollbackProbeError["stage"] = "connect";
  let statementIndex: number | undefined;
  let transactionStarted = false;
  let failure: MigrationRollbackProbeError | undefined;

  try {
    await client.connect();
    stage = "begin";
    await client.query("BEGIN");
    transactionStarted = true;

    stage = "migration";
    for (const [index, statement] of statements.entries()) {
      statementIndex = index + 1;
      await client.query(statement);
    }
    statementIndex = undefined;
  } catch (error: unknown) {
    failure = failure ?? toProbeError(stage, error, statementIndex);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      if (transactionStarted || failure === undefined) {
        failure = new MigrationRollbackProbeError("rollback", "MIGRATION_ROLLBACK_PROBE_ROLLBACK_FAILED");
      }
    }
    try {
      await client.end();
    } catch {
      if (failure === undefined) failure = new MigrationRollbackProbeError("close", "MIGRATION_ROLLBACK_PROBE_CLOSE_FAILED");
    }
  }

  if (failure !== undefined) throw failure;
  return Object.freeze({ statementCount: statements.length, status: "ok" as const });
}

function toProbeError(
  stage: MigrationRollbackProbeError["stage"],
  error: unknown,
  statementIndex: number | undefined,
): MigrationRollbackProbeError {
  const sqlState = typeof error === "object" && error !== null && "code" in error
    && typeof (error as { code?: unknown }).code === "string" && /^[0-9A-Z]{5}$/u.test((error as { code: string }).code)
    ? (error as { code: string }).code
    : undefined;
  const message = error instanceof Error ? error.message : "MIGRATION_ROLLBACK_PROBE_FAILED";
  return new MigrationRollbackProbeError(stage, message, { sqlState, statementIndex });
}

async function main(): Promise<void> {
  const migrationArgument = process.argv[2];
  if (typeof migrationArgument !== "string" || migrationArgument.length === 0 || migrationArgument.length > 4_096) {
    throw new MigrationRollbackProbeError("configuration", "MIGRATION_ROLLBACK_PROBE_PATH_REQUIRED");
  }
  const migrationPath = resolve(migrationArgument);
  if (!/[\\/]supabase[\\/]migrations[\\/][0-9]{14}_[a-z0-9_]+\.sql$/u.test(migrationPath.replaceAll("\\", "/"))) {
    throw new MigrationRollbackProbeError("configuration", "MIGRATION_ROLLBACK_PROBE_PATH_REJECTED");
  }
  let migrationSql: string;
  try {
    migrationSql = readFileSync(migrationPath, "utf8");
  } catch {
    throw new MigrationRollbackProbeError("configuration", "MIGRATION_ROLLBACK_PROBE_PATH_UNREADABLE");
  }
  const config = readSchemaVerificationConfig(process.env);
  const result = await runMigrationRollbackProbe(migrationSql, config);
  process.stdout.write(`${JSON.stringify({ stage: "migration_rollback_probe", ...result })}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const probeError = error instanceof MigrationRollbackProbeError ? error : toProbeError("configuration", error, undefined);
    process.stderr.write(`${JSON.stringify({
      stage: probeError.stage,
      status: "failed",
      message: probeError.message,
      ...(probeError.sqlState === undefined ? {} : { sqlState: probeError.sqlState }),
      ...(probeError.statementIndex === undefined ? {} : { statementIndex: probeError.statementIndex }),
    })}\n`);
    process.exitCode = 1;
  });
}
