import {
  parseActiveTableOrderListV2,
  parseAddOrderItemCommandV1,
  parseBranchMembershipListV1,
  parseBranchOperationalContextV1,
  parseBranchScope,
  parseCreateOrderCommandV2,
  parseDiningLayoutV1,
  parseMenuCatalogStateV1,
  parseOpenOrderCommandV1,
  parseOperationalShiftListV1,
  parseOrderMutationSummaryV1,
  type ActiveTableOrderListV2,
  type AddOrderItemCommandV1,
  type BranchMembershipListV1,
  type BranchOperationalContextV1,
  type CreateOrderCommandV2,
  type DiningLayoutV1,
  type MenuCatalogStateV1,
  type OpenOrderCommandV1,
  type OperationalShiftListV1,
  type OrderMutationSummaryV1,
} from "@super-restaurant/shared-types";

import type { MobileConfig } from "./config.js";

/**
 * The only Nest paths this client is allowed to call, and `request` refuses any
 * path outside this allowlist before touching the network.
 *
 * The three Order paths are the *whole* write surface of this app: create, add
 * one line, open. No payment, cash, refund or item-transition path is listed,
 * so no gesture in the app can reach one.
 *
 * A selected pair is confirmed by `branchContext`, whose response is the
 * authoritative one — roles **and** the branch's IANA zone — and is validated by
 * a shared parser. The older `/access/branch` endpoint is not listed: it needed
 * a copy of its contract inside this app, and a copy is what this slice removes.
 */
export const MOBILE_API_PATHS = Object.freeze({
  activeTableOrders: "/api/v1/orders/active",
  addOrderItem: "/api/v1/orders/items",
  branchContext: "/api/v1/access/branch/context",
  createOrder: "/api/v1/orders",
  diningLayout: "/api/v1/dining/layout",
  memberships: "/api/v1/access/memberships",
  menuCatalog: "/api/v1/catalog/menu",
  openOrder: "/api/v1/orders/open",
  operationalShifts: "/api/v1/shifts/active",
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** True only for the authorized paths, ignoring their query string. */
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

/** Lists open service periods for one freshly authorized branch. */
export async function listOperationalShifts(
  config: MobileConfig,
  accessToken: string,
  scope: MobileBranchScope,
  fetcher: typeof fetch = fetch,
): Promise<OperationalShiftListV1> {
  const list = await request(
    config,
    accessToken,
    scopedPath(MOBILE_API_PATHS.operationalShifts, scope),
    parseOperationalShiftListV1,
    fetcher,
  );
  if (!sameScope(list.scope, scope)) throw new MobileRequestError("protocol");
  return list;
}

/**
 * Selects one Restaurant/Branch pair and reads its authoritative operating
 * context: the roles Nest grants there and the branch's IANA time zone.
 *
 * This replaces the local authorization check in the operational flow. The zone
 * is the reason: `CreateOrderCommandV2` requires one, and a client must not
 * decide the operational zone of a branch — that belongs to the Restaurant's
 * record in PostgreSQL. The response is validated only by the shared parser,
 * and is additionally required to echo the exact pair that was requested.
 */
export async function selectBranchContext(
  config: MobileConfig,
  accessToken: string,
  scope: MobileBranchScope,
  fetcher: typeof fetch = fetch,
): Promise<BranchOperationalContextV1> {
  const validated = validScope(scope);
  const context = await request(config, accessToken, MOBILE_API_PATHS.branchContext, parseBranchOperationalContextV1, fetcher, {
    body: JSON.stringify({ branchId: validated.branchId, restaurantId: validated.restaurantId }),
    method: "POST",
  });
  if (!sameScope(context.scope, validated)) throw new MobileRequestError("protocol");
  return context;
}

/**
 * The active Orders of one table. A bounded list, not a single order: a table
 * can legitimately carry more than one, and `shiftId: null` is a valid historic
 * value from before operational shifts existed. Nothing is recalculated from
 * it — the snapshot prices it carries are the server's.
 */
export async function listActiveTableOrders(
  config: MobileConfig,
  accessToken: string,
  scope: MobileBranchScope,
  tableId: string,
  fetcher: typeof fetch = fetch,
): Promise<ActiveTableOrderListV2> {
  const validated = validScope(scope);
  const table = validUuid(tableId);
  const query = new URLSearchParams({
    branchId: validated.branchId,
    restaurantId: validated.restaurantId,
    tableId: table,
  });
  const list = await request(
    config,
    accessToken,
    `${MOBILE_API_PATHS.activeTableOrders}?${query.toString()}`,
    parseActiveTableOrderListV2,
    fetcher,
  );
  if (!sameScope(list.scope, validated) || list.tableId.toLowerCase() !== table) {
    throw new MobileRequestError("protocol");
  }
  return list;
}

/**
 * The three Order mutations, in the only order the contracts accept.
 *
 * Each body is built by the caller and then validated **with the shared command
 * parser** before it can become a request: the parser is the contract, so a
 * command this client got wrong fails here as a client defect instead of being
 * sent and rejected. The parsed value is what goes on the wire, so the body is
 * exactly the normalized shape the server will parse again.
 */
export async function createOrder(
  config: MobileConfig,
  accessToken: string,
  command: CreateOrderCommandV2,
  fetcher: typeof fetch = fetch,
): Promise<OrderMutationSummaryV1> {
  return mutateOrder(config, accessToken, MOBILE_API_PATHS.createOrder, command, parseCreateOrderCommandV2, fetcher);
}

export async function addOrderItem(
  config: MobileConfig,
  accessToken: string,
  command: AddOrderItemCommandV1,
  fetcher: typeof fetch = fetch,
): Promise<OrderMutationSummaryV1> {
  return mutateOrder(config, accessToken, MOBILE_API_PATHS.addOrderItem, command, parseAddOrderItemCommandV1, fetcher);
}

export async function openOrder(
  config: MobileConfig,
  accessToken: string,
  command: OpenOrderCommandV1,
  fetcher: typeof fetch = fetch,
): Promise<OrderMutationSummaryV1> {
  return mutateOrder(config, accessToken, MOBILE_API_PATHS.openOrder, command, parseOpenOrderCommandV1, fetcher);
}

async function mutateOrder<T extends { readonly orderId: string; readonly scope: { readonly branchId: string; readonly restaurantId: string } }>(
  config: MobileConfig,
  accessToken: string,
  path: string,
  command: T,
  parseCommand: (value: unknown) => T | undefined,
  fetcher: typeof fetch,
): Promise<OrderMutationSummaryV1> {
  const validated = parseCommand(command);
  if (validated === undefined) throw new MobileRequestError("protocol");
  const summary = await request(config, accessToken, path, parseOrderMutationSummaryV1, fetcher, {
    body: JSON.stringify(validated),
    method: "POST",
  });
  // The answer has to be about the order that was asked about, in the pair that
  // was asked about. Anything else is a response this client will not apply.
  if (summary.orderId.toLowerCase() !== validated.orderId.toLowerCase() || !sameScope(summary.scope, validated.scope)) {
    throw new MobileRequestError("protocol");
  }
  return summary;
}

/** A table id reaches the network only as the exact UUID the contracts accept. */
function validUuid(value: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new MobileRequestError("protocol");
  return value.toLowerCase();
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
  // Normalized once, so the request, the echoed scope and the parsed response
  // are all compared in the same form.
  return Object.freeze({
    branchId: parsed.branchId.toLowerCase(),
    restaurantId: parsed.restaurantId.toLowerCase(),
  });
}

/** UUIDs are case-insensitive; the pair itself must still match exactly. */
function sameScope(left: MobileBranchScope, right: MobileBranchScope): boolean {
  return left.restaurantId.toLowerCase() === right.restaurantId.toLowerCase()
    && left.branchId.toLowerCase() === right.branchId.toLowerCase();
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
