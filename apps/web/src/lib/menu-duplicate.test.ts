import assert from "node:assert/strict";
import test from "node:test";
import type { MenuProductV1 } from "@super-restaurant/shared-types";
import { duplicateProduct } from "./menu-duplicate.js";

const counter = (): (() => string) => { let n = 0; return () => `new-${++n}`; };
const product: MenuProductV1 = {
  active: true, categoryId: "c1", displayOrder: 3, fraction: { enabled: true, excludableIngredientIds: ["cebolla"], extraGroupId: "g2", flavorGroupId: "g1", lockedIngredientOptionIds: ["opt-1"] },
  imagePath: "11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/0123456789abcdef0123456789abcdef.png", name: "Pizza", productId: "p1", sku: "PZ-1", stationId: "horno",
  tax: { inclusion: "included", name: "IVA", rateDenominator: 100, rateNumerator: 16, taxId: "iva", taxRuleVersion: "1" }, unit: "pieza", unitPriceMinor: 15000,
  modifierGroupIds: ["g1", "g2"],
  variants: [{ active: true, displayOrder: 1, name: "Grande", sku: null, unitPriceMinor: 20000, variantId: "v1" }],
};

test("duplicate gets fresh ids, copy name, no sku and the given display order", () => {
  const { product: copy } = duplicateProduct(product, counter(), 7);
  assert.equal(copy.productId, "new-1");
  assert.equal(copy.name, "Pizza (copia)");
  assert.equal(copy.sku, null);
  assert.equal(copy.displayOrder, 7);
  assert.equal(copy.imagePath, null);
  assert.equal(copy.variants?.[0]?.variantId, "new-2");
  assert.equal(copy.variants?.[0]?.unitPriceMinor, 20000);
});

test("the copy lists the same shared groups (no group is cloned) and its halves keep pointing at them", () => {
  const { product: copy } = duplicateProduct(product, counter());
  assert.deepEqual(copy.modifierGroupIds, ["g1", "g2"]);
  assert.notEqual(copy.modifierGroupIds, product.modifierGroupIds);
  assert.equal(copy.fraction?.flavorGroupId, "g1");
  assert.equal(copy.fraction?.extraGroupId, "g2");
  assert.deepEqual(copy.fraction?.excludableIngredientIds, ["cebolla"]);
  assert.notEqual(copy.fraction?.excludableIngredientIds, product.fraction?.excludableIngredientIds);
  assert.deepEqual(copy.fraction?.lockedIngredientOptionIds, ["opt-1"]);
  assert.notEqual(copy.fraction?.lockedIngredientOptionIds, product.fraction?.lockedIngredientOptionIds);
  assert.equal(product.name, "Pizza");
  assert.deepEqual(product.modifierGroupIds, ["g1", "g2"]);
});

test("a very long name still fits the 120 character limit", () => {
  const { product: copy } = duplicateProduct({ ...product, name: "x".repeat(120) }, counter());
  assert.equal(copy.name.length, 120);
  assert.ok(copy.name.endsWith(" (copia)"));
});

test("a product without groups, sizes or halves duplicates cleanly", () => {
  const plain: MenuProductV1 = { ...product, fraction: null, modifierGroupIds: [], tax: null, variants: [] };
  const { product: copy } = duplicateProduct(plain, counter());
  assert.deepEqual(copy.modifierGroupIds, []);
  assert.equal(copy.tax, null);
  assert.deepEqual(copy.variants, []);
});
