import {
  MEMBERSHIP_ROLE_CODES,
  parseBranchMembershipListV1,
  parseBranchScope,
  parseDiningLayoutV1,
  parseMenuCatalogStateV1,
  type BranchMembershipListV1,
  type DiningLayoutV1,
  type MembershipRoleCode,
  type MenuCatalogStateV1,
} from "@super-restaurant/shared-types";

import type { MobileConfig } from "./config.js";

/**
 * The only Nest paths this client is allowed to call. The mobile foundation is
 * read-only: no Order, payment or cash mutation exists here, and `request`
 * refuses any path outside this allowlist before touching the network.
 */
export const MOBILE_API_PATHS = Object.freeze({
  authorizeBranch: "/api/v1/access/branch",
  diningLayout: "/api/v1/dining/layout",
  memberships: "/api/v1/access/memberships",
  menuCatalog: "/api/v1/catalog/menu",
} as const);

/** HTTP status, or the two client-side failures that never reach the server. */
export type MobileRequestStatus = number | "network" | "protocol";

export class MobileRequestError extends Error {
  public constructor(public readonly status: MobileRequestStatus) {
    super("MOBILE_REQUEST_FAILED");
    this.name = "MobileRequestError";
  }
}

/** A structural Restaurant/Branch pair; both ids are validated before use. */
export interface MobileBranchScope {
  readonly branchId: string;
  readonly restaurantId: string;
}

/** Exact response contract of `POST /api/v1/access/branch`. */
export interface AuthorizedMobileBranch {
  readonly branchId: string;
  readonly restaurantId: string;
  readonly roles: readonly MembershipRoleCode[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** True only for the four authorized paths, ignoring their query string. */
export function isAuthorizedMobilePath(path: string): boolean {
  const pathname = path.split("?")[0];
  return Object.values(MOBILE_API_PATHS).some((allowed) => allowed === pathname);
}

/** Lists the memberships Nest considers active for the bearer of the token. */
export async function listMemberships(
  config: MobileConfig,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<BranchMembershipListV1> {
  return request(config, accessToken, MOBILE_API_PATHS.memberships, parseBranchMembershipListV1, fetcher);
}

/**
 * Revalidates one Restaurant/Branch pair against Nest. A pair offered by the
 * membership list is never assumed to still be authorized: revocation, a false
 * pair or a stale selection are all decided by the server, and the response is
 * additionally required to echo the exact pair that was requested.
 */
export async function authorizeBranch(
  config: MobileConfig,
  accessToken: string,
  scope: MobileBranchScope,
  fetcher: typeof fetch = fetch,
): Promise<AuthorizedMobileBranch> {
  const validated = validScope(scope);
  const authorized = await request(config, accessToken, MOBILE_API_PATHS.authorizeBranch, parseAuthorizedMobileBranch, fetcher, {
    body: JSON.stringify({ branchId: validated.branchId, restaurantId: validated.restaurantId }),
    method: "POST",
  });
  if (!sameScope(authorized, validated)) throw new MobileRequestError("protocol");
  return authorized;
}

/** Reads the zones and tables of one authorized branch. */
export async function getDiningLayout(
  config: MobileConfig,
  accessToken: string,
  scope: MobileBranchScope,
  fetcher: typeof fetch = fetch,
): Promise<DiningLayoutV1> {
  const layout = await request(config, accessToken, scopedPath(MOBILE_API_PATHS.diningLayout, scope), parseDiningLayoutV1, fetcher);
  if (!sameScope(layout.scope, scope)) throw new MobileRequestError("protocol");
  return layout;
}

/** Reads the published catalog of one authorized branch, in read-only mode. */
export async function getMenuCatalog(
  config: MobileConfig,
  accessToken: string,
  scope: MobileBranchScope,
  fetcher: typeof fetch = fetch,
): Promise<MenuCatalogStateV1> {
  const state = await request(config, accessToken, scopedPath(MOBILE_API_PATHS.menuCatalog, scope), parseMenuCatalogStateV1, fetcher);
  if (!sameScope(state.scope, scope)) throw new MobileRequestError("protocol");
  return state;
}

function scopedPath(path: string, scope: MobileBranchScope): string {
  const validated = validScope(scope);
  const query = new URLSearchParams({ branchId: validated.branchId, restaurantId: validated.restaurantId });
  return `${path}?${query.toString()}`;
}

/**
 * Accepts only the exact `{restaurantId, branchId}` shape, with both ids
 * UUIDs, matching the boundary check `apps/api` applies. A pair that fails
 * here is a client defect or a hostile value and must never become a request.
 */
function validScope(scope: MobileBranchScope): MobileBranchScope {
  const parsed = parseBranchScope({ branchId: scope.branchId, restaurantId: scope.restaurantId });
  if (parsed === undefined || !UUID_PATTERN.test(parsed.restaurantId) || !UUID_PATTERN.test(parsed.branchId)) {
    throw new MobileRequestError("protocol");
  }
  return Object.freeze({ branchId: parsed.branchId, restaurantId: parsed.restaurantId });
}

function sameScope(left: MobileBranchScope, right: MobileBranchScope): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

/**
 * Accepts only the exact contract `BranchAccessController` returns. No shared
 * parser covers this response shape, so the check stays local to this app
 * instead of being invented as a shared contract — the same decision
 * `apps/web` recorded at its own boundary.
 */
function parseAuthorizedMobileBranch(value: unknown): AuthorizedMobileBranch | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3 || !keys.includes("branchId") || !keys.includes("restaurantId") || !keys.includes("roles")) return undefined;
  const { branchId, restaurantId, roles } = record;
  if (typeof branchId !== "string" || !UUID_PATTERN.test(branchId)) return undefined;
  if (typeof restaurantId !== "string" || !UUID_PATTERN.test(restaurantId)) return undefined;
  if (!Array.isArray(roles) || roles.length === 0 || roles.length > MEMBERSHIP_ROLE_CODES.length) return undefined;
  const known = roles.every((role): role is MembershipRoleCode => (
    typeof role === "string" && (MEMBERSHIP_ROLE_CODES as readonly string[]).includes(role)
  ));
  if (!known || new Set(roles).size !== roles.length) return undefined;
  return Object.freeze({ branchId, restaurantId, roles: Object.freeze([...roles]) });
}

async function request<T>(
  config: MobileConfig,
  accessToken: string,
  path: string,
  parser: (value: unknown) => T | undefined,
  fetcher: typeof fetch,
  init: Readonly<{ body?: string; method?: "POST" }> = {},
): Promise<T> {
  if (!isAuthorizedMobilePath(path)) throw new Error("MOBILE_PATH_NOT_AUTHORIZED");
  if (accessToken.length === 0) throw new MobileRequestError(401);

  let response: Response;
  try {
    response = await fetcher(`${config.apiBaseUrl}${path}`, {
      ...(init.body === undefined ? {} : { body: init.body }),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      method: init.method ?? "GET",
    });
  } catch {
    throw new MobileRequestError("network");
  }

  if (!response.ok) throw new MobileRequestError(response.status);

  let value: unknown;
  try { value = await response.json(); } catch { throw new MobileRequestError("protocol"); }

  const parsed = parser(value);
  if (parsed === undefined) throw new MobileRequestError("protocol");
  return parsed;
}
