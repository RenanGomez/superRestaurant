import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { FocusRevalidate } from "../focus-revalidate";
import {
  branchOrderWorkTrayAction,
  cancelOrderItemAction,
  openOrderAction,
  orderDetailAction,
  sendToKitchenAction,
  transitionOrderItemAction,
} from "./actions";
import { OrdersTray } from "./orders-tray";

export const dynamic = "force-dynamic";

// Mirrors /app/caja's own FINANCIAL_ROLES gate: only these roles can actually check out an order
// there, so "Cobrar en caja" must not be offered to anyone else here either.
const FINANCIAL_ROLES = new Set(["owner", "admin", "manager", "supervisor", "cashier"]);

export default async function OrdersPage({ searchParams }: { readonly searchParams: Promise<{ readonly orderId?: string | string[] }> }) {
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
  const requestedOrderId = (await searchParams).orderId;
  const initialOrderId = typeof requestedOrderId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedOrderId) ? requestedOrderId : undefined;
  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <FocusRevalidate />
    <header><p className="text-xs font-semibold uppercase tracking-widest text-accent">Operación</p>
      <h1 className="font-heading text-2xl font-bold">Órdenes activas · {membership.restaurantName}</h1>
      <p className="mt-1 text-sm text-text-muted">{membership.branchName} · domicilio, recoger, mostrador y mesa</p></header>
    <OrdersTray scope={scope} action={branchOrderWorkTrayAction} initialOrderId={initialOrderId}
      canCheckout={membership.roles.some((role) => FINANCIAL_ROLES.has(role))}
      detailActions={{
        cancelItem: cancelOrderItemAction,
        detail: orderDetailAction,
        open: openOrderAction,
        sendToKitchen: sendToKitchenAction,
        transitionItem: transitionOrderItemAction,
      }} />
  </div>;
}
