import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidSnapshotError,
  MenuPizzaProductRequiresHalvesRuleError,
  Money,
  createMenuProductPriceSnapshot,
  validateMenuCatalog,
} from "./index.js";
import type { MenuCatalog, MenuProductCatalog } from "./index.js";

const R = "restaurant-1";
const V = "menu-v1";

function catalog(productExtra: Partial<MenuProductCatalog> = {}): MenuCatalog {
  return {
    restaurantId: R,
    catalogVersion: V,
    currency: "MXN",
    categories: [{ id: "food", restaurantId: R, catalogVersion: V, name: "Food", active: true, displayOrder: 0 }],
    products: [{
      id: "pizza", restaurantId: R, catalogVersion: V, categoryId: "food", name: "Pizza", active: true, displayOrder: 0,
      stationId: "oven", unit: "each", unitPrice: new Money(12_000, "MXN"), modifierGroupIds: ["base", "extras"],
      ...productExtra,
    }],
    modifierGroups: ["base", "extras"].map((id) => ({
      id, restaurantId: R, name: id, catalogVersion: V, productId: "pizza", active: true, minimumQuantity: 0, maximumQuantity: 5,
      options: [{ id: `${id}-1`, name: `${id} 1`, unitPrice: new Money(1_000, "MXN"), active: true }],
    })),
  };
}

test("a legacy product carries no Pizza V2 field", () => {
  const product = validateMenuCatalog(catalog()).products[0]!;
  assert.equal(product.pizzaMode, undefined);
  assert.equal(product.freeIngredientCount, undefined);
});

test("a custom product keeps and freezes its Pizza V2 fields", () => {
  const product = validateMenuCatalog(catalog({
    baseGroupId: "base", customizeAtOrder: true, extraGroupIds: ["extras"], freeIngredientCount: 2, pizzaMode: "custom",
  })).products[0]!;
  assert.equal(product.pizzaMode, "custom");
  assert.equal(product.freeIngredientCount, 2);
  assert.equal(product.baseGroupId, "base");
  assert.deepEqual(product.extraGroupIds, ["extras"]);
  assert.equal(Object.isFrozen(product.extraGroupIds), true);
});

test("N = 0 and a specialty recipe are valid", () => {
  assert.equal(validateMenuCatalog(catalog({ baseGroupId: "base", freeIngredientCount: 0, pizzaMode: "custom" })).products[0]!.freeIngredientCount, 0);
  const specialty = validateMenuCatalog(catalog({ defaultIngredientOptionIds: ["base-1"], pizzaMode: "specialty" })).products[0]!;
  assert.deepEqual(specialty.defaultIngredientOptionIds, ["base-1"]);
  assert.equal(specialty.customizeAtOrder, false);
});

function wideCatalog(groupCount: number, optionCount: number, productExtra: Partial<MenuProductCatalog>): MenuCatalog {
  const groupIds = Array.from({ length: groupCount + 1 }, (_, index) => (index === 0 ? "base" : `extra-${index}`));
  const base = catalog();
  return {
    ...base,
    modifierGroups: groupIds.map((id) => ({
      id, restaurantId: R, name: id, catalogVersion: V, productId: "pizza", active: true, minimumQuantity: 0, maximumQuantity: 5,
      options: Array.from({ length: id === "base" ? optionCount : 1 }, (_, index) => ({
        id: `${id}-opt-${index}`, name: `${id} ${index}`, unitPrice: new Money(1_000, "MXN"), active: true,
      })),
    })),
    products: [{ ...base.products[0]!, modifierGroupIds: groupIds, ...productExtra }],
  };
}

test("limits match shared-types: 24 extra groups and 40 recipe ids pass, 25 and 41 fail, N is 0..40", () => {
  const extras = (count: number) => Array.from({ length: count }, (_, index) => `extra-${index + 1}`);
  const recipe = (count: number) => Array.from({ length: count }, (_, index) => `base-opt-${index}`);
  assert.equal(validateMenuCatalog(wideCatalog(24, 1, { baseGroupId: "base", extraGroupIds: extras(24), pizzaMode: "custom" })).products[0]!.extraGroupIds!.length, 24);
  assert.throws(() => validateMenuCatalog(wideCatalog(25, 1, { baseGroupId: "base", extraGroupIds: extras(25), pizzaMode: "custom" })), InvalidSnapshotError);
  assert.equal(validateMenuCatalog(wideCatalog(1, 41, { defaultIngredientOptionIds: recipe(40), pizzaMode: "specialty" })).products[0]!.defaultIngredientOptionIds!.length, 40);
  assert.throws(() => validateMenuCatalog(wideCatalog(1, 41, { defaultIngredientOptionIds: recipe(41), pizzaMode: "specialty" })), InvalidSnapshotError);
  assert.equal(validateMenuCatalog(catalog({ baseGroupId: "base", freeIngredientCount: 40, pizzaMode: "custom" })).products[0]!.freeIngredientCount, 40);
  assert.throws(() => validateMenuCatalog(catalog({ baseGroupId: "base", freeIngredientCount: 41, pizzaMode: "custom" })), InvalidSnapshotError);
});

test("a base group and extra groups missing from modifierGroupIds are each rejected, together or alone", () => {
  const without = (...ids: string[]) => ({ modifierGroupIds: ["base", "extras"].filter((id) => !ids.includes(id)) });
  assert.throws(() => validateMenuCatalog(catalog({ ...without("base"), baseGroupId: "base", pizzaMode: "custom" })), InvalidSnapshotError, "base only");
  assert.throws(() => validateMenuCatalog(catalog({ ...without("extras"), baseGroupId: "base", extraGroupIds: ["extras"], pizzaMode: "custom" })), InvalidSnapshotError, "extras only");
  assert.throws(() => validateMenuCatalog(catalog({ modifierGroupIds: [], baseGroupId: "base", extraGroupIds: ["extras"], pizzaMode: "custom" })), InvalidSnapshotError, "both");
});

test("invalid Pizza V2 setups are rejected", () => {
  const rejected: readonly [string, Partial<MenuProductCatalog>][] = [
    ["a V2 field without pizzaMode", { freeIngredientCount: 1 }],
    ["an unknown mode", { pizzaMode: "mixed" as never }],
    ["a custom pizza without a base group", { pizzaMode: "custom" }],
    ["a negative N", { baseGroupId: "base", freeIngredientCount: -1, pizzaMode: "custom" }],
    ["a fractional N", { baseGroupId: "base", freeIngredientCount: 1.5, pizzaMode: "custom" }],
    ["a base group the product does not list", { baseGroupId: "ghost", pizzaMode: "custom" }],
    ["an extra group the product does not list", { baseGroupId: "base", extraGroupIds: ["ghost"], pizzaMode: "custom" }],
    ["the base group as an extra group", { baseGroupId: "base", extraGroupIds: ["base"], pizzaMode: "custom" }],
    ["repeated extra groups", { baseGroupId: "base", extraGroupIds: ["extras", "extras"], pizzaMode: "custom" }],
    ["repeated recipe ids", { defaultIngredientOptionIds: ["base-1", "base-1"], pizzaMode: "specialty" }],
  ];
  for (const [label, extra] of rejected) {
    assert.throws(() => validateMenuCatalog(catalog(extra)), InvalidSnapshotError, label);
  }
});

test("a pizza V2 product cannot be sold as a plain catalog product (fail closed), a legacy product still can", () => {
  const context = { restaurantId: R, productId: "pizza", currency: "MXN" } as const;
  for (const extra of [
    { baseGroupId: "base", freeIngredientCount: 1, pizzaMode: "custom" } as const,
    { defaultIngredientOptionIds: ["base-1"], pizzaMode: "specialty" } as const,
  ]) {
    assert.throws(() => createMenuProductPriceSnapshot(catalog(extra), context), MenuPizzaProductRequiresHalvesRuleError);
  }
  assert.equal(createMenuProductPriceSnapshot(catalog(), context).unitPrice.amountMinor, 12_000);
});
