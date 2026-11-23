import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getServerEnv } from "../../../env";
import { readBranchTimeZone } from "../../../lib/deliveries";
import { BRANCH_PREFERENCE_COOKIE, findMembership, parseBranchPreference } from "../../../lib/memberships";
import {
  getRequestAuthorizedBranch,
  getRequestMemberships,
  getRequestSession,
} from "../../../lib/request-context";
import { isSupervisorRoleList } from "../../../lib/sync-ui";
import { fetchManualReviewCases } from "./server-fetch";
import { SyncDashboard } from "./sync-dashboard";

export const dynamic = "force-dynamic";

export default async function SyncPage(): Promise<ReactNode> {
  const session = await getRequestSession();
  if (session === null) {
    redirect("/login");
  }

  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) {
    redirect("/app");
  }

  const env = getServerEnv();
  const [memberships, authorized] = await Promise.all([
    getRequestMemberships(session.access_token),
    getRequestAuthorizedBranch(session.access_token, scope.restaurantId, scope.branchId),
  ]);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || authorized === undefined) {
    redirect("/app?branchError=not_authorized");
  }

  const [timeZone, initialReviewOutcome] = await Promise.all([
    readBranchTimeZone(session.access_token, env.apiBaseUrl, scope),
    fetchManualReviewCases(session.access_token, env.apiBaseUrl, scope),
  ]);

  const initialConfirmedAt =
    initialReviewOutcome.status === "ok" ? initialReviewOutcome.confirmedAt : null;

  return (
    <SyncDashboard
      branchName={membership.branchName}
      restaurantName={membership.restaurantName}
      scope={scope}
      timeZone={timeZone}
      canResolveManualReview={isSupervisorRoleList(authorized.roles)}
      initialConfirmedAt={initialConfirmedAt}
      initialReviewOutcome={initialReviewOutcome}
    />
  );
}
