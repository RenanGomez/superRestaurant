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
  push: "/sync",
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
  /** Milliseconds before the request is aborted; `0` or omitted disables the timer. */
  readonly timeoutMs?: number;
  /** Revocation gate: `false` blocks the request before it is built. */
  readonly canSend?: () => boolean;
}

/** Status-to-code mapping, kept explicit so retryability is never guessed by the engine. */
export interface SyncHttpFailure {
  readonly code: string;
  readonly retryable: boolean;
}

export function classifySyncHttpStatus(status: number): SyncHttpFailure {
  if (status === 401 || status === 403) return { code: "AUTH_REVOKED", retryable: false };
  if (status === 408 || status === 425 || status === 429) return { code: `HTTP_${status}`, retryable: true };
  if (status >= 500) return { code: `HTTP_${status}`, retryable: true };
  return { code: `HTTP_${status}`, retryable: false };
}

export function createMobileSyncTransport(options: MobileSyncTransportOptions): SyncTransportPort {
  const base = normalizeBaseUrl(options.apiBaseUrl);
  const paths: MobileSyncTransportPaths = Object.freeze({
    push: normalizePath(options.paths?.push ?? MOBILE_SYNC_PATHS.push),
    pull: normalizePath(options.paths?.pull ?? MOBILE_SYNC_PATHS.pull),
    snapshot: normalizePath(options.paths?.snapshot ?? MOBILE_SYNC_PATHS.snapshot),
  });
  const fetcher = options.fetcher ?? fetch;

  async function post(path: string, body: unknown): Promise<unknown> {
    if (options.canSend !== undefined && !options.canSend()) {
      throw new SyncTransportError("AUTH_REVOKED", false);
    }
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

    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timeoutMs = options.timeoutMs ?? 0;
    const timer = controller !== null && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        body: JSON.stringify(body),
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
        ...(controller === null ? {} : { signal: controller.signal }),
      });
    } catch {
      throw new SyncTransportError("TRANSPORT_ERROR", true);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }

    if (!response.ok) {
      const failure = classifySyncHttpStatus(response.status);
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
