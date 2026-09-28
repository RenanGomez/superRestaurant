import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPostgresSchemaVerificationSession,
  readReadOnlySchemaVerificationConfig,
  SUMMARY_SQL,
  type SchemaVerificationConfig,
  type SchemaVerificationSession,
} from "./schema-verification.js";

// Read-only postcheck after a Supabase migration apply: confirms every requested version appears
// exactly once in the remote history and that the newest applied version is the greatest one
// requested, prints the catalog summary, and optionally reports EXECUTE privilege on named
// app_private functions for app_api/authenticated/the function owner. Always
// BEGIN TRANSACTION READ ONLY / ROLLBACK; never writes, never prints the connection URL.
export interface MigrationPostcheckCatalogSummary {
  readonly policies: number;
  readonly securedTables: number;
  readonly securityDefinerFunctions: number;
}

export interface MigrationPostcheckFunctionPrivileges {
  readonly appApi: boolean;
  readonly authenticated: boolean;
  readonly functionName: string;
  readonly owner: boolean;
}

export interface MigrationPostcheckResult {
  readonly duplicateVersions: readonly string[];
  readonly functionPrivileges: readonly MigrationPostcheckFunctionPrivileges[];
  readonly lastRemote: string | undefined;
  readonly missingVersions: readonly string[];
  readonly requestedVersions: readonly string[];
  readonly summary: MigrationPostcheckCatalogSummary;
  readonly upToDate: boolean;
}

export type MigrationPostcheckCode =
  | "MIGRATION_POSTCHECK_VERSIONS_REQUIRED"
  | "MIGRATION_POSTCHECK_FUNCTION_NAME_REJECTED"
  | "MIGRATION_POSTCHECK_FUNCTIONS_VALUE_REQUIRED"
  | "MIGRATION_POSTCHECK_HISTORY_MISMATCH"
  | "MIGRATION_POSTCHECK_NOT_LATEST"
  | "MIGRATION_POSTCHECK_HISTORY_ROW_REJECTED"
  | "MIGRATION_POSTCHECK_FUNCTION_NOT_FOUND"
  | "MIGRATION_POSTCHECK_SUMMARY_REJECTED"
  | "MIGRATION_POSTCHECK_SUMMARY_MISSING"
  | "MIGRATION_POSTCHECK_ROLLBACK_FAILED"
  | "MIGRATION_POSTCHECK_CLOSE_FAILED"
  | "MIGRATION_POSTCHECK_FAILED";

export class MigrationPostcheckError extends Error {
  public readonly code: MigrationPostcheckCode;
  public readonly stage:
    | "configuration"
    | "connect"
    | "begin"
    | "history"
    | "privileges"
    | "summary"
    | "rollback"
    | "close";

  public constructor(stage: MigrationPostcheckError["stage"], code: MigrationPostcheckCode) {
    super(code);
    this.name = "MigrationPostcheckError";
    this.code = code;
    this.stage = stage;
  }
}

const MIGRATION_VERSION_PATTERN = /^\d{14}$/u;
const FUNCTION_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/u;

export function evaluateMigrationHistory(
  requestedVersions: readonly string[],
  remoteVersions: readonly string[],
): { readonly duplicateVersions: readonly string[]; readonly missingVersions: readonly string[]; readonly upToDate: boolean } {
  const counts = new Map<string, number>();
  for (const version of remoteVersions) counts.set(version, (counts.get(version) ?? 0) + 1);

  const missingVersions = requestedVersions.filter((version) => !counts.has(version));
  const duplicateVersions = requestedVersions.filter((version) => (counts.get(version) ?? 0) > 1);
  const lastRemote = remoteVersions.at(-1);
  const greatestRequested = [...requestedVersions].sort().at(-1);
  const upToDate = missingVersions.length === 0
    && duplicateVersions.length === 0
    && greatestRequested !== undefined
    && lastRemote === greatestRequested;

  return Object.freeze({
    duplicateVersions: Object.freeze(duplicateVersions),
    missingVersions: Object.freeze(missingVersions),
    upToDate,
  });
}

export async function runMigrationPostcheck(
  config: SchemaVerificationConfig,
  requestedVersions: readonly string[],
  functionNames: readonly string[],
  createSession: (config: SchemaVerificationConfig) => SchemaVerificationSession = createPostgresSchemaVerificationSession,
): Promise<MigrationPostcheckResult> {
  if (requestedVersions.length === 0 || requestedVersions.some((version) => !MIGRATION_VERSION_PATTERN.test(version))) {
    throw new MigrationPostcheckError("configuration", "MIGRATION_POSTCHECK_VERSIONS_REQUIRED");
  }
  if (functionNames.some((name) => !FUNCTION_NAME_PATTERN.test(name))) {
    throw new MigrationPostcheckError("configuration", "MIGRATION_POSTCHECK_FUNCTION_NAME_REJECTED");
  }

  const session = createSession(config);
  let stage: MigrationPostcheckError["stage"] = "connect";
  let transactionStarted = false;
  let result: MigrationPostcheckResult | undefined;
  let failure: MigrationPostcheckError | undefined;

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
    const history = evaluateMigrationHistory(requestedVersions, remoteVersions);

    stage = "privileges";
    const functionPrivileges: MigrationPostcheckFunctionPrivileges[] = [];
    for (const functionName of functionNames) {
      functionPrivileges.push(await readFunctionPrivileges(session, functionName));
    }

    stage = "summary";
    const summaryResult = await session.query(SUMMARY_SQL);
    const summary = readCatalogSummary(summaryResult.rows[0]);

    result = Object.freeze({
      duplicateVersions: history.duplicateVersions,
      functionPrivileges: Object.freeze(functionPrivileges),
      lastRemote: remoteVersions.at(-1),
      missingVersions: history.missingVersions,
      requestedVersions: Object.freeze([...requestedVersions]),
      summary,
      upToDate: history.upToDate,
    });

    if (history.missingVersions.length > 0 || history.duplicateVersions.length > 0) {
      throw new MigrationPostcheckError("history", "MIGRATION_POSTCHECK_HISTORY_MISMATCH");
    }
    if (!history.upToDate) {
      throw new MigrationPostcheckError("history", "MIGRATION_POSTCHECK_NOT_LATEST");
    }
  } catch (error: unknown) {
    failure = error instanceof MigrationPostcheckError ? error : toPostcheckError(stage);
  } finally {
    try {
      await session.query("ROLLBACK");
    } catch {
      if (transactionStarted || failure === undefined) {
        failure = new MigrationPostcheckError("rollback", "MIGRATION_POSTCHECK_ROLLBACK_FAILED");
      }
    }
    try {
      await session.close();
    } catch {
      if (failure === undefined) failure = new MigrationPostcheckError("close", "MIGRATION_POSTCHECK_CLOSE_FAILED");
    }
  }

  if (failure !== undefined) throw failure;
  if (result === undefined) throw new MigrationPostcheckError("summary", "MIGRATION_POSTCHECK_SUMMARY_MISSING");
  return result;
}

async function readFunctionPrivileges(
  session: SchemaVerificationSession,
  functionName: string,
): Promise<MigrationPostcheckFunctionPrivileges> {
  const privilegesResult = await session.query(
    `
select
  has_function_privilege('app_api', p.oid, 'EXECUTE') as "appApi",
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as "authenticated",
  has_function_privilege(o.rolname, p.oid, 'EXECUTE') as "owner"
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
join pg_catalog.pg_roles as o on o.oid = p.proowner
where n.nspname = 'app_private' and p.proname = $1
limit 1
`,
    [functionName],
  );
  const row = privilegesResult.rows[0];
  if (
    typeof row !== "object" || row === null ||
    typeof (row as Record<string, unknown>).appApi !== "boolean" ||
    typeof (row as Record<string, unknown>).authenticated !== "boolean" ||
    typeof (row as Record<string, unknown>).owner !== "boolean"
  ) {
    throw new MigrationPostcheckError("privileges", "MIGRATION_POSTCHECK_FUNCTION_NOT_FOUND");
  }
  const record = row as Pick<MigrationPostcheckFunctionPrivileges, "appApi" | "authenticated" | "owner">;
  return Object.freeze({
    appApi: record.appApi,
    authenticated: record.authenticated,
    functionName,
    owner: record.owner,
  });
}

function readVersion(row: unknown): string {
  if (typeof row !== "object" || row === null || !("version" in row)) throw new MigrationPostcheckError("history", "MIGRATION_POSTCHECK_HISTORY_ROW_REJECTED");
  const version = (row as { version: unknown }).version;
  if (typeof version !== "string" || !MIGRATION_VERSION_PATTERN.test(version)) {
    throw new MigrationPostcheckError("history", "MIGRATION_POSTCHECK_HISTORY_ROW_REJECTED");
  }
  return version;
}

function readCatalogSummary(row: unknown): MigrationPostcheckCatalogSummary {
  if (
    typeof row !== "object" || row === null ||
    typeof (row as Record<string, unknown>).securedTables !== "number" ||
    typeof (row as Record<string, unknown>).policies !== "number" ||
    typeof (row as Record<string, unknown>).securityDefinerFunctions !== "number"
  ) {
    throw new MigrationPostcheckError("summary", "MIGRATION_POSTCHECK_SUMMARY_REJECTED");
  }
  const record = row as MigrationPostcheckCatalogSummary;
  return Object.freeze({
    policies: record.policies,
    securedTables: record.securedTables,
    securityDefinerFunctions: record.securityDefinerFunctions,
  });
}

function toPostcheckError(stage: MigrationPostcheckError["stage"]): MigrationPostcheckError {
  return new MigrationPostcheckError(stage, "MIGRATION_POSTCHECK_FAILED");
}

function parseCliArguments(argv: readonly string[]): { readonly functionNames: readonly string[]; readonly versions: readonly string[] } {
  const versions: string[] = [];
  let functionNames: readonly string[] = [];
  let index = 0;
  while (index < argv.length) {
    const argument = argv[index];
    if (argument === "--functions") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.length === 0) {
        throw new MigrationPostcheckError("configuration", "MIGRATION_POSTCHECK_FUNCTIONS_VALUE_REQUIRED");
      }
      functionNames = value.split(",").map((name) => name.trim()).filter((name) => name.length > 0);
      index += 2;
      continue;
    }
    if (typeof argument === "string" && argument.length > 0) versions.push(argument);
    index += 1;
  }
  return Object.freeze({ functionNames, versions: Object.freeze(versions) });
}

async function main(): Promise<void> {
  const { functionNames, versions } = parseCliArguments(process.argv.slice(2));
  const config = readReadOnlySchemaVerificationConfig(process.env);
  const result = await runMigrationPostcheck(config, versions, functionNames);
  process.stdout.write(`${JSON.stringify({ stage: "migration_postcheck", ...result })}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const postcheckError = error instanceof MigrationPostcheckError ? error : toPostcheckError("configuration");
    process.stderr.write(`${JSON.stringify({ code: postcheckError.code, stage: postcheckError.stage, status: "failed", message: postcheckError.message })}\n`);
    process.exitCode = 1;
  });
}
