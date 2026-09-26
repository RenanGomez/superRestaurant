import assert from "node:assert/strict";
import test from "node:test";

import type { ConfiguredCatalogRelease } from "./configured-catalog.js";
import {
  materializeConfiguredOrderItemSnapshot,
  resolveProductConfiguration,
  type ConfiguredProductSelectionInput,
} from "./configured-selection.js";
import { Money } from "./money.js";

const release = (): ConfiguredCatalogRelease => ({
  catalogVersion: "catalog-v2",
  categories: [{
    active: true,
    catalogVersion: "catalog-v2",
    displayOrder: 1,
    id: "pizza",
    name: "Pizza",
    restaurantId: "restaurant-1",
  }],
  currency: "MXN",
  modifierTemplates: [
    {
      active: true,
      catalogVersion: "catalog-v2",
      id: "template-dough",
      name: "Masa",
      options: [
        { active: true, id: "thin", maximumQuantity: 1, name: "Delgada" },
        { active: true, id: "pan", maximumQuantity: 1, name: "Pan" },
      ],
      restaurantId: "restaurant-1",
    },
    {
      active: true,
      catalogVersion: "catalog-v2",
      id: "template-edge",
      name: "Orilla",
      options: [
        { active: true, id: "regular", maximumQuantity: 1, name: "Regular" },
        { active: true, id: "stuffed", maximumQuantity: 1, name: "Rellena" },
      ],
      restaurantId: "restaurant-1",
    },
  ],
  products: [{
    active: true,
    catalogVersion: "catalog-v2",
    categoryId: "pizza",
    displayOrder: 1,
    id: "pizza-product",
    name: "Pizza de especialidad",
    restaurantId: "restaurant-1",
    tax: {
      inclusion: "excluded",
      name: "IVA",
      rate: { denominator: 100n, numerator: 16n },
      taxId: "mx-vat",
      taxRuleVersion: "mx-v1",
    },
    variantIds: ["pizza-large"],
  }],
  restaurantId: "restaurant-1",
  variants: [{
    active: true,
    catalogVersion: "catalog-v2",
    constraints: [{
      id: "pan-excludes-stuffed",
      kind: "excludes",
      source: { groupId: "dough-large", optionId: "pan" },
      target: { groupId: "edge-large", optionId: "stuffed" },
    }],
    displayOrder: 1,
    id: "pizza-large",
    modifierGroups: [
      {
        binding: {
          active: true,
          groupId: "dough-large",
          maximumQuantity: 1,
          minimumQuantity: 1,
          name: "Elige masa",
          options: [
            { defaultQuantity: 1, optionId: "thin", unitPrice: new Money(0, "MXN") },
            { defaultQuantity: 0, optionId: "pan", unitPrice: new Money(1_500, "MXN") },
          ],
          productId: "pizza-product",
        },
        templateId: "template-dough",
      },
      {
        binding: {
          active: true,
          groupId: "edge-large",
          maximumQuantity: 1,
          minimumQuantity: 1,
          name: "Elige orilla",
          options: [
            { defaultQuantity: 1, optionId: "regular", unitPrice: new Money(0, "MXN") },
            { defaultQuantity: 0, optionId: "stuffed", unitPrice: new Money(3_000, "MXN") },
          ],
          productId: "pizza-product",
        },
        templateId: "template-edge",
      },
    ],
    name: "Grande",
    productId: "pizza-product",
    recipeVersion: "pizza-recipe-v3",
    restaurantId: "restaurant-1",
    sku: "PIZZA-LARGE",
    stationId: "pizza-station",
    unit: "piece",
    unitPrice: new Money(20_000, "MXN"),
  }],
});

const input = (): ConfiguredProductSelectionInput => ({
  catalogVersion: "catalog-v2",
  modifierGroups: [],
  productId: "pizza-product",
  restaurantId: "restaurant-1",
  variantId: "pizza-large",
});

test("resolves omitted groups from published defaults and keeps exact separated totals", () => {
  const result = resolveProductConfiguration(release(), input());

  assert.equal(result.valid, true);
  assert.equal(result.configuration.modifierGroups.length, 2);
  assert.deepEqual(
    result.configuration.modifierGroups.flatMap((group) => group.modifiers.map(({ modifierId }) => modifierId)),
    ["thin", "regular"],
  );
  assert.equal(result.configuration.unitPrice.amountMinor, 20_000);
  assert.equal(result.configuration.modifierTotal.amountMinor, 0);
  assert.equal(Object.isFrozen(result.configuration), true);
});

test("explicit valid choices override defaults and materialize the existing historical price shape", () => {
  const selected: ConfiguredProductSelectionInput = {
    ...input(),
    modifierGroups: [
      { groupId: "dough-large", selections: [{ optionId: "pan", quantity: 1 }] },
      { groupId: "edge-large", selections: [{ optionId: "regular", quantity: 1 }] },
    ],
  };
  const result = resolveProductConfiguration(release(), selected);
  const snapshot = materializeConfiguredOrderItemSnapshot(release(), selected);

  assert.equal(result.valid, true);
  assert.equal(result.configuration.modifierTotal.amountMinor, 1_500);
  assert.equal(snapshot.productId, "pizza-product");
  assert.equal(snapshot.variantId, "pizza-large");
  assert.equal(snapshot.variantName, "Grande");
  assert.equal(snapshot.recipeVersion, "pizza-recipe-v3");
  assert.equal(snapshot.tax?.taxRuleVersion, "mx-v1");
  assert.equal(snapshot.tax?.rate.numerator, 16n);
  assert.equal(snapshot.unitPrice.amountMinor, 20_000);
  assert.deepEqual(snapshot.modifiers.map(({ modifierId }) => modifierId), ["pan", "regular"]);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("returns stable issues for structurally valid but incompatible choices and refuses materialization", () => {
  const selected: ConfiguredProductSelectionInput = {
    ...input(),
    modifierGroups: [
      { groupId: "dough-large", selections: [{ optionId: "pan", quantity: 1 }] },
      { groupId: "edge-large", selections: [{ optionId: "stuffed", quantity: 1 }] },
    ],
  };
  const result = resolveProductConfiguration(release(), selected);

  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map(({ code }) => code), ["excluded_option_selected"]);
  assert.equal(result.configuration.modifierTotal.amountMinor, 4_500);
  assert.throws(() => materializeConfiguredOrderItemSnapshot(release(), selected));
});

test("rejects cross-scope, inactive, unknown and duplicated group selections", () => {
  assert.throws(() => resolveProductConfiguration(release(), { ...input(), restaurantId: "restaurant-2" }));
  assert.throws(() => resolveProductConfiguration(release(), { ...input(), variantId: "missing" }));
  assert.throws(() => resolveProductConfiguration(release(), {
    ...input(),
    modifierGroups: [{ groupId: "missing", selections: [] }],
  }));
  assert.throws(() => resolveProductConfiguration(release(), {
    ...input(),
    modifierGroups: [
      { groupId: "dough-large", selections: [{ optionId: "thin", quantity: 1 }] },
      { groupId: "dough-large", selections: [{ optionId: "thin", quantity: 1 }] },
    ],
  }));
  const inactive = release();
  assert.throws(() => resolveProductConfiguration({
    ...inactive,
    products: [{ ...inactive.products[0]!, active: false }],
  }, input()));
});

test("selection boundaries reject malformed quantities, accessors and hostile proxies", () => {
  assert.throws(() => resolveProductConfiguration(release(), {
    ...input(),
    modifierGroups: [{ groupId: "dough-large", selections: [{ optionId: "thin", quantity: 0 }] }],
  }));
  let invoked = false;
  const hostile = input() as unknown as Record<string, unknown>;
  Object.defineProperty(hostile, "variantId", {
    enumerable: true,
    get: () => {
      invoked = true;
      return "pizza-large";
    },
  });
  assert.throws(() => resolveProductConfiguration(release(), hostile as unknown as ConfiguredProductSelectionInput));
  assert.equal(invoked, false);
  assert.throws(() => resolveProductConfiguration(release(), new Proxy(input(), {
    getPrototypeOf() { throw new Error("hostile"); },
  })));
});
