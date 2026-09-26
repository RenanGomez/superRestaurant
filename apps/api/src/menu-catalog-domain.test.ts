import assert from "node:assert/strict";
import test from "node:test";

import { validateConfiguredCatalogRelease } from "@super-restaurant/domain";
import {
  CONFIGURED_CATALOG_SCHEMA_VERSION,
  CONFIGURED_SELECTION_SCHEMA_VERSION,
  parseConfiguredCatalogReleaseV2,
} from "@super-restaurant/shared-types";

import {
  toDomainConfiguredCatalog,
  toDomainConfiguredSelection,
  toTransportConfiguredCatalog,
  toTransportConfiguredSelection,
} from "./menu-catalog-domain.js";

const ids = {
  branch: "00000000-0000-4000-8000-000000000001",
  catalog: "00000000-0000-4000-8000-000000000002",
  category: "00000000-0000-4000-8000-000000000003",
  constraint: "00000000-0000-4000-8000-000000000004",
  group: "00000000-0000-4000-8000-000000000005",
  optionA: "00000000-0000-4000-8000-000000000006",
  optionB: "00000000-0000-4000-8000-000000000007",
  product: "00000000-0000-4000-8000-000000000008",
  restaurant: "00000000-0000-4000-8000-000000000009",
  template: "00000000-0000-4000-8000-00000000000a",
  variant: "00000000-0000-4000-8000-00000000000b",
} as const;

function transportRelease(): Record<string, unknown> {
  return {
    schemaVersion: CONFIGURED_CATALOG_SCHEMA_VERSION,
    restaurantId: ids.restaurant,
    catalogVersion: ids.catalog,
    currency: "MXN",
    categories: [{ categoryId: ids.category, name: "Pizza", active: true, displayOrder: 1 }],
    products: [{
      productId: ids.product,
      categoryId: ids.category,
      name: "Pizza",
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
    modifierTemplates: [{
      templateId: ids.template,
      name: "Extras",
      active: true,
      options: [
        { optionId: ids.optionA, name: "A", active: true, maximumQuantity: 2 },
        { optionId: ids.optionB, name: "B", active: true, maximumQuantity: 1 },
      ],
    }],
    variants: [{
      variantId: ids.variant,
      productId: ids.product,
      name: "Grande",
      sku: "PIZZA-G",
      active: true,
      displayOrder: 1,
      stationId: "pizza-station",
      recipeVersion: "recipe-v1",
      unit: "piece",
      unitPriceMinor: 20_000,
      modifierGroups: [{
        templateId: ids.template,
        groupId: ids.group,
        name: "Extras",
        active: true,
        minimumQuantity: 1,
        maximumQuantity: 2,
        options: [
          { optionId: ids.optionA, unitPriceMinor: 0, maximumQuantity: 1, defaultQuantity: 1 },
          { optionId: ids.optionB, unitPriceMinor: 1_500, maximumQuantity: 1, defaultQuantity: 0 },
        ],
      }],
      constraints: [{
        constraintId: ids.constraint,
        kind: "requires",
        source: { groupId: ids.group, optionId: ids.optionB },
        target: { groupId: ids.group, optionId: ids.optionA },
      }],
    }],
  };
}

test("configured release transport maps to domain with exact money, fiscal facts, caps and constraints", () => {
  const domain = toDomainConfiguredCatalog(transportRelease());
  const validated = validateConfiguredCatalogRelease(domain);

  assert.equal(validated.variants[0]?.unitPrice.amountMinor, 20_000);
  assert.equal(validated.variants[0]?.modifierGroups[0]?.options[1]?.unitPrice.amountMinor, 1_500);
  assert.equal(validated.variants[0]?.modifierGroups[0]?.options[0]?.maximumQuantity, 1);
  assert.equal(validated.variants[0]?.constraintCatalog.constraints[0]?.kind, "requires");
  assert.equal(validated.products[0]?.tax?.rate.numerator, 16n);
  assert.equal(Object.isFrozen(domain), true);
});

test("configured release round-trip preserves effective domain semantics without exposing Money", () => {
  const domain = toDomainConfiguredCatalog(transportRelease());
  const transport = toTransportConfiguredCatalog(domain);
  const reparsed = parseConfiguredCatalogReleaseV2(transport);
  const roundTrip = toDomainConfiguredCatalog(transport);

  assert.notEqual(reparsed, undefined);
  assert.equal(transport.variants[0]?.unitPriceMinor, 20_000);
  assert.equal("unitPrice" in (transport.variants[0] ?? {}), false);
  assert.equal(transport.products[0]?.tax?.rateDenominator, 100);
  assert.equal(transport.variants[0]?.modifierGroups[0]?.options[0]?.maximumQuantity, 1);
  assert.equal(validateConfiguredCatalogRelease(roundTrip).variants[0]?.defaultConstraintResolution.valid, true);
});

test("configured selection preserves Branch scope while mapping the domain command both ways", () => {
  const transport = {
    expectedCatalogVersion: ids.catalog,
    modifierGroups: [{
      groupId: ids.group,
      selections: [{ optionId: ids.optionB, quantity: 1 }],
    }],
    productId: ids.product,
    schemaVersion: CONFIGURED_SELECTION_SCHEMA_VERSION,
    scope: { branchId: ids.branch, restaurantId: ids.restaurant },
    variantId: ids.variant,
  };
  const domain = toDomainConfiguredSelection(transport);
  const serialized = toTransportConfiguredSelection(domain.selection, domain.branchId);

  assert.equal(domain.branchId, ids.branch);
  assert.equal(domain.selection.restaurantId, ids.restaurant);
  assert.deepEqual(serialized, transport);
  assert.equal(Object.isFrozen(domain.selection.modifierGroups), true);
});

test("adapter boundaries reject unparsed transport and non-transportable domain identity", () => {
  assert.throws(() => toDomainConfiguredCatalog({ ...transportRelease(), currency: "mxn" }));
  const domain = toDomainConfiguredCatalog(transportRelease());
  assert.throws(() => toTransportConfiguredCatalog({ ...domain, catalogVersion: "draft" }));
  assert.throws(() => toDomainConfiguredSelection({ schemaVersion: CONFIGURED_SELECTION_SCHEMA_VERSION }));
  assert.throws(() => toTransportConfiguredSelection({
    catalogVersion: ids.catalog,
    modifierGroups: [],
    productId: ids.product,
    restaurantId: ids.restaurant,
    variantId: ids.variant,
  }, "not-a-uuid"));
});
