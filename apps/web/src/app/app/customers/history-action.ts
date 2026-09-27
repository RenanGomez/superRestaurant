"use server";

import { cookies } from "next/headers";
import { parseCustomerRecentOrdersQueryV1, type CustomerRecentOrderListV1 } from "@super-restaurant/shared-types";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { requestCustomerOrder } from "../../../lib/customer-order-history";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";

export async function customerHistoryAction(input: unknown): Promise<{ ok: true; value: CustomerRecentOrderListV1 } | { ok: false }> {
  const query = parseCustomerRecentOrdersQueryV1(input);
  if (query === undefined) return { ok: false };
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return { ok: false };
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined || query.scope.restaurantId !== scope.restaurantId || query.scope.branchId !== scope.branchId) return { ok: false };
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  if (memberships === undefined || findMembership(memberships.memberships, scope) === undefined
    || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) return { ok: false };
  const result = await requestCustomerOrder(session.access_token, env.apiBaseUrl, "recentOrders", query);
  return result.ok && "orders" in result.value ? { ok: true, value: result.value } : { ok: false };
}
