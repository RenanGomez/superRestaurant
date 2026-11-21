import { MENU_CATALOG_SCHEMA_VERSION, parseSaveMenuCatalogCommandV1 } from "./index.js";

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const categoryId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const pizzaId = "9544c299-d25b-44ce-98ed-d30116610887";
const baseGroupId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const extraGroupId = "b509ec59-9f5e-496d-a45d-b83a46b49675";
const ghostGroupId = "c609ec59-9f5e-496d-a45d-b83a46b49676";
const optionA = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const optionB = "d483b6e7-e102-4cc5-a887-d30712c85e53";

type Json = Record<string, unknown>;

function product(extra: Json = {}): Json {
  return {
    productId: pizzaId, categoryId, name: "Pizza", sku: "PIZ-1", active: true, displayOrder: 0, stationId: "kitchen",
    unit: "piece", unitPriceMinor: 10_000, tax: null, modifierGroupIds: [baseGroupId, extraGroupId], ...extra,
  };
}

function group(id: string, optionIds: readonly string[]): Json {
  return {
    groupId: id, name: `G-${id.slice(0, 4)}`, active: true, displayOrder: 0, minimumQuantity: 0, maximumQuantity: 5,
    productId: null,
    options: optionIds.map((optionId) => ({ optionId, name: `O-${optionId.slice(0, 4)}`, unitPriceMinor: 1_000, active: true, maximumQuantity: 1 })),
  };
}

function command(products: readonly Json[]): Json {
  return {
    schemaVersion: MENU_CATALOG_SCHEMA_VERSION,
    scope: { restaurantId, branchId },
    eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
    idempotencyKey: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
    deviceId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
    occurredAt: "2026-11-01T22:00:00.000Z",
    expectedVersion: 0,
    catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
    currency: "MXN",
    categories: [{ categoryId, name: "Pizzas", active: true, displayOrder: 0 }],
    products,
    modifierGroups: [group(baseGroupId, [optionA, optionB]), group(extraGroupId, ["e483b6e7-e102-4cc5-a887-d30712c85e54"])],
  };
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function rejected(products: readonly Json[], message: string): void {
  expect(parseSaveMenuCatalogCommandV1(command(products)) === undefined, message);
}

// A legacy product (no pizzaMode) parses unchanged and carries no V2 field.
const legacy = parseSaveMenuCatalogCommandV1(command([product()]));
expect(legacy !== undefined, "a legacy product parses");
expect(legacy?.products[0]?.pizzaMode === undefined && legacy?.products[0]?.freeIngredientCount === undefined, "a legacy product carries no V2 field");

// A custom base with N = 2, a base group and one extra group.
const custom = parseSaveMenuCatalogCommandV1(command([product({
  pizzaMode: "custom", freeIngredientCount: 2, baseGroupId, customizeAtOrder: true, extraGroupIds: [extraGroupId],
})]));
expect(custom !== undefined, "a custom pizza product parses");
expect(custom?.products[0]?.pizzaMode === "custom" && custom.products[0].freeIngredientCount === 2, "mode and N are kept");
expect(custom?.products[0]?.baseGroupId === baseGroupId && custom.products[0].customizeAtOrder === true, "base group and customize flag are kept");
expect(Object.isFrozen(custom?.products[0]?.extraGroupIds), "the extra group list is frozen");

// A specialty with a recipe parses; N defaults to 0 and the flag to false.
const specialty = parseSaveMenuCatalogCommandV1(command([product({ pizzaMode: "specialty", defaultIngredientOptionIds: [optionA, optionB] })]));
expect(specialty?.products[0]?.freeIngredientCount === 0 && specialty.products[0].customizeAtOrder === false, "specialty defaults");
expect(specialty?.products[0]?.defaultIngredientOptionIds?.length === 2, "the recipe is kept");

// N = 0 is valid.
expect(parseSaveMenuCatalogCommandV1(command([product({ pizzaMode: "custom", freeIngredientCount: 0, baseGroupId })])) !== undefined, "N = 0 parses");

// Rejections.
rejected([product({ freeIngredientCount: 1 })], "a V2 field without pizzaMode is rejected");
rejected([product({ pizzaMode: "mixed" })], "an unknown pizzaMode is rejected");
rejected([product({ pizzaMode: "custom", baseGroupId: null })], "a custom pizza needs a base group");
rejected([product({ pizzaMode: "custom", baseGroupId, freeIngredientCount: -1 })], "a negative N is rejected");
rejected([product({ pizzaMode: "custom", baseGroupId, freeIngredientCount: 1.5 })], "a fractional N is rejected");
rejected([product({ pizzaMode: "custom", baseGroupId, freeIngredientCount: 41 })], "an N above the bound is rejected");
rejected([product({ pizzaMode: "custom", baseGroupId: ghostGroupId })], "a base group the product does not list is rejected");
rejected([product({ pizzaMode: "custom", baseGroupId, extraGroupIds: [ghostGroupId] })], "an extra group the product does not list is rejected");
rejected([product({ pizzaMode: "custom", baseGroupId, extraGroupIds: [baseGroupId] })], "the base group cannot also be an extra group");
rejected([product({ pizzaMode: "custom", baseGroupId, extraGroupIds: [extraGroupId, extraGroupId] })], "repeated extra groups are rejected");
rejected([product({ pizzaMode: "specialty", defaultIngredientOptionIds: [optionA, optionA] })], "repeated recipe ids are rejected");
rejected([product({ pizzaMode: "specialty", defaultIngredientOptionIds: ["not-a-uuid"] })], "a non-UUID recipe id is rejected");
rejected([product({ pizzaMode: "custom", baseGroupId, customizeAtOrder: "yes" })], "a non-boolean customize flag is rejected");

// Named case: base and extra groups missing from the product's modifierGroupIds, alone or together.
rejected([product({ pizzaMode: "custom", baseGroupId, modifierGroupIds: [extraGroupId] })], "a base group missing from modifierGroupIds is rejected");
rejected([product({ pizzaMode: "custom", baseGroupId, extraGroupIds: [extraGroupId], modifierGroupIds: [baseGroupId] })], "extra groups missing from modifierGroupIds are rejected");
rejected([product({ pizzaMode: "custom", baseGroupId, extraGroupIds: [extraGroupId], modifierGroupIds: [] })], "base and extra groups with no modifierGroupIds are rejected");

// Parity with domain (menu-pizza-v2.test.ts): 24 extra groups / 40 recipe ids / N 40 pass; 25 / 41 fail.
const uuid = (prefix: number, index: number): string => `${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const manyGroupIds = (count: number): string[] => Array.from({ length: count }, (_, index) => uuid(0xa0, index + 1));
const manyOptionIds = (count: number): string[] => Array.from({ length: count }, (_, index) => uuid(0xb0, index + 1));
const withGroups = (extraIds: readonly string[], recipeOptionIds: readonly string[], extra: Json): Json => ({
  ...command([product({ modifierGroupIds: [baseGroupId, ...extraIds], ...extra })]),
  modifierGroups: [group(baseGroupId, recipeOptionIds), ...extraIds.map((id) => group(id, [uuid(0xc0, extraIds.indexOf(id) + 1)]))],
});
const accepts = (value: Json): boolean => parseSaveMenuCatalogCommandV1(value) !== undefined;
expect(accepts(withGroups(manyGroupIds(24), [optionA], { pizzaMode: "custom", baseGroupId, extraGroupIds: manyGroupIds(24) })), "24 extra groups parse");
expect(!accepts(withGroups(manyGroupIds(25), [optionA], { pizzaMode: "custom", baseGroupId, extraGroupIds: manyGroupIds(25) })), "25 extra groups are rejected");
expect(accepts(withGroups([], manyOptionIds(40), { pizzaMode: "specialty", defaultIngredientOptionIds: manyOptionIds(40) })), "40 recipe ids parse");
expect(!accepts(withGroups([], manyOptionIds(41), { pizzaMode: "specialty", defaultIngredientOptionIds: manyOptionIds(41) })), "41 recipe ids are rejected");
expect(accepts(command([product({ pizzaMode: "custom", baseGroupId, freeIngredientCount: 40 })])), "N = 40 parses");
