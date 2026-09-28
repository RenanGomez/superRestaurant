import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { FocusRevalidate } from "../focus-revalidate";
import { branchOrderWorkTrayAction } from "./actions";
import { OrdersTray } from "./orders-tray";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
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
  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
    <FocusRevalidate />
    <header><p className="text-xs font-semibold uppercase tracking-widest text-accent">Operación</p>
      <h1 className="font-heading text-2xl font-bold">Órdenes activas · {membership.restaurantName}</h1>
      <p className="mt-1 text-sm text-text-muted">{membership.branchName} · domicilio, recoger, mostrador y mesa</p></header>
    <OrdersTray scope={scope} action={branchOrderWorkTrayAction} />
  </div>;
}
