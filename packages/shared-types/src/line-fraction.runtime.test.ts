import { parseAddOrderItemCommandV1, parseFractionHalfProjectionV1, parseLineFractionV1 } from "./index.js";

const FLAVOR_A = "11111111-1111-4111-8111-111111111111";
const FLAVOR_B = "22222222-2222-4222-8222-222222222222";
const EXTRA = "33333333-3333-4333-8333-333333333333";

const slot = (fraction: string, flavorOptionId: string | null, extras: string[] = [], excluded: string[] = []) => ({
  excludedIngredientIds: excluded, extraOptionIds: extras, flavorOptionId, fraction,
});

{ // a halves selection parses with half-a first and rejects malformed splits
  const parsed = parseLineFractionV1({
    geometry: "halves",
    slots: [slot("half-b", FLAVOR_B), slot("half-a", FLAVOR_A, [EXTRA], ["cebolla"])],
  });
  expect(parsed?.slots.map((entry) => entry.fraction).join() === "half-a,half-b", "half-a first");
  expect(parsed?.slots[0]?.extraOptionIds.join() === EXTRA, "extras kept");
  expect(parseLineFractionV1({ geometry: "thirds", slots: [] }) === undefined, "rejected");
  expect(parseLineFractionV1({ geometry: "halves", slots: [slot("half-a", FLAVOR_A)] }) === undefined, "rejected");
  expect(parseLineFractionV1({ geometry: "halves", slots: [slot("half-a", FLAVOR_A), slot("half-a", FLAVOR_B)] }) === undefined, "rejected");
  expect(parseLineFractionV1({ geometry: "halves", slots: [slot("half-a", FLAVOR_A, [EXTRA, EXTRA]), slot("half-b", FLAVOR_B)] }) === undefined, "rejected");
  expect(parseLineFractionV1({ geometry: "halves", slots: [slot("half-a", "nope"), slot("half-b", FLAVOR_B)], extra: 1 }) === undefined, "rejected");
}

{ // add-item command accepts an optional fraction (with or without a size)
  const base = {
    deviceId: "44444444-4444-4444-8444-444444444444",
    eventId: "55555555-5555-4555-8555-555555555555",
    expectedVersion: 1,
    idempotencyKey: "66666666-6666-4666-8666-666666666666",
    modifierGroups: [],
    occurredAt: "2026-10-05T10:00:00.000Z",
    orderId: "77777777-7777-4777-8777-777777777777",
    orderItemId: "88888888-8888-4888-8888-888888888888",
    productId: "99999999-9999-4999-8999-999999999999",
    quantity: 1,
    schemaVersion: 1,
    scope: { branchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", restaurantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  };
  const fraction = { geometry: "halves", slots: [slot("half-a", FLAVOR_A), slot("half-b", FLAVOR_B)] };
  const variantId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  expect(parseAddOrderItemCommandV1(base)?.fraction === null, "fraction defaults to null");
  expect(parseAddOrderItemCommandV1({ ...base, fraction, variantId })?.fraction?.geometry === "halves", "fraction parsed");
  // Halves are configured on the product, so a product without sizes may be split too.
  expect(parseAddOrderItemCommandV1({ ...base, fraction })?.fraction?.geometry === "halves", "fraction without a size parsed");
  expect(parseAddOrderItemCommandV1({ ...base, fraction: { geometry: "halves", slots: [] }, variantId }) === undefined, "rejected");
}
{ // a half built ingredient by ingredient has a null flavor; both halves custom is rejected
  const custom = parseLineFractionV1({ geometry: "halves", slots: [slot("half-a", null, [EXTRA]), slot("half-b", FLAVOR_B)] });
  expect(custom?.slots[0]?.flavorOptionId === null && custom.slots[0].extraOptionIds.join() === EXTRA, "custom half parses");
  expect(custom?.slots[1]?.flavorOptionId === FLAVOR_B, "flavor half keeps its id");
  expect(parseLineFractionV1({ geometry: "halves", slots: [slot("half-a", FLAVOR_A), slot("half-b", null)] })?.slots[1]?.flavorOptionId === null, "custom second half parses");
  expect(parseLineFractionV1({ geometry: "halves", slots: [slot("half-a", null), slot("half-b", null)] }) === undefined, "two custom halves rejected");
  expect(parseLineFractionV1({ geometry: "halves", slots: [slot("half-a", "custom"), slot("half-b", FLAVOR_B)] }) === undefined, "sentinel text rejected");
  const half = { amountMinor: 100, exclusions: [], extras: ["Queso"], flavorName: "Armada", fraction: "half-a" };
  const projected = parseFractionHalfProjectionV1({ ...half, excludedIngredientIds: [], extraOptionIds: [EXTRA], flavorOptionId: null });
  expect(projected?.flavorOptionId === null && projected.extraOptionIds?.join() === EXTRA, "custom projection half keeps null id");
}
{ // projection halves: ids are optional (old projections) but all-or-none and validated
  const half = { amountMinor: 100, exclusions: ["cebolla"], extras: ["Queso"], flavorName: "Hawaiana", fraction: "half-a" };
  const ids = { excludedIngredientIds: ["cebolla"], extraOptionIds: [EXTRA], flavorOptionId: FLAVOR_A };
  expect(parseFractionHalfProjectionV1(half)?.flavorOptionId === undefined, "old projection parses without ids");
  const parsed = parseFractionHalfProjectionV1({ ...half, ...ids });
  expect(parsed?.flavorOptionId === FLAVOR_A && parsed.extraOptionIds?.join() === EXTRA
    && parsed.excludedIngredientIds?.join() === "cebolla", "ids kept");
  expect(parseFractionHalfProjectionV1({ ...half, flavorOptionId: FLAVOR_A }) === undefined, "partial ids rejected");
  expect(parseFractionHalfProjectionV1({ ...half, ...ids, flavorOptionId: "nope" }) === undefined, "bad id rejected");
  expect(parseFractionHalfProjectionV1({ ...half, ...ids, extraOptionIds: ["nope"] }) === undefined, "bad extra id rejected");
  expect(parseFractionHalfProjectionV1({ ...half, ...ids, extra: 1 }) === undefined, "unknown key rejected");
}
function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
