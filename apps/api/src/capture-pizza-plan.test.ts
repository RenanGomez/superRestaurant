import assert from "node:assert/strict";
import test from "node:test";

import { parseCaptureSelectionPlanV1 } from "@super-restaurant/shared-types";

import {
  parseCapturePizzaLineV2,
  parseReplaceCaptureSelectionPlanCommandV2,
} from "./capture-pizza-plan.js";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = {
  schemaVersion: 1, expectedVersion: 1,
  scope: { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" },
  captureDraftId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  eventId: "a409ec59-9f5e-496d-a45d-b83a46b49674", idempotencyKey: "c483b6e7-e102-4cc5-a887-d30712c85e52",
  deviceId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4", occurredAt: "2026-11-20T12:00:00.000Z",
  attentionLeaseId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
};
const half = (fraction: string, productId: number, over: Record<string, unknown> = {}) => ({
  extraOptionIds: [], fraction, ingredientOptionIds: [U(100)], productId: U(productId), removedIngredientOptionIds: [], variantId: U(productId + 1), ...over,
});
const pizza = (a: Record<string, unknown> = {}, b: Record<string, unknown> = {}) => ({
  halves: [half("half-a", 10, a), half("half-b", 20, b)], ruleVersion: "pizza-halves-v2",
});
const line = (over: Record<string, unknown> = {}) => ({
  lineId: U(1), modifierGroups: [], note: null, pizza: pizza(), productId: U(10), quantity: 1, variantId: U(11), ...over,
});
const command = (lines: unknown[], schemaVersion = 2) => ({
  ...envelope, plan: { catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", lines, schemaVersion },
});

test("a V2 plan with a pizza line parses into a V1 envelope plus the validated halves", () => {
  const parsed = parseReplaceCaptureSelectionPlanCommandV2(command([line()]));
  assert.ok(parsed);
  assert.equal(parsed.command.plan.lines.length, 1);
  assert.equal(parsed.pizzaByLineId.get(U(1))?.halves[1]?.productId, U(20));
  assert.equal(parsed.pizzaByLineId.get(U(1))?.ruleVersion, "pizza-halves-v2");
});

test("halves are normalized to half-a then half-b, whatever the wire order", () => {
  const swapped = { halves: [half("half-b", 20), half("half-a", 10)], ruleVersion: "pizza-halves-v2" };
  const parsed = parseReplaceCaptureSelectionPlanCommandV2(command([line({ pizza: swapped })]));
  assert.deepEqual(parsed?.pizzaByLineId.get(U(1))?.halves.map((entry) => entry.fraction), ["half-a", "half-b"]);
});

test("negative cases fail closed", () => {
  const bad: unknown[] = [
    command([line()], 3),
    command([line({ pizza: { ...pizza(), ruleVersion: "pizza-halves-v1" } })]),
    command([line({ pizza: { ...pizza(), halves: [half("half-a", 10)] } })]),
    command([line({ pizza: { ...pizza(), halves: [half("half-a", 10), half("half-a", 20)] } })]),
    command([line({ pizza: pizza({ extraOptionIds: [U(100)] }) })]),
    command([line({ pizza: pizza({ removedIngredientOptionIds: [U(100)] }) })]),
    command([line({ pizza: pizza({ ingredientOptionIds: [U(100), U(100)] }) })]),
    command([line({ pizza: pizza({ ingredientOptionIds: ["nope"] }) })]),
    command([line({ pizza: { ...pizza(), extra: 1 } })]),
    command([line({ productId: U(99) })]),
    command([line({ variantId: U(98) })]),
    command([line({ fraction: { geometry: "halves", slots: [] } })]),
  ];
  for (const value of bad) assert.equal(parseReplaceCaptureSelectionPlanCommandV2(value), undefined, JSON.stringify(value).slice(0, 80));
  assert.equal(parseCapturePizzaLineV2(null), undefined);
});

test("a schemaVersion 1 command is not a V2 command and keeps the shared parser (a pizza key there is rejected)", () => {
  assert.equal(parseReplaceCaptureSelectionPlanCommandV2(command([line()], 1)), undefined);
  assert.equal(parseCaptureSelectionPlanV1(command([line()], 1).plan), undefined);
});

test("a V2 plan may mix pizza lines with ordinary lines", () => {
  const plain = { lineId: U(2), modifierGroups: [], note: null, productId: U(30), quantity: 2, variantId: null };
  const parsed = parseReplaceCaptureSelectionPlanCommandV2(command([line(), plain]));
  assert.equal(parsed?.command.plan.lines.length, 2);
  assert.equal(parsed?.pizzaByLineId.has(U(2)), false);
});
