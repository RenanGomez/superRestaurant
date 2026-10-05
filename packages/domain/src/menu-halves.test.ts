import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogVariantToFractionVariant,
  createMenuProductPriceSnapshot,
  InvalidSnapshotError,
  MenuFractionSelectionInvalidError,
  Money,
  validateMenuCatalog,
} from "./index.js";
import type { MenuCatalog, MenuFractionSelection } from "./index.js";

const R = "restaurant-1";
const V = "menu-v9";

function pizzaCatalog(overrides: { readonly fraction?: unknown; readonly flavorActive?: boolean } = {}): MenuCatalog {
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
      unitPrice: new Money(0, "MXN"),
      modifierGroupIds: ["flavors", "extras", "crust"],
      variants: [{
        id: "large",
        name: "Grande",
        active: true,
        displayOrder: 0,
        unitPrice: new Money(15_000, "MXN"),
        fraction: (overrides.fraction ?? {
          enabled: true,
          excludableIngredientIds: ["cebolla"],
          extraGroupId: "extras",
          flavorGroupId: "flavors",
        }) as never,
      }],
    }],
    modifierGroups: [
      {
        id: "flavors", restaurantId: R, name: "Sabor", catalogVersion: V, productId: "pizza", active: true,
        minimumQuantity: 0, maximumQuantity: 2,
        options: [
          { id: "pepperoni", name: "Pepperoni", unitPrice: new Money(0, "MXN"), active: true },
          { id: "hawaiana", name: "Hawaiana", unitPrice: new Money(17_000, "MXN"), active: overrides.flavorActive ?? true },
        ],
      },
      {
        id: "extras", restaurantId: R, name: "Extras", catalogVersion: V, productId: "pizza", active: true,
        minimumQuantity: 0, maximumQuantity: 5,
        options: [
          { id: "queso", name: "Queso extra", unitPrice: new Money(2_501, "MXN"), active: true },
        ],
      },
      {
        id: "crust", restaurantId: R, name: "Orilla", catalogVersion: V, productId: "pizza", active: true,
        minimumQuantity: 0, maximumQuantity: 1,
        options: [{ id: "stuffed", name: "Rellena", unitPrice: new Money(3_000, "MXN"), active: true }],
      },
    ],
  };
}

function halves(overrides: Partial<Record<"a" | "b", { flavor: string; extras?: string[]; excluded?: string[] }>> = {}): MenuFractionSelection {
  const a = overrides.a ?? { flavor: "pepperoni" };
  const b = overrides.b ?? { flavor: "hawaiana" };
  return {
    geometry: "halves",
    slots: [
      { excludedIngredientIds: a.excluded ?? [], extraOptionIds: a.extras ?? [], flavorOptionId: a.flavor, fraction: "half-a" },
      { excludedIngredientIds: b.excluded ?? [], extraOptionIds: b.extras ?? [], flavorOptionId: b.flavor, fraction: "half-b" },
    ],
  };
}

const context = (fraction: MenuFractionSelection | null) => ({
  currency: "MXN", fraction, productId: "pizza", restaurantId: R, variantId: "large",
});

test("a halves line is priced at the greater flavor plus halved extras, rounded up to the minor unit", () => {
  const snapshot = createMenuProductPriceSnapshot(
    pizzaCatalog(),
    context(halves({ a: { flavor: "pepperoni", extras: ["queso"], excluded: ["cebolla"] } })),
  );
  // pepperoni priced at 0 uses the size price (15000); hawaiana is 17000: the greater wins.
  assert.equal(snapshot.unitPrice.amountMinor, 17_000);
  assert.deepEqual(snapshot.fractionBreakdown, [
    { amountMinor: 15_000, flavorName: "Pepperoni", flavorOptionId: "pepperoni", fraction: "half-a" },
    { amountMinor: 17_000, flavorName: "Hawaiana", flavorOptionId: "hawaiana", fraction: "half-b" },
  ]);
  assert.equal(snapshot.geometry, "halves");
  assert.equal(snapshot.variantId, "large");
  assert.equal(snapshot.variantName, "Grande");
  const extra = snapshot.modifiers.find((modifier) => modifier.modifierId === "extra:half-a:queso");
  // 2501 / 2 = 1250.5 rounds up to 1251.
  assert.equal(extra?.unitPrice.amountMinor, 1_251);
  const exclusion = snapshot.modifiers.find((modifier) => modifier.modifierId === "exclude:half-a:cebolla");
  assert.equal(exclusion?.unitPrice.amountMinor, 0);
  assert.equal(exclusion?.quantity, 1);
});

test("ordinary groups outside the fraction pair still apply to a halves line", () => {
  const catalog = pizzaCatalog();
  const snapshot = createMenuProductPriceSnapshot(
    catalog,
    context(halves()),
    [{ groupId: "crust", selections: [{ optionId: "stuffed", quantity: 1 }] }],
  );
  assert.ok(snapshot.modifiers.some((modifier) => modifier.modifierId === "stuffed"));
  assert.equal(snapshot.unitPrice.amountMinor, 17_000);
});

test("a line without fraction keeps the ordinary size price", () => {
  const snapshot = createMenuProductPriceSnapshot(pizzaCatalog(), context(null));
  assert.equal(snapshot.unitPrice.amountMinor, 15_000);
  assert.equal(snapshot.geometry, undefined);
  assert.equal(snapshot.fractionBreakdown, undefined);
});

test("invalid fraction selections are rejected with domain issue codes", () => {
  const issues = (fraction: MenuFractionSelection, catalog = pizzaCatalog()) => {
    try {
      createMenuProductPriceSnapshot(catalog, context(fraction));
    } catch (error) {
      assert.ok(error instanceof MenuFractionSelectionInvalidError);
      return error.issueCodes;
    }
    return assert.fail("expected a rejection");
  };
  assert.deepEqual(issues(halves({ a: { flavor: "nope" } })), ["flavor_not_found"]);
  assert.deepEqual(issues(halves({ b: { flavor: "pepperoni", extras: ["ghost"] } })), ["extra_not_found"]);
  assert.deepEqual(issues(halves({ a: { flavor: "pepperoni", excluded: ["ghost"] } })), ["exclusion_not_found"]);
  assert.deepEqual(issues(halves(), pizzaCatalog({ flavorActive: false })), ["flavor_inactive"]);
  assert.deepEqual(
    issues({ geometry: "halves", slots: [halves().slots[0]!] }),
    ["slot_mismatch"],
  );
});

test("halves must list half-a first and half-b second", () => {
  const ordered = halves();
  assert.throws(
    () => createMenuProductPriceSnapshot(pizzaCatalog(), context({ geometry: "halves", slots: [ordered.slots[1]!, ordered.slots[0]!] })),
    (error) => error instanceof MenuFractionSelectionInvalidError && error.issueCodes[0] === "fraction_slot_order",
  );
});

test("fraction requires an enabled size and forbids selecting the fraction groups as ordinary modifiers", () => {
  const disabled = pizzaCatalog({
    fraction: { enabled: false, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: null },
  });
  assert.throws(
    () => createMenuProductPriceSnapshot(disabled, context(halves())),
    (error) => error instanceof MenuFractionSelectionInvalidError && error.issueCodes[0] === "fraction_not_enabled",
  );
  assert.throws(
    () => createMenuProductPriceSnapshot(
      pizzaCatalog(),
      context(halves()),
      [{ groupId: "flavors", selections: [{ optionId: "pepperoni", quantity: 1 }] }],
    ),
    (error) => error instanceof MenuFractionSelectionInvalidError
      && error.issueCodes[0] === "fraction_group_selection_forbidden",
  );
});

test("catalog validation rejects fraction groups that do not belong to the product", () => {
  assert.throws(
    () => validateMenuCatalog(pizzaCatalog({
      fraction: { enabled: true, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: "other" },
    })),
    InvalidSnapshotError,
  );
  assert.throws(
    () => validateMenuCatalog(pizzaCatalog({
      fraction: { enabled: true, excludableIngredientIds: ["a", "a"], extraGroupId: null, flavorGroupId: "flavors" },
    })),
    InvalidSnapshotError,
  );
  assert.throws(
    () => validateMenuCatalog(pizzaCatalog({
      fraction: { enabled: true, excludableIngredientIds: [], extraGroupId: "flavors", flavorGroupId: "flavors" },
    })),
    InvalidSnapshotError,
  );
});

test("catalogVariantToFractionVariant maps zero-priced flavors to the size price", () => {
  const variant = catalogVariantToFractionVariant(validateMenuCatalog(pizzaCatalog()), "pizza", "large");
  assert.deepEqual(variant.flavors.map((flavor) => [flavor.optionId, flavor.priceMinor, flavor.active]), [
    ["pepperoni", 15_000, true],
    ["hawaiana", 17_000, true],
  ]);
  assert.deepEqual(variant.extras.map((extra) => [extra.optionId, extra.priceMinor]), [["queso", 2_501]]);
  assert.deepEqual(variant.includedIngredients.map((ingredient) => ingredient.ingredientId), ["cebolla"]);
});
