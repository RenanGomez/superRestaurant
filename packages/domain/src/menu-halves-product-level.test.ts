import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogVariantToFractionVariant,
  createMenuProductPriceSnapshot,
  FRACTION_CUSTOM_FLAVOR_ID,
  FRACTION_CUSTOM_FLAVOR_NAME,
  InvalidSnapshotError,
  MenuFractionSelectionInvalidError,
  Money,
  validateMenuCatalog,
} from "./index.js";
import type { MenuCatalog, MenuFractionSelection, MenuProductFractionConfig } from "./index.js";

const R = "restaurant-1";
const V = "menu-v10";

const enabled: MenuProductFractionConfig = {
  enabled: true,
  excludableIngredientIds: ["cebolla"],
  extraGroupId: "ingredients",
  flavorGroupId: "flavors",
};

interface CatalogOptions {
  /** Product-level setup; `null` leaves the product without one. */
  readonly productFraction?: MenuProductFractionConfig | null;
  /** Legacy per-size setup of the single size, when `sized` is true. */
  readonly variantFraction?: MenuProductFractionConfig;
  readonly sized?: boolean;
}

function pizzaCatalog(options: CatalogOptions = {}): MenuCatalog {
  const productFraction = options.productFraction === undefined ? enabled : options.productFraction;
  return {
    restaurantId: R,
    catalogVersion: V,
    currency: "MXN",
    categories: [{ id: "food", restaurantId: R, catalogVersion: V, name: "Food", active: true, displayOrder: 0 }],
    products: [{
      id: "pizza",
      restaurantId: R,
      catalogVersion: V,
      categoryId: "food",
      name: "Pizza",
      active: true,
      displayOrder: 0,
      stationId: "oven",
      unit: "each",
      unitPrice: new Money(12_000, "MXN"),
      modifierGroupIds: ["flavors", "ingredients"],
      ...(options.sized === true ? {
        variants: [{
          id: "large",
          name: "Grande",
          active: true,
          displayOrder: 0,
          unitPrice: new Money(15_000, "MXN"),
          ...(options.variantFraction === undefined ? {} : { fraction: options.variantFraction }),
        }],
      } : {}),
      ...(productFraction === null ? {} : { fraction: productFraction }),
    }],
    modifierGroups: [
      {
        id: "flavors", restaurantId: R, name: "Sabor", catalogVersion: V, productId: "pizza", active: true,
        minimumQuantity: 0, maximumQuantity: 2,
        options: [
          { id: "pepperoni", name: "Pepperoni", unitPrice: new Money(0, "MXN"), active: true },
          { id: "hawaiana", name: "Hawaiana", unitPrice: new Money(17_000, "MXN"), active: true },
        ],
      },
      {
        id: "ingredients", restaurantId: R, name: "Ingredientes", catalogVersion: V, productId: "pizza", active: true,
        minimumQuantity: 0, maximumQuantity: 5,
        options: [
          { id: "queso", name: "Queso", unitPrice: new Money(2_501, "MXN"), active: true },
          { id: "jamon", name: "Jamon", unitPrice: new Money(2_000, "MXN"), active: true },
        ],
      },
    ],
  };
}

type Half = { flavor: string | null; extras?: string[]; excluded?: string[] };

function halves(a: Half, b: Half): MenuFractionSelection {
  return {
    geometry: "halves",
    slots: [
      { excludedIngredientIds: a.excluded ?? [], extraOptionIds: a.extras ?? [], flavorOptionId: a.flavor, fraction: "half-a" },
      { excludedIngredientIds: b.excluded ?? [], extraOptionIds: b.extras ?? [], flavorOptionId: b.flavor, fraction: "half-b" },
    ],
  };
}

const context = (fraction: MenuFractionSelection | null, variantId: string | null = null) => ({
  currency: "MXN", fraction, productId: "pizza", restaurantId: R, variantId,
});

function issueCodes(catalog: MenuCatalog, fraction: MenuFractionSelection, variantId: string | null = null): readonly string[] {
  try {
    createMenuProductPriceSnapshot(catalog, context(fraction, variantId));
  } catch (error) {
    assert.ok(error instanceof MenuFractionSelectionInvalidError);
    return error.issueCodes;
  }
  return assert.fail("expected a rejection");
}

test("a product without sizes sells half and half at the greater half, using the product price for zero-priced flavors", () => {
  const snapshot = createMenuProductPriceSnapshot(
    pizzaCatalog(),
    context(halves({ flavor: "pepperoni" }, { flavor: "hawaiana" })),
  );
  assert.equal(snapshot.unitPrice.amountMinor, 17_000);
  assert.deepEqual(snapshot.fractionBreakdown, [
    { amountMinor: 12_000, flavorName: "Pepperoni", flavorOptionId: "pepperoni", fraction: "half-a" },
    { amountMinor: 17_000, flavorName: "Hawaiana", flavorOptionId: "hawaiana", fraction: "half-b" },
  ]);
  assert.equal(snapshot.geometry, "halves");
  assert.equal(snapshot.variantId, undefined);
  assert.equal(snapshot.variantName, undefined);
});

test("a sized product uses the chosen size price from the product-level setup", () => {
  const snapshot = createMenuProductPriceSnapshot(
    pizzaCatalog({ sized: true }),
    context(halves({ flavor: "pepperoni" }, { flavor: "pepperoni" }), "large"),
  );
  assert.equal(snapshot.unitPrice.amountMinor, 15_000);
  assert.equal(snapshot.variantId, "large");
  assert.equal(snapshot.variantName, "Grande");
});

test("a half built ingredient by ingredient costs the base price and its ingredients are charged at half, rounded up", () => {
  const snapshot = createMenuProductPriceSnapshot(
    pizzaCatalog(),
    context(halves({ flavor: null, extras: ["queso", "jamon"], excluded: ["cebolla"] }, { flavor: "pepperoni" })),
  );
  // Both halves are priced at the 12000 product price: the custom one and the zero-priced flavor.
  assert.equal(snapshot.unitPrice.amountMinor, 12_000);
  assert.deepEqual(snapshot.fractionBreakdown, [
    { amountMinor: 12_000, flavorName: FRACTION_CUSTOM_FLAVOR_NAME, flavorOptionId: FRACTION_CUSTOM_FLAVOR_ID, fraction: "half-a" },
    { amountMinor: 12_000, flavorName: "Pepperoni", flavorOptionId: "pepperoni", fraction: "half-b" },
  ]);
  const charges = snapshot.modifiers.map((modifier) => [modifier.modifierId, modifier.unitPrice.amountMinor]);
  // 2501 / 2 = 1250.5 rounds up to 1251; 2000 / 2 = 1000; exclusions are zero-priced markers.
  assert.deepEqual(charges, [["extra:half-a:queso", 1_251], ["extra:half-a:jamon", 1_000], ["exclude:half-a:cebolla", 0]]);
});

test("a custom half on a sized product takes the size price and the other half may out-price it", () => {
  const sized = pizzaCatalog({ sized: true });
  const customFirst = createMenuProductPriceSnapshot(sized, context(halves({ flavor: null }, { flavor: "pepperoni" }), "large"));
  assert.equal(customFirst.unitPrice.amountMinor, 15_000);
  const customSecond = createMenuProductPriceSnapshot(sized, context(halves({ flavor: "hawaiana" }, { flavor: null }), "large"));
  assert.equal(customSecond.unitPrice.amountMinor, 17_000);
  assert.deepEqual(customSecond.fractionBreakdown?.map((entry) => entry.amountMinor), [17_000, 15_000]);
});

test("two custom halves are rejected as fraction_both_custom", () => {
  assert.deepEqual(issueCodes(pizzaCatalog(), halves({ flavor: null }, { flavor: null })), ["fraction_both_custom"]);
});

test("a custom half needs an ingredient group", () => {
  const withoutIngredients = pizzaCatalog({
    productFraction: { enabled: true, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: "flavors" },
  });
  assert.deepEqual(
    issueCodes(withoutIngredients, halves({ flavor: null }, { flavor: "pepperoni" })),
    ["custom_half_unavailable"],
  );
  // The flavor-only selection of the same product still prices.
  const snapshot = createMenuProductPriceSnapshot(withoutIngredients, context(halves({ flavor: "pepperoni" }, { flavor: "hawaiana" })));
  assert.equal(snapshot.unitPrice.amountMinor, 17_000);
});

test("a disabled or absent product setup rejects a halves line", () => {
  assert.deepEqual(issueCodes(pizzaCatalog({ productFraction: null }), halves({ flavor: "pepperoni" }, { flavor: "hawaiana" })), ["fraction_not_enabled"]);
  const disabled = pizzaCatalog({ productFraction: { enabled: false, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: null } });
  assert.deepEqual(issueCodes(disabled, halves({ flavor: "pepperoni" }, { flavor: "hawaiana" })), ["fraction_not_enabled"]);
});

test("the fraction groups stay empty as ordinary modifiers while a line is split", () => {
  assert.throws(
    () => createMenuProductPriceSnapshot(
      pizzaCatalog(),
      context(halves({ flavor: "pepperoni" }, { flavor: "hawaiana" })),
      [{ groupId: "ingredients", selections: [{ optionId: "queso", quantity: 1 }] }],
    ),
    (error) => error instanceof MenuFractionSelectionInvalidError
      && error.issueCodes[0] === "fraction_group_selection_forbidden",
  );
});

test("the legacy per-size setup still works while the product carries none", () => {
  const legacy = pizzaCatalog({ productFraction: null, sized: true, variantFraction: enabled });
  const snapshot = createMenuProductPriceSnapshot(legacy, context(halves({ flavor: "pepperoni" }, { flavor: "hawaiana" }), "large"));
  assert.equal(snapshot.unitPrice.amountMinor, 17_000);
  const custom = createMenuProductPriceSnapshot(legacy, context(halves({ flavor: null }, { flavor: "pepperoni" }), "large"));
  assert.equal(custom.unitPrice.amountMinor, 15_000);
});

test("a product-level setup takes precedence over the legacy per-size one", () => {
  const disabledLegacy = pizzaCatalog({
    sized: true,
    variantFraction: { enabled: false, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: null },
  });
  assert.equal(
    createMenuProductPriceSnapshot(disabledLegacy, context(halves({ flavor: "pepperoni" }, { flavor: "hawaiana" }), "large")).unitPrice.amountMinor,
    17_000,
  );
  const disabledProduct = pizzaCatalog({
    productFraction: { enabled: false, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: null },
    sized: true,
    variantFraction: enabled,
  });
  assert.deepEqual(
    issueCodes(disabledProduct, halves({ flavor: "pepperoni" }, { flavor: "hawaiana" }), "large"),
    ["fraction_not_enabled"],
  );
});

test("catalog validation rejects product-level fraction groups that do not belong to the product", () => {
  assert.throws(
    () => validateMenuCatalog(pizzaCatalog({
      productFraction: { enabled: true, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: "other" },
    })),
    InvalidSnapshotError,
  );
  assert.throws(
    () => validateMenuCatalog(pizzaCatalog({
      productFraction: { enabled: true, excludableIngredientIds: [], extraGroupId: "flavors", flavorGroupId: "flavors" },
    })),
    InvalidSnapshotError,
  );
  assert.throws(
    () => validateMenuCatalog(pizzaCatalog({
      productFraction: { enabled: true, excludableIngredientIds: ["a", "a"], extraGroupId: null, flavorGroupId: "flavors" },
    })),
    InvalidSnapshotError,
  );
});

test("catalogVariantToFractionVariant builds the pricing view of a product without sizes", () => {
  const view = catalogVariantToFractionVariant(validateMenuCatalog(pizzaCatalog()), "pizza", null);
  assert.equal(view.customHalfPriceMinor, 12_000);
  assert.deepEqual(view.flavors.map((flavor) => [flavor.optionId, flavor.priceMinor]), [["pepperoni", 12_000], ["hawaiana", 17_000]]);
  assert.deepEqual(view.extras.map((extra) => extra.optionId), ["queso", "jamon"]);
  assert.throws(
    () => catalogVariantToFractionVariant(validateMenuCatalog(pizzaCatalog({ productFraction: null })), "pizza", null),
    MenuFractionSelectionInvalidError,
  );
});
