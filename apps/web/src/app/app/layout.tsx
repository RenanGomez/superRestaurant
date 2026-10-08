import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BRANCH_PREFERENCE_COOKIE, findMembership, parseBranchPreference } from "../../lib/memberships";
import { getRequestMemberships, getRequestSession, getRequestSystemAdminAccess, getRequestUser } from "../../lib/request-context";

import { AppNav } from "./app-nav";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";

const REPORT_ROLES = new Set(["owner", "admin", "manager", "supervisor", "viewer", "auditor"]);

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
 *
 * Remote reads go through `request-context.ts` so the page rendered inside
 * this layout reuses them instead of repeating the same calls.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }): Promise<ReactNode> {
  const [user, session] = await Promise.all([getRequestUser(), getRequestSession()]);

  if (user === null) {
    redirect("/login");
  }

  const [canAccessSystemAdmin, memberships] = session === null
    ? [false, undefined]
    : await Promise.all([getRequestSystemAdminAccess(session.access_token), getRequestMemberships(session.access_token)]);

  // Menu hint only (mirrors the RBAC policy's `reports.read` roles); the API decides.
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  const membership = memberships === undefined || scope === undefined ? undefined : findMembership(memberships.memberships, scope);
  const canReadReports = membership?.roles.some((role) => REPORT_ROLES.has(role)) ?? false;
  const canSwitchBranch = (memberships?.memberships.length ?? 0) > 1;

  return (
    <div className="flex min-h-screen bg-bg">
      <AppNav canAccessSystemAdmin={canAccessSystemAdmin} canReadReports={canReadReports} branchName={membership?.branchName} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[68px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 sm:px-8">
          <span className="text-sm font-semibold text-text-muted">superRestaurant</span>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-5">
            {membership !== undefined && (
              <span className="flex min-w-0 items-center gap-2 text-[13px] text-text">
                <span className="min-w-0 truncate"><span className="sr-only">Sucursal activa: </span>{membership.branchName}</span>
                {canSwitchBranch && (
                  <Link href="/app?change=1" className="inline-flex min-h-11 items-center rounded-[8px] border border-border px-3 text-[13px] font-medium link-text transition-colors hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    Cambiar sucursal
                  </Link>
                )}
              </span>
            )}
            <span className="hidden min-w-0 truncate text-[13px] text-text-muted md:inline">{user.email ?? user.id}</span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="min-h-11 rounded-[8px] border border-border px-3 py-1.5 text-[13px] font-medium text-text transition-colors hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
