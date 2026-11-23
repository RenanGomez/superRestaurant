"use server";

import { cookies } from "next/headers";
import { parseBranchScope, type CaptureWorkTrayResultV1 } from "@super-restaurant/shared-types";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { requestCustomerOpenCaptures } from "../../../lib/customer-order-history";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type CustomerOpenCapturesActionResult = { ok: true; value: CaptureWorkTrayResultV1 } | { ok: false };

export async function customerOpenCapturesAction(input: unknown): Promise<CustomerOpenCapturesActionResult> {
  if (typeof input !== "object" || input === null
    || !("scope" in input) || !("customerId" in input)
    || typeof input.customerId !== "string" || !UUID_PATTERN.test(input.customerId)) return { ok: false };
  const scope = parseBranchScope(input.scope);
  if (scope === undefined) return { ok: false };
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return { ok: false };
  const currentScope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (currentScope === undefined || currentScope.restaurantId !== scope.restaurantId
    || currentScope.branchId !== scope.branchId) return { ok: false };
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  if (memberships === undefined || findMembership(memberships.memberships, scope) === undefined
    || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) return { ok: false };
  const result = await requestCustomerOpenCaptures(session.access_token, env.apiBaseUrl, scope, input.customerId);
  return result.ok ? { ok: true, value: result.value } : { ok: false };
}
