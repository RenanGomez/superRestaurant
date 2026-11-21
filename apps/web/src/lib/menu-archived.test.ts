import assert from "node:assert/strict";
import test from "node:test";
import { splitArchivedProducts } from "./menu-archived.js";

const product = (productId: string, active: boolean): { readonly active: boolean; readonly productId: string } => ({ active, productId });

test("separates active products from archived ones keeping their order", () => {
  const sections = splitArchivedProducts([product("a", true), product("b", false), product("c", true), product("d", false)]);
  assert.deepEqual(sections.active.map((entry) => entry.productId), ["a", "c"]);
  assert.deepEqual(sections.archived.map((entry) => entry.productId), ["b", "d"]);
});

test("an all-active or all-archived draft fills only one section", () => {
  assert.deepEqual(splitArchivedProducts([product("a", true)]).archived, []);
  assert.deepEqual(splitArchivedProducts([product("a", false)]).active, []);
  assert.deepEqual(splitArchivedProducts([]), { active: [], archived: [] });
});

test("does not mutate its input", () => {
  const products = [product("a", true), product("b", false)];
  splitArchivedProducts(products);
  assert.deepEqual(products.map((entry) => entry.productId), ["a", "b"]);
  assert.equal(products[1]?.active, false);
});
