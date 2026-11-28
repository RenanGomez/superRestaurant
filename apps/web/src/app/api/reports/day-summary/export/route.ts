import { cookies } from "next/headers";

import { getServerEnv } from "../../../../../env";
import { isCalendarDate } from "../../../../../lib/day-summary";
import { BRANCH_PREFERENCE_COOKIE, parseBranchPreference } from "../../../../../lib/memberships";
import { createServerSupabaseClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Upper bound for one upstream CSV export; the route never hangs on a stalled API. */
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Same-origin bridge for `GET /api/reports/day-summary/export`.
 *
 * Authenticates via the httpOnly session cookie and reads Restaurant/Branch scope
 * exclusively from the branch preference cookie (never from query parameters),
 * then streams the API response bytes untouched to the browser.
 */
export async function GET(request: Request): Promise<Response> {
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) return new Response(null, { status: 401 });

  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return new Response(null, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (date === null || !isCalendarDate(date)) return new Response(null, { status: 400 });

  const query = new URLSearchParams({
    branchId: scope.branchId,
    date,
    format: "csv",
    restaurantId: scope.restaurantId,
  });
  if (searchParams.get("bom") === "1") query.set("bom", "1");

  const env = getServerEnv();
  let upstream: Response;
  try {
    upstream = await fetch(`${env.apiBaseUrl}/api/v1/reports/day-summary/export?${query.toString()}`, {
      cache: "no-store",
      headers: {
        accept: "text/csv",
        authorization: `Bearer ${session.access_token}`,
      },
      method: "GET",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return new Response(null, { status: 503 });
  }

  const headers = new Headers({ "cache-control": "no-store" });
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  const contentDisposition = upstream.headers.get("content-disposition");
  if (contentDisposition !== null) headers.set("content-disposition", contentDisposition);

  return new Response(await upstream.arrayBuffer(), {
    headers,
    status: upstream.status,
  });
}
