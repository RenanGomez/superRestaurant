import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getServerEnv } from "./env";
import { verifyRemoteSession } from "./lib/session";

const LOGIN_PATH = "/login";
const APP_PATH_PREFIX = "/app";

/**
 * Runs on every request to `/login` and `/app/*`. This is the only boundary
 * that can persist cleared cookies: Server Components (see
 * `src/app/app/layout.tsx`) cannot write cookies during render, so both the
 * Supabase JWT check and the server-to-server cross-check against
 * `GET /api/v1/session` on apps/api happen here, once per request, and any
 * rejection signs the session out from a place that can actually clear it.
 *
 * Redirect destinations are fixed constants, never a caller-supplied
 * `redirectTo`: this is the "destinos fijos" requirement in frontend.md and
 * closes off open-redirect risk. `redirectPreservingCookies` guarantees a
 * redirect response never drops cookies the Supabase client just refreshed
 * or cleared on the in-flight `response`.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: env.cookiesSecure,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { pathname } = request.nextUrl;
  const isProtected = pathname.startsWith(APP_PATH_PREFIX);
  const isServerAction = request.method === "POST" && request.headers.has("next-action");

  const { data: { user } } = await supabase.auth.getUser();

  if (isProtected) {
    response.headers.set("Cache-Control", "private, no-store");

    if (user === null) {
      if (isServerAction) return response;
      return redirectPreservingCookies(LOGIN_PATH, request, response, { cacheControl: true });
    }

    const { data: { session } } = await supabase.auth.getSession();
    const remoteSession = session === null
      ? undefined
      : await verifyRemoteSession(session.access_token, env.apiBaseUrl);

    if (remoteSession === undefined) {
      await supabase.auth.signOut({ scope: "local" });
      if (isServerAction) {
        response.headers.set("Cache-Control", "private, no-store");
        return response;
      }
      return redirectPreservingCookies(LOGIN_PATH, request, response, { cacheControl: true });
    }
  }

  if (pathname === LOGIN_PATH && user !== null) {
    return redirectPreservingCookies(APP_PATH_PREFIX, request, response);
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/login"],
};

/**
 * Builds a redirect to a fixed, in-repo destination and copies every cookie
 * already set on `from` (a token refresh, or a `signOut()` clear) onto it.
 * `NextResponse.redirect(...)` starts a brand new response object: without
 * this, a session-cookie mutation made earlier in the same request would be
 * silently dropped, and a rejected session would never actually clear its
 * cookie — the exact bug this closes.
 */
export function redirectPreservingCookies(
  destination: typeof LOGIN_PATH | typeof APP_PATH_PREFIX,
  request: NextRequest,
  from: NextResponse,
  options?: { readonly cacheControl?: boolean },
): NextResponse {
  const redirected = NextResponse.redirect(new URL(destination, request.url));
  for (const cookie of from.cookies.getAll()) {
    redirected.cookies.set(cookie);
  }
  if (options?.cacheControl === true) {
    redirected.headers.set("Cache-Control", "private, no-store");
  }
  return redirected;
}
