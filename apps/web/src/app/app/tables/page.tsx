import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findMembership, BRANCH_PREFERENCE_COOKIE, parseBranchPreference } from "../../../lib/memberships";
import { getRequestAuthorizedBranch, getRequestMemberships, getRequestSession } from "../../../lib/request-context";
import { TablesBoard } from "./tables-board";
import { assignWaiterAction, createTableOrderAction, listWaitersAction, openShiftAction, readTablesBoardAction, setOrderAccountLabelAction, tableOrderDetailAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  const session = await getRequestSession();
  if (session === null) redirect("/login");
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app");
  // Same two checks as before (membership list and branch authorization); the layout already asked
  // for the list in this request, and the two calls no longer wait for each other.
  const [memberships, authorized] = await Promise.all([
    getRequestMemberships(session.access_token),
    getRequestAuthorizedBranch(session.access_token, scope.restaurantId, scope.branchId),
  ]);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || authorized === undefined) redirect("/app?branchError=not_authorized");
  const canManage = authorized.roles.some((role) => role === "owner" || role === "admin" || role === "manager");
  const canOpenShift = authorized.roles.some((role) => role === "owner" || role === "admin" || role === "manager" || role === "supervisor" || role === "cashier");
  return <TablesBoard scope={scope} branchName={membership.branchName} restaurantName={membership.restaurantName}
    actorId={session.user.id} canManage={canManage} canOpenShift={canOpenShift}
    actions={{ read: readTablesBoardAction, create: createTableOrderAction, assign: assignWaiterAction, setAccountLabel: setOrderAccountLabelAction, waiters: listWaitersAction, openShift: openShiftAction, detail: tableOrderDetailAction }} />;
}
