import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope, parseConfirmCaptureDraftCommandV2, type MembershipRoleCode, type MenuCatalogV1 } from "@super-restaurant/shared-types";

import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { parseCapturePizzaLineV2 } from "./capture-pizza-plan.js";
import { materializeCaptureOrder, materializeCaptureSelectionOrder } from "./capture-repeat-order-plan.js";
import { encodeOrderRecord } from "./persistence/order-persistence-codec.js";
import { pricePizzaLineSnapshot, PizzaLinePricingError } from "./capture-pizza-pricing.js";
import {
  CaptureApplicationError, CaptureLineQuoteRejectedError, CaptureSelectionPlanService, CaptureService,
  type CaptureConfirmationPort, type CaptureCreationPort, type CaptureSelectionPlanPort,
} from "./captures.js";
import { toDomainMenuCatalog } from "./menu-catalog-domain.js";

const principal = { actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" };
const parsedScope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
if (parsedScope === undefined) throw new Error("TEST_SCOPE_INVALID");
const scope = parsedScope;
const DRAFT = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const DEVICE = "e74df54b-30a7-449b-a23f-c4ca6f93bda4";
const CATEGORY = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const PIZZA = "ec5e7c30-edac-4b79-bf8c-e363b041c59f";
const BASE_GROUP = "8c3f4e50-6172-4c83-8d94-b5c6d7e8f900";
const EXTRA_GROUP = "8c3f4e50-6172-4c83-8d94-b5c6d7e8f901";
const VEGGIES_GROUP = "8c3f4e50-6172-4c83-8d94-b5c6d7e8f902";
const HAM = "9d405f61-7283-4d94-9ea5-c6d7e8f90a10";
const CHEESE = "9d405f61-7283-4d94-9ea5-c6d7e8f90a11";
const BACON = "9d405f61-7283-4d94-9ea5-c6d7e8f90a12";
const ONION = "9d405f61-7283-4d94-9ea5-c6d7e8f90a13";
const PINEAPPLE = "9d405f61-7283-4d94-9ea5-c6d7e8f90a14";
const UNKNOWN = "9d405f61-7283-4d94-9ea5-c6d7e8f90aff";
const LINE = "00000000-0000-4000-8000-000000000011";
const VERSION = "47f7f293-b155-42b9-bdc7-f9be3846f44e";

const option = (optionId: string, name: string, unitPriceMinor: number) =>
  ({ active: true, imagePath: null, maximumQuantity: null, name, optionId, unitPriceMinor });

const catalog = {
  catalogVersion: VERSION, currency: "MXN", replayed: false, updatedAt: "2026-11-20T11:59:00.000Z",
  updatedBy: principal.actorId, version: 3,
  categories: [{ categoryId: CATEGORY, name: "Pizzas", active: true, color: null, displayOrder: 0, imagePath: null }],
  products: [{
    productId: PIZZA, categoryId: CATEGORY, name: "Pizza a su gusto", sku: "PZ-1", active: true, displayOrder: 0,
    stationId: "hot", unit: "piece", unitPriceMinor: 10_000, tax: null, imagePath: null,
    pizzaMode: "custom", baseGroupIds: [BASE_GROUP, VEGGIES_GROUP], freeIngredientCount: 1,
    extraOptionIds: [BACON, PINEAPPLE],
  }],
  modifierGroups: [
    { active: true, displayOrder: 0, groupId: BASE_GROUP, maximumQuantity: 4, minimumQuantity: 0, name: "Ingredientes", productId: PIZZA,
      options: [option(HAM, "Jamon", 2_000), option(CHEESE, "Queso", 1_000)] },
    { active: true, displayOrder: 1, groupId: EXTRA_GROUP, maximumQuantity: 3, minimumQuantity: 0, name: "Extras", productId: PIZZA,
      options: [option(BACON, "Tocino", 1_500)] },
    { active: true, displayOrder: 2, groupId: VEGGIES_GROUP, maximumQuantity: 4, minimumQuantity: 0, name: "Vegetales", productId: PIZZA,
      options: [option(ONION, "Cebolla", 500), option(PINEAPPLE, "Piña", 3_000)] },
  ],
} as unknown as MenuCatalogV1;

const pizzaLine = (halfA: Record<string, unknown> = {}, halfB: Record<string, unknown> = {}) => ({
  halves: [
    { extraOptionIds: [], fraction: "half-a", ingredientOptionIds: [HAM, CHEESE], productId: PIZZA, removedIngredientOptionIds: [], variantId: null, ...halfA },
    { extraOptionIds: [], fraction: "half-b", ingredientOptionIds: [HAM], productId: PIZZA, removedIngredientOptionIds: [], variantId: null, ...halfB },
  ],
  ruleVersion: "pizza-halves-v2",
});

const auth = (roles: readonly MembershipRoleCode[] = ["cashier"]) =>
  new MembershipAuthorizationService({ findActiveMembership: async () => ({ roles, scope }) });
const catalogPort = { read: async () => ({ schemaVersion: 1 as const, scope, catalog }),
  save: async () => { throw new Error("must not save a catalog"); } };
const noConfirmation: CaptureConfirmationPort = {
  probeConfirmation: async () => { throw new Error("must not probe confirmation"); },
  readRepeatOrderPlan: async () => { throw new Error("must not read repeat order plan"); },
  readSelectionPlan: async () => { throw new Error("must not read selection plan"); },
  confirmDraft: async () => { throw new Error("must not confirm"); },
};
const code = (expected: string) => (error: unknown) => error instanceof CaptureApplicationError && error.code === expected;

const quoteRequest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, scope, catalogVersion: VERSION, productId: PIZZA, variantId: null, modifierGroups: [], fraction: null,
  quantity: 1, ...over,
});
const quoteService = () => new CaptureService(auth(), { createDraft: async () => { throw new Error("must not create"); } }, noConfirmation, catalogPort);

test("pricePizzaLineSnapshot freezes the rule's total: unit price plus the pizza charges equals pizzaHalves.total", () => {
  const parsed = parseCapturePizzaLineV2(pizzaLine());
  assert.ok(parsed);
  const snapshot = pricePizzaLineSnapshot(toDomainMenuCatalog(catalog, scope.restaurantId), scope.restaurantId,
    { modifierGroups: [], productId: PIZZA, variantId: null }, parsed);
  assert.equal(snapshot.geometry, "halves");
  assert.ok(snapshot.pizzaHalves);
  const charges = snapshot.modifiers.reduce((sum, modifier) => sum + modifier.unitPrice.amountMinor * modifier.quantity, 0);
  assert.equal(snapshot.unitPrice.amountMinor + charges, snapshot.pizzaHalves.total.amountMinor);
  assert.ok(snapshot.pizzaHalves.total.amountMinor >= 10_000);
  assert.throws(() => pricePizzaLineSnapshot(toDomainMenuCatalog(catalog, scope.restaurantId), scope.restaurantId,
    { modifierGroups: [], productId: PIZZA, variantId: null }, parseCapturePizzaLineV2(pizzaLine({ ingredientOptionIds: [UNKNOWN] }))!),
  PizzaLinePricingError);
});

test("several base groups share one N and an extra offered by a base group is always charged", () => {
  // Same product on both halves: base 10_000, N = 1. Ingredients: Queso 1_000 (first base group) and
  // Cebolla 500 (second base group) on both halves. The single N is shared: by price, Cebolla is the free
  // one and Queso, in both halves, costs its full 1_000. Piña 3_000 is a loose extra of the second base
  // group: it never consumes N and, in both halves, costs its full 3_000. Total 10_000 + 1_000 + 3_000.
  const parsed = parseCapturePizzaLineV2(pizzaLine(
    { extraOptionIds: [PINEAPPLE], ingredientOptionIds: [CHEESE, ONION] },
    { extraOptionIds: [PINEAPPLE], ingredientOptionIds: [CHEESE, ONION] },
  ));
  assert.ok(parsed);
  const snapshot = pricePizzaLineSnapshot(toDomainMenuCatalog(catalog, scope.restaurantId), scope.restaurantId,
    { modifierGroups: [], productId: PIZZA, variantId: null }, parsed);
  assert.deepEqual(snapshot.pizzaHalves?.freeAssignmentOrder, [ONION]);
  assert.deepEqual(snapshot.pizzaHalves?.charges.map((charge) => [charge.role, charge.fractions, charge.optionId, charge.groupId, charge.amount.amountMinor]), [
    ["ingredient", ["half-a", "half-b"], ONION, VEGGIES_GROUP, 0],
    ["ingredient", ["half-a", "half-b"], CHEESE, BASE_GROUP, 1_000],
    ["extra", ["half-a", "half-b"], PINEAPPLE, VEGGIES_GROUP, 3_000],
  ]);
  assert.equal(snapshot.pizzaHalves?.total.amountMinor, 14_000);
});

test("line quote of a pizza V2 line charges exactly the frozen pizzaHalves total", async () => {
  const quote = await quoteService().quoteLinePrice(principal, quoteRequest({ pizza: pizzaLine() }));
  const parsed = parseCapturePizzaLineV2(pizzaLine());
  assert.ok(parsed);
  const snapshot = pricePizzaLineSnapshot(toDomainMenuCatalog(catalog, scope.restaurantId), scope.restaurantId,
    { modifierGroups: [], productId: PIZZA, variantId: null }, parsed);
  assert.equal(quote.geometry, "halves");
  assert.equal(quote.lineTotalMinor, snapshot.pizzaHalves?.total.amountMinor);
  assert.equal(quote.unitPriceMinor, snapshot.unitPrice.amountMinor);
  assert.deepEqual(quote.modifiers, []);
  const two = await quoteService().quoteLinePrice(principal, quoteRequest({ pizza: pizzaLine(), quantity: 2 }));
  assert.equal(two.lineTotalMinor, 2 * quote.lineTotalMinor);
});

test("line quote of a pizzaMode product without a pizza line, or with an invalid one, is rejected as line_invalid", async () => {
  const service = quoteService();
  for (const request of [quoteRequest(), quoteRequest({ pizza: pizzaLine({ ingredientOptionIds: [UNKNOWN] }) }),
    quoteRequest({ pizza: pizzaLine({ extraOptionIds: [UNKNOWN] }) }),
    quoteRequest({ pizza: pizzaLine({ extraOptionIds: [ONION] }) })]) {
    await assert.rejects(service.quoteLinePrice(principal, request),
      (error: unknown) => error instanceof CaptureLineQuoteRejectedError && error.reason === "line_invalid");
  }
  await assert.rejects(service.quoteLinePrice(principal, quoteRequest({ pizza: { ...pizzaLine(), ruleVersion: "x" } })), code("request"));
});

const planCommand = (lines: unknown[], planVersion = 2) => ({
  schemaVersion: 1, scope, captureDraftId: DRAFT, expectedVersion: 1, attentionLeaseId: DEVICE,
  eventId: "0438d8ac-a86d-4f5b-8b26-1a35f9d82a39", idempotencyKey: "1a8c3c0d-6d1c-4a2c-9f0e-3f6a5e2b7c11",
  deviceId: DEVICE, occurredAt: "2026-11-20T12:00:00.000Z",
  plan: { catalogVersion: VERSION, lines, schemaVersion: planVersion },
});
const planLine = (over: Record<string, unknown> = {}) => ({
  lineId: LINE, modifierGroups: [], note: null, pizza: pizzaLine(), productId: PIZZA, quantity: 1, variantId: null, ...over,
});

function planHarness(outcome: "applied" | "replayed" = "applied") {
  const calls = { probe: 0, replace: 0 };
  let persisted: unknown;
  let storedPlan: unknown;
  const record = {
    schemaVersion: 1,
    detail: { schemaVersion: 1, scope, captureDraftId: DRAFT, folio: `C-${DRAFT}`, sourceChannel: "phone", fulfillmentChannel: null,
      status: "draft", attentionStatus: "claimed", ownerMembershipId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", version: 2,
      updatedAt: "2026-11-20T12:00:01.000Z", attentionLeaseId: DEVICE, attentionLeaseExpiresAt: "2026-11-20T12:05:01.000Z",
      confirmedOrderId: null, customerSnapshotRef: null, fulfillmentSnapshotRef: null },
    recoveryPolicy: { schemaVersion: 1, autoRenewSelected: false, recoveryExpiresAt: "2026-12-20T12:00:01.000Z" },
  };
  const persistence: CaptureSelectionPlanPort = {
    probeReplaceSelectionPlan: async () => { calls.probe += 1; return { status: "pending" }; },
    replaceSelectionPlan: async (_actorId, command) => {
      calls.replace += 1; persisted = command; storedPlan = command.plan;
      return { status: outcome, record };
    },
  };
  const captures: CaptureCreationPort = {
    createDraft: async () => { throw new Error("must not create"); },
    readWorkspaceV5: async () => ({
      schemaVersion: 5, deliveryQuote: null, paymentIntent: null, paymentIntentAppliedCaptureVersion: null,
      paymentIntentBasisFingerprint: null, detail: { ...record.detail, schemaVersion: 2, deliveryInstructions: null },
      customerSnapshot: null, fulfillmentSnapshot: null, repeatOrderPlan: null,
      selectionPlan: { schemaVersion: 1, catalogVersion: VERSION, appliedCaptureVersion: 2, lineCount: 1 },
    }),
  };
  const confirmation: CaptureConfirmationPort = {
    ...noConfirmation,
    readSelectionPlan: async () => ({ status: "ok", plan: storedPlan, appliedCaptureVersion: 2 }),
  };
  const service = new CaptureSelectionPlanService(auth(), persistence, captures, catalogPort, confirmation);
  return { calls, persisted: () => persisted, service, persistence, captures, confirmation };
}

test("a valid schemaVersion 2 plan is priced by the pizza rule, persisted with its pizza and skips the V1-only probe", async () => {
  const { calls, persisted, service } = planHarness();
  const result = await service.replace(principal, planCommand([planLine()]));
  assert.equal(calls.probe, 0);
  assert.equal(calls.replace, 1);
  const plan = (persisted() as { plan: { schemaVersion: number; lines: { pizza?: unknown }[] } }).plan;
  assert.equal(plan.schemaVersion, 2);
  assert.deepEqual(plan.lines[0]?.pizza, parseCapturePizzaLineV2(pizzaLine()));
  const quote = await quoteService().quoteLinePrice(principal, quoteRequest({ pizza: pizzaLine() }));
  const projected = result.selectionProjection?.lines[0];
  assert.equal(projected?.lineTotalMinor, quote.subtotalMinor);
  assert.equal(result.selectionProjection?.itemsTotalMinor, quote.lineTotalMinor);
  assert.ok(projected?.halves);
  // The stored picks come back so the web can restore the line after a reload.
  assert.deepEqual(projected?.pizza, parseCapturePizzaLineV2(pizzaLine()));
});

test("an invalid schemaVersion 2 plan answers 409 or 400 before anything is persisted", async () => {
  const bad: [unknown, string][] = [
    [planCommand([planLine({ pizza: pizzaLine({ ingredientOptionIds: [UNKNOWN] }) })]), "conflict"],
    [planCommand([planLine({ pizza: pizzaLine({ extraOptionIds: [UNKNOWN] }) })]), "conflict"],
    [planCommand([planLine({ pizza: { ...pizzaLine(), ruleVersion: "pizza-halves-v1" } })]), "request"],
    [planCommand([planLine()], 3), "request"],
  ];
  for (const [input, expected] of bad) {
    const { calls, service } = planHarness();
    await assert.rejects(service.replace(principal, input), code(expected));
    // A V2 pricing 409 still asks the write once, solely to honor a `replayed` answer (see the replay test);
    // a malformed request (400) never reaches the write.
    assert.equal(calls.replace, expected === "conflict" ? 1 : 0);
  }
});

test("a V1 plan line (no pizza) over a pizzaMode product is a 409 and nothing is persisted", async () => {
  for (const planVersion of [1, 2]) {
    const { calls, service } = planHarness();
    const withoutPizza: Record<string, unknown> = { ...planLine() };
    delete withoutPizza.pizza;
    await assert.rejects(service.replace(principal, planCommand([withoutPizza], planVersion)), code("conflict"));
    assert.equal(calls.replace, planVersion === 2 ? 1 : 0); // V2 asks the write only for a `replayed` answer
  }
});

const confirmCommand = parseConfirmCaptureDraftCommandV2({
  schemaVersion: 2, expectedVersion: 2, scope, captureDraftId: DRAFT, attentionLeaseId: DEVICE,
  eventId: "0438d8ac-a86d-4f5b-8b26-1a35f9d82a39", idempotencyKey: "1a8c3c0d-6d1c-4a2c-9f0e-3f6a5e2b7c11",
  deviceId: DEVICE, occurredAt: "2026-11-20T12:00:00.000Z",
  orderId: "5b1d3f2e-7c4a-4e8b-9a60-2d1f0c9e8b7a", shiftId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", tableId: null,
  currency: "MXN", timeZone: "America/Hermosillo",
});
assert.ok(confirmCommand);
const wirePlan = { catalogVersion: VERSION, lines: [{ lineId: LINE, modifierGroups: [], note: null, productId: PIZZA, quantity: 2, variantId: null }] };

test("confirm materializes a pizza V2 line into the snapshot SQL expects (field by field against confirm_capture_draft_v3)", () => {
  const pizza = parseCapturePizzaLineV2(pizzaLine());
  assert.ok(pizza);
  const materialized = materializeCaptureSelectionOrder(
    confirmCommand, principal.actorId, "counter", wirePlan, catalog, null, new Map([[LINE, pizza]]),
  );
  const item = materialized.order.items[0];
  assert.ok(item);
  assert.equal(item.quantity, 2);
  const encoded = (encodeOrderRecord(materialized.order) as unknown as { items: { snapshot: Record<string, unknown> }[] }).items[0]?.snapshot;
  assert.ok(encoded);
  const halves = encoded.pizzaHalves as { total: unknown; basePrice: unknown; charges: { role: string; fractions: string[]; optionId: string; name: string; amount: unknown }[] };
  // Independent, hand-computed vector (never read from the result): base 10_000 (both halves are the same
  // product), N = 1. Distinct ingredients: Queso 1_000 < Jamon 2_000, so the first N (Queso) is free and
  // Jamon, present in both halves, is charged once at its full price 2_000. No extras. Total 12_000.
  assert.deepEqual(halves.basePrice, { amountMinor: 10_000, currency: "MXN" });
  assert.deepEqual(halves.total, { amountMinor: 12_000, currency: "MXN" });
  assert.deepEqual(halves.charges.map((charge) => [charge.role, charge.fractions, charge.optionId, charge.name, charge.amount]),
    [
      ["ingredient", ["half-a"], CHEESE, "Queso", { amountMinor: 0, currency: "MXN" }], // free (first N=1 by price)
      ["ingredient", ["half-a", "half-b"], HAM, "Jamon", { amountMinor: 2_000, currency: "MXN" }],
    ]);
  // expected_snapshot in confirm_capture_draft_v3 (migration 20261120000100), one entry per SQL key:
  const expected = {
    catalogVersion: VERSION, // catalog::text
    productId: PIZZA, name: "Pizza a su gusto", // half-a product
    stationId: "hot", unit: "piece", // product.station_id / product.unit
    unitPrice: { amountMinor: 10_000, currency: "MXN" }, // pizza_result.basePrice
    // pizza_modifiers: one per charge ("pizza-<role>:<both|half-x>:<optionId>"), then removals (none here).
    modifiers: [{
      modifierId: `pizza-ingredient:half-a:${CHEESE}`,
      name: "Queso",
      groupId: "pizza-ingredient",
      groupName: "ingredient:half-a",
      groupCatalogVersion: VERSION,
      unitPrice: { amountMinor: 0, currency: "MXN" },
      quantity: 1,
    }, {
      modifierId: `pizza-ingredient:both:${HAM}`,
      name: "Jamon",
      groupId: "pizza-ingredient",
      groupName: "ingredient:both",
      groupCatalogVersion: VERSION,
      unitPrice: { amountMinor: 2_000, currency: "MXN" },
      quantity: 1,
    }],
    geometry: "halves",
    pizzaHalves: halves, // pizza_result, whole (its amounts are asserted literally above)
    sku: "PZ-1", // coalesce(variant.sku, product.sku)
  };
  assert.deepEqual(encoded, expected);
});

test("V2 replay after a catalog change: the write's replayed answer is accepted, any other answer keeps the 409", async () => {
  for (const outcome of ["replayed", "applied"] as const) {
    const { calls, persistence, captures, confirmation } = planHarness(outcome);
    const staleCatalog = { read: async () => ({ schemaVersion: 1 as const, scope, catalog: { ...catalog, catalogVersion: "a5b6c7d8-0000-4000-8000-000000000000" } }),
      save: async () => { throw new Error("must not save a catalog"); } };
    const stale = new CaptureSelectionPlanService(auth(), persistence, captures, staleCatalog, confirmation);
    if (outcome === "replayed") {
      const result = await stale.replace(principal, planCommand([planLine()]));
      assert.equal(result.detail.captureDraftId, DRAFT);
    } else {
      await assert.rejects(stale.replace(principal, planCommand([planLine()])), code("conflict"));
    }
    assert.equal(calls.probe, 0);
    assert.equal(calls.replace, 1);
  }
});

test("materialization fails closed for a pizzaMode product without its pizza line (repeat plan, V1 selection line)", () => {
  assert.throws(() => materializeCaptureSelectionOrder(confirmCommand, principal.actorId, "counter", wirePlan, catalog), /CAPTURE_PIZZA_LINE_REQUIRED/u);
  assert.throws(() => materializeCaptureOrder(confirmCommand, principal.actorId, "counter", {
    catalogVersion: VERSION, customerId: DEVICE, schemaVersion: 1, sourceOrderId: DRAFT,
    lines: [{ modifierGroups: [], productId: PIZZA, quantity: 1, sourceOrderItemId: LINE }],
  }, catalog), /CAPTURE_PIZZA_LINE_REQUIRED/u);
});
