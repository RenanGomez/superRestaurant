import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppNav } from "./app-nav";
import { getServerEnv } from "../../env";
import { canAccessSystemAdministration } from "../../lib/system-onboarding";
import { createServerSupabaseClient } from "../../lib/supabase-server";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Protected shell for FE-0. The authoritative gate — Supabase `getUser()`
 * AND the server-to-server cross-check against `GET /api/v1/session` on
 * apps/api — runs in `src/proxy.ts`, the only boundary able to persist a
 * cleared cookie when Nest rejects a token: Server Components cannot write
 * cookies during render, so `supabase-server.ts`'s cookie adapter silently
 * swallows any write attempted from here.
 *
 * This layout only reads the already-verified user for display and redirects
 * to the fixed "/login" destination as defense in depth if it somehow
 * renders without one (a request that reached here outside the proxy's
 * matcher) — it never calls `signOut()` itself, since that write would be a
 * no-op here and previously produced a stale cookie and a `/login` ↔ `/app`
 * redirect loop.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }): Promise<ReactNode> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user === null) {
    redirect("/login");
  }

  const { data: { session } } = await supabase.auth.getSession();
  const canAccessSystemAdmin = session !== null
    && await canAccessSystemAdministration(session.access_token, getServerEnv().apiBaseUrl);

  return (
    <div className="flex min-h-screen bg-bg">
      <AppNav canAccessSystemAdmin={canAccessSystemAdmin} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-border bg-surface px-3 sm:px-8">
          <span className="text-sm font-semibold text-text-muted">superRestaurant</span>
          <div className="flex min-w-0 items-center gap-2 sm:gap-5">
            <span className="hidden min-w-0 truncate text-[13px] text-text-muted sm:inline">{user.email ?? user.id}</span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-[8px] border border-border px-3 py-1.5 text-[13px] font-medium text-text transition-colors hover:bg-bg"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
        </header>
        <main className="flex min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
