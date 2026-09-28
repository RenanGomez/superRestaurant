import {
  parseOrderDetailV1,
  type BranchScope,
  type OrderDetailActionV1,
  type OrderDetailItemV1,
  type OrderDetailV1,
} from "@super-restaurant/shared-types";

export type OrderDetailRequestResult =
  | { readonly ok: true; readonly value: OrderDetailV1 }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "not_found" | "conflict" | "unavailable" };

export async function requestOrderDetail(
  token: string,
  baseUrl: string,
  scope: BranchScope,
  orderId: string,
): Promise<OrderDetailRequestResult> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/orders/detail`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ orderId, schemaVersion: 1, scope }),
    });
    if (!response.ok) {
      return {
        error: response.status === 400 ? "invalid"
          : response.status === 401 || response.status === 403 ? "denied"
          : response.status === 404 ? "not_found"
          : response.status === 409 ? "conflict"
          : "unavailable",
        ok: false,
      };
    }
    const body: unknown = await response.json();
    const value = parseOrderDetailV1(body);
    if (value === undefined || value.orderId !== orderId || value.scope.restaurantId !== scope.restaurantId
      || value.scope.branchId !== scope.branchId) return { error: "unavailable", ok: false };
    return { ok: true, value };
  } catch { return { error: "unavailable", ok: false }; }
}

export type OrderMutationRequestResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "not_found" | "conflict" | "unavailable" };

/**
 * A single POST to one of the existing `orders/*` mutation routes, used for open/send-to-kitchen/
 * mark-ready/mark-delivered/cancel from the detail panel. The caller always re-reads the detail
 * afterward instead of trusting a client-side projection of the new state.
 */
export async function postOrderMutation(
  token: string,
  baseUrl: string,
  path: "orders/open" | "orders/items/transition" | "orders/items/cancel",
  body: Readonly<Record<string, unknown>>,
): Promise<OrderMutationRequestResult> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/${path}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    return {
      error: response.status === 400 ? "invalid"
        : response.status === 401 || response.status === 403 ? "denied"
        : response.status === 404 ? "not_found"
        : response.status === 409 ? "conflict"
        : "unavailable",
      ok: false,
    };
  } catch { return { error: "unavailable", ok: false }; }
}

const ACTION_LABELS: Record<OrderDetailActionV1, string> = {
  cancelItem: "Cancelar línea",
  checkout: "Cobrar en caja",
  markDelivered: "Marcar entregada",
  markReady: "Marcar lista",
  open: "Enviar a cocina",
  sendToKitchen: "Enviar a cocina",
};

export function actionLabel(action: OrderDetailActionV1): string {
  return ACTION_LABELS[action];
}

export function hasAction(detail: OrderDetailV1, action: OrderDetailActionV1): boolean {
  return detail.availableActions.includes(action);
}

const STATUS_GROUPS = Object.freeze(["pending", "sent", "preparing", "ready", "delivered", "cancelled"] as const);

export type OrderItemStatusGroup = (typeof STATUS_GROUPS)[number];

/** Stable grouping for rendering a detail panel's lines by kitchen-facing status, one bucket each,
 * always in the same forward order regardless of the order the items arrived in. */
export function groupItemsByStatus(
  items: readonly OrderDetailItemV1[],
): ReadonlyMap<OrderItemStatusGroup, readonly OrderDetailItemV1[]> {
  const groups = new Map<OrderItemStatusGroup, OrderDetailItemV1[]>(STATUS_GROUPS.map((status) => [status, []]));
  for (const item of items) groups.get(item.status)?.push(item);
  return groups;
}
