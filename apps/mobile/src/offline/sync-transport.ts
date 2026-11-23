/**
 * HTTP implementation of `SyncTransportPort` for the mobile app.
 *
 * The engine owns every decision about the response (`parsePushResponse`,
 * `parsePullResponse`); this adapter only carries the request, attaches the
 * bearer token **per call** so a renewed session is picked up without rebuilding
 * the transport, and turns failures into the stable `SyncTransportError` codes
 * the engine already understands.
 *
 * Security rules (ADR-005 §4.1, OFFLINE_SYNC_CONTRACT §12):
 *
 * - the token is read from the auth adapter on every request and never logged,
 *   stored or echoed back;
 * - no request body is built here: the engine already validated every envelope
 *   with `payload-guard`, so this adapter cannot introduce PAN, CVV or secrets;
 * - `canSend` is the revocation gate. It is consulted **before** the request is
 *   built, so a signed-out or revoked device produces a non-retryable
 *   `AUTH_REVOKED` instead of traffic, and a gate that closed mid-flight can
 *   still abort an in-progress fetch.
 */
import {
  SyncTransportError,
  type SyncPullRequest,
  type SyncPushRequest,
  type SyncSnapshotResyncRequest,
  type SyncTransportPort,
} from "@super-restaurant/sync-engine";

export const MOBILE_SYNC_PATHS = Object.freeze({
  push: "/sync/push",
  pull: "/sync/pull",
  snapshot: "/sync/snapshot",
});

export interface MobileSyncTransportPaths {
  readonly push: string;
  readonly pull: string;
  readonly snapshot: string;
}

export interface MobileSyncTransportOptions {
  /** API origin, e.g. `https://api.example.com`; a path prefix is allowed. */
  readonly apiBaseUrl: string;
  /** Current bearer token, or `undefined` when there is no session. */
  readonly accessToken: () => Promise<string | undefined>;
  readonly fetcher?: typeof fetch;
  readonly paths?: Partial<MobileSyncTransportPaths>;
  /**
   * Overall bound in milliseconds for one `push`/`pull`/`pullSnapshot` attempt,
   * including the token read, the body transfer, an optional 401 refresh and the
   * retried request. `0` disables the timer; default 30 seconds. The adapter never
   * runs longer than this for one call.
   */
  readonly timeoutMs?: number;
  /** Revocation gate: `false` blocks the request before it is built. */
  readonly canSend?: () => boolean;
  /**
   * Called once after a `401` to renew the bearer token. The request is retried
   * with the returned token; a `401` that survives the retry stays retryable
   * (`AUTH_EXPIRED`) unless the server explicitly declares a revocation code.
   */
  readonly refreshAccessToken?: () => Promise<string | undefined>;
}

/** Status-to-code mapping, kept explicit so retryability is never guessed by the engine. */
export interface SyncHttpFailure {
  readonly code: string;
  readonly retryable: boolean;
}

/** Codes the server may put in the error body to revoke the session outright. */
const SERVER_REVOCATION_CODES: ReadonlySet<string> = new Set(["AUTH_REVOKED", "DEVICE_REVOKED"]);

/**
 * `401` alone is an expired/absent credential, not a revocation: the caller can
 * renew the token and retry. Only a `401`/`403` whose body declares a
 * revocation code ends the session. A plain `403` does not revoke a scope.
 */
export function classifySyncHttpStatus(status: number, declaredCode?: string | null): SyncHttpFailure {
  const declared = typeof declaredCode === "string" && SERVER_REVOCATION_CODES.has(declaredCode) ? declaredCode : null;
  if (status === 401) return declared === null ? { code: "AUTH_EXPIRED", retryable: true } : { code: declared, retryable: false };
  if (status === 403) return { code: declared ?? "HTTP_403", retryable: false };
  // Endpoint deployment errors must retain the batch for a later retry.
  if (status === 404 || status === 405) return { code: `HTTP_${status}`, retryable: true };
  if (status === 408 || status === 425 || status === 429) return { code: `HTTP_${status}`, retryable: true };
  if (status >= 500) return { code: `HTTP_${status}`, retryable: true };
  return { code: `HTTP_${status}`, retryable: false };
}

async function readDeclaredRevocationCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body !== "object" || body === null) return null;
    const code = (body as { readonly code?: unknown }).code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

export function createMobileSyncTransport(options: MobileSyncTransportOptions): SyncTransportPort {
  const base = normalizeBaseUrl(options.apiBaseUrl);
  const paths: MobileSyncTransportPaths = Object.freeze({
    push: normalizePath(options.paths?.push ?? MOBILE_SYNC_PATHS.push),
    pull: normalizePath(options.paths?.pull ?? MOBILE_SYNC_PATHS.pull),
    snapshot: normalizePath(options.paths?.snapshot ?? MOBILE_SYNC_PATHS.snapshot),
  });
  const fetcher = options.fetcher ?? fetch;

  async function send(path: string, body: unknown, token: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      if (timeoutMs > 0) timer = setTimeout(() => { controller.abort(); reject(new SyncTransportError("TRANSPORT_ERROR", true)); }, timeoutMs);
    });
    try {
      const operation = (async (): Promise<Response> => {
        const response = await fetcher(`${base}${path}`, {
          body: JSON.stringify(body), cache: "no-store", method: "POST", signal: controller.signal,
          headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
        });
        const bytes = await response.arrayBuffer();
        return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
      })();
      return await (timeoutMs > 0 ? Promise.race([operation, timeout]) : operation);
    } catch {
      throw new SyncTransportError("TRANSPORT_ERROR", true);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Rejects with the transport timeout once `ms` elapses, bounding an external await. */
  async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    if (ms <= 0) throw new SyncTransportError("TRANSPORT_ERROR", true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new SyncTransportError("TRANSPORT_ERROR", true)), ms);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function post(path: string, body: unknown): Promise<unknown> {
    if (options.canSend !== undefined && !options.canSend()) {
      throw new SyncTransportError("AUTH_REVOKED", false);
    }
    // One deadline for the whole attempt: token read, send, refresh and retry.
    const totalTimeout = options.timeoutMs ?? 30_000;
    const deadline = Date.now() + (totalTimeout > 0 ? totalTimeout : 0);
    const remaining = (): number => (totalTimeout > 0 ? Math.max(0, deadline - Date.now()) : 0);
    const remainingOrThrow = (): number => {
      const left = remaining();
      if (totalTimeout > 0 && left <= 0) throw new SyncTransportError("TRANSPORT_ERROR", true);
      return left;
    };

    let token: string | undefined;
    try {
      token = await options.accessToken();
    } catch {
      throw new SyncTransportError("AUTH_UNAVAILABLE", true);
    }
    if (token === undefined || token.length === 0) throw new SyncTransportError("AUTH_REQUIRED", false);
    // Re-check after the async token read: a sign-out that landed meanwhile wins.
    if (options.canSend !== undefined && !options.canSend()) {
      throw new SyncTransportError("AUTH_REVOKED", false);
    }

    let response = await send(path, body, token, remainingOrThrow());

    // A 401 means the credential may simply have expired: renew once and retry
    // before classifying it. A sign-out that lands meanwhile still wins.
    if (response.status === 401 && options.refreshAccessToken !== undefined) {
      const declared = await readDeclaredRevocationCode(response.clone());
      if (declared !== null && SERVER_REVOCATION_CODES.has(declared)) {
        throw new SyncTransportError(declared, false);
      }
      let refreshed: string | undefined;
      try {
        const refresh = options.refreshAccessToken();
        refreshed = totalTimeout > 0 ? await withTimeout(refresh, remainingOrThrow()) : await refresh;
      } catch (error) {
        // A deadline overrun is the transport's timeout, not a recoverable
        // refresh failure: surface it so the engine retries the batch later.
        if (error instanceof SyncTransportError && error.code === "TRANSPORT_ERROR") throw error;
        refreshed = undefined;
      }
      if (options.canSend !== undefined && !options.canSend()) {
        throw new SyncTransportError("AUTH_REVOKED", false);
      }
      if (refreshed !== undefined && refreshed.length > 0) {
        token = refreshed;
        response = await send(path, body, token, remainingOrThrow());
      }
    }

    if (!response.ok) {
      const declared = response.status === 401 || response.status === 403
        ? await readDeclaredRevocationCode(response)
        : null;
      const failure = classifySyncHttpStatus(response.status, declared);
      throw new SyncTransportError(failure.code, failure.retryable);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new SyncTransportError("RESPONSE_INVALID", true);
    }
  }

  return Object.freeze({
    push: (request: SyncPushRequest): Promise<unknown> => post(paths.push, request),
    pull: (request: SyncPullRequest): Promise<unknown> => post(paths.pull, request),
    pullSnapshot: (request: SyncSnapshotResyncRequest): Promise<unknown> => post(paths.snapshot, request),
  });
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SyncTransportError("CONFIG_INVALID", false);
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) {
    throw new SyncTransportError("CONFIG_INVALID", false);
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw new SyncTransportError("CONFIG_INVALID", false);
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/u, "");
}

function normalizePath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://") || value.includes("..")) {
    throw new SyncTransportError("CONFIG_INVALID", false);
  }
  return value;
}
