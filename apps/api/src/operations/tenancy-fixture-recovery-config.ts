import type { DatabaseConfig } from "../database.js";
import {
  readTenancyAdministrativeConfig,
  type TenancyAdministrativeConfig,
} from "./tenancy-verification-config.js";

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_ARGUMENT = "--run-id=";
const CONFIRM_ARGUMENT = "--confirm=";
const CONFIRM_PREFIX = "DELETE_TENANCY_E2E_FIXTURES_FOR_RUN:";
const RECOVERY_OPT_IN = "REMOTE_FIXTURE_DELETE";

export type TenancyFixtureRecoveryStage = "configuration" | "discovery" | "database" | "auth" | "postcheck";
export type TenancyFixtureRecoveryCode =
  | "TENANCY_FIXTURE_RECOVERY_CONFIGURATION_REJECTED"
  | "TENANCY_FIXTURE_RECOVERY_DISCOVERY_FAILED"
  | "TENANCY_FIXTURE_RECOVERY_CONTAMINATION_DETECTED"
  | "TENANCY_FIXTURE_RECOVERY_RUN_ACTIVE"
  | "TENANCY_FIXTURE_RECOVERY_DATABASE_FAILED"
  | "TENANCY_FIXTURE_RECOVERY_AUTH_FAILED"
  | "TENANCY_FIXTURE_RECOVERY_POSTCHECK_FAILED";

export class TenancyFixtureRecoveryError extends Error {
  public readonly code: TenancyFixtureRecoveryCode;
  public readonly stage: TenancyFixtureRecoveryStage;

  public constructor(stage: TenancyFixtureRecoveryStage, code: TenancyFixtureRecoveryCode) {
    super(code);
    this.name = "TenancyFixtureRecoveryError";
    this.code = code;
    this.stage = stage;
  }
}

export interface TenancyFixtureRecoveryConfig {
  readonly adminDatabase: DatabaseConfig;
  readonly expectedProjectRef: string;
  readonly runId: string;
  readonly secretKey: string;
  readonly supabaseUrl: string;
}

type CertificateLoader = (path: string) => string;

export function readTenancyFixtureRecoveryConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
  certificateLoader?: CertificateLoader,
): TenancyFixtureRecoveryConfig {
  try {
    if (environment.TENANCY_FIXTURE_RECOVERY_RUN !== RECOVERY_OPT_IN) throw configurationError();
    const runId = readExactRunIdAndConfirmation(arguments_);
    const administrativeConfig = readTenancyAdministrativeConfig(environment, certificateLoader);
    return toRecoveryConfig(administrativeConfig, runId);
  } catch {
    throw configurationError();
  }
}

export function sanitizeTenancyFixtureRecoveryFailure(
  error: unknown,
): Readonly<{ code: TenancyFixtureRecoveryCode; stage: TenancyFixtureRecoveryStage; status: "failed" }> {
  const failure = error instanceof TenancyFixtureRecoveryError
    ? error
    : configurationError();
  return Object.freeze({ code: failure.code, stage: failure.stage, status: "failed" });
}

export function formatTenancyFixtureRecoveryFailure(error: unknown): string {
  return JSON.stringify(sanitizeTenancyFixtureRecoveryFailure(error));
}

function readExactRunIdAndConfirmation(arguments_: readonly string[]): string {
  if (arguments_.length !== 2) throw configurationError();
  const runArgument = arguments_.find((argument) => argument.startsWith(RUN_ID_ARGUMENT));
  const confirmArgument = arguments_.find((argument) => argument.startsWith(CONFIRM_ARGUMENT));
  if (runArgument === undefined || confirmArgument === undefined) throw configurationError();
  const runId = runArgument.slice(RUN_ID_ARGUMENT.length);
  const confirmation = confirmArgument.slice(CONFIRM_ARGUMENT.length);
  if (!RUN_ID_PATTERN.test(runId) || confirmation !== `${CONFIRM_PREFIX}${runId}`) {
    throw configurationError();
  }
  return runId;
}

function toRecoveryConfig(config: TenancyAdministrativeConfig, runId: string): TenancyFixtureRecoveryConfig {
  return Object.freeze({
    adminDatabase: config.adminDatabase,
    expectedProjectRef: config.expectedProjectRef,
    runId,
    secretKey: config.secretKey,
    supabaseUrl: config.supabaseUrl,
  });
}

function configurationError(): TenancyFixtureRecoveryError {
  return new TenancyFixtureRecoveryError(
    "configuration",
    "TENANCY_FIXTURE_RECOVERY_CONFIGURATION_REJECTED",
  );
}
