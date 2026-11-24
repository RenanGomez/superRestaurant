import { cookies } from "next/headers";

import { getServerEnv } from "../../../../env";
import { authorizeBranch } from "../../../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, parseBranchPreference } from "../../../../lib/memberships";
import { createServerSupabaseClient } from "../../../../lib/supabase-server";
import { handleSyncProxyRequest } from "../sync-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Upper bound for one upstream push/pull/snapshot; the route never hangs on a stalled API. */
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Same-origin bridge for `POST /api/sync/{push|pull|snapshot}`.
 *
 * The browser never receives a Supabase token or the API origin: this handler
 * authenticates with the httpOnly session cookie, re-authorizes the exact
 * Restaurant/Branch scope in the body against `apps/api`, and only then forwards
 * the already-validated sync envelope untouched. All rejection policy (cross-site,
 * size, content type, scope mismatch) lives in `handleSyncProxyRequest`; this file
 * only supplies the real dependencies and the bounded upstream fetch.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly action: string }> },
): Promise<Response> {
  const { action } = await context.params;
  const env = getServerEnv();

  return handleSyncProxyRequest(request, action, {
    authorize: async (accessToken, scope) =>
      (await authorizeBranch(accessToken, env.apiBaseUrl, scope)) !== undefined,
    forward: async ({ action: forwardedAction, accessToken, body }) => {
      let upstream: Response;
      try {
        upstream = await fetch(`${env.apiBaseUrl}/api/v1/sync/${forwardedAction}`, {
          body,
          cache: "no-store",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch {
        return new Response(null, { status: 503 });
      }
      return new Response(await upstream.arrayBuffer(), {
        headers: {
          "cache-control": "no-store",
          "content-type": upstream.headers.get("content-type") ?? "application/json",
        },
        status: upstream.status,
      });
    },
    getCookieScope: async () =>
      parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value),
    getSession: async () => {
      const supabase = await createServerSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      return session === null ? null : { accessToken: session.access_token };
    },
  });
}
