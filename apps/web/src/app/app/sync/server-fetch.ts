import { type BranchScope, type ManualReviewCaseV1 } from "@super-restaurant/shared-types";

import { parseScopedManualReviewList } from "../../../lib/sync-ui";

export type ManualReviewListOutcome =
  | { readonly status: "ok"; readonly cases: readonly ManualReviewCaseV1[]; readonly confirmedAt: string }
  | { readonly status: "not_deployed" }
  | { readonly status: "denied" }
  | { readonly status: "unavailable" };

/**
 * Internal server-only helper (intentionally outside `"use server"` so it is never exposed as a
 * client-callable Server Action). Fetches manual review cases for the authorized Restaurant/Branch
 * scope, failing closed on malformed payloads or cross-branch items.
 *
 * When the backend returns 404/501 (`not_deployed`), no `confirmedAt` timestamp is fabricated.
 */
export async function fetchManualReviewCases(
  accessToken: string,
  apiBaseUrl: string,
  scope: BranchScope,
): Promise<ManualReviewListOutcome> {
  const params = new URLSearchParams({
    branchId: scope.branchId,
    restaurantId: scope.restaurantId,
  });
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/sync/manual-review?${params.toString()}`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 404 || response.status === 501) {
    return { status: "not_deployed" };
  }
  if (response.status === 401 || response.status === 403) {
    return { status: "denied" };
  }
  if (!response.ok) {
    return { status: "unavailable" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable" };
  }

  const cases = parseScopedManualReviewList(body, scope);
  if (cases === undefined) {
    return { status: "unavailable" };
  }
  return { cases, confirmedAt: new Date().toISOString(), status: "ok" };
}
