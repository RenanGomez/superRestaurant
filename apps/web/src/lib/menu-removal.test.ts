import assert from "node:assert/strict";
import test from "node:test";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { applyRemoval, removalNeedsConfirmation, unassignGroup, type MenuDraftParts } from "./menu-removal.js";

const variant = (variantId: string, name: string) => ({ active: true, displayOrder: 1, name, sku: null, unitPriceMinor: 0, variantId });
const product = (productId: string, categoryId: string, groupIds: readonly string[] = [], variants: readonly ReturnType<typeof variant>[] = []): MenuProductV1 => ({
  active: true, categoryId, displayOrder: 1, imagePath: null, modifierGroupIds: groupIds, name: productId, productId, sku: null, stationId: "general",
  tax: null, unit: "pieza", unitPriceMinor: 100, variants,
});
const group = (groupId: string, productId: string | null, optionIds: readonly string[]): MenuModifierGroupV1 => ({
  active: true, displayOrder: 1, groupId, maximumQuantity: 1, minimumQuantity: 0, name: groupId, productId,
  options: optionIds.map((optionId) => ({ active: true, imagePath: null, maximumQuantity: null, name: optionId, optionId, unitPriceMinor: 0 })),
});
const category = (categoryId: string) => ({ active: true, categoryId, color: null, displayOrder: 1, imagePath: null, name: categoryId });

// g1 belongs only to p1, g2 only to p2, g3 is shared by both.
const draft: MenuDraftParts = {
  categories: [category("c1"), category("c2")],
  groups: [group("g1", "p1", ["o1", "o2"]), group("g2", "p2", ["o3"]), group("g3", null, ["o4"])],
  products: [product("p1", "c1", ["g1", "g3"], [variant("v1", ""), variant("v2", "Grande")]), product("p2", "c2", ["g2", "g3"])],
};

test("unassigning one group from a product keeps the others and empties a halves setup that used it", () => {
  const base = { ...product("p1", "c1", ["g1", "g3"]), fraction: { enabled: true, excludableIngredientIds: [], extraGroupId: "g3", flavorGroupId: "g1" } };
  const result = unassignGroup(base, "g3");
  assert.deepEqual(result.modifierGroupIds, ["g1"]);
  assert.equal(result.fraction?.extraGroupId, null);
  assert.equal(result.fraction?.flavorGroupId, "g1");
  assert.deepEqual(base.modifierGroupIds, ["g1", "g3"]);
});

test("removing a freshly added size drops exactly that variant and nothing else", () => {
  const result = applyRemoval(draft, { groupId: "p1", id: "v1", kind: "variant", label: "tamaño nuevo", unnamed: true });
  assert.deepEqual(result.products[0]?.variants?.map((entry) => entry.variantId), ["v2"]);
  assert.equal(result.products[1], draft.products[1]);
  assert.equal(result.groups, draft.groups);
  assert.equal(draft.products[0]?.variants?.length, 2);
});

test("only a variant without a name skips the confirmation", () => {
  assert.equal(removalNeedsConfirmation({ groupId: "p1", id: "v1", kind: "variant", label: "x", unnamed: true }), false);
  assert.equal(removalNeedsConfirmation({ groupId: "p1", id: "v2", kind: "variant", label: "Grande", unnamed: false }), true);
  assert.equal(removalNeedsConfirmation({ id: "p1", kind: "product", label: "p1", unnamed: true }), true);
});

test("removing a category or a product keeps the catalog groups and refreshes the legacy owners", () => {
  const withoutCategory = applyRemoval(draft, { id: "c1", kind: "category", label: "c1" });
  assert.deepEqual(withoutCategory.categories.map((entry) => entry.categoryId), ["c2"]);
  assert.deepEqual(withoutCategory.products.map((entry) => entry.productId), ["p2"]);
  assert.deepEqual(withoutCategory.groups.map((entry) => entry.groupId), ["g1", "g2", "g3"]);
  // g1 is now unassigned, g3 has a single product left and becomes its legacy owner.
  assert.deepEqual(withoutCategory.groups.map((entry) => entry.productId), [null, "p2", "p2"]);
  const withoutProduct = applyRemoval(draft, { id: "p2", kind: "product", label: "p2" });
  assert.deepEqual(withoutProduct.groups.map((entry) => entry.groupId), ["g1", "g2", "g3"]);
  assert.deepEqual(withoutProduct.groups.map((entry) => entry.productId), ["p1", null, "p1"]);
});

test("removing a group deletes it from the catalog and from every product that offered it", () => {
  const result = applyRemoval(draft, { id: "g3", kind: "group", label: "g3" });
  assert.deepEqual(result.groups.map((entry) => entry.groupId), ["g1", "g2"]);
  assert.deepEqual(result.products.map((entry) => entry.modifierGroupIds), [["g1"], ["g2"]]);
  const withHalves: MenuDraftParts = {
    ...draft,
    products: [{ ...draft.products[0]!, fraction: { enabled: true, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: "g3" } }, draft.products[1]!],
  };
  assert.equal(applyRemoval(withHalves, { id: "g3", kind: "group", label: "g3" }).products[0]?.fraction?.flavorGroupId, null);
  assert.equal(result.products[1]?.productId, "p2");
});

test("removing an option touches only that element", () => {
  const withoutOption = applyRemoval(draft, { groupId: "g1", id: "o1", kind: "option", label: "o1" });
  assert.deepEqual(withoutOption.groups[0]?.options.map((entry) => entry.optionId), ["o2"]);
  assert.equal(withoutOption.groups[1], draft.groups[1]);
});

test("unassigning all groups of a product keeps the groups, other products and clears dangling halves", () => {
  const withHalves: MenuDraftParts = {
    ...draft,
    products: [{ ...draft.products[0]!, fraction: { enabled: true, excludableIngredientIds: [], extraGroupId: null, flavorGroupId: "g1" } }, draft.products[1]!],
  };
  const result = applyRemoval(withHalves, { id: "p1", kind: "groups", label: "todos los grupos de p1" });
  assert.deepEqual(result.groups.map((entry) => entry.groupId), ["g1", "g2", "g3"]);
  assert.deepEqual(result.products[0]?.modifierGroupIds, []);
  assert.deepEqual(result.products[1]?.modifierGroupIds, ["g2", "g3"]);
  assert.equal(result.products[0]?.fraction?.flavorGroupId, null);
  assert.equal(result.products[0]?.fraction?.enabled, true);
  assert.equal(result.products[1], withHalves.products[1]);
  const sizeSetup = { enabled: true, excludableIngredientIds: [], extraGroupId: "g1", flavorGroupId: null };
  const legacy = applyRemoval({ ...draft, products: [{ ...product("p1", "c1", ["g1"], [{ ...variant("v1", "Grande"), fraction: sizeSetup } as ReturnType<typeof variant>]), fraction: null }] }, { id: "p1", kind: "groups", label: "x" });
  assert.equal(legacy.products[0]?.variants?.[0]?.fraction?.extraGroupId, null);
  assert.equal(removalNeedsConfirmation({ id: "p1", kind: "groups", label: "x" }), true);
});
