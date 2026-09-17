"use server";

import { cookies } from "next/headers";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { customerOperations, requestCustomerDirectory } from "../../../lib/customer-directory";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import type { CustomerAction, CustomerActionResult } from "./customer-editor";

export async function customerDirectoryAction(operation: CustomerAction, input: unknown): Promise<CustomerActionResult> {
  if (!Object.hasOwn(customerOperations, operation)) return { ok: false, error: "invalid" };
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return { ok: false, error: "denied" };
  const store = await cookies();
  const scope = parseBranchPreference(store.get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) return { ok: false, error: "denied" };
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  if (memberships === undefined || findMembership(memberships.memberships, scope) === undefined
    || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) return { ok: false, error: "denied" };
  const parsed = customerOperations[operation].input(input);
  if (parsed === undefined || parsed.scope.restaurantId !== scope.restaurantId || parsed.scope.branchId !== scope.branchId) return { ok: false, error: "invalid" };
  if (operation === "search") return requestCustomerDirectory(session.access_token, env.apiBaseUrl, "search", parsed);
  if (operation === "detail") return requestCustomerDirectory(session.access_token, env.apiBaseUrl, "detail", parsed);

  // Device identity is metadata, never authentication. Preserve the complete command on replay.
  const command = parsed;
  const mutation = await requestCustomerDirectory(session.access_token, env.apiBaseUrl, operation, command);
  if (!mutation.ok) return { ...mutation, command: mutation.error === "unavailable" ? command : undefined };
  const detail = await requestCustomerDirectory(session.access_token, env.apiBaseUrl, "detail", {
    schemaVersion: 1, scope, customerId: mutation.value.record.customerId,
  });
  if (!detail.ok) return { ...detail, command: detail.error === "unavailable" ? command : undefined };
  return detail;
}
