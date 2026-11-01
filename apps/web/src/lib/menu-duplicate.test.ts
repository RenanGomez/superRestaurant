import assert from "node:assert/strict";
import test from "node:test";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { duplicateProduct } from "./menu-duplicate.js";

const counter = (): (() => string) => { let n = 0; return () => `new-${++n}`; };
const group = (groupId: string, productId: string): MenuModifierGroupV1 => ({
  active: true, displayOrder: 1, groupId, maximumQuantity: 2, minimumQuantity: 0, name: groupId, productId,
  options: [
    { active: true, imagePath: "11111111-1111-4111-8111-111111111111/options/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/0123456789abcdef0123456789abcdef.png", maximumQuantity: null, name: "A", optionId: `${groupId}-o1`, unitPriceMinor: 10 },
    { active: false, imagePath: null, maximumQuantity: 2, name: "B", optionId: `${groupId}-o2`, unitPriceMinor: 0 },
  ],
});
const product: MenuProductV1 = {
  active: true, categoryId: "c1", displayOrder: 3, fraction: { enabled: true, excludableIngredientIds: ["cebolla"], extraGroupId: "g2", flavorGroupId: "g1" },
  imagePath: "11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/0123456789abcdef0123456789abcdef.png", name: "Pizza", productId: "p1", sku: "PZ-1", stationId: "horno",
  tax: { inclusion: "included", name: "IVA", rateDenominator: 100, rateNumerator: 16, taxId: "iva", taxRuleVersion: "1" }, unit: "pieza", unitPriceMinor: 15000,
  variants: [{ active: true, displayOrder: 1, name: "Grande", sku: null, unitPriceMinor: 20000, variantId: "v1" }],
};
const groups = [group("g1", "p1"), group("g2", "p1"), group("g3", "other")];

test("duplicate gets fresh ids, copy name, no sku and the given display order", () => {
  const { groups: copiedGroups, product: copy } = duplicateProduct(product, groups, counter(), 7);
  assert.equal(copy.productId, "new-1");
  assert.equal(copy.name, "Pizza (copia)");
  assert.equal(copy.sku, null);
  assert.equal(copy.displayOrder, 7);
  assert.equal(copy.imagePath, null);
  assert.ok(copiedGroups.every((entry) => entry.options.every((option) => option.imagePath === null)));
  assert.equal(copy.variants?.[0]?.variantId === "v1", false);
  assert.equal(copy.variants?.[0]?.unitPriceMinor, 20000);
  assert.equal(copiedGroups.length, 2);
  assert.ok(copiedGroups.every((entry) => entry.productId === "new-1"));
  const ids = [copy.productId, ...copiedGroups.flatMap((entry) => [entry.groupId, ...entry.options.map((option) => option.optionId)]), ...(copy.variants ?? []).map((v) => v.variantId)];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("new-")));
});

test("halves point at the copied groups and the originals are untouched", () => {
  const { groups: copiedGroups, product: copy } = duplicateProduct(product, groups, counter());
  assert.equal(copy.fraction?.flavorGroupId, copiedGroups[0]?.groupId);
  assert.equal(copy.fraction?.extraGroupId, copiedGroups[1]?.groupId);
  assert.deepEqual(copy.fraction?.excludableIngredientIds, ["cebolla"]);
  assert.notEqual(copy.fraction?.excludableIngredientIds, product.fraction?.excludableIngredientIds);
  assert.equal(product.fraction?.flavorGroupId, "g1");
  assert.equal(product.name, "Pizza");
  assert.equal(groups[0]?.productId, "p1");
});

test("a very long name still fits the 120 character limit", () => {
  const { product: copy } = duplicateProduct({ ...product, name: "x".repeat(120) }, [], counter());
  assert.equal(copy.name.length, 120);
  assert.ok(copy.name.endsWith(" (copia)"));
});

test("a product without groups, sizes or halves duplicates cleanly", () => {
  const plain: MenuProductV1 = { ...product, fraction: null, tax: null, variants: [] };
  const { groups: copiedGroups, product: copy } = duplicateProduct(plain, groups.filter((entry) => entry.productId !== "p1"), counter());
  assert.deepEqual(copiedGroups, []);
  assert.equal(copy.tax, null);
  assert.deepEqual(copy.variants, []);
});
