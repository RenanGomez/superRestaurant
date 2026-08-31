import { Client, type QueryResult, type QueryResultRow } from "pg";

import { loadAndValidateCaCertificate } from "../database.js";

const FORBIDDEN_PROJECT_REF = "cxcnnhafchqslvgvkeye";
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const CONFIRMATION = "ROLLBACK_ONLY";

const SUMMARY_SQL = `
select
  (
    select count(*)::integer
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relname in ('roles', 'restaurants', 'branches', 'memberships', 'membership_role_grants')
      and c.relrowsecurity
      and c.relforcerowsecurity
  ) as "securedTables",
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'app'
  ) as "policies",
  (
    select count(*)::integer
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('app_rls', 'has_active_restaurant_membership'),
      ('app_rls', 'has_active_branch_membership'),
      ('app_rls', 'can_read_membership'),
      ('app_private', 'find_active_branch_membership'),
      ('app_private', 'list_active_branch_memberships')
    )
      and p.prosecdef
  ) as "securityDefinerFunctions"
`;

export type SchemaVerificationStage =
  | "configuration"
  | "migration"
  | "connect"
  | "begin"
  | "catalog_audit"
  | "summary"
  | "rollback"
  | "close";

export type SchemaVerificationCode =
  | "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED"
  | "SCHEMA_VERIFICATION_SQL_REJECTED"
  | "SCHEMA_VERIFICATION_CONNECT_FAILED"
  | "SCHEMA_VERIFICATION_BEGIN_FAILED"
  | "SCHEMA_VERIFICATION_MIGRATION_FAILED"
  | "SCHEMA_VERIFICATION_CATALOG_AUDIT_FAILED"
  | "SCHEMA_VERIFICATION_SUMMARY_FAILED"
  | "SCHEMA_VERIFICATION_SUMMARY_REJECTED"
  | "SCHEMA_VERIFICATION_ROLLBACK_FAILED"
  | "SCHEMA_VERIFICATION_CLOSE_FAILED";

export class SchemaVerificationError extends Error {
  public readonly code: SchemaVerificationCode;
  public readonly stage: SchemaVerificationStage;

  public constructor(stage: SchemaVerificationStage, code: SchemaVerificationCode) {
    super(code);
    this.name = "SchemaVerificationError";
    this.code = code;
    this.stage = stage;
  }
}

export interface SchemaVerificationConfig {
  readonly caCertificate: string;
  readonly connectionString: string;
  readonly expectedProjectRef: string;
}

export interface SchemaVerificationQueryResult {
  readonly rows: readonly unknown[];
}

export interface SchemaVerificationSession {
  connect(): Promise<void>;
  query(sql: string): Promise<SchemaVerificationQueryResult>;
  close(): Promise<void>;
}

export interface SchemaVerificationSummary {
  readonly policies: 5;
  readonly securedTables: 5;
  readonly securityDefinerFunctions: 4 | 5;
}

export interface RunSchemaVerificationOptions {
  readonly catalogAuditSql: string;
  readonly config: SchemaVerificationConfig;
  readonly createSession?: (config: SchemaVerificationConfig) => SchemaVerificationSession;
  readonly expectedSecurityDefinerFunctions?: 4 | 5;
  readonly migrationSql: string;
}

type CertificateLoader = (path: string) => string;

export function readSchemaVerificationConfig(
  environment: NodeJS.ProcessEnv,
  certificateLoader: CertificateLoader = loadAndValidateCaCertificate,
): SchemaVerificationConfig {
  const confirmation = boundedValue(environment.SCHEMA_VERIFICATION_CONFIRMATION, 64);
  const expectedProjectRef = boundedValue(environment.SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF, 64);
  const rawUrl = boundedValue(environment.SCHEMA_VERIFICATION_DATABASE_URL, 8_192);
  const certificatePath = boundedValue(environment.SCHEMA_VERIFICATION_CA_CERT_PATH, 1_024);

  if (
    confirmation !== CONFIRMATION ||
    expectedProjectRef === undefined ||
    !PROJECT_REF_PATTERN.test(expectedProjectRef) ||
    expectedProjectRef === FORBIDDEN_PROJECT_REF ||
    rawUrl === undefined ||
    certificatePath === undefined
  ) {
    throw configurationError();
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw configurationError();
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hash.length !== 0 ||
    parsed.password.length === 0 ||
    parsed.pathname !== "/postgres" ||
    !isExpectedAdministrativeTarget(parsed, expectedProjectRef) ||
    [...parsed.searchParams.keys()].some((key) => key !== "sslmode") ||
    parsed.searchParams.getAll("sslmode").length !== 1 ||
    parsed.searchParams.get("sslmode")?.toLowerCase() !== "verify-full"
  ) {
    throw configurationError();
  }

  let caCertificate: string;
  try {
    caCertificate = certificateLoader(certificatePath);
  } catch {
    throw configurationError();
  }
  if (typeof caCertificate !== "string" || caCertificate.length === 0 || caCertificate.length > 65_536) {
    throw configurationError();
  }

  // node-postgres replaces an explicit SSL object when sslmode remains in the URL.
  // Validation happens first; only then is the driver-only copy stripped.
  parsed.search = "";
  return Object.freeze({ caCertificate, connectionString: parsed.toString(), expectedProjectRef });
}

export function extractMigrationBody(migrationSql: string): string {
  return `${extractMigrationStatements(migrationSql).join(";\n")};`;
}

export function extractMigrationStatements(migrationSql: string): readonly string[] {
  const statements = splitTopLevelStatements(migrationSql);
  if (statements.length < 3 || normalizedSql(statements[0] ?? "") !== "BEGIN" || normalizedSql(statements.at(-1) ?? "") !== "COMMIT") {
    throw sqlError();
  }

  const bodyStatements = statements.slice(1, -1);
  if (bodyStatements.some(isTransactionControlStatement)) throw sqlError();
  return Object.freeze([...bodyStatements]);
}

export function validateCatalogAuditSql(catalogAuditSql: string): string {
  let statements: string[];
  try {
    statements = splitTopLevelStatements(catalogAuditSql);
  } catch {
    throw catalogAuditSqlError();
  }
  if (statements.length === 0 || statements.some(isTransactionControlStatement)) throw catalogAuditSqlError();
  return `${statements.join(";\n")};`;
}

export async function runSchemaVerification(options: RunSchemaVerificationOptions): Promise<SchemaVerificationSummary> {
  const expectedSecurityDefinerFunctions = options.expectedSecurityDefinerFunctions ?? 4;
  if (expectedSecurityDefinerFunctions !== 4 && expectedSecurityDefinerFunctions !== 5) {
    throw configurationError();
  }
  const migrationBody = extractMigrationBody(options.migrationSql);
  const catalogAudit = validateCatalogAuditSql(options.catalogAuditSql);
  const session = (options.createSession ?? createPostgresSchemaVerificationSession)(options.config);

  let stage: SchemaVerificationStage = "connect";
  let transactionStarted = false;
  let result: SchemaVerificationSummary | undefined;
  let failure: SchemaVerificationError | undefined;

  try {
    await session.connect();
    stage = "begin";
    await session.query("BEGIN");
    transactionStarted = true;

    stage = "migration";
    await session.query(migrationBody);

    stage = "catalog_audit";
    await session.query(catalogAudit);

    stage = "summary";
    const summaryResult = await session.query(SUMMARY_SQL);
    result = readSummary(summaryResult.rows, expectedSecurityDefinerFunctions);
  } catch (error: unknown) {
    failure = error instanceof SchemaVerificationError ? error : executionError(stage);
  } finally {
    try {
      await session.query("ROLLBACK");
    } catch {
      if (transactionStarted || failure === undefined) {
        failure = new SchemaVerificationError("rollback", "SCHEMA_VERIFICATION_ROLLBACK_FAILED");
      }
    }

    try {
      await session.close();
    } catch {
      if (failure === undefined) {
        failure = new SchemaVerificationError("close", "SCHEMA_VERIFICATION_CLOSE_FAILED");
      }
    }
  }

  if (failure !== undefined) throw failure;
  if (result === undefined) throw new SchemaVerificationError("summary", "SCHEMA_VERIFICATION_SUMMARY_REJECTED");
  return result;
}

class PostgresSchemaVerificationSession implements SchemaVerificationSession {
  readonly #client: Client;

  public constructor(config: SchemaVerificationConfig) {
    this.#client = new Client({
      application_name: "super-restaurant-schema-rollback-verifier",
      connectionTimeoutMillis: 5_000,
      connectionString: config.connectionString,
      query_timeout: 120_000,
      ssl: { ca: config.caCertificate, rejectUnauthorized: true },
      statement_timeout: 120_000,
    });
  }

  public async connect(): Promise<void> {
    await this.#client.connect();
  }

  public async query(sql: string): Promise<SchemaVerificationQueryResult> {
    const queryResult = await this.#client.query<QueryResultRow>(sql) as
      | QueryResult<QueryResultRow>
      | QueryResult<QueryResultRow>[];
    const results = Array.isArray(queryResult) ? queryResult : [queryResult];
    return Object.freeze({
      rows: Object.freeze(results.flatMap((result) => [...result.rows])),
    });
  }

  public async close(): Promise<void> {
    await this.#client.end();
  }
}

function createPostgresSchemaVerificationSession(config: SchemaVerificationConfig): SchemaVerificationSession {
  return new PostgresSchemaVerificationSession(config);
}

function readSummary(
  rows: readonly unknown[],
  expectedSecurityDefinerFunctions: 4 | 5,
): SchemaVerificationSummary {
  const row = rows[0];
  if (
    !isPlainRecord(row)
    || Reflect.ownKeys(row).length !== 3
    || row.securedTables !== 5
    || row.policies !== 5
    || row.securityDefinerFunctions !== expectedSecurityDefinerFunctions
  ) {
    throw new SchemaVerificationError("summary", "SCHEMA_VERIFICATION_SUMMARY_REJECTED");
  }
  return Object.freeze({
    policies: 5,
    securedTables: 5,
    securityDefinerFunctions: expectedSecurityDefinerFunctions,
  });
}

function splitTopLevelStatements(sql: string): string[] {
  if (typeof sql !== "string" || sql.length === 0 || sql.length > 1_000_000) throw sqlError();

  const statements: string[] = [];
  let start = 0;
  let index = 0;
  let state: "normal" | "single" | "double" | "line_comment" | "block_comment" | "dollar" = "normal";
  let blockDepth = 0;
  let dollarTag = "";

  while (index < sql.length) {
    const current = sql[index] ?? "";
    const next = sql[index + 1] ?? "";

    if (state === "line_comment") {
      if (current === "\n" || current === "\r") state = "normal";
      index += 1;
      continue;
    }
    if (state === "block_comment") {
      if (current === "/" && next === "*") {
        blockDepth += 1;
        index += 2;
      } else if (current === "*" && next === "/") {
        blockDepth -= 1;
        index += 2;
        if (blockDepth === 0) state = "normal";
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "dollar") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        state = "normal";
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "single") {
      if (current === "'" && next === "'") index += 2;
      else if (current === "\\") index += Math.min(2, sql.length - index);
      else {
        if (current === "'") state = "normal";
        index += 1;
      }
      continue;
    }
    if (state === "double") {
      if (current === '"' && next === '"') index += 2;
      else {
        if (current === '"') state = "normal";
        index += 1;
      }
      continue;
    }

    if (current === "-" && next === "-") {
      state = "line_comment";
      index += 2;
    } else if (current === "/" && next === "*") {
      state = "block_comment";
      blockDepth = 1;
      index += 2;
    } else if (current === "'") {
      state = "single";
      index += 1;
    } else if (current === '"') {
      state = "double";
      index += 1;
    } else if (current === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(index))?.[0];
      if (tag === undefined) index += 1;
      else {
        state = "dollar";
        dollarTag = tag;
        index += tag.length;
      }
    } else if (current === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement.length > 0) statements.push(statement);
      start = index + 1;
      index += 1;
    } else {
      index += 1;
    }
  }

  if (state !== "normal" && state !== "line_comment") throw sqlError();
  const trailing = sql.slice(start).trim();
  if (removeComments(trailing).trim().length > 0) statements.push(trailing);
  return statements;
}

function isTransactionControlStatement(statement: string): boolean {
  const normalized = normalizedSql(statement);
  return /^(?:ABORT\b|BEGIN(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION|COMMIT(?:\s+(?:WORK|TRANSACTION))?|END(?:\s+(?:WORK|TRANSACTION))?|ROLLBACK(?:\s+(?:WORK|TRANSACTION))?|SAVEPOINT\b|RELEASE\s+SAVEPOINT\b|PREPARE\s+TRANSACTION\b|SET\s+TRANSACTION\b|SET\s+SESSION\s+CHARACTERISTICS\s+AS\s+TRANSACTION\b)/u.test(normalized);
}

function normalizedSql(statement: string): string {
  return removeComments(statement).trim().replace(/\s+/gu, " ").toUpperCase();
}

function removeComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/--[^\r\n]*/gu, " ");
}

function isExpectedAdministrativeTarget(parsed: URL, expectedProjectRef: string): boolean {
  const hostname = parsed.hostname.toLowerCase();
  let username: string;
  try {
    username = decodeURIComponent(parsed.username).toLowerCase();
  } catch {
    return false;
  }
  const port = parsed.port === "" ? "5432" : parsed.port;
  const isDirect = hostname === `db.${expectedProjectRef}.supabase.co` && username === "postgres" && port === "5432";
  const isPooler = hostname.endsWith(".pooler.supabase.com") && username === `postgres.${expectedProjectRef}` && ["5432", "6543"].includes(port);
  return isDirect || isPooler;
}

function boundedValue(value: string | undefined, maximumLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength && value.trim() === value ? value : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function configurationError(): SchemaVerificationError {
  return new SchemaVerificationError("configuration", "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
}

function sqlError(): SchemaVerificationError {
  return new SchemaVerificationError("migration", "SCHEMA_VERIFICATION_SQL_REJECTED");
}

function catalogAuditSqlError(): SchemaVerificationError {
  return new SchemaVerificationError("catalog_audit", "SCHEMA_VERIFICATION_SQL_REJECTED");
}

function executionError(stage: SchemaVerificationStage): SchemaVerificationError {
  const codes: Readonly<Partial<Record<SchemaVerificationStage, SchemaVerificationCode>>> = {
    begin: "SCHEMA_VERIFICATION_BEGIN_FAILED",
    catalog_audit: "SCHEMA_VERIFICATION_CATALOG_AUDIT_FAILED",
    connect: "SCHEMA_VERIFICATION_CONNECT_FAILED",
    migration: "SCHEMA_VERIFICATION_MIGRATION_FAILED",
    summary: "SCHEMA_VERIFICATION_SUMMARY_FAILED",
  };
  return new SchemaVerificationError(stage, codes[stage] ?? "SCHEMA_VERIFICATION_SQL_REJECTED");
}
