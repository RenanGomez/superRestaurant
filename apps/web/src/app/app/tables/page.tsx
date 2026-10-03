import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { TablesBoard } from "./tables-board";
import { assignWaiterAction, createTableOrderAction, openShiftAction, readTablesBoardAction, tableOrderDetailAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) redirect("/login");
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  const authorized = membership === undefined ? undefined : await authorizeBranch(session.access_token, env.apiBaseUrl, scope);
  if (membership === undefined || authorized === undefined) redirect("/app?branchError=not_authorized");
  const canManage = authorized.roles.some((role) => role === "owner" || role === "admin" || role === "manager");
  const canOpenShift = authorized.roles.some((role) => role === "owner" || role === "admin" || role === "manager" || role === "supervisor" || role === "cashier");
  return <TablesBoard scope={scope} branchName={membership.branchName} restaurantName={membership.restaurantName}
    actorId={session.user.id} actorName={session.user.email ?? null} canManage={canManage} canOpenShift={canOpenShift}
    actions={{ read: readTablesBoardAction, create: createTableOrderAction, assign: assignWaiterAction, openShift: openShiftAction, detail: tableOrderDetailAction }} />;
}
