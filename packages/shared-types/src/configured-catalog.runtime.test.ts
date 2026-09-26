import {
  CONFIGURED_CATALOG_SCHEMA_VERSION,
  CONFIGURED_SELECTION_SCHEMA_VERSION,
  parseConfiguredCatalogReleaseV2,
  parseResolveConfiguredProductSelectionV2,
} from "./index.js";

const ids = {
  branch: "00000000-0000-4000-8000-000000000001",
  catalog: "00000000-0000-4000-8000-000000000002",
  category: "00000000-0000-4000-8000-000000000003",
  constraint: "00000000-0000-4000-8000-000000000004",
  groupDough: "00000000-0000-4000-8000-000000000005",
  groupEdge: "00000000-0000-4000-8000-000000000006",
  optionPan: "00000000-0000-4000-8000-000000000007",
  optionRegular: "00000000-0000-4000-8000-000000000008",
  optionStuffed: "00000000-0000-4000-8000-000000000009",
  optionThin: "00000000-0000-4000-8000-00000000000a",
  product: "00000000-0000-4000-8000-00000000000b",
  restaurant: "00000000-0000-4000-8000-00000000000c",
  templateDough: "00000000-0000-4000-8000-00000000000d",
  templateEdge: "00000000-0000-4000-8000-00000000000e",
  variant: "00000000-0000-4000-8000-00000000000f",
} as const;

function release(): Record<string, unknown> {
  return {
    schemaVersion: CONFIGURED_CATALOG_SCHEMA_VERSION,
    restaurantId: ids.restaurant,
    catalogVersion: ids.catalog,
    currency: "MXN",
    categories: [{ categoryId: ids.category, name: "Pizza", active: true, displayOrder: 1 }],
    products: [{
      productId: ids.product,
      categoryId: ids.category,
      name: "Pizza de especialidad",
      active: true,
      displayOrder: 1,
      tax: {
        taxId: "mx-vat",
        name: "IVA",
        taxRuleVersion: "mx-v1",
        rateNumerator: 16,
        rateDenominator: 100,
        inclusion: "excluded",
      },
      variantIds: [ids.variant],
    }],
    modifierTemplates: [
      {
        templateId: ids.templateDough,
        name: "Masa",
        active: true,
        options: [
          { optionId: ids.optionThin, name: "Delgada", active: true, maximumQuantity: 1 },
          { optionId: ids.optionPan, name: "Pan", active: true, maximumQuantity: 1 },
        ],
      },
      {
        templateId: ids.templateEdge,
        name: "Orilla",
        active: true,
        options: [
          { optionId: ids.optionRegular, name: "Regular", active: true, maximumQuantity: 1 },
          { optionId: ids.optionStuffed, name: "Rellena", active: true, maximumQuantity: 1 },
        ],
      },
    ],
    variants: [{
      variantId: ids.variant,
      productId: ids.product,
      name: "Grande",
      sku: "PIZZA-LARGE",
      active: true,
      displayOrder: 1,
      stationId: "pizza-station",
      recipeVersion: "pizza-recipe-v3",
      unit: "piece",
      unitPriceMinor: 20_000,
      modifierGroups: [
        {
          templateId: ids.templateDough,
          groupId: ids.groupDough,
          name: "Elige masa",
          active: true,
          minimumQuantity: 1,
          maximumQuantity: 1,
          options: [
            { optionId: ids.optionThin, unitPriceMinor: 0, maximumQuantity: 1, defaultQuantity: 1 },
            { optionId: ids.optionPan, unitPriceMinor: 1_500, maximumQuantity: 1, defaultQuantity: 0 },
          ],
        },
        {
          templateId: ids.templateEdge,
          groupId: ids.groupEdge,
          name: "Elige orilla",
          active: true,
          minimumQuantity: 1,
          maximumQuantity: 1,
          options: [
            { optionId: ids.optionRegular, unitPriceMinor: 0, maximumQuantity: 1, defaultQuantity: 1 },
            { optionId: ids.optionStuffed, unitPriceMinor: 3_000, maximumQuantity: 1, defaultQuantity: 0 },
          ],
        },
      ],
      constraints: [{
        constraintId: ids.constraint,
        kind: "excludes",
        source: { groupId: ids.groupDough, optionId: ids.optionPan },
        target: { groupId: ids.groupEdge, optionId: ids.optionStuffed },
      }],
    }],
  };
}

function selection(): Record<string, unknown> {
  return {
    schemaVersion: CONFIGURED_SELECTION_SCHEMA_VERSION,
    scope: { restaurantId: ids.restaurant, branchId: ids.branch },
    expectedCatalogVersion: ids.catalog,
    productId: ids.product,
    variantId: ids.variant,
    modifierGroups: [{
      groupId: ids.groupDough,
      selections: [{ optionId: ids.optionPan, quantity: 1 }],
    }],
  };
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectDefined<T>(value: T | undefined, message: string): asserts value is T {
  expect(value !== undefined, message);
}

const parsedRelease = parseConfiguredCatalogReleaseV2(release());
expectDefined(parsedRelease, "valid configured release parses");
expect(Object.isFrozen(parsedRelease), "release is frozen");
expect(Object.isFrozen(parsedRelease.products[0]?.tax), "tax is frozen");
expect(Object.isFrozen(parsedRelease.variants[0]?.modifierGroups[0]?.options), "variant options are frozen");
expect(parsedRelease.variants[0]?.unitPriceMinor === 20_000, "money stays in transport minor units");
expect(!("unitPrice" in (parsedRelease.variants[0] ?? {})), "domain Money is never exposed in transport");

const parsedSelection = parseResolveConfiguredProductSelectionV2(selection());
expectDefined(parsedSelection, "valid configured selection parses");
expect(Object.isFrozen(parsedSelection.scope), "selection scope is frozen");
expect(Object.isFrozen(parsedSelection.modifierGroups[0]?.selections), "selection options are frozen");

expect(parseConfiguredCatalogReleaseV2({ ...release(), schemaVersion: 1 }) === undefined, "V1 is not accepted as V2");
expect(parseConfiguredCatalogReleaseV2({ ...release(), currency: "mxn" }) === undefined, "currency is canonical");
expect(parseConfiguredCatalogReleaseV2({ ...release(), unexpected: true }) === undefined, "extra release fields fail closed");
const extraArrayProperty = release();
(extraArrayProperty.categories as unknown[] & { hidden?: boolean }).hidden = true;
expect(parseConfiguredCatalogReleaseV2(extraArrayProperty) === undefined, "extra array fields fail closed");

const missingVariant = release();
missingVariant.variants = [];
expect(parseConfiguredCatalogReleaseV2(missingVariant) === undefined, "every listed variant must exist");

const unknownTemplate = release();
unknownTemplate.variants = [{
  ...(unknownTemplate.variants as Record<string, unknown>[])[0],
  modifierGroups: [{
    ...(((unknownTemplate.variants as Record<string, unknown>[])[0]?.modifierGroups as Record<string, unknown>[])[0]),
    templateId: ids.category,
  }],
}];
expect(parseConfiguredCatalogReleaseV2(unknownTemplate) === undefined, "group template references resolve");

const invalidDefault = release();
invalidDefault.variants = [{
  ...(invalidDefault.variants as Record<string, unknown>[])[0],
  modifierGroups: [{
    ...(((invalidDefault.variants as Record<string, unknown>[])[0]?.modifierGroups as Record<string, unknown>[])[0]),
    options: [{ optionId: ids.optionThin, unitPriceMinor: 0, maximumQuantity: 2, defaultQuantity: 2 }],
  }],
}];
expect(parseConfiguredCatalogReleaseV2(invalidDefault) === undefined, "default quantities obey group and template caps");

const danglingConstraint = release();
danglingConstraint.variants = [{
  ...(danglingConstraint.variants as Record<string, unknown>[])[0],
  constraints: [{
    constraintId: ids.constraint,
    kind: "requires",
    source: { groupId: ids.groupDough, optionId: ids.optionPan },
    target: { groupId: ids.groupEdge, optionId: ids.optionThin },
  }],
}];
expect(parseConfiguredCatalogReleaseV2(danglingConstraint) === undefined, "constraint references are variant-local");

expect(parseResolveConfiguredProductSelectionV2({ ...selection(), schemaVersion: 1 }) === undefined, "selection version is exact");
expect(parseResolveConfiguredProductSelectionV2({ ...selection(), expectedCatalogVersion: "current" }) === undefined, "catalog version is UUID");
expect(parseResolveConfiguredProductSelectionV2({
  ...selection(),
  modifierGroups: [
    ...(selection().modifierGroups as readonly unknown[]),
    ...(selection().modifierGroups as readonly unknown[]),
  ],
}) === undefined, "selection group IDs are unique");

let invoked = false;
const accessor = release();
Object.defineProperty(accessor, "currency", {
  enumerable: true,
  get: () => {
    invoked = true;
    return "MXN";
  },
});
expect(parseConfiguredCatalogReleaseV2(accessor) === undefined, "accessors are rejected");
expect(!invoked, "accessors are not invoked");
expect(parseConfiguredCatalogReleaseV2(new Proxy(release(), {
  ownKeys: () => { throw new Error("hostile"); },
})) === undefined, "hostile release proxy fails closed");
expect(parseResolveConfiguredProductSelectionV2(new Proxy(selection(), {
  getPrototypeOf: () => { throw new Error("hostile"); },
})) === undefined, "hostile selection proxy fails closed");
