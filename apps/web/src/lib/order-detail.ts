import {
  MAX_SEND_ORDER_TO_KITCHEN_ITEM_IDS,
  parseOrderDetailV1,
  parseOrderMutationSummaryV1,
  type BranchScope,
  type LineFractionV1,
  type AddOrderItemCommandV1,
  type OrderDetailActionV1,
  type OrderDetailItemV1,
  type OrderDetailV1,
} from "@super-restaurant/shared-types";
import type { SelectionPlanModifierGroupDraft } from "./capture-selection.js";

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
  path: "orders/open" | "orders/items" | "orders/send-to-kitchen" | "orders/items/transition" | "orders/items/cancel",
  body: Readonly<object>,
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
  addItem: "Agregar producto",
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

export function canAddItems(detail: OrderDetailV1): boolean {
  return hasAction(detail, "addItem");
}

/** A read, not a mutation response, settles an uncertain add. */
export function resolvePendingAdd(
  detail: OrderDetailV1 | undefined,
  attempt: AddOrderItemCommandV1,
): "confirming" | "applied" | "retry" {
  if (detail === undefined || detail.orderId !== attempt.orderId
    || detail.scope.restaurantId !== attempt.scope.restaurantId || detail.scope.branchId !== attempt.scope.branchId) {
    return "confirming";
  }
  return detail.items.some((item) => item.orderItemId === attempt.orderItemId) ? "applied" : "retry";
}

/** Single construction point for the server's add-item contract. */
export function buildAddOrderItemCommand(input: {
  readonly scope: BranchScope;
  readonly orderId: string;
  readonly expectedVersion: number;
  readonly orderItemId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly note: string | null;
  readonly variantId: string | null;
  /** Half-and-half split; omitted or `null` for a whole line. */
  readonly fraction?: LineFractionV1 | null;
  readonly modifierGroups: readonly SelectionPlanModifierGroupDraft[];
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly deviceId: string;
}): AddOrderItemCommandV1 {
  return {
    schemaVersion: 1, scope: input.scope, orderId: input.orderId,
    expectedVersion: input.expectedVersion, orderItemId: input.orderItemId,
    productId: input.productId, quantity: input.quantity,
    note: input.note, variantId: input.variantId,
    ...(input.fraction === undefined || input.fraction === null ? {} : { fraction: input.fraction }),
    modifierGroups: input.modifierGroups.map((group) => ({ groupId: group.groupId,
      selections: group.selections.map((selection) => ({ optionId: selection.optionId, quantity: selection.quantity })) })),
    eventId: input.eventId, idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt, deviceId: input.deviceId,
  };
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

/** Capture uses the same server-owned action gate and pending-line snapshot as Orders. */
export function captureKitchenSend(detail: OrderDetailV1): {
  readonly orderId: string; readonly expectedVersion: number; readonly orderItemIds: readonly string[];
} | undefined {
  const orderItemIds = pendingOrderItemIds(detail);
  return hasAction(detail, "sendToKitchen") && orderItemIds.length > 0
    ? { orderId: detail.orderId, expectedVersion: detail.version, orderItemIds } : undefined;
}

export function captureKitchenResultText(sentLines: number, error?: Extract<OrderMutationRequestResult, { ok: false }>["error"]): string {
  if (sentLines > 0 && error === undefined) return `Enviada a cocina · ${sentLines} ${sentLines === 1 ? "línea" : "líneas"}`;
  const partial = sentLines > 0 ? `${sentLines} ${sentLines === 1 ? "línea enviada" : "líneas enviadas"}. ` : "";
  if (error === "conflict") return `${partial}La orden cambió o alguna línea ya se envió. Abre la orden para revisar lo pendiente.`;
  if (error === "denied") return `${partial}Tu sesión o permisos ya no permiten enviar esta orden a cocina.`;
  if (error === "not_found") return `${partial}La orden ya no está disponible. Abre Órdenes para revisar.`;
  if (error === "invalid") return `${partial}No se pudo enviar la orden. Abre la orden para revisar sus líneas.`;
  return `${partial}No se pudo confirmar el envío a cocina. Abre la orden para comprobar su estado.`;
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

/**
 * The index `Tab` (or `Shift+Tab`) should move focus to, trapping it within a fixed-size list of
 * `count` focusable elements instead of letting it escape to the page behind a modal dialog. Wraps
 * at both ends: from the last element `Tab` goes to the first, and from the first `Shift+Tab` goes
 * to the last. `count <= 0` has nothing to move to and returns `0`.
 */
export function nextFocusIndex(count: number, index: number, shift: boolean): number {
  if (count <= 0) return 0;
  if (shift) return index <= 0 ? count - 1 : index - 1;
  return index >= count - 1 ? 0 : index + 1;
}
