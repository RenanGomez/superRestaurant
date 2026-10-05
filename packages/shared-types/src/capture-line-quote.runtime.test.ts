import {
  parseCaptureLineQuoteRequestV1,
  parseCaptureLineQuoteResultV1,
} from "./index.js";

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const scope = {
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
};
const catalogVersion = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const productId = "9544c299-d25b-44ce-98ed-d30116610887";
const variantId = "0b3d5a8e-0f6e-4c2e-9d44-6f1a9c1d7a10";
const groupId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const optionId = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const flavorA = "5f0c2f3a-1b6e-4a53-8f55-2e7a0c9b1a01";
const flavorB = "5f0c2f3a-1b6e-4a53-8f55-2e7a0c9b1a02";

const request = {
  schemaVersion: 1,
  scope,
  catalogVersion,
  productId,
  variantId: null,
  modifierGroups: [{ groupId, selections: [{ optionId, quantity: 2 }] }],
  fraction: null,
  quantity: 3,
};
const halves = {
  geometry: "halves",
  slots: [
    { fraction: "half-a", flavorOptionId: flavorA, extraOptionIds: [], excludedIngredientIds: [] },
    { fraction: "half-b", flavorOptionId: flavorB, extraOptionIds: [], excludedIngredientIds: ["cebolla"] },
  ],
};

const parsed = parseCaptureLineQuoteRequestV1(request);
expect(parsed !== undefined && parsed.quantity === 3 && parsed.fraction === null && parsed.variantId === null, "whole request parses");
expect(parsed !== undefined && Object.isFrozen(parsed) && Object.isFrozen(parsed.modifierGroups), "request is frozen");
expect(parsed?.modifierGroups[0]?.selections[0]?.quantity === 2, "modifier quantity kept");

const half = parseCaptureLineQuoteRequestV1({ ...request, variantId, fraction: halves });
expect(half?.fraction?.geometry === "halves" && half.variantId === variantId, "half-and-half request parses");
expect(parseCaptureLineQuoteRequestV1({ ...request, fraction: halves }) === undefined, "halves require a variant");

const bad = (patch: Record<string, unknown>): unknown => parseCaptureLineQuoteRequestV1({ ...request, ...patch });
expect(bad({ quantity: 0 }) === undefined, "quantity 0 rejected");
expect(bad({ quantity: 1_001 }) === undefined, "quantity above the plan limit rejected");
expect(parseCaptureLineQuoteRequestV1({ ...request, quantity: 500 })?.quantity === 500, "quantity 500 accepted");
expect(parseCaptureLineQuoteRequestV1({ ...request, quantity: 1_000 })?.quantity === 1_000, "plan-sized quantity accepted");
expect(bad({ quantity: 1.5 }) === undefined, "fractional quantity rejected");
expect(bad({ schemaVersion: 2 }) === undefined, "unknown schemaVersion rejected");
expect(bad({ catalogVersion: "not-a-uuid" }) === undefined, "bad catalogVersion rejected");
expect(bad({ scope: { restaurantId: scope.restaurantId } }) === undefined, "partial scope rejected");
expect(bad({ extra: 1 }) === undefined, "unknown key rejected");
expect(bad({ productId: "x" }) === undefined, "bad productId rejected");
expect(bad({ modifierGroups: [{ groupId, selections: [{ optionId, quantity: 0 }] }] }) === undefined, "modifier quantity 0 rejected");
expect(bad({ modifierGroups: [{ groupId, selections: [] }, { groupId, selections: [] }] }) === undefined, "duplicate group rejected");
expect(parseCaptureLineQuoteRequestV1(null) === undefined, "null rejected");

const result = {
  schemaVersion: 1,
  catalogVersion,
  currency: "MXN",
  unitPriceMinor: 12_000,
  lineTotalMinor: 37_000,
  subtotalMinor: 32_000,
  taxMinor: 5_000,
  modifiers: [{ groupId, optionId, name: "Queso extra", quantity: 2, unitPriceMinor: 500 }],
  geometry: "whole",
  fractionBreakdown: [],
};
const parsedResult = parseCaptureLineQuoteResultV1(result);
expect(parsedResult?.lineTotalMinor === 37_000 && parsedResult.modifiers.length === 1, "result parses");
expect(parseCaptureLineQuoteResultV1({ ...result, unitPriceMinor: 1.5 }) === undefined, "float price rejected");
expect(parseCaptureLineQuoteResultV1({ ...result, lineTotalMinor: -1 }) === undefined, "negative total rejected");
expect(parseCaptureLineQuoteResultV1({ ...result, taxMinor: 4_999 }) === undefined, "subtotal plus tax must equal the total");
expect(parseCaptureLineQuoteResultV1({ ...result, taxMinor: 1.5 }) === undefined, "float tax rejected");
expect(parseCaptureLineQuoteResultV1({ ...result, currency: "mxn" }) === undefined, "lowercase currency rejected");
expect(parseCaptureLineQuoteResultV1({ ...result, geometry: "halves" }) === undefined, "halves geometry needs two halves");
expect(parseCaptureLineQuoteResultV1({ ...result, extra: 1 }) === undefined, "result unknown key rejected");
const halfEntry = (fraction: string, flavorName: string) => ({
  amountMinor: 6_000, exclusions: [], extras: [], flavorName, fraction,
});
const halvesResult = parseCaptureLineQuoteResultV1({
  ...result, geometry: "halves", fractionBreakdown: [halfEntry("half-a", "Pepperoni"), halfEntry("half-b", "Hawaiana")],
});
expect(halvesResult?.fractionBreakdown.length === 2, "halves result parses");
expect(parseCaptureLineQuoteResultV1({ ...result, fractionBreakdown: [halfEntry("half-a", "Pepperoni")] }) === undefined,
  "whole result with halves rejected");
