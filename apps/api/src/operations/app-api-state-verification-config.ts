import type { DatabaseConfig } from "../database.js";
import { loadAndValidateCaCertificate } from "../database.js";
import {
  readHostedSupabaseProjectUrl,
  readSupabaseAdministrativeDatabaseConfig,
} from "./tenancy-verification-config.js";

const FORBIDDEN_PROJECT_REF = "cxcnnhafchqslvgvkeye";
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;

export type AppApiStateVerificationStage = "configuration" | "connection" | "audit" | "close";

export type AppApiStateVerificationCode =
  | "APP_API_STATE_CONFIGURATION_REJECTED"
  | "APP_API_STATE_CONNECTION_FAILED"
  | "APP_API_STATE_AUDIT_FAILED"
  | "APP_API_STATE_CLOSE_FAILED";

export class AppApiStateVerificationError extends Error {
  public readonly code: AppApiStateVerificationCode;
  public readonly stage: AppApiStateVerificationStage;

  public constructor(stage: AppApiStateVerificationStage, code: AppApiStateVerificationCode) {
    super(code);
    this.name = "AppApiStateVerificationError";
    this.code = code;
    this.stage = stage;
  }
}

export interface AppApiStateVerificationConfig {
  readonly adminDatabase: DatabaseConfig;
  readonly expectedProjectRef: string;
}

type CertificateLoader = (path: string) => string;

export function readAppApiStateVerificationConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
  certificateLoader: CertificateLoader = loadAndValidateCaCertificate,
): AppApiStateVerificationConfig {
  try {
    const expectedProjectRef = boundedValue(environment.APP_API_STATE_VERIFICATION_PROJECT_REF, 64);
    if (
      arguments_.length !== 0
      || expectedProjectRef === undefined
      || !PROJECT_REF_PATTERN.test(expectedProjectRef)
      || expectedProjectRef === FORBIDDEN_PROJECT_REF
    ) throw configurationError();
    const supabaseUrl = readHostedSupabaseProjectUrl(environment.SUPABASE_URL);
    if (new URL(supabaseUrl).hostname !== `${expectedProjectRef}.supabase.co`) throw configurationError();
    const rawAdminUrl = boundedValue(environment.APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL, 8_192);
    const certificatePath = boundedValue(environment.DATABASE_CA_CERT_PATH, 1_024);
    if (rawAdminUrl === undefined || certificatePath === undefined) throw configurationError();
    const caCertificate = certificateLoader(certificatePath);
    if (typeof caCertificate !== "string" || caCertificate.length === 0 || caCertificate.length > 65_536) {
      throw configurationError();
    }
    const adminDatabase = readSupabaseAdministrativeDatabaseConfig(
      rawAdminUrl,
      expectedProjectRef,
      caCertificate,
    );
    return Object.freeze({ adminDatabase, expectedProjectRef });
  } catch {
    throw configurationError();
  }
}

export function sanitizeAppApiStateVerificationFailure(
  error: unknown,
): Readonly<{
  code: AppApiStateVerificationCode;
  stage: AppApiStateVerificationStage;
  status: "failed";
}> {
  const failure = error instanceof AppApiStateVerificationError ? error : configurationError();
  return Object.freeze({ code: failure.code, stage: failure.stage, status: "failed" });
}

export function formatAppApiStateVerificationFailure(error: unknown): string {
  return JSON.stringify(sanitizeAppApiStateVerificationFailure(error));
}

function boundedValue(value: string | undefined, maximumLength: number): string | undefined {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value.trim() === value
    ? value
    : undefined;
}

function configurationError(): AppApiStateVerificationError {
  return new AppApiStateVerificationError("configuration", "APP_API_STATE_CONFIGURATION_REJECTED");
}
