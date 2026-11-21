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

function catalog(productExtra: Partial<MenuProductCatalog> = {}, groupIds: readonly string[] = ["base", "extras"]): MenuCatalog {
  return {
    restaurantId: R,
    catalogVersion: V,
    currency: "MXN",
    categories: [{ id: "food", restaurantId: R, catalogVersion: V, name: "Food", active: true, displayOrder: 0 }],
    products: [{
      id: "pizza", restaurantId: R, catalogVersion: V, categoryId: "food", name: "Pizza", active: true, displayOrder: 0,
      stationId: "oven", unit: "each", unitPrice: new Money(12_000, "MXN"), modifierGroupIds: groupIds,
      ...productExtra,
    }],
    modifierGroups: groupIds.map((id) => ({
      id, restaurantId: R, name: id, catalogVersion: V, productId: "pizza", active: true, minimumQuantity: 0, maximumQuantity: 5,
      options: [{ id: `${id}-1`, name: `${id} 1`, unitPrice: new Money(1_000, "MXN"), active: true }],
    })),
  };
}

test("a legacy product carries no Pizza V2 field", () => {
  const product = validateMenuCatalog(catalog()).products[0]!;
  assert.equal(product.pizzaMode, undefined);
  assert.equal(product.freeIngredientCount, undefined);
  assert.equal(product.baseGroupIds, undefined);
  assert.equal(product.extraOptionIds, undefined);
});

test("a custom product keeps and freezes its canonical Pizza V2 fields", () => {
  const product = validateMenuCatalog(catalog({
    baseGroupIds: ["base"], customizeAtOrder: true, extraOptionIds: ["extras-1"], freeIngredientCount: 2, pizzaMode: "custom",
  })).products[0]!;
  assert.equal(product.pizzaMode, "custom");
  assert.equal(product.freeIngredientCount, 2);
  assert.deepEqual(product.baseGroupIds, ["base"]);
  assert.deepEqual(product.extraOptionIds, ["extras-1"]);
  assert.equal(Object.isFrozen(product.baseGroupIds), true);
  assert.equal(Object.isFrozen(product.extraOptionIds), true);
  assert.equal(Object.hasOwn(product, "baseGroupId"), false);
  assert.equal(Object.hasOwn(product, "extraGroupIds"), false);
});

test("the legacy parser normalizes baseGroupId to baseGroupIds and extraGroupIds to their active options", () => {
  const product = validateMenuCatalog(catalog({
    baseGroupId: "base", extraGroupIds: ["extras"], freeIngredientCount: 1, pizzaMode: "custom",
  })).products[0]!;
  assert.deepEqual(product.baseGroupIds, ["base"]);
  assert.deepEqual(product.extraOptionIds, ["extras-1"]);
  assert.equal(Object.hasOwn(product, "baseGroupId"), false);
  assert.equal(Object.hasOwn(product, "extraGroupIds"), false);
});

test("N = 0 and a specialty recipe are valid; a persisted customizeAtOrder is preserved on read", () => {
  assert.equal(validateMenuCatalog(catalog({ baseGroupIds: ["base"], freeIngredientCount: 0, pizzaMode: "custom" })).products[0]!.freeIngredientCount, 0);
  const specialty = validateMenuCatalog(catalog({ baseGroupIds: ["base"], defaultIngredientOptionIds: ["base-1"], pizzaMode: "specialty" })).products[0]!;
  assert.deepEqual(specialty.defaultIngredientOptionIds, ["base-1"]);
  assert.equal(specialty.customizeAtOrder, false);
  const legacySpecialty = validateMenuCatalog(catalog({
    baseGroupIds: ["base"], customizeAtOrder: true, defaultIngredientOptionIds: ["base-1"], pizzaMode: "specialty",
  })).products[0]!;
  assert.equal(legacySpecialty.customizeAtOrder, true);
});

test("several base groups share one N; a recipe may come from any of them and extras may reuse a base group", () => {
  const product = validateMenuCatalog(catalog({
    baseGroupIds: ["base", "veggies"],
    defaultIngredientOptionIds: ["veggies-1"],
    extraOptionIds: ["base-1"],
    freeIngredientCount: 2,
    modifierGroupIds: ["base", "veggies", "extras"],
    pizzaMode: "custom",
  }, ["base", "veggies", "extras"])).products[0]!;
  assert.deepEqual(product.baseGroupIds, ["base", "veggies"]);
  assert.deepEqual(product.defaultIngredientOptionIds, ["veggies-1"]);
  assert.deepEqual(product.extraOptionIds, ["base-1"]);
  assert.equal(product.freeIngredientCount, 2);
});

function wideCatalog(groupCount: number, baseOptionCount: number, extraOptionCount: number, productExtra: Partial<MenuProductCatalog>): MenuCatalog {
  const extraIds = Array.from({ length: groupCount }, (_, index) => `extra-${index + 1}`);
  const groupIds = ["base", ...extraIds];
  const base = catalog();
  return {
    ...base,
    modifierGroups: groupIds.map((id) => ({
      id, restaurantId: R, name: id, catalogVersion: V, productId: "pizza", active: true, minimumQuantity: 0, maximumQuantity: 5,
      options: Array.from({ length: id === "base" ? baseOptionCount : extraOptionCount }, (_, index) => ({
        id: `${id}-opt-${index}`, name: `${id} ${index}`, unitPrice: new Money(1_000, "MXN"), active: true,
      })),
    })),
    products: [{ ...base.products[0]!, modifierGroupIds: groupIds, ...productExtra }],
  };
}

test("limits match shared-types: N is 0..40, the recipe is 40, the extra options are 200", () => {
  const recipe = (count: number) => Array.from({ length: count }, (_, index) => `base-opt-${index}`);
  const options = (count: number) => Array.from({ length: count }, (_, index) => `extra-1-opt-${index}`);
  assert.equal(validateMenuCatalog(wideCatalog(1, 41, 200, {
    baseGroupIds: ["base"], defaultIngredientOptionIds: recipe(40), extraOptionIds: options(200), pizzaMode: "custom",
  })).products[0]!.extraOptionIds!.length, 200);
  assert.throws(() => validateMenuCatalog(wideCatalog(1, 41, 201, {
    baseGroupIds: ["base"], defaultIngredientOptionIds: recipe(40), extraOptionIds: options(201), pizzaMode: "custom",
  })), InvalidSnapshotError);
  assert.equal(validateMenuCatalog(wideCatalog(1, 41, 1, { baseGroupIds: ["base"], defaultIngredientOptionIds: recipe(40), pizzaMode: "specialty" })).products[0]!.defaultIngredientOptionIds!.length, 40);
  assert.throws(() => validateMenuCatalog(wideCatalog(1, 41, 1, { baseGroupIds: ["base"], defaultIngredientOptionIds: recipe(41), pizzaMode: "specialty" })), InvalidSnapshotError);
  assert.equal(validateMenuCatalog(catalog({ baseGroupIds: ["base"], freeIngredientCount: 40, pizzaMode: "custom" })).products[0]!.freeIngredientCount, 40);
  assert.throws(() => validateMenuCatalog(catalog({ baseGroupIds: ["base"], freeIngredientCount: 41, pizzaMode: "custom" })), InvalidSnapshotError);
});

test("a base group, an extra option or a recipe option outside the assigned groups is rejected", () => {
  const without = (...ids: string[]) => ({ modifierGroupIds: ["base", "extras"].filter((id) => !ids.includes(id)) });
  assert.throws(() => validateMenuCatalog(catalog({ ...without("base"), baseGroupIds: ["base"], pizzaMode: "custom" })));
  assert.throws(() => validateMenuCatalog(catalog({ baseGroupIds: ["base"], extraOptionIds: ["ghost"], pizzaMode: "custom" })), InvalidSnapshotError);
  assert.throws(() => validateMenuCatalog(catalog({ baseGroupIds: ["base"], defaultIngredientOptionIds: ["extras-1"], pizzaMode: "specialty" })), InvalidSnapshotError);
});

test("an option cannot be a recipe ingredient and a charged extra at the same time", () => {
  assert.throws(() => validateMenuCatalog(catalog({
    baseGroupIds: ["base"], defaultIngredientOptionIds: ["base-1"], extraOptionIds: ["base-1"], pizzaMode: "custom",
  })), InvalidSnapshotError);
});

test("invalid Pizza V2 setups are rejected", () => {
  const rejected: readonly [string, Partial<MenuProductCatalog>][] = [
    ["a V2 field without pizzaMode", { freeIngredientCount: 1 }],
    ["an unknown mode", { pizzaMode: "mixed" as never }],
    ["a custom pizza without a base group", { pizzaMode: "custom" }],
    ["a negative N", { baseGroupIds: ["base"], freeIngredientCount: -1, pizzaMode: "custom" }],
    ["a fractional N", { baseGroupIds: ["base"], freeIngredientCount: 1.5, pizzaMode: "custom" }],
    ["a base group the product does not list", { baseGroupIds: ["ghost"], pizzaMode: "custom" }],
    ["an extra option the product does not offer", { baseGroupIds: ["base"], extraOptionIds: ["ghost"], pizzaMode: "custom" }],
    ["repeated base groups", { baseGroupIds: ["base", "base"], pizzaMode: "custom" }],
    ["repeated extra options", { baseGroupIds: ["base"], extraOptionIds: ["extras-1", "extras-1"], pizzaMode: "custom" }],
    ["repeated recipe ids", { baseGroupIds: ["base"], defaultIngredientOptionIds: ["base-1", "base-1"], pizzaMode: "specialty" }],
    ["both base group forms", { baseGroupId: "base", baseGroupIds: ["base"], pizzaMode: "custom" } as never],
    ["both extra forms", { baseGroupIds: ["base"], extraGroupIds: ["extras"], extraOptionIds: ["extras-1"], pizzaMode: "custom" } as never],
    ["a null legacy base group on a custom pizza", { baseGroupId: null, pizzaMode: "custom" } as never],
  ];
  for (const [label, extra] of rejected) {
    assert.throws(() => validateMenuCatalog(catalog(extra)), InvalidSnapshotError, label);
  }
});

test("a pizza V2 product cannot be sold as a plain catalog product (fail closed), a legacy product still can", () => {
  const context = { restaurantId: R, productId: "pizza", currency: "MXN" } as const;
  for (const extra of [
    { baseGroupIds: ["base"], freeIngredientCount: 1, pizzaMode: "custom" } as const,
    { baseGroupIds: ["base"], defaultIngredientOptionIds: ["base-1"], pizzaMode: "specialty" } as const,
  ]) {
    assert.throws(() => createMenuProductPriceSnapshot(catalog(extra), context), MenuPizzaProductRequiresHalvesRuleError);
  }
  assert.equal(createMenuProductPriceSnapshot(catalog(), context).unitPrice.amountMinor, 12_000);
});
