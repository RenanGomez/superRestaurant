import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getServerEnv } from "../../../env";
import { getCaptureConfirmationContext } from "../../../lib/capture-confirmation-context";
import { BRANCH_PREFERENCE_COOKIE, findMembership, parseBranchPreference } from "../../../lib/memberships";
import { getMenuCatalog } from "../../../lib/menu-catalog";
import { MenuImageBaseUrlProvider } from "../../../lib/menu-image-url-context";
import { getRequestSession, getRequestMemberships, getRequestAuthorizedBranch } from "../../../lib/request-context";
import { orderDetailAction, sendToKitchenAction } from "../orders/actions";
import { captureWorkspaceAction, quoteCaptureLineAction, reloadCaptureCatalog } from "./actions";
import { CaptureWorkspace } from "./capture-workspace";

export const dynamic = "force-dynamic";

export default async function CapturePage(): Promise<ReactNode> {
  const session = await getRequestSession();
  if (session === null) redirect("/login");
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");
  const env = getServerEnv();
  const memberships = await getRequestMemberships(session.access_token);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || await getRequestAuthorizedBranch(session.access_token, scope.restaurantId, scope.branchId) === undefined) {
    redirect("/app?branchError=not_authorized");
  }
  const canOperate = membership.roles.some((role) => ["owner", "admin", "manager", "supervisor", "cashier", "waiter"].includes(role));
  const canManageAssignment = membership.roles.some((role) => ["owner", "admin", "manager", "supervisor"].includes(role));
  const [confirmationContext, catalog] = canOperate
    ? await Promise.all([getCaptureConfirmationContext(session.access_token, env.apiBaseUrl, scope), getMenuCatalog(session.access_token, env.apiBaseUrl, scope)])
    : [undefined, undefined];
  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <header className="min-w-0"><p className="text-xs font-semibold uppercase tracking-widest text-accent">Captura telefónica</p>
      <h1 className="break-words font-heading text-2xl font-bold">Nueva captura · {membership.restaurantName}</h1>
      <p className="mt-1 break-words text-sm text-text-muted">{membership.branchName} · conexión requerida · el borrador aún no es una orden</p>
    </header>
    {canOperate && catalog !== undefined
      ? <MenuImageBaseUrlProvider url={env.supabaseUrl}><CaptureWorkspace scope={scope} action={captureWorkspaceAction} quoteLine={quoteCaptureLineAction} canManageAssignment={canManageAssignment} catalog={catalog}
        reloadCatalog={reloadCaptureCatalog} orderDetail={orderDetailAction} sendToKitchen={sendToKitchenAction}
        {...(confirmationContext === undefined ? {} : { confirmationContext })} /></MenuImageBaseUrlProvider>
      : canOperate ? <p role="alert" className="rounded-xl border border-border bg-surface p-5">No fue posible leer el catálogo de esta sucursal. Recarga la página.</p>
        : <p role="alert" className="rounded-xl border border-border bg-surface p-5">Tu rol no permite capturar pedidos.</p>}
  </div>;
}
