"use server";

import { cookies } from "next/headers";
import { parseBranchOrderWorkTrayRequestV1 } from "@super-restaurant/shared-types";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { requestBranchOrderWorkTray, type BranchOrderTrayRequestResult } from "../../../lib/branch-order-work-tray";
import { BRANCH_PREFERENCE_COOKIE, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";

export async function branchOrderWorkTrayAction(input: unknown): Promise<BranchOrderTrayRequestResult> {
  const request = parseBranchOrderWorkTrayRequestV1(input);
  if (request === undefined) return { error: "invalid", ok: false };
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined || request.scope.restaurantId !== scope.restaurantId || request.scope.branchId !== scope.branchId) {
    return { error: "invalid", ok: false };
  }
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return { error: "denied", ok: false };
  const env = getServerEnv();
  if (await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) return { error: "denied", ok: false };
  return requestBranchOrderWorkTray(session.access_token, env.apiBaseUrl, scope, request.cursor, request.limit);
}
