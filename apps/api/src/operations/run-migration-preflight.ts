import { existsSync, readdirSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPostgresSchemaVerificationSession,
  readReadOnlySchemaVerificationConfig,
  SUMMARY_SQL,
  type SchemaVerificationConfig,
  type SchemaVerificationSession,
} from "./schema-verification.js";

// Read-only preflight for a Supabase migration apply: reports which local migration files are
// missing from the remote history, which remote versions have no local file (expected for the
// historical ADR migrations that predate this repository layout), and a live catalog summary.
// Always BEGIN READ ONLY / ROLLBACK; never writes, never applies, never prints the connection URL.
export interface MigrationPreflightCatalogSummary {
  readonly policies: number;
  readonly securedTables: number;
  readonly securityDefinerFunctions: number;
}

export interface MigrationPreflightResult {
  readonly lastRemote: string | undefined;
  readonly localFiles: readonly string[];
  readonly localMissingInRemote: readonly string[];
  readonly remoteMissingLocally: readonly string[];
  readonly remoteVersions: readonly string[];
  readonly summary: MigrationPreflightCatalogSummary;
}

export class MigrationPreflightError extends Error {
  public readonly stage: "configuration" | "connect" | "begin" | "history" | "summary" | "rollback" | "close";

  public constructor(stage: MigrationPreflightError["stage"], message: string) {
    super(message);
    this.name = "MigrationPreflightError";
    this.stage = stage;
  }
}

const MIGRATION_VERSION_PATTERN = /^\d{14}$/u;

export function listLocalMigrationVersions(
  migrationsDirectory: string,
  readDirectory: (directory: string) => readonly string[] = (directory) => readdirSync(directory),
): readonly string[] {
  return readDirectory(migrationsDirectory)
    .filter((entry) => entry.endsWith(".sql"))
    .map((entry) => entry.slice(0, 14))
    .filter((version) => MIGRATION_VERSION_PATTERN.test(version))
    .sort();
}

/**
 * Resolves the `supabase/migrations` directory independent of the process cwd (running via
 * `pnpm --filter @super-restaurant/api run preflight:migrations` has apps/api as cwd, which has
 * no `supabase/migrations` of its own). An explicit `--migrations-dir` always wins; otherwise
 * walks up from `startDirectory` looking for the repo root marker `pnpm-workspace.yaml`.
 */
export function resolveMigrationsDirectory(
  explicitDirectory: string | undefined,
  startDirectory: string,
  exists: (path: string) => boolean = existsSync,
): string {
  if (explicitDirectory !== undefined) return resolve(explicitDirectory);

  let current = resolve(startDirectory);
  const { root } = parse(current);
  for (;;) {
    if (exists(join(current, "pnpm-workspace.yaml"))) return join(current, "supabase", "migrations");
    if (current === root) throw new MigrationPreflightError("configuration", "MIGRATION_PREFLIGHT_WORKSPACE_ROOT_NOT_FOUND");
    current = dirname(current);
  }
}

export function diffMigrationVersions(
  localVersions: readonly string[],
  remoteVersions: readonly string[],
): { readonly localMissingInRemote: readonly string[]; readonly remoteMissingLocally: readonly string[] } {
  const remoteSet = new Set(remoteVersions);
  const localSet = new Set(localVersions);
  return Object.freeze({
    localMissingInRemote: Object.freeze(localVersions.filter((version) => !remoteSet.has(version))),
    remoteMissingLocally: Object.freeze(remoteVersions.filter((version) => !localSet.has(version))),
  });
}

export async function runMigrationPreflight(
  config: SchemaVerificationConfig,
  localVersions: readonly string[],
  createSession: (config: SchemaVerificationConfig) => SchemaVerificationSession = createPostgresSchemaVerificationSession,
): Promise<MigrationPreflightResult> {
  const session = createSession(config);
  let stage: MigrationPreflightError["stage"] = "connect";
  let transactionStarted = false;
  let result: MigrationPreflightResult | undefined;
  let failure: MigrationPreflightError | undefined;

  try {
    await session.connect();
    stage = "begin";
    await session.query("BEGIN TRANSACTION READ ONLY");
    transactionStarted = true;

    stage = "history";
    const historyResult = await session.query(
      "select version from supabase_migrations.schema_migrations order by version",
    );
    const remoteVersions = historyResult.rows.map((row) => readVersion(row));
    const diff = diffMigrationVersions(localVersions, remoteVersions);

    stage = "summary";
    const summaryResult = await session.query(SUMMARY_SQL);
    const summary = readCatalogSummary(summaryResult.rows[0]);

    result = Object.freeze({
      lastRemote: remoteVersions.at(-1),
      localFiles: Object.freeze([...localVersions]),
      localMissingInRemote: diff.localMissingInRemote,
      remoteMissingLocally: diff.remoteMissingLocally,
      remoteVersions: Object.freeze(remoteVersions),
      summary,
    });
  } catch (error: unknown) {
    failure = error instanceof MigrationPreflightError ? error : toPreflightError(stage, error);
  } finally {
    try {
      await session.query("ROLLBACK");
    } catch {
      if (transactionStarted || failure === undefined) {
        failure = new MigrationPreflightError("rollback", "MIGRATION_PREFLIGHT_ROLLBACK_FAILED");
      }
    }
    try {
      await session.close();
    } catch {
      if (failure === undefined) failure = new MigrationPreflightError("close", "MIGRATION_PREFLIGHT_CLOSE_FAILED");
    }
  }

  if (failure !== undefined) throw failure;
  if (result === undefined) throw new MigrationPreflightError("summary", "MIGRATION_PREFLIGHT_SUMMARY_MISSING");
  return result;
}

function readVersion(row: unknown): string {
  if (typeof row !== "object" || row === null || !("version" in row)) throw new MigrationPreflightError("history", "MIGRATION_PREFLIGHT_HISTORY_ROW_REJECTED");
  const version = (row as { version: unknown }).version;
  if (typeof version !== "string" || !MIGRATION_VERSION_PATTERN.test(version)) {
    throw new MigrationPreflightError("history", "MIGRATION_PREFLIGHT_HISTORY_ROW_REJECTED");
  }
  return version;
}

function readCatalogSummary(row: unknown): MigrationPreflightCatalogSummary {
  if (
    typeof row !== "object" || row === null ||
    typeof (row as Record<string, unknown>).securedTables !== "number" ||
    typeof (row as Record<string, unknown>).policies !== "number" ||
    typeof (row as Record<string, unknown>).securityDefinerFunctions !== "number"
  ) {
    throw new MigrationPreflightError("summary", "MIGRATION_PREFLIGHT_SUMMARY_REJECTED");
  }
  const record = row as MigrationPreflightCatalogSummary;
  return Object.freeze({
    policies: record.policies,
    securedTables: record.securedTables,
    securityDefinerFunctions: record.securityDefinerFunctions,
  });
}

function toPreflightError(stage: MigrationPreflightError["stage"], error: unknown): MigrationPreflightError {
  const message = error instanceof Error ? error.message : "MIGRATION_PREFLIGHT_FAILED";
  return new MigrationPreflightError(stage, message);
}

function parseCliArguments(argv: readonly string[]): { readonly migrationsDirectory: string | undefined } {
  const index = argv.indexOf("--migrations-dir");
  if (index === -1) return Object.freeze({ migrationsDirectory: undefined });
  const value = argv[index + 1];
  if (typeof value !== "string" || value.length === 0) {
    throw new MigrationPreflightError("configuration", "MIGRATION_PREFLIGHT_MIGRATIONS_DIR_VALUE_REQUIRED");
  }
  return Object.freeze({ migrationsDirectory: value });
}

async function main(): Promise<void> {
  const { migrationsDirectory } = parseCliArguments(process.argv.slice(2));
  const config = readReadOnlySchemaVerificationConfig(process.env);
  const migrationsDir = resolveMigrationsDirectory(migrationsDirectory, dirname(fileURLToPath(import.meta.url)));
  const localVersions = listLocalMigrationVersions(migrationsDir);
  const result = await runMigrationPreflight(config, localVersions);
  process.stdout.write(`${JSON.stringify({ stage: "migration_preflight", ...result })}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const preflightError = error instanceof MigrationPreflightError ? error : toPreflightError("configuration", error);
    process.stderr.write(`${JSON.stringify({ stage: preflightError.stage, status: "failed", message: preflightError.message })}\n`);
    process.exitCode = 1;
  });
}
