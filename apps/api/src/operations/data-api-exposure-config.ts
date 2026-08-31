const FORBIDDEN_PROJECT_REF = "cxcnnhafchqslvgvkeye";
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const ACCESS_TOKEN_PATTERN = /^[\x21-\x7E]+$/u;
const MAXIMUM_ACCESS_TOKEN_LENGTH = 8_192;
const RUN_OPT_IN = "REMOTE_CONFIG_WRITE";
const CONFIRM_PREFIX = "--confirm=EXPOSE_ONLY_APP_DATA_API_FOR:";

export type DataApiExposureStage = "configuration" | "precheck" | "change" | "postcheck";

export type DataApiExposureCode =
  | "DATA_API_EXPOSURE_CONFIGURATION_REJECTED"
  | "DATA_API_EXPOSURE_PRECHECK_FAILED"
  | "DATA_API_EXPOSURE_CHANGE_FAILED"
  | "DATA_API_EXPOSURE_POSTCHECK_FAILED";

export class DataApiExposureError extends Error {
  public readonly code: DataApiExposureCode;
  public readonly stage: DataApiExposureStage;

  public constructor(stage: DataApiExposureStage, code: DataApiExposureCode) {
    super(code);
    this.name = "DataApiExposureError";
    this.code = code;
    this.stage = stage;
  }
}

export interface DataApiExposureConfig {
  readonly accessToken: string;
  readonly projectRef: string;
}

export function readDataApiExposureConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[],
): DataApiExposureConfig {
  try {
    const projectRef = readProjectRef(environment.DATA_API_EXPOSURE_PROJECT_REF);
    const accessToken = readAccessToken(environment.SUPABASE_ACCESS_TOKEN);
    if (
      environment.DATA_API_EXPOSURE_RUN !== RUN_OPT_IN
      || arguments_.length !== 1
      || arguments_[0] !== `${CONFIRM_PREFIX}${projectRef}`
    ) throw configurationError();
    return Object.freeze({ accessToken, projectRef });
  } catch {
    throw configurationError();
  }
}

export function dataApiExposureEndpoint(projectRef: string): string {
  const validatedProjectRef = readProjectRef(projectRef);
  return `https://api.supabase.com/v1/projects/${validatedProjectRef}/postgrest`;
}

export function sanitizeDataApiExposureFailure(
  error: unknown,
): Readonly<{ code: DataApiExposureCode; stage: DataApiExposureStage; status: "failed" }> {
  const failure = error instanceof DataApiExposureError ? error : configurationError();
  return Object.freeze({ code: failure.code, stage: failure.stage, status: "failed" });
}

export function formatDataApiExposureFailure(error: unknown): string {
  return JSON.stringify(sanitizeDataApiExposureFailure(error));
}

function readProjectRef(value: string | undefined): string {
  if (
    typeof value !== "string"
    || !PROJECT_REF_PATTERN.test(value)
    || value === FORBIDDEN_PROJECT_REF
  ) throw configurationError();
  return value;
}

function readAccessToken(value: string | undefined): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAXIMUM_ACCESS_TOKEN_LENGTH
    || !ACCESS_TOKEN_PATTERN.test(value)
  ) throw configurationError();
  return value;
}

function configurationError(): DataApiExposureError {
  return new DataApiExposureError(
    "configuration",
    "DATA_API_EXPOSURE_CONFIGURATION_REJECTED",
  );
}
