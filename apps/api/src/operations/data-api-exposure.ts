import {
  DataApiExposureError,
  dataApiExposureEndpoint,
  type DataApiExposureConfig,
  type DataApiExposureStage,
} from "./data-api-exposure-config.js";

const TARGET_DB_SCHEMA = "public,graphql_public,app";
const FINAL_SCHEMAS = Object.freeze(["public", "graphql_public", "app"] as const);
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;
const MAXIMUM_RESPONSE_LENGTH = 65_536;
const NON_TARGET_FIELDS = Object.freeze([
  "db_extra_search_path",
  "max_rows",
  "db_pool",
  "db_pool_acquisition_timeout",
] as const);

type NonTargetField = typeof NON_TARGET_FIELDS[number];
type NonTargetValue = number | string | null;
type SchemaState = "baseline" | "adr010_b" | "final";

interface DataApiSettings {
  readonly nonTarget: Readonly<Record<NonTargetField, NonTargetValue>>;
  readonly schemas: readonly string[];
  readonly state: SchemaState;
}

export interface DataApiExposureHttpResponse {
  readonly status: unknown;
  text(): Promise<unknown>;
}

export type DataApiExposureFetch = (
  url: string,
  init: RequestInit,
) => Promise<DataApiExposureHttpResponse>;

export interface DataApiExposureOptions {
  readonly config: DataApiExposureConfig;
  readonly fetch?: DataApiExposureFetch;
}

export interface DataApiExposureSummary {
  readonly audit: true;
  readonly changed: boolean;
  readonly currentSchemas: readonly ["public", "graphql_public", "app"];
  readonly status: "ok";
}

export async function exposeAppDataApi(
  options: DataApiExposureOptions,
): Promise<DataApiExposureSummary> {
  const endpoint = dataApiExposureEndpoint(options.config.projectRef);
  const fetchImplementation = options.fetch ?? defaultFetch;
  const before = await getSettings(
    endpoint,
    options.config.accessToken,
    "precheck",
    fetchImplementation,
  );

  if (before.state === "final") return createSummary(false);

  let patchFailure: DataApiExposureError | undefined;
  try {
    await patchSettings(endpoint, options.config.accessToken, fetchImplementation);
  } catch {
    patchFailure = exposureError("change");
  }

  let after: DataApiSettings;
  try {
    after = await getSettings(
      endpoint,
      options.config.accessToken,
      "postcheck",
      fetchImplementation,
    );
  } catch {
    throw patchFailure ?? exposureError("postcheck");
  }

  if (after.state !== "final") throw patchFailure ?? exposureError("postcheck");
  if (!sameNonTargetSettings(before.nonTarget, after.nonTarget)) {
    throw exposureError("postcheck");
  }
  return createSummary(true);
}

const defaultFetch: DataApiExposureFetch = async (url, init) => fetch(url, init);

async function getSettings(
  endpoint: string,
  accessToken: string,
  stage: "precheck" | "postcheck",
  fetchImplementation: DataApiExposureFetch,
): Promise<DataApiSettings> {
  try {
    const response = await fetchImplementation(endpoint, Object.freeze({
      headers: Object.freeze({
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      }),
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    }));
    assertSuccessfulStatus(response);
    return parseSettings(await readBoundedText(response));
  } catch {
    throw exposureError(stage);
  }
}

async function patchSettings(
  endpoint: string,
  accessToken: string,
  fetchImplementation: DataApiExposureFetch,
): Promise<void> {
  try {
    const response = await fetchImplementation(endpoint, Object.freeze({
      body: JSON.stringify({ db_schema: TARGET_DB_SCHEMA }),
      headers: Object.freeze({
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      }),
      method: "PATCH",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    }));
    assertSuccessfulStatus(response);
  } catch {
    throw exposureError("change");
  }
}

function assertSuccessfulStatus(response: DataApiExposureHttpResponse): void {
  const status = response.status;
  if (!Number.isInteger(status) || (status as number) < 200 || (status as number) > 299) {
    throw new TypeError("HTTP_STATUS_REJECTED");
  }
}

async function readBoundedText(response: DataApiExposureHttpResponse): Promise<string> {
  const textMethod = response.text;
  if (typeof textMethod !== "function") throw new TypeError("HTTP_BODY_REJECTED");
  const body = await textMethod.call(response);
  if (typeof body !== "string" || body.length > MAXIMUM_RESPONSE_LENGTH) {
    throw new TypeError("HTTP_BODY_REJECTED");
  }
  return body;
}

function parseSettings(body: string): DataApiSettings {
  const parsed: unknown = JSON.parse(body);
  if (!isPlainRecord(parsed)) throw new TypeError("SETTINGS_RESPONSE_REJECTED");

  const schemas = parseSchemas(readOwnDataProperty(parsed, "db_schema"));
  const nonTarget = Object.create(null) as Record<NonTargetField, NonTargetValue>;
  for (const field of NON_TARGET_FIELDS) {
    nonTarget[field] = parseNonTargetValue(field, readOwnDataProperty(parsed, field));
  }
  return Object.freeze({
    nonTarget: Object.freeze(nonTarget),
    schemas,
    state: identifySchemaState(schemas),
  });
}

function parseSchemas(value: unknown): readonly string[] {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError("SCHEMA_STATE_REJECTED");
  }
  const schemas = value.split(",").map((schema) => schema.trim());
  if (
    schemas.some((schema) => !/^[a-z][a-z0-9_]*$/u.test(schema))
    || new Set(schemas).size !== schemas.length
  ) throw new TypeError("SCHEMA_STATE_REJECTED");
  identifySchemaState(schemas);
  return Object.freeze([...schemas]);
}

function identifySchemaState(schemas: readonly string[]): SchemaState {
  const state = schemas.join("+");
  if (state === "public+graphql_public") return "baseline";
  if (state === "public+graphql_public+adr010_b") return "adr010_b";
  if (state === "public+graphql_public+app") return "final";
  throw new TypeError("SCHEMA_STATE_REJECTED");
}

function parseNonTargetValue(field: NonTargetField, value: unknown): NonTargetValue {
  if (field === "db_extra_search_path") {
    if (typeof value === "string" && value.length <= 8_192) return value;
    throw new TypeError("SETTINGS_FIELD_REJECTED");
  }
  if (value === null || (typeof value === "number" && Number.isSafeInteger(value))) return value;
  throw new TypeError("SETTINGS_FIELD_REJECTED");
}

function readOwnDataProperty(record: Record<string, unknown>, property: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, property);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError("SETTINGS_FIELD_REJECTED");
  }
  return descriptor.value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameNonTargetSettings(
  before: Readonly<Record<NonTargetField, NonTargetValue>>,
  after: Readonly<Record<NonTargetField, NonTargetValue>>,
): boolean {
  return NON_TARGET_FIELDS.every((field) => Object.is(before[field], after[field]));
}

function createSummary(changed: boolean): DataApiExposureSummary {
  return Object.freeze({
    audit: true,
    changed,
    currentSchemas: FINAL_SCHEMAS,
    status: "ok",
  });
}

function exposureError(stage: DataApiExposureStage): DataApiExposureError {
  const codes = {
    change: "DATA_API_EXPOSURE_CHANGE_FAILED",
    configuration: "DATA_API_EXPOSURE_CONFIGURATION_REJECTED",
    postcheck: "DATA_API_EXPOSURE_POSTCHECK_FAILED",
    precheck: "DATA_API_EXPOSURE_PRECHECK_FAILED",
  } as const;
  return new DataApiExposureError(stage, codes[stage]);
}
