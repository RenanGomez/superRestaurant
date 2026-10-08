import assert from "node:assert/strict";
import test from "node:test";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { applyRemoval, removalNeedsConfirmation, type MenuDraftParts } from "./menu-removal.js";

const variant = (variantId: string, name: string) => ({ active: true, displayOrder: 1, name, sku: null, unitPriceMinor: 0, variantId });
const product = (productId: string, categoryId: string, variants: readonly ReturnType<typeof variant>[] = []): MenuProductV1 => ({
  active: true, categoryId, displayOrder: 1, imagePath: null, name: productId, productId, sku: null, stationId: "general",
  tax: null, unit: "pieza", unitPriceMinor: 100, variants,
});
const group = (groupId: string, productId: string, optionIds: readonly string[]): MenuModifierGroupV1 => ({
  active: true, displayOrder: 1, groupId, maximumQuantity: 1, minimumQuantity: 0, name: groupId, productId,
  options: optionIds.map((optionId) => ({ active: true, imagePath: null, maximumQuantity: null, name: optionId, optionId, unitPriceMinor: 0 })),
});
const category = (categoryId: string) => ({ active: true, categoryId, displayOrder: 1, name: categoryId });

const draft: MenuDraftParts = {
  categories: [category("c1"), category("c2")],
  groups: [group("g1", "p1", ["o1", "o2"]), group("g2", "p2", ["o3"])],
  products: [product("p1", "c1", [variant("v1", ""), variant("v2", "Grande")]), product("p2", "c2")],
};

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

test("removing a category removes its products and their groups; a product removes its groups", () => {
  const withoutCategory = applyRemoval(draft, { id: "c1", kind: "category", label: "c1" });
  assert.deepEqual(withoutCategory.categories.map((entry) => entry.categoryId), ["c2"]);
  assert.deepEqual(withoutCategory.products.map((entry) => entry.productId), ["p2"]);
  assert.deepEqual(withoutCategory.groups.map((entry) => entry.groupId), ["g2"]);
  const withoutProduct = applyRemoval(draft, { id: "p2", kind: "product", label: "p2" });
  assert.deepEqual(withoutProduct.groups.map((entry) => entry.groupId), ["g1"]);
});

test("removing a group or an option touches only that element", () => {
  assert.deepEqual(applyRemoval(draft, { id: "g1", kind: "group", label: "g1" }).groups.map((entry) => entry.groupId), ["g2"]);
  const withoutOption = applyRemoval(draft, { groupId: "g1", id: "o1", kind: "option", label: "o1" });
  assert.deepEqual(withoutOption.groups[0]?.options.map((entry) => entry.optionId), ["o2"]);
  assert.equal(withoutOption.groups[1], draft.groups[1]);
});
