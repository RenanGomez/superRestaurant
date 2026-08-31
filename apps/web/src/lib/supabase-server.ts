import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getServerEnv } from "../env";

/**
 * Server-only Supabase Auth client for Server Components and Server Actions.
 *
 * There is no browser Supabase client anywhere in apps/web: this is the only
 * place `@supabase/ssr` is constructed, cookies are host-only (no `domain`),
 * `httpOnly`, `sameSite: "lax"`, and `secure` whenever the app's own origin is
 * HTTPS. Writing cookies from a Server Component render is a no-op by design;
 * `proxy.ts` is what actually refreshes and persists the session on every
 * request.
 */
export async function createServerSupabaseClient() {
  const env = getServerEnv();
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: env.cookiesSecure,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called during a Server Component render, where cookies cannot be
          // written. proxy.ts refreshes the session on every request.
        }
      },
    },
  });
}
