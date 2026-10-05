import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCaptureSelectionPlanV1,
  parseConfirmCaptureDraftCommandV2,
  type MenuCatalogV1,
} from "@super-restaurant/shared-types";

import {
  materializeCaptureOrder,
  materializeCaptureSelectionOrder,
  parseCaptureRepeatSelectionPlan,
} from "./capture-repeat-order-plan.js";

const ids = {
  actor: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  branch: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  capture: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  catalog: "47f7f293-b155-42b9-bdc7-f9be3846f44e",
  category: "a409ec59-9f5e-496d-a45d-b83a46b49674",
  customer: "c483b6e7-e102-4cc5-a887-d30712c85e52",
  device: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  event: "0438d8ac-a86d-4f5b-8b26-1a35f9d82a39",
  group: "ff430295-2a61-4d22-b3f5-5cb7f383c4f4",
  idempotency: "0e22dfd1-9064-4fa8-86da-8fcce41fe821",
  lease: "e2a6113b-d5cb-4e26-8f65-a0bc9065b08c",
  option: "3b6b1fb5-006d-410a-b7af-232b66229c75",
  order: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
  product: "ec5e7c30-edac-4b79-bf8c-e363b041c59f",
  restaurant: "1e37ae13-8507-484c-969f-2176f77b7000",
  shift: "4107e340-b079-490d-8a36-988d540f5544",
  sourceItem: "60a26e69-3ea6-4ef8-8a2b-ad43ba0a0da1",
  sourceOrder: "dfc75888-413a-4460-8125-461ee8f50462",
  sizeRetired: "5a1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8",
  sizeSmall: "6a1d2c3e-4f50-4a61-8b72-93a4b5c6d7e8",
};

const command = parseConfirmCaptureDraftCommandV2({
  schemaVersion: 2,
  scope: { restaurantId: ids.restaurant, branchId: ids.branch },
  captureDraftId: ids.capture,
  expectedVersion: 4,
  eventId: ids.event,
  idempotencyKey: ids.idempotency,
  deviceId: ids.device,
  occurredAt: "2026-09-24T12:00:00.000Z",
  attentionLeaseId: ids.lease,
  orderId: ids.order,
  shiftId: ids.shift,
  tableId: null,
  currency: "MXN",
  timeZone: "America/Hermosillo",
});
assert.ok(command);

const plan = parseCaptureRepeatSelectionPlan({
  schemaVersion: 1,
  customerId: ids.customer,
  sourceOrderId: ids.sourceOrder,
  catalogVersion: ids.catalog,
  lines: [{
    sourceOrderItemId: ids.sourceItem,
    productId: ids.product,
    quantity: 2,
    modifierGroups: [{ groupId: ids.group, selections: [{ optionId: ids.option, quantity: 1 }] }],
  }],
});
assert.ok(plan);

const catalog: MenuCatalogV1 = {
  catalogVersion: ids.catalog,
  currency: "MXN",
  replayed: false,
  updatedAt: "2026-09-24T11:59:00.000Z",
  updatedBy: ids.actor,
  version: 3,
  categories: [{ categoryId: ids.category, name: "Comida", active: true, displayOrder: 0 }],
  products: [{
    productId: ids.product,
    categoryId: ids.category,
    name: "Tacos vigentes",
    sku: "TACO-1",
    active: true,
    displayOrder: 0,
    stationId: "hot",
    unit: "piece",
    unitPriceMinor: 4_500,
    imagePath: null,
    tax: null,
  }],
  modifierGroups: [{
    groupId: ids.group,
    productId: ids.product,
    name: "Extras",
    active: true,
    displayOrder: 0,
    minimumQuantity: 0,
    maximumQuantity: 2,
    options: [{
      optionId: ids.option,
      name: "Queso vigente",
      unitPriceMinor: 700,
      active: true,
      maximumQuantity: 2,
      imagePath: null,
    }],
  }],
};

test("repeat plan parser rejects duplicate source lines and deeply freezes accepted selections", () => {
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.lines[0]?.modifierGroups[0]?.selections), true);
  assert.equal(parseCaptureRepeatSelectionPlan({ ...plan, lines: [plan.lines[0], plan.lines[0]] }), undefined);
});

test("repeat materialization deterministically snapshots current catalog prices", () => {
  const first = materializeCaptureOrder(command, ids.actor, "delivery", plan, catalog);
  const replay = materializeCaptureOrder(command, ids.actor, "delivery", plan, catalog);
  assert.deepEqual(replay, first);
  assert.equal(first.order.items.length, 1);
  assert.equal(first.order.items[0]?.quantity, 2);
  assert.equal(first.order.items[0]?.snapshot.name, "Tacos vigentes");
  assert.equal(first.order.items[0]?.snapshot.unitPrice.amountMinor, 4_500);
  assert.equal(first.order.items[0]?.snapshot.modifiers[0]?.name, "Queso vigente");
  assert.equal(first.order.items[0]?.snapshot.modifiers[0]?.unitPrice.amountMinor, 700);
  assert.equal(first.auditEvents[0]?.operation, "order.created");
  assert.equal(first.auditEvents[1]?.operation, "order.item_added");
  assert.match(first.order.items[0]?.orderItemId ?? "", /^[0-9a-f-]{36}$/u);
});

test("repeat materialization rejects catalog drift that invalidates the selection", () => {
  assert.throws(() => materializeCaptureOrder(command, ids.actor, "delivery", plan, {
    ...catalog,
    products: [{ ...catalog.products[0]!, active: false }],
  }));
  assert.throws(() => materializeCaptureOrder(command, ids.actor, "delivery", plan, {
    ...catalog,
    currency: "USD",
  }));
});

const secondLineId = "aab5d3a7-0c1f-4f9e-9d3d-8a0f9c5f0c11";
const selectionPlan = parseCaptureSelectionPlanV1({
  schemaVersion: 1,
  catalogVersion: ids.catalog,
  lines: [
    {
      lineId: ids.sourceItem,
      productId: ids.product,
      variantId: null,
      quantity: 2,
      modifierGroups: [{ groupId: ids.group, selections: [{ optionId: ids.option, quantity: 1 }] }],
      note: null,
    },
    {
      lineId: secondLineId,
      productId: ids.product,
      variantId: null,
      quantity: 1,
      modifierGroups: [],
      note: "sin cebolla",
    },
  ],
});
assert.ok(selectionPlan);

test("selection materialization snapshots current catalog prices for every line, keyed by lineId", () => {
  const first = materializeCaptureSelectionOrder(command, ids.actor, "counter", selectionPlan, catalog);
  const replay = materializeCaptureSelectionOrder(command, ids.actor, "counter", selectionPlan, catalog);
  assert.deepEqual(replay, first);
  assert.equal(first.order.items.length, 2);
  assert.equal(first.order.items[0]?.quantity, 2);
  assert.equal(first.order.items[0]?.snapshot.unitPrice.amountMinor, 4_500);
  assert.equal(first.order.items[1]?.quantity, 1);
  assert.equal(first.order.items[1]?.snapshot.modifiers.length, 0);
  assert.notEqual(first.order.items[0]?.orderItemId, first.order.items[1]?.orderItemId);
  assert.match(first.order.items[0]?.orderItemId ?? "", /^[0-9a-f-]{36}$/u);
});

const sizedCatalog: MenuCatalogV1 = {
  ...catalog,
  products: [{
    ...catalog.products[0]!,
    variants: [
      { variantId: ids.sizeSmall, name: "Chica", sku: null, unitPriceMinor: 3_000, active: true, displayOrder: 0 },
      { variantId: ids.sizeRetired, name: "Gigante", sku: null, unitPriceMinor: 9_000, active: false, displayOrder: 1 },
    ],
  }],
};

function planWithVariant(variantId: string | null) {
  const parsed = parseCaptureSelectionPlanV1({
    ...selectionPlan,
    lines: [{ ...selectionPlan!.lines[0]!, variantId }],
  });
  assert.ok(parsed);
  return parsed;
}

test("selection materialization prices and freezes the catalog variant, never the client price", () => {
  const sized = materializeCaptureSelectionOrder(command, ids.actor, "counter", planWithVariant(ids.sizeSmall), sizedCatalog);
  const snapshot = sized.order.items[0]?.snapshot;
  assert.equal(snapshot?.unitPrice.amountMinor, 3_000);
  assert.equal(snapshot?.variantId, ids.sizeSmall);
  assert.equal(snapshot?.variantName, "Chica");
  // Same plan on a catalog whose size later changed price: the new publish re-prices (confirm runs
  // against the current head); the already-confirmed order keeps its frozen snapshot.
  const repriced = materializeCaptureSelectionOrder(command, ids.actor, "counter", planWithVariant(ids.sizeSmall), {
    ...sizedCatalog,
    products: [{ ...sizedCatalog.products[0]!, variants: [{ ...sizedCatalog.products[0]!.variants![0]!, unitPriceMinor: 3_500 }] }],
  });
  assert.equal(repriced.order.items[0]?.snapshot.unitPrice.amountMinor, 3_500);
  assert.equal(sized.order.items[0]?.snapshot.unitPrice.amountMinor, 3_000);
});

test("selection materialization rejects unknown, inactive, missing and unexpected variants", () => {
  assert.throws(() => materializeCaptureSelectionOrder(command, ids.actor, "counter", planWithVariant(ids.sizeRetired), sizedCatalog));
  assert.throws(() => materializeCaptureSelectionOrder(command, ids.actor, "counter", planWithVariant(ids.option), sizedCatalog));
  assert.throws(() => materializeCaptureSelectionOrder(command, ids.actor, "counter", planWithVariant(null), sizedCatalog));
  assert.throws(() => materializeCaptureSelectionOrder(command, ids.actor, "counter", planWithVariant(ids.sizeSmall), catalog));
  assert.equal(
    materializeCaptureSelectionOrder(command, ids.actor, "counter", planWithVariant(null), catalog).order.items[0]?.snapshot.variantId,
    undefined,
  );
});

test("selection materialization rejects catalog version drift and currency mismatch", () => {
  assert.throws(
    () => materializeCaptureSelectionOrder(command, ids.actor, "counter", selectionPlan, {
      ...catalog,
      catalogVersion: ids.sourceOrder,
    }),
    /CAPTURE_SELECTION_CATALOG_CONFLICT/u,
  );
  assert.throws(
    () => materializeCaptureSelectionOrder(command, ids.actor, "counter", selectionPlan, null),
    /CAPTURE_SELECTION_CATALOG_CONFLICT/u,
  );
});

test("repeat plan lines may carry a size: parsed, priced from the catalog variant, and legacy lines still parse", () => {
  const withSize = parseCaptureRepeatSelectionPlan({
    ...plan, lines: [{ ...plan.lines[0]!, variantId: ids.sizeSmall }],
  });
  assert.ok(withSize);
  assert.equal(withSize.lines[0]?.variantId, ids.sizeSmall);
  const sized = materializeCaptureOrder(command, ids.actor, "delivery", withSize, sizedCatalog);
  assert.equal(sized.order.items[0]?.snapshot.unitPrice.amountMinor, 3_000);
  assert.equal(sized.order.items[0]?.snapshot.variantName, "Chica");
  // A legacy line (no size) against a product that now requires one cannot be materialized.
  assert.throws(() => materializeCaptureOrder(command, ids.actor, "delivery", plan, sizedCatalog));
  assert.equal(plan.lines[0] !== undefined && Object.hasOwn(plan.lines[0], "variantId"), false);
  for (const variantId of ["not-a-uuid", null, 7]) {
    assert.equal(parseCaptureRepeatSelectionPlan({ ...plan, lines: [{ ...plan.lines[0]!, variantId }] }), undefined);
  }
});
