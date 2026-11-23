import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Pool, type QueryResultRow } from "pg";

export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");

export interface DatabaseQueryResult {
  readonly rows: readonly unknown[];
}

export interface DatabaseClientPort {
  query(sql: string, parameters: readonly unknown[]): Promise<DatabaseQueryResult>;
}

export interface TransactionalDatabaseClientPort extends DatabaseClientPort {
  transaction<T>(operation: (database: DatabaseClientPort) => Promise<T>): Promise<T>;
}

export interface DatabaseConfig {
  readonly caCertificate: string;
  readonly connectionString: string;
}

/**
 * node-postgres emits `error` for an idle client outside any query promise.
 * Registering a listener prevents that transport event from terminating the
 * process; active and subsequent query failures continue to reject normally.
 */
export function guardPostgresPool(pool: Pool): Pool {
  pool.on("error", () => undefined);
  return pool;
}

export class DatabaseConfigurationError extends Error {
  public constructor() {
    super("DATABASE_CONFIGURATION_REJECTED");
    this.name = "DatabaseConfigurationError";
  }
}

type CertificateLoader = (path: string) => string;

export function readDatabaseConfig(
  environment: NodeJS.ProcessEnv,
  certificateLoader: CertificateLoader = loadAndValidateCaCertificate,
): DatabaseConfig {
  if (environment.NODE_ENV === "test" && environment.SR_TEST_DATABASE_URL !== undefined) {
    let url: URL;
    try { url = new URL(environment.SR_TEST_DATABASE_URL); } catch { throw new DatabaseConfigurationError(); }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" ||
        !url.username || !url.password || url.pathname !== "/postgres" || url.search || url.hash) throw new DatabaseConfigurationError();
    return Object.freeze({ caCertificate: "", connectionString: url.toString() });
  }
  const rawUrl = boundedValue(environment.DATABASE_URL, 8_192);
  const certificatePath = boundedValue(environment.DATABASE_CA_CERT_PATH, 1_024);
  const projectRef = readProjectRef(environment.SUPABASE_URL);
  if (rawUrl === undefined || certificatePath === undefined || projectRef === undefined) {
    throw new DatabaseConfigurationError();
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DatabaseConfigurationError();
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hash.length !== 0 ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.pathname !== "/postgres" ||
    !isExpectedSupabaseDatabaseTarget(parsed, projectRef) ||
    [...parsed.searchParams.keys()].some((key) => key !== "sslmode") ||
    parsed.searchParams.getAll("sslmode").length !== 1 ||
    parsed.searchParams.get("sslmode")?.toLowerCase() !== "verify-full"
  ) {
    throw new DatabaseConfigurationError();
  }

  let caCertificate: string;
  try {
    caCertificate = certificateLoader(certificatePath);
  } catch {
    throw new DatabaseConfigurationError();
  }
  if (typeof caCertificate !== "string" || caCertificate.length === 0 || caCertificate.length > 65_536) {
    throw new DatabaseConfigurationError();
  }

  parsed.search = "";
  return Object.freeze({ caCertificate, connectionString: parsed.toString() });
}

@Injectable()
export class PostgresDatabaseClient implements TransactionalDatabaseClientPort, OnApplicationShutdown {
  readonly #pool: Pool;

  public constructor(config: DatabaseConfig) {
    this.#pool = guardPostgresPool(new Pool({
      application_name: "super-restaurant-api",
      connectionTimeoutMillis: 5_000,
      connectionString: config.connectionString,
      idleTimeoutMillis: 30_000,
      max: 10,
      query_timeout: 5_000,
      ...(config.caCertificate === "" ? {} : { ssl: { ca: config.caCertificate, rejectUnauthorized: true } }),
      statement_timeout: 5_000,
    }));
  }

  public async query(sql: string, parameters: readonly unknown[]): Promise<DatabaseQueryResult> {
    const result = await this.#pool.query<QueryResultRow>(sql, [...parameters]);
    return Object.freeze({ rows: Object.freeze([...result.rows]) });
  }

  public async transaction<T>(operation: (database: DatabaseClientPort) => Promise<T>): Promise<T> {
    return runDatabaseTransaction(await this.#pool.connect(), operation);
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.#pool.end();
  }
}

export async function runDatabaseTransaction<T>(
  connection: { query(sql: string, parameters?: unknown[]): Promise<{ rows: QueryResultRow[] }>; release(error?: Error): void },
  operation: (database: DatabaseClientPort) => Promise<T>,
): Promise<T> {
    let releaseError: Error | undefined;
    try {
      await connection.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const database: DatabaseClientPort = {
        query: async (sql, parameters) => {
          const result = await connection.query(sql, [...parameters]);
          return Object.freeze({ rows: Object.freeze([...result.rows]) });
        },
      };
      const result = await operation(database);
      await connection.query("COMMIT");
      return result;
    } catch (error: unknown) {
      try { await connection.query("ROLLBACK"); } catch { releaseError = new Error("ROLLBACK_FAILED"); }
      throw error;
    } finally {
      connection.release(releaseError);
    }
}

export function loadAndValidateCaCertificate(path: string): string {
  const certificate = readFileSync(path, { encoding: "utf8" });
  if (certificate.length === 0 || certificate.length > 65_536) throw new DatabaseConfigurationError();

  const parsed = new X509Certificate(certificate);
  const now = Date.now();
  const validFrom = Date.parse(parsed.validFrom);
  const validTo = Date.parse(parsed.validTo);
  if (!parsed.ca || !Number.isFinite(validFrom) || !Number.isFinite(validTo) || validFrom > now || validTo <= now) {
    throw new DatabaseConfigurationError();
  }
  return certificate;
}

function readProjectRef(rawSupabaseUrl: string | undefined): string | undefined {
  const value = boundedValue(rawSupabaseUrl, 2_048);
  if (value === undefined) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.port !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
      return undefined;
    }
    const match = /^([a-z0-9]{20})\.supabase\.co$/u.exec(parsed.hostname.toLowerCase());
    return match?.[1];
  } catch {
    return undefined;
  }
}

function isExpectedSupabaseDatabaseTarget(parsed: URL, projectRef: string): boolean {
  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username).toLowerCase();
  const port = parsed.port === "" ? "5432" : parsed.port;
  const isDirect = hostname === `db.${projectRef}.supabase.co` && username === "app_api" && port === "5432";
  const isPooler = hostname.endsWith(".pooler.supabase.com") && username === `app_api.${projectRef}` && ["5432", "6543"].includes(port);
  return isDirect || isPooler;
}

function boundedValue(value: string | undefined, maximumLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength && value.trim() === value ? value : undefined;
}
