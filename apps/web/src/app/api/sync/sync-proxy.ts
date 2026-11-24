import { parseSyncScopeV1, type BranchScope } from "@super-restaurant/shared-types";

const SYNC_ACTIONS: ReadonlySet<string> = new Set(["push", "pull", "snapshot"]);
/** Request body cap: the engine already bounds batches, this only rejects abuse. */
export const SYNC_PROXY_MAX_BODY_BYTES = 8 * 1024 * 1024;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/iu;

export interface SyncProxyDependencies {
  /** Restaurant/Branch currently selected by the authenticated session cookie. */
  readonly getCookieScope: () => Promise<BranchScope | undefined>;
  readonly getSession: () => Promise<{ readonly accessToken: string } | null>;
  readonly authorize: (accessToken: string, scope: BranchScope) => Promise<boolean>;
  /** Performs the upstream call and maps its status/body; owns the request timeout. */
  readonly forward: (input: {
    readonly action: string;
    readonly accessToken: string;
    readonly body: string;
  }) => Promise<Response>;
}

function reject(status: number): Response {
  return new Response(null, { status });
}

/**
 * Pure request pipeline of `POST /api/sync/{push|pull|snapshot}`.
 *
 * Kept free of Next/Supabase imports so it can be tested directly. The route
 * supplies the cookie/session/authorization/fetch dependencies; this function
 * decides every rejection in a fixed, fail-closed order:
 *
 * 1. unknown action â†’ 404;
 * 2. `Sec-Fetch-Site: cross-site` â†’ 403 (a cookie-authenticated mutation must
 *    never be driven from another site);
 * 3. declared `Content-Length` too large â†’ 413, malformed â†’ 400;
 * 4. non-`application/json` body â†’ 415;
 * 5. real `Buffer.byteLength(body)` too large â†’ 413 (header can lie);
 * 6. malformed JSON/scope â†’ 400;
 * 7. body scope different from the cookie scope â†’ 403;
 * 8. no session â†’ 401;
 * 9. API denies the scope â†’ 403.
 */
export async function handleSyncProxyRequest(
  request: Request,
  action: string,
  deps: SyncProxyDependencies,
  maxBodyBytes: number = SYNC_PROXY_MAX_BODY_BYTES,
): Promise<Response> {
  if (!SYNC_ACTIONS.has(action)) return reject(404);

  if (request.headers.get("sec-fetch-site")?.trim().toLowerCase() === "cross-site") return reject(403);

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return reject(400);
    if (parsed > maxBodyBytes) return reject(413);
  }

  const contentType = request.headers.get("content-type");
  if (contentType === null || !JSON_CONTENT_TYPE.test(contentType.trim())) return reject(415);

  const bodyText = await request.text();
  if (Buffer.byteLength(bodyText, "utf8") > maxBodyBytes) return reject(413);

  let body: unknown;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    return reject(400);
  }
  const bodyScope = typeof body === "object" && body !== null
    ? parseSyncScopeV1((body as { readonly scope?: unknown }).scope)
    : undefined;
  if (bodyScope === undefined) return reject(400);

  const cookieScope = await deps.getCookieScope();
  if (
    cookieScope === undefined
    || cookieScope.restaurantId !== bodyScope.restaurantId
    || cookieScope.branchId !== bodyScope.branchId
  ) {
    return reject(403);
  }

  const session = await deps.getSession();
  if (session === null) return reject(401);

  if (!(await deps.authorize(session.accessToken, bodyScope))) return reject(403);

  return deps.forward({ action, accessToken: session.accessToken, body: bodyText });
}
