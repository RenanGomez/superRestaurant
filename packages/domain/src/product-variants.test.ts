import assert from "node:assert/strict";
import test from "node:test";

import { Money } from "./money.js";
import { createModifierSelectionSnapshot } from "./modifiers.js";
import {
  instantiateProductVariantCatalog,
  type ProductVariantCatalog,
} from "./product-variants.js";
import type { ModifierGroupTemplateCatalog } from "./modifier-templates.js";

const templates = (): readonly ModifierGroupTemplateCatalog[] => [
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
];

const variant = (id = "pizza-large"): ProductVariantCatalog => ({
  active: true,
  catalogVersion: "catalog-v2",
  constraints: [{
    id: "pan-excludes-stuffed",
    kind: "excludes",
    source: { groupId: `dough-${id}`, optionId: "pan" },
    target: { groupId: `edge-${id}`, optionId: "stuffed" },
  }],
  displayOrder: 1,
  id,
  modifierGroups: [
    {
      binding: {
        active: true,
        groupId: `dough-${id}`,
        maximumQuantity: 1,
        minimumQuantity: 1,
        name: "Elige masa",
        options: [
          { defaultQuantity: 1, optionId: "thin", unitPrice: new Money(0, "MXN") },
          { defaultQuantity: 0, optionId: "pan", unitPrice: new Money(1_500, "MXN") },
        ],
        productId: "pizza",
      },
      templateId: "template-dough",
    },
    {
      binding: {
        active: true,
        groupId: `edge-${id}`,
        maximumQuantity: 1,
        minimumQuantity: 1,
        name: "Elige orilla",
        options: [
          { defaultQuantity: 1, optionId: "regular", unitPrice: new Money(0, "MXN") },
          { defaultQuantity: 0, optionId: "stuffed", unitPrice: new Money(3_000, "MXN") },
        ],
        productId: "pizza",
      },
      templateId: "template-edge",
    },
  ],
  name: id === "pizza-large" ? "Grande" : "Mediana",
  productId: "pizza",
  recipeVersion: "pizza-recipe-v3",
  restaurantId: "restaurant-1",
  sku: id.toUpperCase(),
  stationId: "pizza-station",
  unit: "piece",
  unitPrice: new Money(id === "pizza-large" ? 20_000 : 15_000, "MXN"),
});

test("instantiates a variant through reusable templates, exact money and compatible defaults", () => {
  const source = variant();
  const result = instantiateProductVariantCatalog(templates(), source);

  assert.equal(result.id, "pizza-large");
  assert.equal(result.unitPrice.amountMinor, 20_000);
  assert.equal(result.modifierGroups.length, 2);
  assert.equal(result.defaultConstraintResolution.valid, true);
  assert.equal(result.constraintCatalog.groups[0]?.groupId, "dough-pizza-large");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.modifierGroups), true);

  const dough = result.modifierGroups[0]!;
  const snapshot = createModifierSelectionSnapshot(
    dough,
    { productId: result.productId, restaurantId: result.restaurantId },
    dough.defaultSelections,
  );
  assert.equal(snapshot.modifiers[0]?.modifierId, "thin");
  assert.equal(snapshot.total.amountMinor, 0);
  assert.equal(source.modifierGroups[0]?.binding.name, "Elige masa");
});

test("the same templates produce variant-specific identities, base prices and surcharges", () => {
  const medium = variant("pizza-medium");
  const adjusted: ProductVariantCatalog = {
    ...medium,
    modifierGroups: medium.modifierGroups.map((entry) => entry.templateId === "template-edge"
      ? {
          ...entry,
          binding: {
            ...entry.binding,
            options: entry.binding.options.map((option) => option.optionId === "stuffed"
              ? { ...option, unitPrice: new Money(2_000, "MXN") }
              : option),
          },
        }
      : entry),
  };
  const result = instantiateProductVariantCatalog(templates(), adjusted);
  assert.equal(result.unitPrice.amountMinor, 15_000);
  assert.equal(result.modifierGroups[1]?.options[1]?.unitPrice.amountMinor, 2_000);
  assert.equal(result.modifierGroups[1]?.productId, "pizza");
});

test("publication rejects missing templates, divergent scope/version and duplicate group instances", () => {
  assert.throws(() => instantiateProductVariantCatalog(templates(), {
    ...variant(),
    modifierGroups: [{ ...variant().modifierGroups[0]!, templateId: "missing" }],
  }));
  assert.throws(() => instantiateProductVariantCatalog([
    { ...templates()[0]!, restaurantId: "restaurant-2" },
  ], variant()));
  assert.throws(() => instantiateProductVariantCatalog([
    { ...templates()[0]!, catalogVersion: "catalog-v3" },
  ], variant()));
  assert.throws(() => instantiateProductVariantCatalog(templates(), {
    ...variant(),
    modifierGroups: [variant().modifierGroups[0]!, variant().modifierGroups[0]!],
  }));
});

test("publication rejects product mismatch, invalid money and cross-currency surcharges", () => {
  const first = variant().modifierGroups[0]!;
  assert.throws(() => instantiateProductVariantCatalog(templates(), {
    ...variant(),
    modifierGroups: [{ ...first, binding: { ...first.binding, productId: "other" } }],
  }));
  assert.throws(() => instantiateProductVariantCatalog(templates(), {
    ...variant(),
    unitPrice: new Money(-1, "MXN"),
  }));
  assert.throws(() => instantiateProductVariantCatalog(templates(), {
    ...variant(),
    modifierGroups: [{
      ...first,
      binding: {
        ...first.binding,
        options: first.binding.options.map((option) => ({ ...option, unitPrice: new Money(0, "USD") })),
      },
    }],
  }));
});

test("publication rejects defaults that violate variant constraints", () => {
  const current = variant();
  assert.throws(() => instantiateProductVariantCatalog(templates(), {
    ...current,
    constraints: [{
      id: "thin-needs-stuffed",
      kind: "requires",
      source: { groupId: "dough-pizza-large", optionId: "thin" },
      target: { groupId: "edge-pizza-large", optionId: "stuffed" },
    }],
  }));
});

test("variant boundaries reject accessors and hostile proxies without invoking nested values", () => {
  let invoked = false;
  const hostileConstraint = {} as Record<string, unknown>;
  Object.defineProperty(hostileConstraint, "kind", {
    enumerable: true,
    get: () => {
      invoked = true;
      return "requires";
    },
  });
  assert.throws(() => instantiateProductVariantCatalog(templates(), {
    ...variant(),
    constraints: [hostileConstraint as never],
  }));
  assert.equal(invoked, false);
  assert.throws(() => instantiateProductVariantCatalog(templates(), new Proxy(variant(), {
    getPrototypeOf() { throw new Error("hostile"); },
  })));
});
