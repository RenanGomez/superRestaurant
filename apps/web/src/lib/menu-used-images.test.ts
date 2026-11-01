import assert from "node:assert/strict";
import test from "node:test";
import { collectUsedImagePaths, imagePathsOfEntity, retainImagePaths } from "./menu-used-images.js";

const R = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-8222-222222222222";
const P2 = "33333333-3333-4333-8333-333333333333";
const O1 = "44444444-4444-4444-8444-444444444444";
const file = "0123456789abcdef0123456789abcdef.png";

test("only photos of the entity itself are offered", () => {
  const mine = `${R}/products/${P1}/${file}`;
  const paths = [mine, `${R}/products/${P2}/${file}`, `${R}/options/${O1}/${file}`, "bad"];
  assert.deepEqual(imagePathsOfEntity(paths, P1), [mine]);
  assert.deepEqual(imagePathsOfEntity(paths, O1), [`${R}/options/${O1}/${file}`]);
  assert.deepEqual(imagePathsOfEntity(paths, "x"), []);
});

const option = (imagePath: string | null) => ({ active: true, imagePath, maximumQuantity: null, name: "o", optionId: "o", unitPriceMinor: 0 });

test("collects distinct product and option paths, products first, skipping nulls", () => {
  const paths = collectUsedImagePaths(
    [{ imagePath: "a" }, { imagePath: null }, { imagePath: "b" }, { imagePath: "a" }],
    [{ options: [option("c"), option(null), option("b")] }, { options: [option("d")] }],
  );
  assert.deepEqual(paths, ["a", "b", "c", "d"]);
});

test("an empty draft has no used photos", () => {
  assert.deepEqual(collectUsedImagePaths([], []), []);
});

test("retained paths keep a removed photo and add new ones without duplicates", () => {
  const first = retainImagePaths([], ["a", "b"]);
  const afterRemoval = retainImagePaths(first, ["b"]);
  assert.deepEqual(afterRemoval, ["a", "b"]);
  assert.equal(afterRemoval, first);
  assert.deepEqual(retainImagePaths(afterRemoval, ["b", "c"]), ["a", "b", "c"]);
});

test("category images are collected after products and options and belong to their own id", () => {
  const category = "11111111-1111-4111-8111-111111111111";
  const path = `r/categories/${category}/0123456789abcdef0123456789abcdef.png`;
  const paths = collectUsedImagePaths([{ imagePath: "r/products/p/a.png" }], [], [{ imagePath: path }, { imagePath: null }]);
  assert.deepEqual(paths, ["r/products/p/a.png", path]);
  assert.deepEqual(imagePathsOfEntity(paths, category), [path]);
});
