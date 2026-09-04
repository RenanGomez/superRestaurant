import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BrandMark } from "../../components/brand-mark";
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

  return (
    <div className="flex min-h-screen bg-bg">
      <nav aria-label="Navegación principal" className="flex w-[76px] shrink-0 flex-col items-center gap-7 bg-nav py-5">
        <BrandMark size={36} />
        <a href="/app" title="Mesas" aria-label="Mesas" className="flex h-11 w-11 items-center justify-center rounded-xl text-white hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M16 4v16M3 10h18" />
          </svg>
        </a>
        <a href="/app/menu" title="Menú" aria-label="Menú" className="flex h-11 w-11 items-center justify-center rounded-xl text-white hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16M4 12h16M4 19h10" /><circle cx="18" cy="19" r="2" />
          </svg>
        </a>
        <a href="/app/caja" title="Caja" aria-label="Caja" className="flex h-11 w-11 items-center justify-center rounded-xl text-white hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h10M7 13h3M14 13h3" />
          </svg>
        </a>
      </nav>

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
