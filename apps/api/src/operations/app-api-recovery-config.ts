import type { DatabaseConfig } from "../database.js";
import { loadAndValidateCaCertificate } from "../database.js";
import {
  readHostedSupabaseProjectUrl,
  readSupabaseAdministrativeDatabaseConfig,
} from "./tenancy-verification-config.js";

const FORBIDDEN_PROJECT_REF = "cxcnnhafchqslvgvkeye";
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const RUN_OPT_IN = "REMOTE_ROLE_DISABLE";
const CONFIRM_PREFIX = "DISABLE_APP_API_LOGIN_AFTER_AMBIGUOUS_PROVISIONING_FOR:";
const CONFIRM_ARGUMENT = "--confirm=";

export type AppApiRecoveryStage = "configuration" | "precheck" | "disable" | "postcheck" | "close";

export type AppApiRecoveryCode =
  | "APP_API_RECOVERY_CONFIGURATION_REJECTED"
  | "APP_API_RECOVERY_PRECHECK_FAILED"
  | "APP_API_RECOVERY_DISABLE_FAILED"
  | "APP_API_RECOVERY_POSTCHECK_FAILED"
  | "APP_API_RECOVERY_CLOSE_FAILED";

export class AppApiRecoveryError extends Error {
  public readonly code: AppApiRecoveryCode;
  public readonly stage: AppApiRecoveryStage;

  public constructor(stage: AppApiRecoveryStage, code: AppApiRecoveryCode) {
    super(code);
    this.name = "AppApiRecoveryError";
    this.code = code;
    this.stage = stage;
  }
}

export interface AppApiRecoveryConfig {
  readonly adminDatabase: DatabaseConfig;
  readonly expectedProjectRef: string;
}

type CertificateLoader = (path: string) => string;

export function readAppApiRecoveryConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
  certificateLoader: CertificateLoader = loadAndValidateCaCertificate,
): AppApiRecoveryConfig {
  try {
    const expectedProjectRef = boundedValue(environment.APP_API_RECOVERY_CONFIRM_PROJECT_REF, 64);
    if (
      environment.APP_API_RECOVERY_RUN !== RUN_OPT_IN
      || expectedProjectRef === undefined
      || !PROJECT_REF_PATTERN.test(expectedProjectRef)
      || expectedProjectRef === FORBIDDEN_PROJECT_REF
      || arguments_.length !== 1
      || arguments_[0] !== `${CONFIRM_ARGUMENT}${CONFIRM_PREFIX}${expectedProjectRef}`
    ) throw configurationError();

    const supabaseUrl = readHostedSupabaseProjectUrl(environment.SUPABASE_URL);
    if (new URL(supabaseUrl).hostname !== `${expectedProjectRef}.supabase.co`) throw configurationError();
    const rawAdminUrl = boundedValue(environment.APP_API_RECOVERY_ADMIN_DATABASE_URL, 8_192);
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

export function sanitizeAppApiRecoveryFailure(
  error: unknown,
): Readonly<{ code: AppApiRecoveryCode; stage: AppApiRecoveryStage; status: "failed" }> {
  const failure = error instanceof AppApiRecoveryError ? error : configurationError();
  return Object.freeze({ code: failure.code, stage: failure.stage, status: "failed" });
}

export function formatAppApiRecoveryFailure(error: unknown): string {
  return JSON.stringify(sanitizeAppApiRecoveryFailure(error));
}

function boundedValue(value: string | undefined, maximumLength: number): string | undefined {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value.trim() === value
    ? value
    : undefined;
}

function configurationError(): AppApiRecoveryError {
  return new AppApiRecoveryError("configuration", "APP_API_RECOVERY_CONFIGURATION_REJECTED");
}
