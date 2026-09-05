/**
 * The seam between the mobile draft composer and a future Order integration.
 *
 * The screen never speaks HTTP. It hands the caller three plain intents that
 * describe **what the operator composed**, using the shapes the shared Order
 * contracts already define. Everything that carries audit identity or
 * optimistic concurrency — `orderId`, `orderItemId`, `eventId`, `deviceId`,
 * `idempotencyKey`, `occurredAt`, `expectedVersion` — is deliberately absent:
 * those belong to the layer that actually performs the mutation, mints the
 * identifiers and orders the calls. Inventing them here would fabricate an
 * audit trail for a write that never happened.
 *
 * `timeZone`, which `CreateOrderCommandV1` also requires, is omitted for the
 * same reason: the client must not decide the operational time zone of a
 * branch. See `BACKEND_REQUESTS.md`.
 */
import type { ModifierGroupSelectionV1, OrderChannelV1 } from "@super-restaurant/shared-types";

import type { MobileBranchScope } from "./mobile-client.js";
import type { OrderDraftFailure, OrderDraftLine } from "./order-draft.js";

const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

/** Mobile order entry is table service; the other channels are not offered here. */
const TABLE_CHANNEL: Extract<OrderChannelV1, "table"> = "table";

export interface CreateOrderIntentV1 {
  readonly channel: Extract<OrderChannelV1, "table">;
  /** ISO code exactly as the catalog delivered it. Never defaulted. */
  readonly currency: string;
  readonly scope: MobileBranchScope;
  readonly tableId: string;
}

export interface AddOrderItemIntentV1 {
  /** Local draft handle, not an `orderItemId`; it only correlates UI feedback. */
  readonly draftLineId: string;
  readonly modifierGroups: readonly ModifierGroupSelectionV1[];
  readonly productId: string;
  readonly quantity: number;
  readonly scope: MobileBranchScope;
}

export interface OpenOrderIntentV1 {
  readonly scope: MobileBranchScope;
  readonly tableId: string;
}

/** Everything the composer can offer about one finished draft. */
export interface OrderDraftHandoffV1 {
  readonly addItems: readonly AddOrderItemIntentV1[];
  readonly createOrder: CreateOrderIntentV1;
  readonly openOrder: OpenOrderIntentV1;
}

export interface OrderDraftCallbacks {
  readonly onAddItem: (intent: AddOrderItemIntentV1) => void;
  readonly onCreateOrder: (intent: CreateOrderIntentV1) => void;
  readonly onOpenOrder: (intent: OpenOrderIntentV1) => void;
}

/**
 * What the screen needs from whoever will perform the writes: the three
 * callbacks plus one hand-over that reports how it went. `submit` resolves
 * `undefined` on success, or the failure the transport produced.
 */
export interface OrderDraftIntegration extends OrderDraftCallbacks {
  readonly submit: (handoff: OrderDraftHandoffV1) => Promise<OrderDraftFailure | undefined>;
}

/**
 * The integration this slice ships with: it accepts the draft, performs no
 * request and says so. Replacing it is the whole point of the seam — until
 * then no gesture in the app can reach an Order endpoint.
 */
export const disconnectedOrderDraftIntegration: OrderDraftIntegration = Object.freeze({
  onAddItem: (): void => undefined,
  onCreateOrder: (): void => undefined,
  onOpenOrder: (): void => undefined,
  submit: (): Promise<OrderDraftFailure> => Promise.resolve("notConnected"),
});

/**
 * Builds the hand-over, or returns `undefined` when the draft cannot be
 * expressed with the data at hand: no lines, a currency the catalog did not
 * deliver as an ISO code, or a product the catalog no longer publishes. Failing
 * closed here is what keeps a stale draft from becoming a request.
 */
export function buildOrderDraftHandoff(input: {
  readonly currency: string;
  readonly knownProductIds: ReadonlySet<string>;
  readonly lines: readonly OrderDraftLine[];
  readonly scope: MobileBranchScope;
  readonly tableId: string;
}): OrderDraftHandoffV1 | undefined {
  if (input.lines.length === 0 || !CURRENCY_PATTERN.test(input.currency)) return undefined;
  if (input.lines.some((line) => !input.knownProductIds.has(line.productId))) return undefined;

  const scope = Object.freeze({ branchId: input.scope.branchId, restaurantId: input.scope.restaurantId });
  return Object.freeze({
    addItems: Object.freeze(input.lines.map((line) => Object.freeze({
      draftLineId: line.draftLineId,
      modifierGroups: line.modifierGroups,
      productId: line.productId,
      quantity: line.quantity,
      scope,
    }))),
    createOrder: Object.freeze({
      channel: TABLE_CHANNEL,
      currency: input.currency,
      scope,
      tableId: input.tableId,
    }),
    openOrder: Object.freeze({ scope, tableId: input.tableId }),
  });
}

/**
 * Offers the draft to the caller in the order the Order contracts expect:
 * create, then one item per line, then open. It only calls back — it performs
 * no request and reports no result, so nothing here can claim an order was
 * saved.
 */
export function offerOrderDraft(handoff: OrderDraftHandoffV1, callbacks: OrderDraftCallbacks): void {
  callbacks.onCreateOrder(handoff.createOrder);
  for (const item of handoff.addItems) callbacks.onAddItem(item);
  callbacks.onOpenOrder(handoff.openOrder);
}
