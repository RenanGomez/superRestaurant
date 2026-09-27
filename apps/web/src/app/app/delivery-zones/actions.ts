"use server";

import { cookies } from "next/headers";
import { parseListDeliveryZonesQueryV1, parseRequestDeliveryQuoteCommandV1,
  parseUpsertDeliveryZoneCommandV1 } from "@super-restaurant/shared-types";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { requestDelivery, type DeliveryOperation, type DeliveryRequestResult } from "../../../lib/delivery-zones";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import type { DeliveryQuoteV1, DeliveryZoneListV1, UpsertDeliveryZoneCommandV1, UpsertDeliveryZoneResultV1 } from "@super-restaurant/shared-types";

export type DeliveryActionResult = DeliveryRequestResult<DeliveryQuoteV1 | DeliveryZoneListV1 | UpsertDeliveryZoneResultV1>
  & { readonly command?: UpsertDeliveryZoneCommandV1 };

export async function deliveryZonesAction(operation: DeliveryOperation, input: unknown): Promise<DeliveryActionResult> {
  const parsed = operation === "list" ? parseListDeliveryZonesQueryV1(input)
    : operation === "upsert" ? parseUpsertDeliveryZoneCommandV1(input) : parseRequestDeliveryQuoteCommandV1(input);
  if (parsed === undefined) return { ok: false, error: "invalid" };
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined || parsed.scope.restaurantId !== scope.restaurantId
    || ("branchId" in parsed.scope && parsed.scope.branchId !== scope.branchId)
    || (operation === "list" && !("kind" in parsed.scope && parsed.scope.kind === "branch"))) return { ok: false, error: "invalid" };
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return { ok: false, error: "denied" };
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined
    || (operation !== "quote" && !membership.roles.some((role) => ["owner", "admin", "manager"].includes(role)))) {
    return { ok: false, error: "denied" };
  }
  const result = await requestDelivery(session.access_token, env.apiBaseUrl, operation, parsed);
  return result.ok ? result : { ...result,
    ...(operation === "upsert" && result.error === "unavailable" ? { command: parsed as UpsertDeliveryZoneCommandV1 } : {}) };
}
