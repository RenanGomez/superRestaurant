import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { getCaptureConfirmationContext } from "../../../lib/capture-confirmation-context";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { getMenuCatalog } from "../../../lib/menu-catalog";
import { MenuImageBaseUrlProvider } from "../../../lib/menu-image-url-context";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { captureWorkspaceAction, quoteCaptureLineAction, reloadCaptureCatalog } from "./actions";
import { CaptureWorkspace } from "./capture-workspace";

export const dynamic = "force-dynamic";

export default async function CapturePage(): Promise<ReactNode> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) redirect("/login");
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) {
    redirect("/app?branchError=not_authorized");
  }
  const canOperate = membership.roles.some((role) => ["owner", "admin", "manager", "supervisor", "cashier", "waiter"].includes(role));
  const canManageAssignment = membership.roles.some((role) => ["owner", "admin", "manager", "supervisor"].includes(role));
  const confirmationContext = canOperate
    ? await getCaptureConfirmationContext(session.access_token, env.apiBaseUrl, scope)
    : undefined;
  const catalog = canOperate ? await getMenuCatalog(session.access_token, env.apiBaseUrl, scope) : undefined;
  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <header className="min-w-0"><p className="text-xs font-semibold uppercase tracking-widest text-accent">Captura telefónica</p>
      <h1 className="break-words font-heading text-2xl font-bold">Nueva captura · {membership.restaurantName}</h1>
      <p className="mt-1 break-words text-sm text-text-muted">{membership.branchName} · conexión requerida · el borrador aún no es una orden</p>
    </header>
    {canOperate && catalog !== undefined
      ? <MenuImageBaseUrlProvider url={env.supabaseUrl}><CaptureWorkspace scope={scope} action={captureWorkspaceAction} quoteLine={quoteCaptureLineAction} canManageAssignment={canManageAssignment} catalog={catalog}
        reloadCatalog={reloadCaptureCatalog} {...(confirmationContext === undefined ? {} : { confirmationContext })} /></MenuImageBaseUrlProvider>
      : canOperate ? <p role="alert" className="rounded-xl border border-border bg-surface p-5">No fue posible leer el catálogo de esta sucursal. Recarga la página.</p>
        : <p role="alert" className="rounded-xl border border-border bg-surface p-5">Tu rol no permite capturar pedidos.</p>}
  </div>;
}
