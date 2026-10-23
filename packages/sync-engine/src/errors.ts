export const SYNC_ENGINE_ERROR_CODES = [
  "ENVELOPE_INVALID",
  "SCOPE_INVALID",
  "SCHEMA_UNSUPPORTED",
  "INPUT_INVALID",
  "PAYLOAD_INVALID",
  "PAYLOAD_TOO_DEEP",
  "PAYLOAD_TOO_LARGE",
  "PAYLOAD_SENSITIVE_DATA",
  "PAYLOAD_MONEY_INVALID",
  "IDEMPOTENCY_KEY_REUSE",
  "SCOPE_REVOKED",
  "ENTITY_TOMBSTONED",
  "ENTITY_EXISTS",
  "OUTBOX_TERMINAL_IMMUTABLE",
  "OUTBOX_TRANSITION_INVALID",
  "RESOLUTION_INVALID",
  "STATE_CORRUPT",
  "SEQUENCE_REGRESSION",
  "STORAGE_LOAD_FAILED",
  "STORAGE_COMMIT_FAILED",
  "ID_GENERATION_INVALID",
  "PUSH_RESPONSE_INVALID",
  "PULL_RESPONSE_INVALID",
  "PULL_SCOPE_VIOLATION",
] as const;

export type SyncEngineErrorCode = (typeof SYNC_ENGINE_ERROR_CODES)[number];

/** Domain error raised by the engine. Carries a stable code and never payload data. */
export class SyncEngineError extends Error {
  public readonly code: SyncEngineErrorCode;

  public constructor(code: SyncEngineErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "SyncEngineError";
    this.code = code;
  }
}

/**
 * Error a transport adapter throws. `code` is a stable uppercase identifier and
 * `retryable` is explicit: transient failures never get disguised as `rejected`.
 */
export class SyncTransportError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  public constructor(code: string, retryable: boolean) {
    super(code);
    this.name = "SyncTransportError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: SyncEngineErrorCode; readonly field: string };

export function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

export function fail<T>(code: SyncEngineErrorCode, field: string): ParseResult<T> {
  return { ok: false, code, field };
}

export function unwrap<T>(result: ParseResult<T>): T {
  if (result.ok) return result.value;
  throw new SyncEngineError(result.code, result.field);
}
