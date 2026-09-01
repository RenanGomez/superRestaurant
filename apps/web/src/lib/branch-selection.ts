import type { MembershipRoleCode } from "@super-restaurant/shared-types";
import { MEMBERSHIP_ROLE_CODES } from "@super-restaurant/shared-types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AuthorizedBranch {
  readonly branchId: string;
  readonly restaurantId: string;
  readonly roles: readonly MembershipRoleCode[];
}

/**
 * A structural (unbranded) Restaurant/Branch pair — see the identical note
 * in `memberships.ts`. `BranchScope` is always structurally assignable here.
 */
interface BranchScopeLike {
  readonly restaurantId: string;
  readonly branchId: string;
}

/**
 * Server-to-server authorization of one Restaurant/Branch pair against
 * `POST /api/v1/access/branch`. A pair coming from the membership list is
 * never assumed still valid on its own (frontend.md FE-0.1 task 2): a false
 * pair, a revoked membership, or a stale preference are all rejected here,
 * by Nest, not guessed client-side.
 *
 * Fails closed: an unreachable API, a non-200 (including the 403 Nest
 * returns for a rejected/false/revoked pair), or a hostile body are all
 * treated as "not authorized".
 */
export async function authorizeBranch(
  accessToken: string,
  apiBaseUrl: string,
  scope: BranchScopeLike,
): Promise<AuthorizedBranch | undefined> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/access/branch`, {
      body: JSON.stringify({ branchId: scope.branchId, restaurantId: scope.restaurantId }),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
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

  const authorized = parseAuthorizedBranch(body);
  return authorized !== undefined
    && authorized.restaurantId === scope.restaurantId
    && authorized.branchId === scope.branchId
    ? authorized
    : undefined;
}

/**
 * Accepts only the exact contract `apps/api`'s `BranchAccessController`
 * returns: a plain object with exactly `{branchId, restaurantId, roles}`,
 * both ids UUIDs, `roles` a non-empty array drawn from the shared role
 * allowlist with no unknown entries. No shared parser exists for this
 * specific response shape (`packages/shared-types` only parses the
 * request-side `BranchScope`), so this stays local to apps/web rather than
 * being invented as a shared contract.
 */
function parseAuthorizedBranch(value: unknown): AuthorizedBranch | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const ownKeys = Reflect.ownKeys(value);
    const expectedKeys = ["branchId", "restaurantId", "roles"];
    if (ownKeys.length !== expectedKeys.length || !expectedKeys.every((key) => ownKeys.includes(key))) {
      return undefined;
    }

    const branchId = ownStringValue(value, "branchId");
    const restaurantId = ownStringValue(value, "restaurantId");
    const rolesDescriptor = Object.getOwnPropertyDescriptor(value, "roles");
    if (
      branchId === undefined || !UUID_PATTERN.test(branchId)
      || restaurantId === undefined || !UUID_PATTERN.test(restaurantId)
      || rolesDescriptor === undefined || !("value" in rolesDescriptor)
    ) {
      return undefined;
    }

    const roles = parseRoles(rolesDescriptor.value);
    if (roles === undefined) return undefined;

    return Object.freeze({
      branchId: branchId.toLowerCase(),
      restaurantId: restaurantId.toLowerCase(),
      roles,
    });
  } catch {
    return undefined;
  }
}

function parseRoles(value: unknown): readonly MembershipRoleCode[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  if (value.length === 0 || value.length > MEMBERSHIP_ROLE_CODES.length) return undefined;

  const roles: MembershipRoleCode[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const raw = descriptor?.value;
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || typeof raw !== "string"
      || !(MEMBERSHIP_ROLE_CODES as readonly string[]).includes(raw)
      || roles.includes(raw as MembershipRoleCode)
    ) {
      return undefined;
    }
    roles.push(raw as MembershipRoleCode);
  }
  return Object.freeze(roles);
}

function ownStringValue(value: object, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}
