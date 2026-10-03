import {
  MAX_ORDER_ITEM_MODIFIER_GROUPS,
  MENU_CATALOG_SCHEMA_VERSION,
  parseMenuCatalogStateV1,
  parseMenuCatalogV1,
  parseSaveMenuCatalogCommandV1,
  parseUploadMenuImageCommandV1,
} from "./index.js";

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const categoryId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const productId = "9544c299-d25b-44ce-98ed-d30116610887";
const groupId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const optionId = "c483b6e7-e102-4cc5-a887-d30712c85e52";

function command(): Record<string, unknown> {
  return {
    schemaVersion: MENU_CATALOG_SCHEMA_VERSION,
    scope: { restaurantId, branchId },
    eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
    idempotencyKey: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
    deviceId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
    occurredAt: "2026-09-02T22:00:00.000Z",
    expectedVersion: 0,
    catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
    currency: "MXN",
    categories: [{ categoryId, name: "Alimentos", active: true, displayOrder: 0 }],
    products: [{
      productId,
      categoryId,
      name: "Hamburguesa",
      sku: "HAM-001",
      active: true,
      displayOrder: 0,
      stationId: "kitchen",
      unit: "piece",
      unitPriceMinor: 12_500,
      imagePath: `${restaurantId}/products/${productId}/00000000000000000000000000000000.jpg`,
      tax: {
        taxId: "vat",
        name: "IVA",
        taxRuleVersion: "mx-v1",
        rateNumerator: 16,
        rateDenominator: 100,
        inclusion: "excluded",
      },
    }],
    modifierGroups: [{
      groupId,
      productId,
      name: "Extras",
      active: true,
      displayOrder: 0,
      minimumQuantity: 0,
      maximumQuantity: 2,
      options: [{
        optionId, name: "Queso", unitPriceMinor: 1_500, active: true, maximumQuantity: 2,
        imagePath: `${restaurantId}/options/${optionId}/11111111111111111111111111111111.png`,
      }],
    }],
  };
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectDefined<T>(value: T | undefined, message: string): asserts value is T {
  expect(value !== undefined, message);
}

function expectRejected(value: unknown, message: string): void {
  expect(parseSaveMenuCatalogCommandV1(value) === undefined, message);
}

const parsed = parseSaveMenuCatalogCommandV1(command());
expectDefined(parsed, "valid menu catalog command parses");
expect(Object.isFrozen(parsed), "command is frozen");
expect(Object.isFrozen(parsed.scope), "scope is frozen");
expect(Object.isFrozen(parsed.categories), "category collection is frozen");
expect(Object.isFrozen(parsed.products[0]?.tax), "tax snapshot is frozen");
expect(Object.isFrozen(parsed.modifierGroups[0]?.options), "modifier options are frozen");

const response = parseMenuCatalogV1({
  catalogVersion: parsed.catalogVersion,
  currency: parsed.currency,
  categories: parsed.categories,
  products: parsed.products,
  modifierGroups: parsed.modifierGroups,
  version: 1,
  updatedAt: "2026-09-02T22:00:01.000Z",
  updatedBy: "5ed22a92-a93d-4034-9661-4df2b523517b",
  replayed: false,
});
expectDefined(response, "menu catalog response parses");
expectDefined(parseMenuCatalogStateV1({ schemaVersion: 1, scope: parsed.scope, catalog: response }), "populated menu state parses");
expectDefined(parseMenuCatalogStateV1({ schemaVersion: 1, scope: parsed.scope, catalog: null }), "empty menu state parses");

expectRejected({ ...command(), schemaVersion: 2 }, "unknown schema version is rejected");
expectRejected({ ...command(), currency: "mxn" }, "non-canonical currency is rejected");
expectRejected({ ...command(), expectedVersion: -1 }, "negative expected version is rejected");
expectRejected({ ...command(), unexpected: true }, "extra command field is rejected");

const missingCategory = command();
missingCategory.categories = [];
expectRejected(missingCategory, "unresolved product category is rejected");

const duplicateSku = command();
duplicateSku.products = [
  ...(duplicateSku.products as readonly unknown[]),
  { ...(duplicateSku.products as readonly Record<string, unknown>[])[0], productId: "72371a5f-2056-448d-9ddb-14ab6664a4e8" },
];
expectRejected(duplicateSku, "duplicate product SKU is rejected");

const unknownProduct = command();
unknownProduct.modifierGroups = [{
  ...(unknownProduct.modifierGroups as readonly Record<string, unknown>[])[0],
  productId: "72371a5f-2056-448d-9ddb-14ab6664a4e8",
}];
expectRejected(unknownProduct, "modifier group with unknown product is rejected");

const invalidBounds = command();
invalidBounds.modifierGroups = [{
  ...(invalidBounds.modifierGroups as readonly Record<string, unknown>[])[0],
  minimumQuantity: 3,
  maximumQuantity: 2,
}];
expectRejected(invalidBounds, "invalid modifier bounds are rejected");

const groupTemplate = (command().modifierGroups as readonly Record<string, unknown>[])[0];
if (groupTemplate === undefined) throw new Error("TEST_GROUP_TEMPLATE_MISSING");
const requiredGroups = Array.from({ length: MAX_ORDER_ITEM_MODIFIER_GROUPS + 1 }, (_, index) => ({
  ...groupTemplate,
  displayOrder: index,
  groupId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  minimumQuantity: 1,
  options: [{
    ...((groupTemplate.options as readonly Record<string, unknown>[])[0] ?? {}),
    optionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  }],
}));
const tooManyRequiredGroups = command();
tooManyRequiredGroups.modifierGroups = requiredGroups;
expectRejected(
  tooManyRequiredGroups,
  "a product cannot require more modifier groups than one order-item command can carry",
);

const maximumRequiredGroups = command();
maximumRequiredGroups.modifierGroups = requiredGroups.slice(0, MAX_ORDER_ITEM_MODIFIER_GROUPS);
expectDefined(
  parseSaveMenuCatalogCommandV1(maximumRequiredGroups),
  "the exact order-item modifier-group limit remains publishable",
);

const extraInactiveGroup = command();
extraInactiveGroup.modifierGroups = requiredGroups.map((group, index) => (
  index === MAX_ORDER_ITEM_MODIFIER_GROUPS ? { ...group, active: false } : group
));
expectDefined(
  parseSaveMenuCatalogCommandV1(extraInactiveGroup),
  "inactive groups do not consume the order-item command limit",
);

const invalidTax = command();
invalidTax.products = [{
  ...(invalidTax.products as readonly Record<string, unknown>[])[0],
  tax: {
    ...((invalidTax.products as readonly Record<string, unknown>[])[0]?.tax as Record<string, unknown>),
    rateDenominator: 0,
  },
}];
expectRejected(invalidTax, "zero tax denominator is rejected");

const accessor = command();
Object.defineProperty(accessor, "currency", { enumerable: true, get: () => "MXN" });
expectRejected(accessor, "accessor fields are rejected without invocation");
expectRejected(new Proxy(command(), { ownKeys: () => { throw new Error("hostile"); } }), "hostile proxies fail closed");

expect(parsed.products[0]?.imagePath === `${restaurantId}/products/${productId}/00000000000000000000000000000000.jpg`,
  "product imagePath round-trips");
expect(parsed.modifierGroups[0]?.options[0]?.imagePath
  === `${restaurantId}/options/${optionId}/11111111111111111111111111111111.png`, "option imagePath round-trips");

const nullImagePaths = command();
nullImagePaths.products = [{ ...(nullImagePaths.products as readonly Record<string, unknown>[])[0], imagePath: null }];
nullImagePaths.modifierGroups = [{
  ...(nullImagePaths.modifierGroups as readonly Record<string, unknown>[])[0],
  options: [{ ...((nullImagePaths.modifierGroups as readonly Record<string, unknown>[])[0]?.options as readonly Record<string, unknown>[])[0], imagePath: null }],
}];
const nullImageParsed = parseSaveMenuCatalogCommandV1(nullImagePaths);
expectDefined(nullImageParsed, "null imagePath is accepted on both product and option");
expect(nullImageParsed.products[0]?.imagePath === null, "product imagePath stays null");

const missingImagePath = command();
missingImagePath.products = [{ ...(missingImagePath.products as readonly Record<string, unknown>[])[0] }];
delete (missingImagePath.products as Record<string, unknown>[])[0]?.imagePath;
const absentParsed = parseSaveMenuCatalogCommandV1(missingImagePath);
expectDefined(absentParsed, "an omitted imagePath (older producer) still parses");
expect(absentParsed.products[0]?.imagePath === null, "an omitted product imagePath normalizes to null");
const absentOption = command();
absentOption.modifierGroups = [{
  ...(absentOption.modifierGroups as readonly Record<string, unknown>[])[0],
  options: [{ optionId, name: "Queso", unitPriceMinor: 1_500, active: true, maximumQuantity: 2 }],
}];
const absentOptionParsed = parseSaveMenuCatalogCommandV1(absentOption);
expectDefined(absentOptionParsed, "an option without imagePath still parses");
expect(absentOptionParsed.modifierGroups[0]?.options[0]?.imagePath === null, "an omitted option imagePath normalizes to null");

const malformedImagePath = command();
malformedImagePath.products = [{
  ...(malformedImagePath.products as readonly Record<string, unknown>[])[0], imagePath: "../../etc/passwd",
}];
expectRejected(malformedImagePath, "a malformed imagePath shape is rejected");

const wrongExtensionImagePath = command();
wrongExtensionImagePath.products = [{
  ...(wrongExtensionImagePath.products as readonly Record<string, unknown>[])[0],
  imagePath: `${restaurantId}/products/${productId}/00000000000000000000000000000000.gif`,
}];
expectRejected(wrongExtensionImagePath, "an unsupported image extension is rejected");

function uploadCommand(): Record<string, unknown> {
  return {
    schemaVersion: MENU_CATALOG_SCHEMA_VERSION,
    scope: { restaurantId, branchId },
    target: "product",
    targetId: productId,
    contentType: "image/jpeg",
    dataBase64: "/9j/4AAQSkZJRgABAQEASABIAAD/",
    eventId: "9e113c0b-9f7f-4e8d-8d1e-9b6a7c1b0001",
    idempotencyKey: "9e113c0b-9f7f-4e8d-8d1e-9b6a7c1b0002",
    deviceId: "9e113c0b-9f7f-4e8d-8d1e-9b6a7c1b0003",
    occurredAt: "2026-10-04T00:00:00.000Z",
  };
}

const uploadParsed = parseUploadMenuImageCommandV1(uploadCommand());
expectDefined(uploadParsed, "valid upload-menu-image command parses");
expect(Object.isFrozen(uploadParsed), "upload command is frozen");
expect(parseUploadMenuImageCommandV1({ ...uploadCommand(), target: "option" }) !== undefined, "option target is accepted");
expect(parseUploadMenuImageCommandV1({ ...uploadCommand(), target: "ingredient" }) === undefined, "unknown target is rejected");
expect(parseUploadMenuImageCommandV1({ ...uploadCommand(), contentType: "image/gif" }) === undefined, "unsupported content type is rejected");
expect(parseUploadMenuImageCommandV1({ ...uploadCommand(), dataBase64: "" }) === undefined, "empty payload is rejected");
expect(parseUploadMenuImageCommandV1({ ...uploadCommand(), dataBase64: "not base64 at all!" }) === undefined, "non-base64 payload is rejected");
expect(parseUploadMenuImageCommandV1({ ...uploadCommand(), dataBase64: "A".repeat(3_000_000) }) === undefined, "oversized payload is rejected");
expect(parseUploadMenuImageCommandV1({ ...uploadCommand(), unexpected: true }) === undefined, "extra upload command field is rejected");

expect(parseMenuCatalogStateV1({ schemaVersion: 1, scope: parsed.scope, catalog: undefined }) === undefined, "undefined catalog state is rejected");
expect(parseMenuCatalogV1({ ...response, version: 0 }) === undefined, "non-positive response version is rejected");
