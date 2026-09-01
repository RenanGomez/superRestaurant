import type { BranchMembershipListV1, BranchMembershipSummaryV1, BranchScope } from "@super-restaurant/shared-types";
import { parseBranchMembershipListV1, parseBranchScope } from "@super-restaurant/shared-types";

/** Non-authoritative preference: only which pair to *try* to revalidate next. */
export const BRANCH_PREFERENCE_COOKIE = "sr-branch-pref";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * A structural (unbranded) Restaurant/Branch pair. `BranchScope` from
 * `@super-restaurant/shared-types` is nominally branded and only ever
 * produced by its own parsers; the helpers below accept any already-UUID
 * -validated pair — including one built from `AuthorizedBranch` (validated
 * independently by `branch-selection.ts`) or from a test fixture — without
 * requiring a caller to fabricate a fake brand via an unsafe cast. A real
 * `BranchScope` is always structurally assignable here.
 */
interface BranchScopeLike {
  readonly restaurantId: string;
  readonly branchId: string;
}

/**
 * Server-to-server fetch of the caller's effective memberships from
 * `GET /api/v1/access/memberships`. This is the *only* source of truth for
 * which Restaurant/Branch pairs may be offered or accepted (frontend.md
 * FE-0.1 task 1: never derived from Auth metadata).
 *
 * Fails closed: an unreachable API, a non-200 response, or a body that does
 * not match the exact `BranchMembershipListV1` contract are all treated as
 * "unavailable" — never as an empty-but-valid list.
 */
export async function listMemberships(
  accessToken: string,
  apiBaseUrl: string,
): Promise<BranchMembershipListV1 | undefined> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/access/memberships`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return undefined;
  }

  if (!response.ok) return undefined;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }

  return parseBranchMembershipListV1(body);
}

/** Finds the membership matching an exact Restaurant/Branch pair, if any. */
export function findMembership(
  memberships: readonly BranchMembershipSummaryV1[],
  scope: BranchScopeLike,
): BranchMembershipSummaryV1 | undefined {
  return memberships.find(
    (membership) => membership.scope.restaurantId === scope.restaurantId && membership.scope.branchId === scope.branchId,
  );
}

/**
 * Parses the non-authoritative branch-preference cookie. Reuses
 * `parseBranchScope` for the exact `{restaurantId, branchId}` shape, then
 * additionally requires both ids to be UUIDs (matching the stricter check
 * `apps/api` applies at its own transport boundary). A malformed, tampered,
 * or legacy-shaped cookie value is treated as "no preference" — it is never
 * trusted for authorization on its own; callers must still revalidate it
 * against a fresh `listMemberships`/`authorizeBranch` call.
 */
export function parseBranchPreference(rawCookieValue: string | undefined): BranchScope | undefined {
  if (rawCookieValue === undefined) return undefined;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawCookieValue);
  } catch {
    return undefined;
  }

  const scope = parseBranchScope(parsedJson);
  return scope !== undefined && UUID_PATTERN.test(scope.restaurantId) && UUID_PATTERN.test(scope.branchId)
    ? scope
    : undefined;
}

/** Encodes a validated scope for storage in the preference cookie. */
export function encodeBranchPreference(scope: BranchScopeLike): string {
  return JSON.stringify({ branchId: scope.branchId, restaurantId: scope.restaurantId });
}

/**
 * Decodes the single-value `"restaurantId:branchId"` a selector radio input
 * carries, then validates it through the same shape+UUID check as the
 * preference cookie. A hostile client could still POST an arbitrary string
 * here directly (bypassing the rendered radios); this is why the Server
 * Action must independently re-check the result against a fresh membership
 * list and `POST /api/v1/access/branch`, never trust this parse alone.
 */
export function parseEncodedScope(value: string): BranchScope | undefined {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex === -1) return undefined;

  const restaurantId = value.slice(0, separatorIndex);
  const branchId = value.slice(separatorIndex + 1);
  const scope = parseBranchScope({ branchId, restaurantId });
  return scope !== undefined && UUID_PATTERN.test(scope.restaurantId) && UUID_PATTERN.test(scope.branchId)
    ? scope
    : undefined;
}

/** Encodes a scope for a selector radio input's `value` — inverse of `parseEncodedScope`. */
export function encodeScope(scope: BranchScopeLike): string {
  return `${scope.restaurantId}:${scope.branchId}`;
}
