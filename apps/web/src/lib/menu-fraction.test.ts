import assert from "node:assert/strict";
import test from "node:test";
import type { MenuProductV1, MenuVariantFractionV1 } from "@super-restaurant/shared-types";
import { EMPTY_PRODUCT_FRACTION, editorProductFraction, legacyFractionNotice, legacyFractionSource, migrateLegacyFraction } from "./menu-fraction.js";
import { variantValidationError } from "./menu-variants.js";

const flavors = "11111111-1111-4111-8111-111111111111";
const ingredients = "22222222-2222-4222-8222-222222222222";
const setup = (extra: Partial<MenuVariantFractionV1> = {}): MenuVariantFractionV1 =>
  ({ enabled: true, excludableIngredientIds: ["cebolla"], extraGroupId: ingredients, flavorGroupId: flavors, ...extra });
const variant = (name: string, displayOrder: number, fraction: MenuVariantFractionV1 | null) =>
  ({ active: true, displayOrder, fraction, name, sku: null, unitPriceMinor: 100, variantId: `v-${name}` });
const product = (overrides: Partial<MenuProductV1>): MenuProductV1 => ({
  active: true, categoryId: "c", displayOrder: 1, imagePath: null, name: "Pizza", productId: "p", sku: null,
  stationId: "general", tax: null, unit: "pieza", unitPriceMinor: 100, variants: [], ...overrides });

test("a product without any setup shows the empty one", () => {
  assert.equal(editorProductFraction(product({})), EMPTY_PRODUCT_FRACTION);
  assert.equal(legacyFractionSource(product({})), null);
});

test("legacy size setups are shown as the product's and moved to it on save", () => {
  const legacy = product({ variants: [variant("Chica", 1, setup()), variant("Grande", 2, setup())] });
  assert.deepEqual(editorProductFraction(legacy), setup());
  assert.equal(legacyFractionNotice(legacy), null, "identical setups raise no warning");
  const migrated = migrateLegacyFraction(legacy);
  assert.deepEqual(migrated.fraction, setup());
  assert.deepEqual(migrated.variants?.map((entry) => entry.fraction?.enabled), [false, false]);
  assert.deepEqual(migrateLegacyFraction(migrated), migrated, "idempotent");
});

test("different legacy setups warn, use the first size by order, and are not lost silently", () => {
  const legacy = product({ variants: [variant("Grande", 2, setup({ excludableIngredientIds: [] })), variant("Chica", 1, setup())] });
  assert.equal(legacyFractionNotice(legacy), "Los tamaños tienen mitades configuradas distinto; al guardar se usará la de Chica.");
  assert.deepEqual(migrateLegacyFraction(legacy).fraction, setup());
});

test("the product's own setup wins and enabled size setups are switched off", () => {
  const own = product({ fraction: setup({ excludableIngredientIds: [] }), variants: [variant("Chica", 1, setup())] });
  assert.equal(legacyFractionNotice(own), null);
  const migrated = migrateLegacyFraction(own);
  assert.deepEqual(migrated.fraction, own.fraction);
  assert.equal(migrated.variants?.[0]?.fraction?.enabled, false);
  const disabledOwn = product({ fraction: setup({ enabled: false }), variants: [variant("Chica", 1, setup())] });
  assert.equal(migrateLegacyFraction(disabledOwn), disabledOwn, "a disabled product setup does not clash with the server");
});

test("product-level guidance rejects an enabled setup without a usable flavor group", () => {
  const ids = new Set([flavors, ingredients]);
  assert.equal(variantValidationError("p", [], ids, setup()), null);
  assert.equal(variantValidationError("p", [], ids, setup({ enabled: false, flavorGroupId: null })), null);
  assert.match(variantValidationError("p", [], ids, setup({ flavorGroupId: null }))?.message ?? "", /grupo de sabores/);
  assert.match(variantValidationError("p", [], ids, setup({ extraGroupId: flavors }))?.message ?? "", /distintos/);
  assert.match(variantValidationError("p", [], new Set([ingredients]), setup())?.message ?? "", /ya no existe/);
});
