import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "../../../env";
import { BRANCH_PREFERENCE_COOKIE, findMembership, parseBranchPreference } from "../../../lib/memberships";
import { MenuImageBaseUrlProvider } from "../../../lib/menu-image-url-context";
import { getRequestSession, getRequestMemberships, getRequestAuthorizedBranch } from "../../../lib/request-context";
import { FocusRevalidate } from "../focus-revalidate";
import {
  branchOrderWorkTrayAction,
  addOrderItemAction,
  cancelOrderAction,
  cancelOrderItemAction,
  cancelledWorkTrayAction,
  openOrderAction,
  orderDetailAction,
  orderMenuCatalogAction,
  tableNamesAction,
  sendToKitchenAction,
  transitionOrderItemAction,
} from "./actions";
import { OrdersTray } from "./orders-tray";

export const dynamic = "force-dynamic";

// Mirrors /app/caja's own FINANCIAL_ROLES gate: only these roles can actually check out an order
// there, so "Cobrar en caja" must not be offered to anyone else here either.
const FINANCIAL_ROLES = new Set(["owner", "admin", "manager", "supervisor", "cashier"]);

export default async function OrdersPage() {
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
  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <FocusRevalidate />
    <header><p className="text-xs font-semibold uppercase tracking-widest text-accent">Operación</p>
      <h1 className="font-heading text-2xl font-bold">Órdenes · {membership.restaurantName}</h1>
      <p className="mt-1 text-sm text-text-muted">{membership.branchName} · domicilio, recoger, mostrador y mesa</p></header>
    <MenuImageBaseUrlProvider url={env.supabaseUrl}><OrdersTray scope={scope} action={branchOrderWorkTrayAction}
      canCheckout={membership.roles.some((role) => FINANCIAL_ROLES.has(role))}
      printHeader={{ restaurantName: membership.restaurantName, branchName: membership.branchName }}
      cancelledAction={cancelledWorkTrayAction}
      tableNamesAction={tableNamesAction}
      detailActions={{
        addItem: addOrderItemAction,
        cancelItem: cancelOrderItemAction,
        cancelOrder: cancelOrderAction,
        detail: orderDetailAction,
        menuCatalog: orderMenuCatalogAction,
        open: openOrderAction,
        sendToKitchen: sendToKitchenAction,
        transitionItem: transitionOrderItemAction,
      }} /></MenuImageBaseUrlProvider>
  </div>;
}
