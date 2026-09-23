import {
  parseBranchOperationalContextV1,
  parseDiningLayoutV1,
  parseMenuCatalogStateV1,
  parseOperationalShiftListV1,
  type BranchScope,
  type DiningTableV1,
  type OperationalShiftSummaryV1,
} from "@super-restaurant/shared-types";

export interface CaptureConfirmationContext {
  readonly currency: string;
  readonly shifts: readonly OperationalShiftSummaryV1[];
  /** Null means the authoritative layout could not be read; an empty array is a valid layout without tables. */
  readonly tables: readonly DiningTableV1[] | null;
  readonly timeZone: string;
}

/** Reads every server-owned fact required to turn a Capture into an Order. */
export async function getCaptureConfirmationContext(
  accessToken: string,
  apiBaseUrl: string,
  scope: BranchScope,
): Promise<CaptureConfirmationContext | undefined> {
  const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
  const [branchContext, shifts, menu, layout] = await Promise.all([
    request(accessToken, `${apiBaseUrl}/api/v1/access/branch/context`, "POST", scope, parseBranchOperationalContextV1),
    request(accessToken, `${apiBaseUrl}/api/v1/shifts/active?${query.toString()}`, "GET", undefined, parseOperationalShiftListV1),
    request(accessToken, `${apiBaseUrl}/api/v1/catalog/menu?${query.toString()}`, "GET", undefined, parseMenuCatalogStateV1),
    request(accessToken, `${apiBaseUrl}/api/v1/dining/layout?${query.toString()}`, "GET", undefined, parseDiningLayoutV1),
  ]);
  if (branchContext === undefined || shifts === undefined || menu === undefined || menu.catalog === null
    || branchContext.scope.restaurantId !== scope.restaurantId || branchContext.scope.branchId !== scope.branchId
    || shifts.scope.restaurantId !== scope.restaurantId || shifts.scope.branchId !== scope.branchId
    || menu.scope.restaurantId !== scope.restaurantId || menu.scope.branchId !== scope.branchId
    || (layout !== undefined && (layout.scope.restaurantId !== scope.restaurantId || layout.scope.branchId !== scope.branchId))) {
    return undefined;
  }
  const tables = layout === undefined ? null : Object.freeze(layout.zones.flatMap((zone) => zone.tables));
  return Object.freeze({ currency: menu.catalog.currency, shifts: shifts.shifts, tables, timeZone: branchContext.timeZone });
}

async function request<T>(
  accessToken: string,
  url: string,
  method: "GET" | "POST",
  body: BranchScope | undefined,
  parser: (value: unknown) => T | undefined,
): Promise<T | undefined> {
  try {
    const response = await fetch(url, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      method,
    });
    if (!response.ok) return undefined;
    return parser(await response.json());
  } catch { return undefined; }
}
