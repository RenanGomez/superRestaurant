import { parseSyncScopeV1 } from "@super-restaurant/shared-types";
import { cookies } from "next/headers";

import { getServerEnv } from "../../../../env";
import { authorizeBranch } from "../../../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, parseBranchPreference } from "../../../../lib/memberships";
import { createServerSupabaseClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYNC_ACTIONS: ReadonlySet<string> = new Set(["push", "pull", "snapshot"]);
/** Request body cap: sync batches are bounded by the engine, this only rejects abuse. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Same-origin bridge for `POST /api/sync/{push|pull|snapshot}`.
 *
 * The browser never receives a Supabase token or the API origin: this handler
 * authenticates with the httpOnly session cookie, re-authorizes the exact
 * Restaurant/Branch scope in the body against `apps/api`, and only then forwards
 * the already-validated sync envelope untouched. The client-side
 * `createWebSyncTransport` talks to this route, so the transport stays the same
 * one the tests cover while credentials remain server-side.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly action: string }> },
): Promise<Response> {
  const { action } = await context.params;
  if (!SYNC_ACTIONS.has(action)) return new Response(null, { status: 404 });

  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    return new Response(null, { status: 400 });
  }
  const bodyScope = typeof body === "object" && body !== null
    ? parseSyncScopeV1((body as { readonly scope?: unknown }).scope)
    : undefined;
  if (bodyScope === undefined) return new Response(null, { status: 400 });

  const cookieScope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (
    cookieScope === undefined
    || cookieScope.restaurantId !== bodyScope.restaurantId
    || cookieScope.branchId !== bodyScope.branchId
  ) {
    return new Response(null, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return new Response(null, { status: 401 });

  const env = getServerEnv();
  if (await authorizeBranch(session.access_token, env.apiBaseUrl, bodyScope) === undefined) {
    return new Response(null, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${env.apiBaseUrl}/api/v1/sync/${action}`, {
      body: bodyText,
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
  } catch {
    return new Response(null, { status: 503 });
  }

  const responseBody = await upstream.arrayBuffer();
  return new Response(responseBody, {
    headers: {
      "cache-control": "no-store",
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
    status: upstream.status,
  });
}
