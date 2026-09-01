import type { DatabaseConfig } from "../database.js";
import { loadAndValidateCaCertificate, readDatabaseConfig } from "../database.js";
import { readApiConfig } from "../config.js";

const FORBIDDEN_PROJECT_REF = "cxcnnhafchqslvgvkeye";
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const RUN_OPT_IN = "REMOTE_FIXTURE_WRITE";
const TARGET_OPT_IN = "ISOLATED_PRODUCT_SCHEMA";

const legacySecretNames = ["SUPABASE_SERVICE_ROLE_KEY", "TENANCY_VERIFICATION_SERVICE_ROLE_KEY"] as const;

export type TenancyVerificationStage =
  | "configuration"
  | "catalog_audit"
  | "fixtures"
  | "authentication"
  | "data_api"
  | "app_api"
  | "http"
  | "dining_zones"
  | "dining_tables"
  | "revocation"
  | "constraints"
  | "cleanup";

export type TenancyVerificationCode =
  | "TENANCY_VERIFICATION_CONFIGURATION_REJECTED"
  | "TENANCY_VERIFICATION_CATALOG_AUDIT_FAILED"
  | "TENANCY_VERIFICATION_FIXTURES_FAILED"
  | "TENANCY_VERIFICATION_AUTHENTICATION_FAILED"
  | "TENANCY_VERIFICATION_DATA_API_FAILED"
  | "TENANCY_VERIFICATION_APP_API_FAILED"
  | "TENANCY_VERIFICATION_HTTP_FAILED"
  | "TENANCY_VERIFICATION_DINING_ZONES_FAILED"
  | "TENANCY_VERIFICATION_DINING_TABLES_FAILED"
  | "TENANCY_VERIFICATION_REVOCATION_FAILED"
  | "TENANCY_VERIFICATION_CONSTRAINT_FAILED"
  | "TENANCY_VERIFICATION_ASSERTION_FAILED"
  | "TENANCY_VERIFICATION_CLEANUP_FAILED";

export class TenancyVerificationError extends Error {
  public readonly code: TenancyVerificationCode;
  public readonly stage: TenancyVerificationStage;

  public constructor(stage: TenancyVerificationStage, code: TenancyVerificationCode) {
    super(code);
    this.name = "TenancyVerificationError";
    this.code = code;
    this.stage = stage;
  }
}

export interface TenancyVerificationConfig {
  readonly adminDatabase: DatabaseConfig;
  readonly appDatabase: DatabaseConfig;
  readonly expectedProjectRef: string;
  readonly publishableKey: string;
  readonly secretKey: string;
  readonly supabaseUrl: string;
}

export interface TenancyAdministrativeConfig {
  readonly adminDatabase: DatabaseConfig;
  readonly expectedProjectRef: string;
  readonly secretKey: string;
  readonly supabaseUrl: string;
}

type CertificateLoader = (path: string) => string;

export function readTenancyVerificationConfig(
  environment: NodeJS.ProcessEnv,
  certificateLoader: CertificateLoader = loadAndValidateCaCertificate,
): TenancyVerificationConfig {
  try {
    if (environment.TENANCY_VERIFICATION_RUN !== RUN_OPT_IN) throw configurationError();
    const administrativeConfig = readTenancyAdministrativeConfig(environment, certificateLoader);
    const apiConfig = readApiConfig(environment);
    if (apiConfig.supabaseUrl !== administrativeConfig.supabaseUrl) {
      throw configurationError();
    }

    const appDatabase = readDatabaseConfig(environment, certificateLoader);

    return Object.freeze({
      adminDatabase: administrativeConfig.adminDatabase,
      appDatabase,
      expectedProjectRef: administrativeConfig.expectedProjectRef,
      publishableKey: apiConfig.supabasePublishableKey,
      secretKey: administrativeConfig.secretKey,
      supabaseUrl: apiConfig.supabaseUrl,
    });
  } catch {
    throw configurationError();
  }
}

export function readTenancyAdministrativeConfig(
  environment: NodeJS.ProcessEnv,
  certificateLoader: CertificateLoader = loadAndValidateCaCertificate,
): TenancyAdministrativeConfig {
  try {
    const expectedProjectRef = boundedValue(environment.TENANCY_VERIFICATION_CONFIRM_PROJECT_REF, 64);
    if (
      environment.TENANCY_VERIFICATION_CONFIRM_ISOLATED_TARGET !== TARGET_OPT_IN
      || expectedProjectRef === undefined
      || !PROJECT_REF_PATTERN.test(expectedProjectRef)
      || expectedProjectRef === FORBIDDEN_PROJECT_REF
      || legacySecretNames.some((name) => boundedValue(environment[name], 2_048) !== undefined)
    ) throw configurationError();

    const supabaseUrl = readHostedSupabaseProjectUrl(environment.SUPABASE_URL);
    const projectRef = readHostedProjectRef(supabaseUrl);
    const secretKey = boundedValue(environment.TENANCY_VERIFICATION_SUPABASE_SECRET_KEY, 2_048);
    const certificatePath = boundedValue(environment.DATABASE_CA_CERT_PATH, 1_024);
    const rawAdminUrl = boundedValue(environment.TENANCY_VERIFICATION_ADMIN_DATABASE_URL, 8_192);
    if (
      projectRef !== expectedProjectRef
      || secretKey === undefined
      || !secretKey.startsWith("sb_secret_")
      || secretKey.length <= "sb_secret_".length
      || !/^[A-Za-z0-9_-]+$/u.test(secretKey)
      || certificatePath === undefined
      || rawAdminUrl === undefined
    ) throw configurationError();

    const caCertificate = certificateLoader(certificatePath);
    if (typeof caCertificate !== "string" || caCertificate.length === 0 || caCertificate.length > 65_536) {
      throw configurationError();
    }
    const adminDatabase = readSupabaseAdministrativeDatabaseConfig(rawAdminUrl, expectedProjectRef, caCertificate);
    return Object.freeze({ adminDatabase, expectedProjectRef, secretKey, supabaseUrl });
  } catch {
    throw configurationError();
  }
}

export function sanitizeTenancyVerificationFailure(
  error: unknown,
  fallbackStage: TenancyVerificationStage = "configuration",
): Readonly<{ code: TenancyVerificationCode; stage: TenancyVerificationStage; status: "failed" }> {
  const failure = error instanceof TenancyVerificationError
    ? error
    : new TenancyVerificationError(fallbackStage, codeForStage(fallbackStage));
  return Object.freeze({ code: failure.code, stage: failure.stage, status: "failed" });
}

export function formatTenancyVerificationFailure(
  error: unknown,
  fallbackStage?: TenancyVerificationStage,
): string {
  return JSON.stringify(sanitizeTenancyVerificationFailure(error, fallbackStage));
}

export function codeForStage(stage: TenancyVerificationStage): TenancyVerificationCode {
  const codes: Readonly<Record<TenancyVerificationStage, TenancyVerificationCode>> = {
    app_api: "TENANCY_VERIFICATION_APP_API_FAILED",
    authentication: "TENANCY_VERIFICATION_AUTHENTICATION_FAILED",
    catalog_audit: "TENANCY_VERIFICATION_CATALOG_AUDIT_FAILED",
    cleanup: "TENANCY_VERIFICATION_CLEANUP_FAILED",
    configuration: "TENANCY_VERIFICATION_CONFIGURATION_REJECTED",
    constraints: "TENANCY_VERIFICATION_CONSTRAINT_FAILED",
    data_api: "TENANCY_VERIFICATION_DATA_API_FAILED",
    dining_tables: "TENANCY_VERIFICATION_DINING_TABLES_FAILED",
    dining_zones: "TENANCY_VERIFICATION_DINING_ZONES_FAILED",
    fixtures: "TENANCY_VERIFICATION_FIXTURES_FAILED",
    http: "TENANCY_VERIFICATION_HTTP_FAILED",
    revocation: "TENANCY_VERIFICATION_REVOCATION_FAILED",
  };
  return codes[stage];
}

function readHostedProjectRef(supabaseUrl: string): string | undefined {
  const parsed = new URL(supabaseUrl);
  const match = /^([a-z0-9]{20})\.supabase\.co$/u.exec(parsed.hostname.toLowerCase());
  return match?.[1];
}

export function readHostedSupabaseProjectUrl(rawUrl: string | undefined): string {
  const value = boundedValue(rawUrl, 2_048);
  if (value === undefined) throw configurationError();
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.port !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
  ) throw configurationError();
  return parsed.toString().replace(/\/$/u, "");
}

export function readSupabaseAdministrativeDatabaseConfig(
  rawUrl: string,
  expectedProjectRef: string,
  caCertificate: string,
): DatabaseConfig {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw configurationError();
  }

  let username: string;
  try {
    username = decodeURIComponent(parsed.username).toLowerCase();
  } catch {
    throw configurationError();
  }
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port === "" ? "5432" : parsed.port;
  const direct = hostname === `db.${expectedProjectRef}.supabase.co`
    && username === "postgres"
    && port === "5432";
  const pooler = hostname.endsWith(".pooler.supabase.com")
    && username === `postgres.${expectedProjectRef}`
    && port === "5432";
  const sslModeValues = parsed.searchParams.getAll("sslmode");
  const sslRootCertificateValues = parsed.searchParams.getAll("sslrootcert");
  const sslRootCertificate = sslRootCertificateValues.length === 1
    ? boundedValue(sslRootCertificateValues[0], 1_024)
    : undefined;

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hash !== ""
    || parsed.password === ""
    || parsed.pathname !== "/postgres"
    || (!direct && !pooler)
    || [...parsed.searchParams.keys()].some((key) => !["sslmode", "sslrootcert"].includes(key))
    || sslModeValues.length !== 1
    || sslModeValues[0]?.toLowerCase() !== "verify-full"
    || sslRootCertificateValues.length > 1
    || (sslRootCertificateValues.length === 1
      && (sslRootCertificate === undefined || sslRootCertificate.includes("\0")))
  ) {
    throw configurationError();
  }

  parsed.search = "";
  return Object.freeze({ caCertificate, connectionString: parsed.toString() });
}

function boundedValue(value: string | undefined, maximumLength: number): string | undefined {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value.trim() === value
    ? value
    : undefined;
}

function configurationError(): TenancyVerificationError {
  return new TenancyVerificationError("configuration", "TENANCY_VERIFICATION_CONFIGURATION_REJECTED");
}
