import { MENU_CATALOG_SCHEMA_VERSION, parseSaveMenuCatalogCommandV1 } from "./index.js";

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const categoryId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const pizzaId = "9544c299-d25b-44ce-98ed-d30116610887";
const baseGroupId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const veggieGroupId = "b509ec59-9f5e-496d-a45d-b83a46b49675";
const extraGroupId = "c609ec59-9f5e-496d-a45d-b83a46b49676";
const ghostGroupId = "d709ec59-9f5e-496d-a45d-b83a46b49677";
const optionA = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const optionB = "d483b6e7-e102-4cc5-a887-d30712c85e53";
const veggieOption = "e483b6e7-e102-4cc5-a887-d30712c85e54";
const extraOption = "f483b6e7-e102-4cc5-a887-d30712c85e55";

type Json = Record<string, unknown>;

function product(extra: Json = {}): Json {
  return {
    productId: pizzaId, categoryId, name: "Pizza", sku: "PIZ-1", active: true, displayOrder: 0, stationId: "kitchen",
    unit: "piece", unitPriceMinor: 10_000, tax: null, modifierGroupIds: [baseGroupId, extraGroupId], ...extra,
  };
}

function option(optionId: string, active = true): Json {
  return { optionId, name: `O-${optionId.slice(0, 4)}`, unitPriceMinor: 1_000, active, maximumQuantity: 1 };
}

function group(id: string, optionIds: readonly string[], inactive: readonly string[] = []): Json {
  return {
    groupId: id, name: `G-${id.slice(0, 4)}`, active: true, displayOrder: 0, minimumQuantity: 0, maximumQuantity: 5,
    productId: null,
    options: optionIds.map((optionId) => option(optionId, !inactive.includes(optionId))),
  };
}

function command(products: readonly Json[], modifierGroups?: readonly Json[]): Json {
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
    modifierGroups: modifierGroups ?? [
      group(baseGroupId, [optionA, optionB]),
      group(veggieGroupId, [veggieOption]),
      group(extraGroupId, [extraOption]),
    ],
  };
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function rejected(products: readonly Json[], message: string, modifierGroups?: readonly Json[]): void {
  expect(parseSaveMenuCatalogCommandV1(command(products, modifierGroups)) === undefined, message);
}

// A legacy product (no pizzaMode) parses unchanged and carries no V2 field.
const legacy = parseSaveMenuCatalogCommandV1(command([product()]));
expect(legacy !== undefined, "a legacy product parses");
expect(legacy?.products[0]?.pizzaMode === undefined && legacy?.products[0]?.freeIngredientCount === undefined, "a legacy product carries no V2 field");

// A custom base with N = 2, several base groups and a loose extra option.
const custom = parseSaveMenuCatalogCommandV1(command([product({
  pizzaMode: "custom",
  freeIngredientCount: 2,
  baseGroupIds: [baseGroupId, veggieGroupId],
  defaultIngredientOptionIds: [veggieOption],
  extraOptionIds: [extraOption],
  customizeAtOrder: true,
  modifierGroupIds: [baseGroupId, veggieGroupId, extraGroupId],
})]));
expect(custom !== undefined, "a custom pizza product parses");
expect(custom?.products[0]?.pizzaMode === "custom" && custom.products[0].freeIngredientCount === 2, "mode and one N are kept");
expect(custom?.products[0]?.baseGroupIds?.length === 2 && Object.isFrozen(custom.products[0].baseGroupIds), "both base groups are kept and frozen");
expect(custom?.products[0]?.defaultIngredientOptionIds?.[0] === veggieOption, "the recipe may come from the second base group");
expect(custom?.products[0]?.extraOptionIds?.[0] === extraOption && Object.isFrozen(custom.products[0].extraOptionIds), "the extra option is kept and frozen");
expect(!Object.hasOwn(custom!.products[0]!, "baseGroupId") && !Object.hasOwn(custom!.products[0]!, "extraGroupIds"), "legacy forms are never emitted");

// The legacy parser normalizes baseGroupId to [id] and extraGroupIds to the active options of those groups.
const normalized = parseSaveMenuCatalogCommandV1(command([product({
  pizzaMode: "custom", freeIngredientCount: 1, baseGroupId, extraGroupIds: [extraGroupId],
})], [group(baseGroupId, [optionA]), group(extraGroupId, [extraOption, optionB], [optionB])]));
expect(normalized?.products[0]?.baseGroupIds?.length === 1 && normalized.products[0].baseGroupIds[0] === baseGroupId, "baseGroupId becomes baseGroupIds");
expect(JSON.stringify(normalized?.products[0]?.extraOptionIds) === JSON.stringify([extraOption]), "extraGroupIds expand to the active options only");
expect(!Object.hasOwn(normalized!.products[0]!, "baseGroupId") && !Object.hasOwn(normalized!.products[0]!, "extraGroupIds"), "legacy forms are not emitted");

// A specialty with a recipe from a base group parses; N defaults to 0 and the flag to false.
const specialty = parseSaveMenuCatalogCommandV1(command([product({ pizzaMode: "specialty", baseGroupIds: [baseGroupId], defaultIngredientOptionIds: [optionA, optionB] })]));
expect(specialty?.products[0]?.freeIngredientCount === 0 && specialty.products[0].customizeAtOrder === false, "specialty defaults");
expect(specialty?.products[0]?.defaultIngredientOptionIds?.length === 2, "the recipe is kept");

// N = 0 is valid.
expect(parseSaveMenuCatalogCommandV1(command([product({ pizzaMode: "custom", freeIngredientCount: 0, baseGroupIds: [baseGroupId] })])) !== undefined, "N = 0 parses");

// Rejections.
rejected([product({ freeIngredientCount: 1 })], "a V2 field without pizzaMode is rejected");
rejected([product({ pizzaMode: "mixed" })], "an unknown pizzaMode is rejected");
rejected([product({ pizzaMode: "custom" })], "a custom pizza needs a base group");
rejected([product({ pizzaMode: "custom", baseGroupId: null })], "a null legacy base group is not a base group");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], freeIngredientCount: -1 })], "a negative N is rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], freeIngredientCount: 1.5 })], "a fractional N is rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], freeIngredientCount: 41 })], "an N above the bound is rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [ghostGroupId] })], "a base group the product does not list is rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], extraOptionIds: [ghostGroupId] })], "an extra option the product does not offer is rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], defaultIngredientOptionIds: [extraOption] })], "a recipe option outside the base groups is rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], defaultIngredientOptionIds: [optionA], extraOptionIds: [optionA] })], "an option cannot be a recipe item and an extra");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId, baseGroupId] })], "repeated base groups are rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], extraOptionIds: [extraOption, extraOption] })], "repeated extra options are rejected");
rejected([product({ pizzaMode: "specialty", baseGroupIds: [baseGroupId], defaultIngredientOptionIds: [optionA, optionA] })], "repeated recipe ids are rejected");
rejected([product({ pizzaMode: "specialty", baseGroupIds: [baseGroupId], defaultIngredientOptionIds: ["not-a-uuid"] })], "a non-UUID recipe id is rejected");
rejected([product({ pizzaMode: "custom", baseGroupId, baseGroupIds: [baseGroupId] })], "both base group forms are rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], extraGroupIds: [extraGroupId], extraOptionIds: [extraOption] })], "both extra forms are rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], customizeAtOrder: "yes" })], "a non-boolean customize flag is rejected");

// An extra option may belong to a group that is also a base group; only the same option is a conflict.
expect(parseSaveMenuCatalogCommandV1(command([product({
  pizzaMode: "custom", baseGroupIds: [baseGroupId], defaultIngredientOptionIds: [optionA], extraOptionIds: [optionB],
})])) !== undefined, "an extra option from a base group parses");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], extraOptionIds: [extraOption], modifierGroupIds: [baseGroupId, veggieGroupId] })], "an extra option from an unassigned group is rejected");

// Named case: base groups missing from the product's modifierGroupIds are rejected.
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], modifierGroupIds: [extraGroupId] })], "a base group missing from modifierGroupIds is rejected");
rejected([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId, veggieGroupId], modifierGroupIds: [baseGroupId, extraGroupId] })], "a second missing base group is rejected");

// Parity with domain (menu-pizza-v2.test.ts): 40 recipe ids / N 40 / 200 extra options pass; 41 and 201 fail.
const uuid = (prefix: number, index: number): string => `${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const manyOptionIds = (prefix: number, count: number): string[] => Array.from({ length: count }, (_, index) => uuid(prefix, index + 1));
const withGroups = (recipeOptionIds: readonly string[], extraGroups: readonly (readonly [string, readonly string[]])[], extra: Json): Json => {
  const extraIds = extraGroups.map(([id]) => id);
  return command(
    [product({ modifierGroupIds: [baseGroupId, ...extraIds], ...extra })],
    [group(baseGroupId, recipeOptionIds), ...extraGroups.map(([id, options]) => group(id, options))],
  );
};
const accepts = (value: Json): boolean => parseSaveMenuCatalogCommandV1(value) !== undefined;
const recipe40 = manyOptionIds(0xb0, 40);
const recipe41 = manyOptionIds(0xb0, 41);
const extras200 = manyOptionIds(0xc0, 200);
const extras201a = manyOptionIds(0xc0, 101);
const extras201b = manyOptionIds(0xd0, 100);
const extraGroupB = uuid(0xe0, 1);
expect(accepts(withGroups(recipe40, [], { pizzaMode: "specialty", baseGroupIds: [baseGroupId], defaultIngredientOptionIds: recipe40 })), "40 recipe ids parse");
expect(!accepts(withGroups(recipe41, [], { pizzaMode: "specialty", baseGroupIds: [baseGroupId], defaultIngredientOptionIds: recipe41 })), "41 recipe ids are rejected");
expect(accepts(withGroups([optionA], [[extraGroupId, extras200]], { pizzaMode: "custom", baseGroupIds: [baseGroupId], extraOptionIds: extras200 })), "200 extra options parse");
expect(!accepts(withGroups([optionA], [[extraGroupId, extras201a], [extraGroupB, extras201b]], { pizzaMode: "custom", baseGroupIds: [baseGroupId], extraOptionIds: [...extras201a, ...extras201b] })), "201 extra options are rejected");
expect(accepts(command([product({ pizzaMode: "custom", baseGroupIds: [baseGroupId], freeIngredientCount: 40 })])), "N = 40 parses");
