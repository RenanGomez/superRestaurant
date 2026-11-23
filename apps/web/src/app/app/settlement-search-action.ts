"use server";

import { cookies } from "next/headers";
import { parseSettlementSearchRequestV1, type SettlementSearchResultV1 } from "@super-restaurant/shared-types";
import { getServerEnv } from "../../env";
import { authorizeBranch } from "../../lib/branch-selection";
import { requestDelivery, type DeliveryRequestResult } from "../../lib/delivery-zones";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../lib/memberships";
import { createServerSupabaseClient } from "../../lib/supabase-server";

export async function searchSettlements(input: unknown): Promise<DeliveryRequestResult<SettlementSearchResultV1>> {
  const command = parseSettlementSearchRequestV1(input);
  if (command === undefined) return { ok: false, error: "invalid" };
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined || scope.restaurantId !== command.scope.restaurantId || scope.branchId !== command.scope.branchId)
    return { ok: false, error: "denied" };
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return { ok: false, error: "denied" };
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  if (memberships === undefined || findMembership(memberships.memberships, scope) === undefined
    || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined)
    return { ok: false, error: "denied" };
  return requestDelivery(session.access_token, env.apiBaseUrl, "settlements/search", command);
}
