import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidSyncMergeInputError,
  Money,
  ORDER_DISCOUNT_ALLOCATION_STRATEGY,
  evaluateSyncMerge,
  mergeCashMovementSyncEvent,
  mergeDiningTableSyncEvent,
  mergeKdsTicketSyncEvent,
  mergeOrderItemSyncEvent,
  mergeOrderSyncEvent,
  mergePaymentSyncEvent,
  mergeTombstoneSyncEvent,
} from "./index.js";
import type {
  CashRegisterSyncState,
  DiningTableSyncState,
  KdsTicketSyncState,
  OrderItemPricingInput,
  OrderItemSyncState,
  OrderSyncState,
  PaymentSyncContext,
  SyncMergeEventMeta,
  SyncSupervisorAuthorization,
} from "./index.js";

const RESTAURANT_A = "11111111-1111-4111-8111-111111111111";
const RESTAURANT_B = "22222222-2222-4222-8222-222222222222";
const BRANCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRANCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function mxn(amountMinor: number): Money {
  return new Money(amountMinor, "MXN");
}

function meta(overrides: Partial<SyncMergeEventMeta> = {}): SyncMergeEventMeta {
  return {
    eventId: "evt-1",
    idempotencyKey: "idem-1",
    deviceId: "dev-1",
    actorId: "actor-1",
    restaurantId: RESTAURANT_A,
    branchId: BRANCH_A,
    occurredAt: "2026-11-23T12:00:00Z",
    ...overrides,
  };
}

function supervisor(actorId = "sup-1"): SyncSupervisorAuthorization {
  return { approved: true, actorId };
}

function pricingLine(
  orderItemId: string,
  unitMinor: number,
  quantity = 1,
  overrides: Partial<OrderItemPricingInput> = {},
): OrderItemPricingInput {
  return {
    orderItemId,
    quantity,
    snapshot: {
      catalogVersion: "cat-v1",
      productId: `prod-${orderItemId}`,
      name: `Platillo ${orderItemId}`,
      stationId: "grill",
      unit: "each",
      unitPrice: mxn(unitMinor),
      modifiers: [],
      tax: {
        taxId: "iva-16",
        name: "IVA 16%",
        taxRuleVersion: "mx-v1",
        rate: { numerator: 16n, denominator: 100n },
        inclusion: "excluded",
      },
    },
    ...overrides,
  };
}

function baseOrder(overrides: Partial<OrderSyncState> = {}): OrderSyncState {
  const initialLine = pricingLine("item-1", 10000, 1);
  return {
    orderId: "order-1",
    restaurantId: RESTAURANT_A,
    branchId: BRANCH_A,
    channel: "table",
    tableId: "table-1",
    currency: "MXN",
    timeZone: "America/Hermosillo",
    status: "open",
    version: 2,
    items: [
      {
        ...initialLine,
        restaurantId: RESTAURANT_A,
        branchId: BRANCH_A,
        status: "pending",
      },
    ],
    deliveryCharge: null,
    capturedAmountMinor: 0,
    ...overrides,
  };
}

function baseOrderItem(overrides: Partial<OrderItemSyncState> = {}): OrderItemSyncState {
  return {
    orderItemId: "item-1",
    orderId: "order-1",
    restaurantId: RESTAURANT_A,
    branchId: BRANCH_A,
    version: 2,
    status: "pending",
    item: pricingLine("item-1", 10000, 1),
    tombstoned: false,
    ...overrides,
  };
}

function baseTable(overrides: Partial<DiningTableSyncState> = {}): DiningTableSyncState {
  return {
    tableId: "table-1",
    restaurantId: RESTAURANT_A,
    branchId: BRANCH_A,
    version: 1,
    status: "free",
    activeOrderId: null,
    reservationId: null,
    waiterUserId: null,
    shiftId: "shift-1",
    tombstoned: false,
    ...overrides,
  };
}

function baseKdsTicket(overrides: Partial<KdsTicketSyncState> = {}): KdsTicketSyncState {
  return {
    ticketId: "ticket-1",
    orderId: "order-1",
    orderItemId: "item-1",
    restaurantId: RESTAURANT_A,
    branchId: BRANCH_A,
    stationId: "grill",
    version: 1,
    status: "sent",
    acknowledged: false,
    ...overrides,
  };
}

function basePaymentContext(overrides: Partial<PaymentSyncContext> = {}): PaymentSyncContext {
  return {
    restaurantId: RESTAURANT_A,
    branchId: BRANCH_A,
    orderId: "order-1",
    orderStatus: "open",
    currency: "MXN",
    orderTotalMinor: 11600,
    existingPayments: [],
    cashRegisterOpen: true,
    offlineCashLimitMinor: 50000,
    expectedCashSequenceByDevice: { "dev-1": 1, "dev-2": 1 },
    ...overrides,
  };
}

function baseCashRegister(overrides: Partial<CashRegisterSyncState> = {}): CashRegisterSyncState {
  return {
    cashRegisterId: "cr-1",
    restaurantId: RESTAURANT_A,
    branchId: BRANCH_A,
    registerId: "reg-1",
    shiftId: "shift-1",
    cashierId: "cashier-1",
    currency: "MXN",
    status: "open",
    version: 1,
    openingFloatMinor: 10000,
    movements: [],
    expectedNextSequenceByDevice: { "dev-1": 1, "dev-2": 1 },
    offlineCashLimitMinor: 50000,
    ...overrides,
  };
}

// ============================================================================
// 1. Order merge rules (OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §4.2)
// ============================================================================

test("Order: two devices adding distinct orderItemIds combine and recalculate totals in minor units from snapshots", () => {
  const created = mergeOrderSyncEvent({
    canonical: null,
    event: {
      ...meta({ eventId: "evt-create", idempotencyKey: "idem-create", deviceId: "dev-1" }),
      entityId: "order-1",
      operation: "create",
      baseVersion: null,
      channel: "delivery",
      currency: "MXN",
      timeZone: "America/Hermosillo",
      items: [pricingLine("item-1", 10000, 1)],
      deliveryCharge: { amount: mxn(2500), quoteId: "quote-1" },
    },
  });
  assert.equal(created.status, "accepted");
  assert.equal(created.canonicalVersion, 1);
  // 10000 + 16% IVA (1600) = 11600; + 2500 deliveryCharge = 14100
  assert.equal(created.recalculatedTotals?.total.amountMinor, 11600);
  assert.equal(created.payableTotal?.amountMinor, 14100);
  assert.equal(Object.isFrozen(created), true);

  // Device 1 adds item-A at baseVersion 1 -> version 2
  const addA = mergeOrderSyncEvent({
    canonical: created.mergedState,
    event: {
      ...meta({ eventId: "evt-add-a", idempotencyKey: "idem-add-a", deviceId: "dev-1" }),
      entityId: "order-1",
      operation: "update",
      kind: "add_items",
      baseVersion: 1,
      items: [pricingLine("item-A", 5000, 2)],
    },
  });
  assert.equal(addA.status, "accepted");
  assert.equal(addA.code, "ACCEPTED");
  assert.equal(addA.canonicalVersion, 2);

  // Device 2 offline read version 1 (stale!) and adds distinct item-B -> combines!
  const addB = mergeOrderSyncEvent({
    canonical: addA.mergedState,
    event: {
      ...meta({ eventId: "evt-add-b", idempotencyKey: "idem-add-b", deviceId: "dev-2" }),
      entityId: "order-1",
      operation: "update",
      kind: "add_items",
      baseVersion: 1,
      items: [pricingLine("item-B", 7500, 1)],
    },
  });
  assert.equal(addB.status, "accepted");
  assert.equal(addB.code, "ADDITIVE_LINES_MERGED");
  assert.equal(addB.canonicalVersion, 3);
  assert.deepEqual(
    addB.mergedState?.items.map((i) => i.orderItemId),
    ["item-1", "item-A", "item-B"],
  );
  // 10000 + 10000 + 7500 = 27500 subtotal; 16% tax = 1600 + 1600 + 1200 = 4400; total = 31900; + 2500 shipping = 34400
  assert.equal(addB.recalculatedTotals?.grossBeforeLineDiscount.amountMinor, 27500);
  assert.equal(addB.recalculatedTotals?.taxTotal.amountMinor, 4400);
  assert.equal(addB.recalculatedTotals?.total.amountMinor, 31900);
  assert.equal(addB.payableTotal?.amountMinor, 34400);

  // Retrying addB with same idempotencyKey (even with new eventId and different occurredAt) deduplicates!
  const retryB = mergeOrderSyncEvent({
    canonical: addB.mergedState,
    event: {
      ...meta({
        eventId: "evt-add-b-retry",
        idempotencyKey: "idem-add-b",
        deviceId: "dev-2",
        occurredAt: "2026-11-23T12:05:00Z",
      }),
      entityId: "order-1",
      operation: "update",
      kind: "add_items",
      baseVersion: 1,
      items: [pricingLine("item-B", 7500, 1)],
    },
  });
  assert.equal(retryB.status, "duplicate");
  assert.equal(retryB.code, "DUPLICATE_IDEMPOTENCY_KEY");
  assert.equal(retryB.canonicalVersion, 3);
});

test("Order: concurrent edit of same line, arbitrary price override, competing discount, and closed/paid line additions never use LWW", () => {
  const order = baseOrder({ version: 3 });

  // Adding an item with an existing orderItemId from another device -> conflict
  const dupLineId = mergeOrderSyncEvent({
    canonical: order,
    event: {
      ...meta({ eventId: "evt-dup-line", idempotencyKey: "idem-dup-line", deviceId: "dev-2" }),
      entityId: "order-1",
      operation: "update",
      kind: "add_items",
      baseVersion: 2,
      items: [pricingLine("item-1", 10000, 2)],
    },
  });
  assert.equal(dupLineId.status, "conflict");
  assert.equal(dupLineId.code, "CONCURRENT_ORDER_ITEM_MODIFICATION");
  assert.equal(dupLineId.requiresManualReview, true);

  // Modifying same line with stale baseVersion -> conflict (never LWW)
  const concurrentEdit = mergeOrderSyncEvent({
    canonical: order,
    event: {
      ...meta({ eventId: "evt-edit", idempotencyKey: "idem-edit", deviceId: "dev-2" }),
      entityId: "order-1",
      operation: "update",
      kind: "modify_item",
      baseVersion: 2,
      item: pricingLine("item-1", 10000, 3),
    },
  });
  assert.equal(concurrentEdit.status, "conflict");
  assert.equal(concurrentEdit.code, "CONCURRENT_ORDER_ITEM_MODIFICATION");
  assert.equal(concurrentEdit.requiresManualReview, true);
  assert.equal(concurrentEdit.manualReview?.preserveEvidence, true);

  // Arbitrary unit price override even at current version -> manual_review
  const priceOverride = mergeOrderSyncEvent({
    canonical: order,
    event: {
      ...meta({ eventId: "evt-price", idempotencyKey: "idem-price" }),
      entityId: "order-1",
      operation: "update",
      kind: "modify_item",
      baseVersion: 3,
      item: pricingLine("item-1", 100, 1),
    },
  });
  assert.equal(priceOverride.status, "manual_review");
  assert.equal(priceOverride.code, "ARBITRARY_PRICE_OVERRIDE_BLOCKED");
  assert.equal(priceOverride.financial, true);

  // Competing order discounts -> manual_review
  const discountedOrder = baseOrder({
    version: 3,
    orderDiscount: {
      discountId: "disc-1",
      discountRuleVersion: "v1",
      amount: mxn(1000),
      allocationStrategy: ORDER_DISCOUNT_ALLOCATION_STRATEGY,
    },
  });
  const secondDiscount = mergeOrderSyncEvent({
    canonical: discountedOrder,
    event: {
      ...meta({ eventId: "evt-disc-2", idempotencyKey: "idem-disc-2" }),
      entityId: "order-1",
      operation: "update",
      kind: "apply_discount",
      baseVersion: 3,
      orderDiscount: {
        discountId: "disc-2",
        discountRuleVersion: "v1",
        amount: mxn(2000),
        allocationStrategy: ORDER_DISCOUNT_ALLOCATION_STRATEGY,
      },
    },
  });
  assert.equal(secondDiscount.status, "manual_review");
  assert.equal(secondDiscount.code, "CONCURRENT_DISCOUNT_CONFLICT");

  // Additive line arriving after order became paid -> conflict
  const paidOrder = baseOrder({ status: "paid", version: 5, capturedAmountMinor: 11600 });
  const lateLine = mergeOrderSyncEvent({
    canonical: paidOrder,
    event: {
      ...meta({ eventId: "evt-late", idempotencyKey: "idem-late" }),
      entityId: "order-1",
      operation: "update",
      kind: "add_items",
      baseVersion: 2,
      items: [pricingLine("item-late", 5000, 1)],
    },
  });
  assert.equal(lateLine.status, "conflict");
  assert.equal(lateLine.code, "ORDER_DOES_NOT_ACCEPT_NEW_LINES");
  assert.equal(lateLine.requiresManualReview, true);

  // Order cannot be deleted/tombstoned
  const del = mergeOrderSyncEvent({
    canonical: order,
    event: {
      ...meta({ eventId: "evt-del", idempotencyKey: "idem-del" }),
      entityId: "order-1",
      operation: "delete",
      baseVersion: 3,
    },
  });
  assert.equal(del.status, "rejected");
  assert.equal(del.code, "TOMBSTONE_NOT_ALLOWED");
});

test("Order: monotonic transitions, reopen conflict, and cancellation conflicts", () => {
  const paidOrder = baseOrder({ status: "paid", version: 4, capturedAmountMinor: 11600 });

  // Stale transition to earlier monotonic state deduplicates without regressing
  const staleOpen = mergeOrderSyncEvent({
    canonical: paidOrder,
    event: {
      ...meta({ eventId: "evt-stale-open", idempotencyKey: "idem-stale-open" }),
      entityId: "order-1",
      operation: "transition",
      baseVersion: 2,
      targetStatus: "open",
    },
  });
  assert.equal(staleOpen.status, "duplicate");
  assert.equal(staleOpen.code, "STATE_ALREADY_SURPASSED");
  assert.equal(staleOpen.mergedState?.status, "paid");

  // Explicit backward transition at current version -> rejected
  const back = mergeOrderSyncEvent({
    canonical: paidOrder,
    event: {
      ...meta({ eventId: "evt-back", idempotencyKey: "idem-back" }),
      entityId: "order-1",
      operation: "transition",
      baseVersion: 4,
      targetStatus: "open",
    },
  });
  assert.equal(back.status, "rejected");
  assert.equal(back.code, "INVALID_BACKWARD_TRANSITION");

  // Reopening a closed order -> conflict (never LWW)
  const closedOrder = baseOrder({
    status: "closed",
    version: 5,
    items: [{ ...pricingLine("item-1", 10000, 1), restaurantId: RESTAURANT_A, branchId: BRANCH_A, status: "delivered" }],
  });
  const reopen = mergeOrderSyncEvent({
    canonical: closedOrder,
    event: {
      ...meta({ eventId: "evt-reopen", idempotencyKey: "idem-reopen" }),
      entityId: "order-1",
      operation: "transition",
      baseVersion: 3,
      targetStatus: "open",
    },
  });
  assert.equal(reopen.status, "conflict");
  assert.equal(reopen.code, "ORDER_REOPEN_CONFLICT");
  assert.equal(reopen.requiresManualReview, true);

  // Cancelling a paid order without pending refund obligation -> manual_review
  const cancelNoRefund = mergeOrderSyncEvent({
    canonical: paidOrder,
    event: {
      ...meta({ eventId: "evt-cancel-nr", idempotencyKey: "idem-cancel-nr" }),
      entityId: "order-1",
      operation: "transition",
      baseVersion: 4,
      targetStatus: "cancelled",
      reason: "Cliente canceló",
      authorization: supervisor(),
    },
  });
  assert.equal(cancelNoRefund.status, "manual_review");
  assert.equal(cancelNoRefund.code, "REFUND_OBLIGATION_REQUIRED");

  // Stale whole-order cancellation (another device changed order since baseVersion) -> conflict
  const staleCancel = mergeOrderSyncEvent({
    canonical: baseOrder({ status: "open", version: 3 }),
    event: {
      ...meta({ eventId: "evt-stale-cancel", idempotencyKey: "idem-stale-cancel" }),
      entityId: "order-1",
      operation: "transition",
      baseVersion: 2,
      targetStatus: "cancelled",
      reason: "Error",
      authorization: supervisor(),
    },
  });
  assert.equal(staleCancel.status, "conflict");
  assert.equal(staleCancel.code, "ORDER_CANCELLATION_CONFLICT");
});

// ============================================================================
// 2. OrderItem merge rules: concurrent edits, monotonicity, post-send cancel, tombstones
// ============================================================================

test("OrderItem: concurrent edit conflicts, monotonic transitions never regress, post-send cancel never silent", () => {
  // Concurrent edit on same line -> conflict
  const concurrent = mergeOrderItemSyncEvent({
    canonical: baseOrderItem({ version: 3 }),
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-item-edit", idempotencyKey: "idem-item-edit", deviceId: "dev-2" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "update",
      baseVersion: 2,
      item: pricingLine("item-1", 10000, 4),
    },
  });
  assert.equal(concurrent.status, "conflict");
  assert.equal(concurrent.code, "CONCURRENT_ORDER_ITEM_MODIFICATION");
  assert.equal(concurrent.requiresManualReview, true);

  // Monotonic progression: sent -> preparing accepted
  const sentItem = baseOrderItem({ status: "sent", version: 2 });
  const toPreparing = mergeOrderItemSyncEvent({
    canonical: sentItem,
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-prep", idempotencyKey: "idem-prep" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "transition",
      baseVersion: 2,
      targetStatus: "preparing",
    },
  });
  assert.equal(toPreparing.status, "accepted");
  assert.equal(toPreparing.mergedState?.status, "preparing");
  assert.equal(toPreparing.canonicalVersion, 3);

  // Duplicate same target state from another device -> duplicate
  const dupPreparing = mergeOrderItemSyncEvent({
    canonical: toPreparing.mergedState,
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-prep-2", idempotencyKey: "idem-prep-2", deviceId: "dev-2" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "transition",
      baseVersion: 2,
      targetStatus: "preparing",
    },
  });
  assert.equal(dupPreparing.status, "duplicate");
  assert.equal(dupPreparing.code, "ALREADY_IN_TARGET_STATE");
  assert.equal(dupPreparing.mergedState?.status, "preparing");

  // Stale earlier state (sent arriving when already ready) -> duplicate STATE_ALREADY_SURPASSED, no regression
  const readyItem = baseOrderItem({ status: "ready", version: 4 });
  const staleSent = mergeOrderItemSyncEvent({
    canonical: readyItem,
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-stale-sent", idempotencyKey: "idem-stale-sent" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "sent",
    },
  });
  assert.equal(staleSent.status, "duplicate");
  assert.equal(staleSent.code, "STATE_ALREADY_SURPASSED");
  assert.equal(staleSent.mergedState?.status, "ready");

  // Explicit backward at current version -> rejected
  const backward = mergeOrderItemSyncEvent({
    canonical: readyItem,
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-back", idempotencyKey: "idem-back" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "transition",
      baseVersion: 4,
      targetStatus: "preparing",
    },
  });
  assert.equal(backward.status, "rejected");
  assert.equal(backward.code, "INVALID_BACKWARD_TRANSITION");

  // Post-send cancellation race (stale version while KDS preparing) -> conflict
  const cancelRace = mergeOrderItemSyncEvent({
    canonical: baseOrderItem({ status: "preparing", version: 3 }),
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-cancel-race", idempotencyKey: "idem-cancel-race" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "cancelled",
      reason: "Cliente cambió de opinión",
      authorization: supervisor(),
      kdsEvidenceVerified: true,
    },
  });
  assert.equal(cancelRace.status, "conflict");
  assert.equal(cancelRace.code, "POST_SEND_CANCELLATION_CONFLICT");
  assert.equal(cancelRace.requiresManualReview, true);

  // Post-send cancellation at current version WITHOUT KDS evidence or supervisor -> conflict
  const cancelUnverified = mergeOrderItemSyncEvent({
    canonical: baseOrderItem({ status: "preparing", version: 3 }),
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-cancel-unv", idempotencyKey: "idem-cancel-unv" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "transition",
      baseVersion: 3,
      targetStatus: "cancelled",
      reason: "Agotado",
      authorization: supervisor(),
      kdsEvidenceVerified: false,
    },
  });
  assert.equal(cancelUnverified.status, "conflict");
  assert.equal(cancelUnverified.code, "POST_SEND_CANCELLATION_CONFLICT");

  // Authorized post-send cancellation at current version WITH verified KDS evidence -> accepted
  const cancelOk = mergeOrderItemSyncEvent({
    canonical: baseOrderItem({ status: "preparing", version: 3 }),
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-cancel-ok", idempotencyKey: "idem-cancel-ok" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "transition",
      baseVersion: 3,
      targetStatus: "cancelled",
      reason: "Producto agotado en cocina",
      authorization: supervisor(),
      kdsEvidenceVerified: true,
    },
  });
  assert.equal(cancelOk.status, "accepted");
  assert.equal(cancelOk.mergedState?.status, "cancelled");

  // Advancing an already cancelled item -> conflict (cancel vs prepare/deliver)
  const advanceCancelled = mergeOrderItemSyncEvent({
    canonical: cancelOk.mergedState,
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-adv-canc", idempotencyKey: "idem-adv-canc" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "transition",
      baseVersion: 3,
      targetStatus: "ready",
    },
  });
  assert.equal(advanceCancelled.status, "conflict");
  assert.equal(advanceCancelled.code, "CANCEL_VS_PROGRESS_CONFLICT");
});

test("OrderItem & generic tombstones: idempotent delete, block resurrection, block same-ID recreation", () => {
  const deleted = mergeOrderItemSyncEvent({
    canonical: baseOrderItem({ status: "pending", version: 2 }),
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-del-1", idempotencyKey: "idem-del-1" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "delete",
      baseVersion: 2,
      reason: "Duplicado antes de enviar",
    },
  });
  assert.equal(deleted.status, "accepted");
  assert.equal(deleted.tombstoned, true);
  assert.equal(deleted.canonicalVersion, 3);

  // Exact retry of delete event -> duplicate
  const retryDelete = mergeOrderItemSyncEvent({
    canonical: deleted.mergedState,
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-del-1", idempotencyKey: "idem-del-1" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "delete",
      baseVersion: 2,
      reason: "Duplicado antes de enviar",
    },
  });
  assert.equal(retryDelete.status, "duplicate");
  assert.equal(retryDelete.tombstoned, true);

  // Distinct second delete event on already tombstoned item -> idempotent accepted
  const secondDelete = mergeOrderItemSyncEvent({
    canonical: deleted.mergedState,
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-del-2", idempotencyKey: "idem-del-2", deviceId: "dev-2" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "delete",
      baseVersion: 2,
    },
  });
  assert.equal(secondDelete.status, "accepted");
  assert.equal(secondDelete.code, "TOMBSTONE_ALREADY_APPLIED");
  assert.equal(secondDelete.canonicalVersion, 3);

  // Stale update against tombstoned item NEVER resurrects
  const staleUpdate = mergeOrderItemSyncEvent({
    canonical: deleted.mergedState,
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-resurrect", idempotencyKey: "idem-resurrect", deviceId: "dev-2" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "update",
      baseVersion: 2,
      item: pricingLine("item-1", 10000, 2),
    },
  });
  assert.equal(staleUpdate.status, "conflict");
  assert.equal(staleUpdate.code, "TOMBSTONE_RESURRECTION_BLOCKED");
  assert.equal(staleUpdate.tombstoned, true);
  assert.equal(staleUpdate.mergedState, null);

  // Recreating same ID on tombstoned item -> rejected
  const recreateSameId = mergeOrderItemSyncEvent({
    canonical: deleted.mergedState,
    parentOrderStatus: "open",
    orderCurrency: "MXN",
    event: {
      ...meta({ eventId: "evt-recreate", idempotencyKey: "idem-recreate" }),
      entityId: "item-1",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      item: pricingLine("item-1", 10000, 1),
    },
  });
  assert.equal(recreateSameId.status, "rejected");
  assert.equal(recreateSameId.code, "TOMBSTONE_RECREATION_REQUIRES_NEW_ID");

  // Standalone tombstone helper: new ID competing for semantic identity -> manual_review
  const semanticConflict = mergeTombstoneSyncEvent({
    canonical: null,
    event: {
      ...meta({ eventId: "evt-sem", idempotencyKey: "idem-sem" }),
      entityType: "DiningTable",
      entityId: "table-new-id",
      operation: "create",
      baseVersion: null,
      semanticIdentityConflict: true,
    },
  });
  assert.equal(semanticConflict.status, "manual_review");
  assert.equal(semanticConflict.code, "TOMBSTONE_SEMANTIC_IDENTITY_CONFLICT");
});

// ============================================================================
// 3. DiningTable merge rules: occupancy dispute, shared reservation, distinct tables
// ============================================================================

test("DiningTable: occupancy dispute conflicts without displacing diner; distinct tables succeed unless sharing exclusive reservation", () => {
  // Occupy free table-1 with order-A -> accepted
  const occupyA = mergeDiningTableSyncEvent({
    canonical: baseTable({ tableId: "table-1", version: 1, status: "free" }),
    event: {
      ...meta({ eventId: "evt-t1-a", idempotencyKey: "idem-t1-a", deviceId: "dev-1" }),
      entityId: "table-1",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "occupied",
      activeOrderId: "order-A",
      waiterUserId: "waiter-1",
    },
  });
  assert.equal(occupyA.status, "accepted");
  assert.equal(occupyA.canonicalVersion, 2);
  assert.equal(occupyA.mergedState?.activeOrderId, "order-A");

  // Second device concurrently assigns order-B to occupied table-1 -> conflict (never displaces diner!)
  const occupyB = mergeDiningTableSyncEvent({
    canonical: occupyA.mergedState,
    event: {
      ...meta({ eventId: "evt-t1-b", idempotencyKey: "idem-t1-b", deviceId: "dev-2" }),
      entityId: "table-1",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "occupied",
      activeOrderId: "order-B",
      waiterUserId: "waiter-2",
    },
  });
  assert.equal(occupyB.status, "conflict");
  assert.equal(occupyB.code, "TABLE_OCCUPANCY_CONFLICT");
  assert.equal(occupyB.requiresManualReview, true);

  // Distinct table-2 in same branch without shared reservation -> accepted
  const occupyTable2 = mergeDiningTableSyncEvent({
    canonical: baseTable({ tableId: "table-2", version: 1, status: "free" }),
    event: {
      ...meta({ eventId: "evt-t2", idempotencyKey: "idem-t2", deviceId: "dev-2" }),
      entityId: "table-2",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "occupied",
      activeOrderId: "order-B",
      waiterUserId: "waiter-2",
    },
  });
  assert.equal(occupyTable2.status, "accepted");

  // Distinct table-3 claiming an exclusive reservation already held by table-2 -> conflict
  const sharedReservation = mergeDiningTableSyncEvent({
    canonical: baseTable({ tableId: "table-3", version: 1, status: "free" }),
    event: {
      ...meta({ eventId: "evt-t3-res", idempotencyKey: "idem-t3-res" }),
      entityId: "table-3",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "occupied",
      activeOrderId: "order-C",
      reservationId: "res-99",
      exclusiveReservationHolderTableId: "table-2",
    },
  });
  assert.equal(sharedReservation.status, "conflict");
  assert.equal(sharedReservation.code, "SHARED_EXCLUSIVE_RESERVATION_CONFLICT");

  // Deleting an occupied table -> conflict
  const deleteOccupied = mergeDiningTableSyncEvent({
    canonical: occupyA.mergedState,
    event: {
      ...meta({ eventId: "evt-del-occ", idempotencyKey: "idem-del-occ" }),
      entityId: "table-1",
      operation: "delete",
      baseVersion: 2,
    },
  });
  assert.equal(deleteOccupied.status, "conflict");
  assert.equal(deleteOccupied.code, "TABLE_OCCUPIED_DELETE_CONFLICT");
});

// ============================================================================
// 4. KdsTicket merge rules: idempotent ACK/advance, monotonic, double station, lost ticket
// ============================================================================

test("KdsTicket: monotonic advance & ACK idempotency, double station & lost ticket keep ticket visible", () => {
  const ack1 = mergeKdsTicketSyncEvent({
    canonical: baseKdsTicket(),
    event: {
      ...meta({ eventId: "evt-ack-1", idempotencyKey: "idem-ack-1" }),
      entityId: "ticket-1",
      orderId: "order-1",
      orderItemId: "item-1",
      stationId: "grill",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "sent",
      acknowledge: true,
    },
  });
  assert.equal(ack1.status, "accepted");
  assert.equal(ack1.mergedState?.acknowledged, true);

  // Second ACK from another device on same station -> duplicate
  const ack2 = mergeKdsTicketSyncEvent({
    canonical: ack1.mergedState,
    event: {
      ...meta({ eventId: "evt-ack-2", idempotencyKey: "idem-ack-2", deviceId: "dev-2" }),
      entityId: "ticket-1",
      orderId: "order-1",
      orderItemId: "item-1",
      stationId: "grill",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "sent",
      acknowledge: true,
    },
  });
  assert.equal(ack2.status, "duplicate");
  assert.equal(ack2.code, "ALREADY_ACKNOWLEDGED");

  // Advance sent -> preparing -> ready
  const prep = mergeKdsTicketSyncEvent({
    canonical: ack1.mergedState,
    event: {
      ...meta({ eventId: "evt-kds-prep", idempotencyKey: "idem-kds-prep" }),
      entityId: "ticket-1",
      orderId: "order-1",
      orderItemId: "item-1",
      stationId: "grill",
      operation: "transition",
      baseVersion: 2,
      targetStatus: "preparing",
    },
  });
  assert.equal(prep.status, "accepted");
  assert.equal(prep.mergedState?.status, "preparing");

  const ready = mergeKdsTicketSyncEvent({
    canonical: prep.mergedState,
    event: {
      ...meta({ eventId: "evt-kds-ready", idempotencyKey: "idem-kds-ready" }),
      entityId: "ticket-1",
      orderId: "order-1",
      orderItemId: "item-1",
      stationId: "grill",
      operation: "transition",
      baseVersion: 3,
      targetStatus: "ready",
    },
  });
  assert.equal(ready.status, "accepted");
  assert.equal(ready.mergedState?.status, "ready");

  // Stale preparing arriving when already ready -> duplicate without regression
  const stalePrep = mergeKdsTicketSyncEvent({
    canonical: ready.mergedState,
    event: {
      ...meta({ eventId: "evt-kds-stale-prep", idempotencyKey: "idem-kds-stale-prep", deviceId: "dev-2" }),
      entityId: "ticket-1",
      orderId: "order-1",
      orderItemId: "item-1",
      stationId: "grill",
      operation: "transition",
      baseVersion: 2,
      targetStatus: "preparing",
    },
  });
  assert.equal(stalePrep.status, "duplicate");
  assert.equal(stalePrep.code, "STATE_ALREADY_SURPASSED");
  assert.equal(stalePrep.mergedState?.status, "ready");

  // Double station conflict -> conflict + keepTicketVisible + requiresCursorResync
  const wrongStation = mergeKdsTicketSyncEvent({
    canonical: ready.mergedState,
    event: {
      ...meta({ eventId: "evt-wrong-st", idempotencyKey: "idem-wrong-st" }),
      entityId: "ticket-1",
      orderId: "order-1",
      orderItemId: "item-1",
      stationId: "bar",
      operation: "transition",
      baseVersion: 4,
      targetStatus: "delivered",
    },
  });
  assert.equal(wrongStation.status, "conflict");
  assert.equal(wrongStation.code, "KDS_DOUBLE_STATION_CONFLICT");
  assert.equal(wrongStation.keepTicketVisible, true);
  assert.equal(wrongStation.requiresCursorResync, true);

  // Lost / missing ticket -> conflict + keepTicketVisible + requiresCursorResync
  const missing = mergeKdsTicketSyncEvent({
    canonical: null,
    event: {
      ...meta({ eventId: "evt-missing", idempotencyKey: "idem-missing" }),
      entityId: "ticket-lost",
      orderId: "order-1",
      orderItemId: "item-1",
      stationId: "grill",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "preparing",
    },
  });
  assert.equal(missing.status, "conflict");
  assert.equal(missing.code, "KDS_TICKET_NOT_FOUND");
  assert.equal(missing.keepTicketVisible, true);
  assert.equal(missing.requiresCursorResync, true);

  // Cancelled ticket cannot advance
  const cancelledTicket = baseKdsTicket({ status: "cancelled", version: 3 });
  const advCancelled = mergeKdsTicketSyncEvent({
    canonical: cancelledTicket,
    event: {
      ...meta({ eventId: "evt-adv-canc", idempotencyKey: "idem-adv-canc" }),
      entityId: "ticket-1",
      orderId: "order-1",
      orderItemId: "item-1",
      stationId: "grill",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "ready",
    },
  });
  assert.equal(advCancelled.status, "conflict");
  assert.equal(advCancelled.code, "KDS_CANCELLED_TICKET_CONFLICT");
  assert.equal(advCancelled.keepTicketVisible, true);
});

// ============================================================================
// 5. Payment merge rules: dedup, key reuse, overcollection, offline cash/card_manual
// ============================================================================

test("Payment: same idempotencyKey deduplicates; tampered key rejects; distinct-key overcollection escalates to manual_review", () => {
  const existingPay = {
    paymentId: "pay-1",
    eventId: "evt-pay-1",
    idempotencyKey: "idem-pay-1",
    orderId: "order-1",
    amountMinor: 11600,
    tipMinor: 1000,
    tenderedAmountMinor: 15000,
    currency: "MXN",
    method: "cash" as const,
    state: "captured" as const,
    deviceId: "dev-1",
    cashRegisterId: "cr-1",
    cashierId: "cashier-1",
    cashSequence: 1,
    receiptNumber: "R-001",
  };
  const paidCtx = basePaymentContext({
    orderStatus: "paid",
    existingPayments: [existingPay],
  });

  // Reconstructed retry with same idempotencyKey and identical business intent -> duplicate
  const retrySameKey = mergePaymentSyncEvent({
    context: paidCtx,
    event: {
      ...meta({ eventId: "evt-pay-1-retry", idempotencyKey: "idem-pay-1" }),
      entityId: "pay-1",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 11600,
      tipMinor: 1000,
      tenderedAmountMinor: 15000,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: true,
      cashRegisterId: "cr-1",
      cashierId: "cashier-1",
      cashSequence: 1,
      receiptNumber: "R-001",
    },
  });
  assert.equal(retrySameKey.status, "duplicate");
  assert.equal(retrySameKey.code, "DUPLICATE_IDEMPOTENCY_KEY");
  assert.equal(retrySameKey.changeMinor, 2400);
  assert.equal(retrySameKey.blockNewCollection, false);

  // Same idempotencyKey reused with different amount -> rejected (IDEMPOTENCY_KEY_REUSE)
  const tamperedKey = mergePaymentSyncEvent({
    context: paidCtx,
    event: {
      ...meta({ eventId: "evt-pay-tamper", idempotencyKey: "idem-pay-1" }),
      entityId: "pay-1",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 5000,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: false,
    },
  });
  assert.equal(tamperedKey.status, "rejected");
  assert.equal(tamperedKey.code, "IDEMPOTENCY_KEY_REUSE");

  // Second payment on already-paid order with DIFFERENT idempotencyKey -> manual_review & blockNewCollection (NEVER LWW!)
  const secondCharge = mergePaymentSyncEvent({
    context: paidCtx,
    event: {
      ...meta({ eventId: "evt-pay-2", idempotencyKey: "idem-pay-2", deviceId: "dev-2" }),
      entityId: "pay-2",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 11600,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: true,
      cashRegisterId: "cr-1",
      cashierId: "cashier-1",
      cashSequence: 1,
    },
  });
  assert.equal(secondCharge.status, "manual_review");
  assert.equal(secondCharge.code, "DUPLICATE_OBLIGATION_PAYMENT_DIFFERENT_KEY");
  assert.equal(secondCharge.blockNewCollection, true);
  assert.equal(secondCharge.overcollectionMinor, 11600);
  assert.equal(secondCharge.manualReview?.preserveEvidence, true);

  // Partial payment exceeding remaining balance -> manual_review with exact overcollectionMinor
  const partialCtx = basePaymentContext({
    orderStatus: "partially_paid",
    existingPayments: [{ ...existingPay, amountMinor: 6000, tipMinor: 0, tenderedAmountMinor: null }],
  });
  const exceeds = mergePaymentSyncEvent({
    context: partialCtx,
    event: {
      ...meta({ eventId: "evt-pay-over", idempotencyKey: "idem-pay-over" }),
      entityId: "pay-over",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 7000,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: false,
    },
  });
  assert.equal(exceeds.status, "manual_review");
  assert.equal(exceeds.code, "PAYMENT_EXCEEDS_OBLIGATION");
  assert.equal(exceeds.overcollectionMinor, 1400);
  assert.equal(exceeds.blockNewCollection, true);

  // Exact split completion -> accepted, remaining 0, order status paid
  const splitOk = mergePaymentSyncEvent({
    context: partialCtx,
    event: {
      ...meta({ eventId: "evt-pay-split", idempotencyKey: "idem-pay-split" }),
      entityId: "pay-split",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 5600,
      tenderedAmountMinor: 6000,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: false,
    },
  });
  assert.equal(splitOk.status, "accepted");
  assert.equal(splitOk.changeMinor, 400);
  assert.equal(splitOk.remainingObligationMinor, 0);
  assert.equal(splitOk.resultingOrderPaymentStatus, "paid");
});

test("Payment: offline cash sequence/limit/closed-register and offline card_manual reconciliation rules", () => {
  // Offline cash exceeding limit -> manual_review
  const overLimit = mergePaymentSyncEvent({
    context: basePaymentContext({ orderTotalMinor: 80000, offlineCashLimitMinor: 50000 }),
    event: {
      ...meta({ eventId: "evt-lim", idempotencyKey: "idem-lim" }),
      entityId: "pay-lim",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 60000,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: true,
      cashRegisterId: "cr-1",
      cashierId: "cashier-1",
      cashSequence: 1,
    },
  });
  assert.equal(overLimit.status, "manual_review");
  assert.equal(overLimit.code, "OFFLINE_CASH_LIMIT_EXCEEDED");

  // Offline cash sequence gap -> manual_review
  const seqGap = mergePaymentSyncEvent({
    context: basePaymentContext({ expectedCashSequenceByDevice: { "dev-1": 2 } }),
    event: {
      ...meta({ eventId: "evt-gap", idempotencyKey: "idem-gap" }),
      entityId: "pay-gap",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 5000,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: true,
      cashRegisterId: "cr-1",
      cashierId: "cashier-1",
      cashSequence: 5,
    },
  });
  assert.equal(seqGap.status, "manual_review");
  assert.equal(seqGap.code, "CASH_SEQUENCE_GAP");

  // Offline card_manual with external confirmation -> accepted as authorized (NEVER captured), requiresReconciliation
  const cardManual = mergePaymentSyncEvent({
    context: basePaymentContext(),
    event: {
      ...meta({ eventId: "evt-cm", idempotencyKey: "idem-cm" }),
      entityId: "pay-cm",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 11600,
      currency: "MXN",
      method: "card_manual",
      isOfflineEvent: true,
      cardManualExternalConfirmed: true,
    },
  });
  assert.equal(cardManual.status, "accepted");
  assert.equal(cardManual.resultingPaymentState, "authorized");
  assert.equal(cardManual.requiresReconciliation, true);

  // Payment arriving on a cancelled order -> manual_review (preserve evidence)
  const onCancelled = mergePaymentSyncEvent({
    context: basePaymentContext({ orderStatus: "cancelled" }),
    event: {
      ...meta({ eventId: "evt-canc-pay", idempotencyKey: "idem-canc-pay" }),
      entityId: "pay-canc",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 11600,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: true,
      cashRegisterId: "cr-1",
      cashierId: "cashier-1",
      cashSequence: 1,
    },
  });
  assert.equal(onCancelled.status, "manual_review");
  assert.equal(onCancelled.code, "PAYMENT_ON_TERMINAL_ORDER");
});

// ============================================================================
// 6. CashMovement & CashRegister close merge rules
// ============================================================================

test("CashMovement: additive movements combine per device sequence; gaps, duplicates, negative totals, and double closes escalate", () => {
  // Device 1 appends cash_sale seq 1 -> accepted, balance 10000 + 5000 = 15000
  const m1 = mergeCashMovementSyncEvent({
    canonical: baseCashRegister(),
    event: {
      ...meta({ eventId: "evt-m1", idempotencyKey: "idem-m1", deviceId: "dev-1" }),
      entityId: "mov-1",
      operation: "create",
      baseVersion: null,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      localSequence: 1,
      type: "cash_sale",
      direction: "in",
      amountMinor: 5000,
      currency: "MXN",
      isOfflineEvent: true,
      source: { type: "payment", paymentId: "pay-1" },
    },
  });
  assert.equal(m1.status, "accepted");
  assert.equal(m1.expectedBalanceMinor, 15000);
  assert.equal(m1.mergedState?.expectedNextSequenceByDevice["dev-1"], 2);

  // Device 2 concurrently appends cash_sale seq 1 -> combines additively, balance 15000 + 3000 = 18000
  const m2 = mergeCashMovementSyncEvent({
    canonical: m1.mergedState!,
    event: {
      ...meta({ eventId: "evt-m2", idempotencyKey: "idem-m2", deviceId: "dev-2" }),
      entityId: "mov-2",
      operation: "create",
      baseVersion: null,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      localSequence: 1,
      type: "cash_sale",
      direction: "in",
      amountMinor: 3000,
      currency: "MXN",
      isOfflineEvent: true,
      source: { type: "payment", paymentId: "pay-2" },
    },
  });
  assert.equal(m2.status, "accepted");
  assert.equal(m2.expectedBalanceMinor, 18000);

  // Sequence gap on dev-1 (expected 2, got 4) -> manual_review
  const gap = mergeCashMovementSyncEvent({
    canonical: m2.mergedState!,
    event: {
      ...meta({ eventId: "evt-gap", idempotencyKey: "idem-gap", deviceId: "dev-1" }),
      entityId: "mov-gap",
      operation: "create",
      baseVersion: null,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      localSequence: 4,
      type: "cash_sale",
      direction: "in",
      amountMinor: 1000,
      currency: "MXN",
      isOfflineEvent: true,
      source: { type: "payment", paymentId: "pay-3" },
    },
  });
  assert.equal(gap.status, "manual_review");
  assert.equal(gap.code, "CASH_SEQUENCE_GAP");

  // Impossible negative cash balance (cash_out 25000 when balance is 18000) -> manual_review
  const negative = mergeCashMovementSyncEvent({
    canonical: m2.mergedState!,
    event: {
      ...meta({ eventId: "evt-neg", idempotencyKey: "idem-neg", deviceId: "dev-1" }),
      entityId: "mov-neg",
      operation: "create",
      baseVersion: null,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      localSequence: 2,
      type: "cash_out",
      direction: "out",
      amountMinor: 25000,
      currency: "MXN",
      isOfflineEvent: false,
      reason: "Retiro a proveedor",
    },
  });
  assert.equal(negative.status, "manual_review");
  assert.equal(negative.code, "CASH_BALANCE_IMPOSSIBLE");

  // Close register online -> accepted; second concurrent close -> conflict (block double close); reopen -> conflict
  const close1 = mergeCashMovementSyncEvent({
    canonical: m2.mergedState!,
    event: {
      ...meta({ eventId: "evt-close-1", idempotencyKey: "idem-close-1", deviceId: "dev-1" }),
      entityId: "cr-1",
      operation: "transition",
      baseVersion: 3,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      targetStatus: "closed",
      countedClosingBalanceMinor: 18000,
      currency: "MXN",
      isOfflineEvent: false,
      authorization: supervisor(),
    },
  });
  assert.equal(close1.status, "accepted");
  assert.equal(close1.closingDifferenceMinor, 0);

  // Reconstructed retry of same close key -> duplicate
  const closeRetry = mergeCashMovementSyncEvent({
    canonical: close1.mergedState!,
    event: {
      ...meta({ eventId: "evt-close-1-retry", idempotencyKey: "idem-close-1", deviceId: "dev-1" }),
      entityId: "cr-1",
      operation: "transition",
      baseVersion: 3,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      targetStatus: "closed",
      countedClosingBalanceMinor: 18000,
      currency: "MXN",
      isOfflineEvent: false,
      authorization: supervisor(),
    },
  });
  assert.equal(closeRetry.status, "duplicate");
  assert.equal(closeRetry.code, "DUPLICATE_IDEMPOTENCY_KEY");

  // Second concurrent close with different key -> conflict
  const close2 = mergeCashMovementSyncEvent({
    canonical: close1.mergedState!,
    event: {
      ...meta({ eventId: "evt-close-2", idempotencyKey: "idem-close-2", deviceId: "dev-2" }),
      entityId: "cr-1",
      operation: "transition",
      baseVersion: 3,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      targetStatus: "closed",
      countedClosingBalanceMinor: 17500,
      currency: "MXN",
      isOfflineEvent: false,
      reason: "Diferencia",
      authorization: supervisor(),
    },
  });
  assert.equal(close2.status, "conflict");
  assert.equal(close2.code, "CONCURRENT_CASH_REGISTER_CLOSE");
  assert.equal(close2.requiresManualReview, true);

  // Late offline cash movement after register close -> manual_review (never silently lost)
  const lateCash = mergeCashMovementSyncEvent({
    canonical: close1.mergedState!,
    event: {
      ...meta({ eventId: "evt-late-cash", idempotencyKey: "idem-late-cash", deviceId: "dev-1" }),
      entityId: "mov-late",
      operation: "create",
      baseVersion: null,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      localSequence: 2,
      type: "cash_sale",
      direction: "in",
      amountMinor: 2000,
      currency: "MXN",
      isOfflineEvent: true,
      source: { type: "payment", paymentId: "pay-late" },
    },
  });
  assert.equal(lateCash.status, "manual_review");
  assert.equal(lateCash.code, "CASH_REGISTER_ALREADY_CLOSED");

  // Reopen closed register -> conflict (never LWW)
  const reopen = mergeCashMovementSyncEvent({
    canonical: close1.mergedState!,
    event: {
      ...meta({ eventId: "evt-reopen-cr", idempotencyKey: "idem-reopen-cr" }),
      entityId: "cr-1",
      operation: "transition",
      baseVersion: 4,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      targetStatus: "open",
      currency: "MXN",
      isOfflineEvent: false,
      authorization: supervisor(),
    },
  });
  assert.equal(reopen.status, "conflict");
  assert.equal(reopen.code, "CASH_REGISTER_REOPEN_CONFLICT");
});

// ============================================================================
// 7. Cross-cutting invariants: occurredAt NEVER decides order, scope isolation, no floats, hostile objects
// ============================================================================

test("occurredAt manipulation (far past vs far future) NEVER changes merge decisions across all entities", () => {
  const timestamps = ["2000-01-01T00:00:00Z", "2099-12-31T23:59:59Z"] as const;

  // Order concurrent line edit
  const orderOutcomes = timestamps.map((occurredAt) => evaluateSyncMerge({
    entityType: "Order",
    canonical: baseOrder({ version: 3 }),
    event: {
      ...meta({ eventId: "evt-o", idempotencyKey: "idem-o", occurredAt }),
      entityId: "order-1",
      operation: "update",
      kind: "modify_item",
      baseVersion: 2,
      item: pricingLine("item-1", 10000, 2),
    },
  }));
  assert.equal(orderOutcomes[0]?.status, "conflict");
  assert.equal(orderOutcomes[1]?.status, "conflict");
  assert.equal(orderOutcomes[0]?.code, orderOutcomes[1]?.code);

  // DiningTable occupancy dispute
  const tableOutcomes = timestamps.map((occurredAt) => evaluateSyncMerge({
    entityType: "DiningTable",
    canonical: baseTable({ status: "occupied", activeOrderId: "order-A", version: 2 }),
    event: {
      ...meta({ eventId: "evt-t", idempotencyKey: "idem-t", occurredAt }),
      entityId: "table-1",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "occupied",
      activeOrderId: "order-B",
    },
  }));
  assert.equal(tableOutcomes[0]?.status, "conflict");
  assert.equal(tableOutcomes[1]?.status, "conflict");
  assert.equal(tableOutcomes[0]?.code, "TABLE_OCCUPANCY_CONFLICT");
  assert.equal(tableOutcomes[1]?.code, "TABLE_OCCUPANCY_CONFLICT");

  // KdsTicket monotonic non-regression
  const kdsOutcomes = timestamps.map((occurredAt) => evaluateSyncMerge({
    entityType: "KdsTicket",
    canonical: baseKdsTicket({ status: "ready", version: 3 }),
    event: {
      ...meta({ eventId: "evt-k", idempotencyKey: "idem-k", occurredAt }),
      entityId: "ticket-1",
      orderId: "order-1",
      orderItemId: "item-1",
      stationId: "grill",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "preparing",
    },
  }));
  assert.equal(kdsOutcomes[0]?.status, "duplicate");
  assert.equal(kdsOutcomes[1]?.status, "duplicate");
  assert.equal(kdsOutcomes[0]?.code, "STATE_ALREADY_SURPASSED");
  assert.equal(kdsOutcomes[1]?.code, "STATE_ALREADY_SURPASSED");

  // Payment overcollection
  const paymentOutcomes = timestamps.map((occurredAt) => evaluateSyncMerge({
    entityType: "Payment",
    context: basePaymentContext({
      orderStatus: "paid",
      existingPayments: [{
        paymentId: "pay-1",
        eventId: "evt-p1",
        idempotencyKey: "idem-p1",
        orderId: "order-1",
        amountMinor: 11600,
        tipMinor: 0,
        tenderedAmountMinor: null,
        currency: "MXN",
        method: "cash",
        state: "captured",
        deviceId: "dev-1",
        cashRegisterId: "cr-1",
        cashierId: "cashier-1",
        cashSequence: 1,
        receiptNumber: null,
      }],
    }),
    event: {
      ...meta({ eventId: "evt-p2", idempotencyKey: "idem-p2", occurredAt }),
      entityId: "pay-2",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 11600,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: true,
      cashRegisterId: "cr-1",
      cashierId: "cashier-1",
      cashSequence: 2,
    },
  }));
  assert.equal(paymentOutcomes[0]?.status, "manual_review");
  assert.equal(paymentOutcomes[1]?.status, "manual_review");
  assert.equal(paymentOutcomes[0]?.code, paymentOutcomes[1]?.code);
});

test("Cross-tenant and cross-branch events are rejected fail-closed across all entities", () => {
  const crossTenantOrder = evaluateSyncMerge({
    entityType: "Order",
    canonical: baseOrder(),
    event: {
      ...meta({ restaurantId: RESTAURANT_B }),
      entityId: "order-1",
      operation: "transition",
      baseVersion: 2,
      targetStatus: "partially_paid",
    },
  });
  assert.equal(crossTenantOrder.status, "rejected");
  assert.equal(crossTenantOrder.code, "SCOPE_MISMATCH");

  const crossBranchTable = evaluateSyncMerge({
    entityType: "DiningTable",
    canonical: baseTable(),
    event: {
      ...meta({ branchId: BRANCH_B }),
      entityId: "table-1",
      operation: "transition",
      baseVersion: 1,
      targetStatus: "occupied",
      activeOrderId: "order-1",
    },
  });
  assert.equal(crossBranchTable.status, "rejected");
  assert.equal(crossBranchTable.code, "SCOPE_MISMATCH");

  const crossTenantPayment = evaluateSyncMerge({
    entityType: "Payment",
    context: basePaymentContext(),
    event: {
      ...meta({ restaurantId: RESTAURANT_B }),
      entityId: "pay-x",
      orderId: "order-1",
      operation: "create",
      baseVersion: null,
      amountMinor: 5000,
      currency: "MXN",
      method: "cash",
      isOfflineEvent: false,
    },
  });
  assert.equal(crossTenantPayment.status, "rejected");
  assert.equal(crossTenantPayment.code, "SCOPE_MISMATCH");

  const crossBranchCash = evaluateSyncMerge({
    entityType: "CashMovement",
    canonical: baseCashRegister(),
    event: {
      ...meta({ branchId: BRANCH_B }),
      entityId: "mov-x",
      operation: "create",
      baseVersion: null,
      cashRegisterId: "cr-1",
      registerId: "reg-1",
      shiftId: "shift-1",
      cashierId: "cashier-1",
      localSequence: 1,
      type: "cash_sale",
      direction: "in",
      amountMinor: 1000,
      currency: "MXN",
      isOfflineEvent: false,
      source: { type: "payment", paymentId: "pay-1" },
    },
  });
  assert.equal(crossBranchCash.status, "rejected");
  assert.equal(crossBranchCash.code, "SCOPE_MISMATCH");
});

test("Floats, non-safe integers, invalid timestamps, and hostile getter objects fail closed with InvalidSyncMergeInputError", () => {
  // Float in Payment amountMinor
  assert.throws(
    () => mergePaymentSyncEvent({
      context: basePaymentContext(),
      event: {
        ...meta(),
        entityId: "pay-float",
        orderId: "order-1",
        operation: "create",
        baseVersion: null,
        amountMinor: 100.5,
        currency: "MXN",
        method: "cash",
        isOfflineEvent: false,
      },
    }),
    InvalidSyncMergeInputError,
  );

  // Float in CashMovement localSequence
  assert.throws(
    () => mergeCashMovementSyncEvent({
      canonical: baseCashRegister(),
      event: {
        ...meta(),
        entityId: "mov-float",
        operation: "create",
        baseVersion: null,
        cashRegisterId: "cr-1",
        registerId: "reg-1",
        shiftId: "shift-1",
        cashierId: "cashier-1",
        localSequence: 1.5,
        type: "cash_sale",
        direction: "in",
        amountMinor: 1000,
        currency: "MXN",
        isOfflineEvent: false,
        source: { type: "payment", paymentId: "pay-1" },
      },
    }),
    InvalidSyncMergeInputError,
  );

  // Float in DiningTable baseVersion
  assert.throws(
    () => mergeDiningTableSyncEvent({
      canonical: baseTable(),
      event: {
        ...meta(),
        entityId: "table-1",
        operation: "transition",
        baseVersion: 1.25,
        targetStatus: "occupied",
        activeOrderId: "order-1",
      },
    }),
    InvalidSyncMergeInputError,
  );

  // Hostile getter object on event
  const hostileEvent = {
    ...meta(),
    entityId: "table-1",
    operation: "transition",
    baseVersion: 1,
    get targetStatus() {
      return "occupied";
    },
    activeOrderId: "order-1",
  };
  assert.throws(
    () => mergeDiningTableSyncEvent({
      canonical: baseTable(),
      event: hostileEvent as never,
    }),
    InvalidSyncMergeInputError,
  );

  // Invalid occurredAt timestamp
  assert.throws(
    () => mergeKdsTicketSyncEvent({
      canonical: baseKdsTicket(),
      event: {
        ...meta({ occurredAt: "2026-02-30T12:00:00Z" }),
        entityId: "ticket-1",
        orderId: "order-1",
        orderItemId: "item-1",
        stationId: "grill",
        operation: "transition",
        baseVersion: 1,
        targetStatus: "preparing",
      },
    }),
    InvalidSyncMergeInputError,
  );
});
