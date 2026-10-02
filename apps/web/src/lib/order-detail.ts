import {
  MAX_SEND_ORDER_TO_KITCHEN_ITEM_IDS,
  parseOrderDetailV1,
  parseOrderMutationSummaryV1,
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Validates a client-minted `{ eventId, idempotencyKey }` pair for one order-mutation attempt. The
 * server action never generates these itself: the caller (the detail panel) mints them once per
 * logical operation and reuses the same pair verbatim on its single retry, so a lost-response retry
 * resends the same command instead of a distinct one.
 */
export function parseAttemptIds(eventId: unknown, idempotencyKey: unknown): { readonly eventId: string; readonly idempotencyKey: string } | undefined {
  if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId)) return undefined;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 200 || idempotencyKey !== idempotencyKey.trim()) {
    return undefined;
  }
  return { eventId: eventId.toLowerCase(), idempotencyKey };
}

const MAX_OCCURRED_AT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_OCCURRED_AT_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Validates a client-minted `occurredAt` for one mutation attempt: a well-formed ISO timestamp, not
 * more than 5 minutes ahead of the server's own clock (clock skew tolerance) and not older than 24h
 * (stale retry from a reopened tab). The server action uses this instead of minting its own
 * `new Date()` on every call, so a retry of the *same* attempt (same eventId/idempotencyKey) submits
 * the same `occurredAt` too -- otherwise `persist_order_mutation`'s byte-identical replay check would
 * never match and every retry would look like a brand-new, conflicting command.
 */
export function parseOccurredAt(value: unknown, now: number = Date.now()): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) return undefined;
  const skewMs = parsed.getTime() - now;
  if (skewMs > MAX_OCCURRED_AT_FUTURE_SKEW_MS || skewMs < -MAX_OCCURRED_AT_AGE_MS) return undefined;
  return value;
}

/** Splits `orderItemIds` into chunks of at most `MAX_SEND_ORDER_TO_KITCHEN_ITEM_IDS` (the same bound
 * the server's `SendOrderToKitchenCommandV1` parser enforces), so "send to kitchen" on an order with
 * more pending lines than that limit still succeeds instead of always failing at the parser. */
export function chunkOrderItemIds(
  ids: readonly string[],
  size: number = MAX_SEND_ORDER_TO_KITCHEN_ITEM_IDS,
): readonly (readonly string[])[] {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

export type OrderMutationRequestResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "not_found" | "conflict" | "unavailable" };

/**
 * A single POST to one of the existing `orders/*` mutation routes, used for open/send-to-kitchen/
 * mark-ready/mark-delivered/cancel from the detail panel. The caller always re-reads the detail
 * afterward instead of trusting a client-side projection of the new state; the returned `version` is
 * used only to chain multiple "send to kitchen" chunks against the same order without a round trip.
 */
export async function postOrderMutation(
  token: string,
  baseUrl: string,
  path: "orders/open" | "orders/send-to-kitchen" | "orders/items/transition" | "orders/items/cancel",
  body: Readonly<Record<string, unknown>>,
): Promise<OrderMutationRequestResult> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/${path}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const parsedBody: unknown = await response.json().catch(() => undefined);
      const summary = parseOrderMutationSummaryV1(parsedBody);
      if (summary === undefined) return { error: "unavailable", ok: false };
      return { ok: true, version: summary.version };
    }
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
  open: "Abrir cuenta",
  sendToKitchen: "Enviar a cocina",
};

export function actionLabel(action: OrderDetailActionV1): string {
  return ACTION_LABELS[action];
}

export function hasAction(detail: OrderDetailV1, action: OrderDetailActionV1): boolean {
  return detail.availableActions.includes(action);
}

/** Per-line gate: `cancelItem`/`markReady`/`markDelivered` only ever come from the line's own
 * `availableActions` -- never the order-level list, which cannot express that a role with
 * `orders.cancel.pending` alone must not see cancellation on a line that already reached KDS. */
export function hasItemAction(item: OrderDetailItemV1, action: OrderDetailActionV1): boolean {
  return item.availableActions.includes(action);
}

/** The exact set of lines "send to kitchen" offers for this detail: every line the operator is
 * currently seeing as "pending". Fixed once per attempt by the caller and reused verbatim on its
 * single retry, so a line another actor adds to the order after this snapshot is never swept into
 * a resend -- see `OrdersService.sendToKitchen`'s own `orderItemIds` contract. */
export function pendingOrderItemIds(detail: OrderDetailV1): readonly string[] {
  return detail.items.filter((item) => item.status === "pending").map((item) => item.orderItemId);
}

/**
 * Validates the `orderItemIds` a client submits with "send to kitchen": every entry a well-formed
 * UUID, at least one entry, no duplicates. The server still re-validates and re-derives permission
 * from its own read of the order; this only rejects a malformed submission before the request.
 */
export function parseOrderItemIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !UUID_PATTERN.test(entry)) return undefined;
    const id = entry.toLowerCase();
    if (seen.has(id)) return undefined;
    seen.add(id);
    ids.push(id);
  }
  return ids;
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
