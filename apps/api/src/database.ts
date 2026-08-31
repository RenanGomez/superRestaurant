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

export interface DatabaseConfig {
  readonly caCertificate: string;
  readonly connectionString: string;
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
export class PostgresDatabaseClient implements DatabaseClientPort, OnApplicationShutdown {
  readonly #pool: Pool;

  public constructor(config: DatabaseConfig) {
    this.#pool = new Pool({
      application_name: "super-restaurant-api",
      connectionTimeoutMillis: 5_000,
      connectionString: config.connectionString,
      idleTimeoutMillis: 30_000,
      max: 10,
      query_timeout: 5_000,
      ssl: { ca: config.caCertificate, rejectUnauthorized: true },
      statement_timeout: 5_000,
    });
  }

  public async query(sql: string, parameters: readonly unknown[]): Promise<DatabaseQueryResult> {
    const result = await this.#pool.query<QueryResultRow>(sql, [...parameters]);
    return Object.freeze({ rows: Object.freeze([...result.rows]) });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.#pool.end();
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
