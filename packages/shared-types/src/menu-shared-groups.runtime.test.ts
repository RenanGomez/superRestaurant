import { MENU_CATALOG_SCHEMA_VERSION, parseSaveMenuCatalogCommandV1 } from "./index.js";

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const categoryId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const burgerId = "9544c299-d25b-44ce-98ed-d30116610887";
const wrapId = "72371a5f-2056-448d-9ddb-14ab6664a4e8";
const groupId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const ghostGroupId = "b509ec59-9f5e-496d-a45d-b83a46b49675";
const optionId = "c483b6e7-e102-4cc5-a887-d30712c85e52";

type Json = Record<string, unknown>;

function product(productId: string, sku: string, extra: Json = {}): Json {
  return {
    productId, categoryId, name: sku, sku, active: true, displayOrder: 0, stationId: "kitchen",
    unit: "piece", unitPriceMinor: 12_500, tax: null, ...extra,
  };
}

function group(extra: Json = {}): Json {
  return {
    groupId, name: "Extras", active: true, displayOrder: 0, minimumQuantity: 0, maximumQuantity: 2,
    options: [{ optionId, name: "Queso", unitPriceMinor: 1_500, active: true, maximumQuantity: 2 }],
    ...extra,
  };
}

function command(products: readonly Json[], groups: readonly Json[]): Json {
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
    categories: [{ categoryId, name: "Alimentos", active: true, displayOrder: 0 }],
    products,
    modifierGroups: groups,
  };
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function listed(parsed: ReturnType<typeof parseSaveMenuCatalogCommandV1>, productId: string): readonly string[] | undefined {
  return parsed?.products.find((entry) => entry.productId === productId)?.modifierGroupIds;
}

// A group shared by two products, with no legacy owner.
const shared = parseSaveMenuCatalogCommandV1(command(
  [product(burgerId, "HAM-1", { modifierGroupIds: [groupId] }), product(wrapId, "WRP-1", { modifierGroupIds: [groupId] })],
  [group({ productId: null })],
));
expect(shared !== undefined, "a group shared by two products parses");
expect(listed(shared, burgerId)?.[0] === groupId && listed(shared, wrapId)?.[0] === groupId, "both products list the shared group");
expect(shared?.modifierGroups[0]?.productId === null, "a shared group carries a null legacy owner");
expect(Object.isFrozen(shared?.products[0]?.modifierGroupIds), "the group id list is frozen");

// A group that omits productId entirely is normalized to null.
const noOwnerKey = parseSaveMenuCatalogCommandV1(command([product(burgerId, "HAM-1", { modifierGroupIds: [groupId] })], [group()]));
expect(noOwnerKey?.modifierGroups[0]?.productId === null, "an absent productId normalizes to null");

// An unassigned group is valid and shows up in no product.
const unassigned = parseSaveMenuCatalogCommandV1(command([product(burgerId, "HAM-1", { modifierGroupIds: [] })], [group()]));
expect(unassigned !== undefined && listed(unassigned, burgerId)?.length === 0, "an unassigned group parses");

// Older producers: legacy productId, no product list; the list is derived.
const legacy = parseSaveMenuCatalogCommandV1(command([product(burgerId, "HAM-1"), product(wrapId, "WRP-1")], [group({ productId: burgerId })]));
expect(legacy !== undefined, "a legacy payload parses");
expect(listed(legacy, burgerId)?.[0] === groupId && listed(legacy, wrapId)?.length === 0, "the product list is derived from the legacy owner");

// Rejections.
function rejected(value: Json, message: string): void {
  expect(parseSaveMenuCatalogCommandV1(value) === undefined, message);
}

rejected(command([product(burgerId, "HAM-1", { modifierGroupIds: [ghostGroupId] })], [group()]), "a product listing an unknown group is rejected");
rejected(command([product(burgerId, "HAM-1", { modifierGroupIds: [groupId, groupId] })], [group()]), "a repeated group id in a product is rejected");
rejected(command([product(burgerId, "HAM-1", { modifierGroupIds: ["not-a-uuid"] })], [group()]), "a non-UUID group id is rejected");
rejected(
  command([product(burgerId, "HAM-1", { modifierGroupIds: [groupId] }), product(wrapId, "WRP-1", { modifierGroupIds: [groupId] })], [group({ productId: burgerId })]),
  "a legacy owner cannot be shared with another product",
);
rejected(command([product(burgerId, "HAM-1", { modifierGroupIds: [] })], [group({ productId: burgerId })]), "a legacy owner must list its own group");
rejected(command([product(burgerId, "HAM-1")], [group({ productId: wrapId })]), "a legacy owner that is not a product is rejected");
rejected(
  command([product(burgerId, "HAM-1", { modifierGroupIds: [groupId], fraction: { enabled: true, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: ghostGroupId } })], [group()]),
  "a fraction flavor group that the product does not list is rejected",
);
const accepted = parseSaveMenuCatalogCommandV1(command(
  [product(burgerId, "HAM-1", { modifierGroupIds: [groupId], fraction: { enabled: true, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: groupId } })],
  [group()],
));
expect(accepted !== undefined, "a fraction group listed by the product is accepted");
rejected(command([product(burgerId, "HAM-1", { modifierGroupIds: [groupId] })], [group(), group()]), "a duplicated group id is rejected");
