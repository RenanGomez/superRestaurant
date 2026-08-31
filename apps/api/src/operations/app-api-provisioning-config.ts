import type { DatabaseConfig } from "../database.js";
import { loadAndValidateCaCertificate } from "../database.js";
import {
  readHostedSupabaseProjectUrl,
  readSupabaseAdministrativeDatabaseConfig,
} from "./tenancy-verification-config.js";

const FORBIDDEN_PROJECT_REF = "cxcnnhafchqslvgvkeye";
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const RUN_OPT_IN = "REMOTE_ROLE_LOGIN_CHANGE";
const CONFIRM_PREFIX = "PROVISION_APP_API_LOGIN_FOR:";
const CONFIRM_ARGUMENT = "--confirm=";

export type AppApiProvisioningStage =
  | "configuration"
  | "precheck"
  | "provision"
  | "runtime_audit"
  | "connection"
  | "compensation"
  | "close";

export type AppApiProvisioningCode =
  | "APP_API_PROVISIONING_CONFIGURATION_REJECTED"
  | "APP_API_PROVISIONING_PRECHECK_FAILED"
  | "APP_API_PROVISIONING_CHANGE_FAILED"
  | "APP_API_PROVISIONING_RUNTIME_AUDIT_FAILED"
  | "APP_API_PROVISIONING_CONNECTION_FAILED"
  | "APP_API_PROVISIONING_COMPENSATION_FAILED"
  | "APP_API_PROVISIONING_CLOSE_FAILED";

export class AppApiProvisioningError extends Error {
  public readonly code: AppApiProvisioningCode;
  public readonly stage: AppApiProvisioningStage;

  public constructor(stage: AppApiProvisioningStage, code: AppApiProvisioningCode) {
    super(code);
    this.name = "AppApiProvisioningError";
    this.code = code;
    this.stage = stage;
  }
}

export interface AppApiProvisioningConfig {
  readonly adminDatabase: DatabaseConfig;
  readonly appDatabase: DatabaseConfig;
  readonly expectedProjectRef: string;
  readonly password: string;
}

type CertificateLoader = (path: string) => string;

export function readAppApiProvisioningConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
  certificateLoader: CertificateLoader = loadAndValidateCaCertificate,
): AppApiProvisioningConfig {
  try {
    const expectedProjectRef = boundedValue(environment.APP_API_PROVISIONING_CONFIRM_PROJECT_REF, 64);
    if (
      environment.APP_API_PROVISIONING_RUN !== RUN_OPT_IN
      || expectedProjectRef === undefined
      || !PROJECT_REF_PATTERN.test(expectedProjectRef)
      || expectedProjectRef === FORBIDDEN_PROJECT_REF
      || !hasExactConfirmation(arguments_, expectedProjectRef)
    ) throw configurationError();

    const supabaseUrl = readHostedSupabaseProjectUrl(environment.SUPABASE_URL);
    if (new URL(supabaseUrl).hostname !== `${expectedProjectRef}.supabase.co`) throw configurationError();
    const rawAdminUrl = boundedValue(environment.APP_API_PROVISIONING_ADMIN_DATABASE_URL, 8_192);
    const certificatePath = boundedValue(environment.DATABASE_CA_CERT_PATH, 1_024);
    const password = boundedValue(environment.APP_API_PROVISIONING_PASSWORD, 256);
    if (
      rawAdminUrl === undefined
      || certificatePath === undefined
      || password === undefined
      || !isStrongPassword(password)
    ) throw configurationError();

    const caCertificate = certificateLoader(certificatePath);
    if (typeof caCertificate !== "string" || caCertificate.length === 0 || caCertificate.length > 65_536) {
      throw configurationError();
    }
    const adminDatabase = readSupabaseAdministrativeDatabaseConfig(
      rawAdminUrl,
      expectedProjectRef,
      caCertificate,
    );
    if (decodeURIComponent(new URL(adminDatabase.connectionString).password) === password) {
      throw configurationError();
    }
    const appDatabase = createAppDatabaseConfig(adminDatabase, expectedProjectRef, password);
    return Object.freeze({ adminDatabase, appDatabase, expectedProjectRef, password });
  } catch {
    throw configurationError();
  }
}

export function sanitizeAppApiProvisioningFailure(
  error: unknown,
): Readonly<{ code: AppApiProvisioningCode; stage: AppApiProvisioningStage; status: "failed" }> {
  const failure = error instanceof AppApiProvisioningError ? error : configurationError();
  return Object.freeze({ code: failure.code, stage: failure.stage, status: "failed" });
}

export function formatAppApiProvisioningFailure(error: unknown): string {
  return JSON.stringify(sanitizeAppApiProvisioningFailure(error));
}

function hasExactConfirmation(arguments_: readonly string[], projectRef: string): boolean {
  return arguments_.length === 1
    && arguments_[0] === `${CONFIRM_ARGUMENT}${CONFIRM_PREFIX}${projectRef}`;
}

function isStrongPassword(password: string): boolean {
  return password.length >= 32
    && /^[\x21-\x7E]+$/u.test(password)
    && /[a-z]/u.test(password)
    && /[A-Z]/u.test(password)
    && /[0-9]/u.test(password)
    && /[^A-Za-z0-9]/u.test(password);
}

function createAppDatabaseConfig(
  adminDatabase: DatabaseConfig,
  projectRef: string,
  password: string,
): DatabaseConfig {
  const parsed = new URL(adminDatabase.connectionString);
  const adminUsername = decodeURIComponent(parsed.username).toLowerCase();
  parsed.username = adminUsername === "postgres" ? "app_api" : `app_api.${projectRef}`;
  parsed.password = password;
  return Object.freeze({
    caCertificate: adminDatabase.caCertificate,
    connectionString: parsed.toString(),
  });
}

function boundedValue(value: string | undefined, maximumLength: number): string | undefined {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value.trim() === value
    ? value
    : undefined;
}

function configurationError(): AppApiProvisioningError {
  return new AppApiProvisioningError(
    "configuration",
    "APP_API_PROVISIONING_CONFIGURATION_REJECTED",
  );
}
