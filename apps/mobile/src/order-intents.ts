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
import type { MenuCatalogV1, ModifierGroupSelectionV1, OrderChannelV1 } from "@super-restaurant/shared-types";

import type { MobileBranchScope } from "./mobile-client.js";
import { draftLineIssues, type OrderDraftLine } from "./order-draft.js";

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

/**
 * Builds the hand-over, or returns `undefined` when the draft cannot be
 * expressed against the catalog as it stands now.
 *
 * Every line is revalidated here, not merely checked for a known product id:
 * the product must still be published and active, the quantity must be an
 * integer inside the range the command accepts, and each line's modifier
 * groups must still be active, still belong to that product, hold no repeated
 * group or option, respect every per-option and per-group maximum and satisfy
 * every required minimum. A catalog that changed between composing and sending
 * therefore yields `undefined`, which the caller reports as `stale` — no
 * partial hand-over, and nothing offered at all.
 */
export function buildOrderDraftHandoff(input: {
  readonly catalog: MenuCatalogV1;
  readonly lines: readonly OrderDraftLine[];
  readonly scope: MobileBranchScope;
  readonly tableId: string;
}): OrderDraftHandoffV1 | undefined {
  const currency = input.catalog.currency;
  if (input.lines.length === 0 || !CURRENCY_PATTERN.test(currency)) return undefined;
  if (input.lines.some((line) => draftLineIssues(input.catalog, line).length > 0)) return undefined;
  // Two lines sharing a handle would make the feedback for one of them
  // ambiguous, and nothing downstream could tell them apart.
  const handles = input.lines.map((line) => line.draftLineId);
  if (new Set(handles).size !== handles.length) return undefined;

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
      currency,
      scope,
      tableId: input.tableId,
    }),
    openOrder: Object.freeze({ scope, tableId: input.tableId }),
  });
}
