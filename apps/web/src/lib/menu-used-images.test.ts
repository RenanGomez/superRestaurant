import assert from "node:assert/strict";
import test from "node:test";
import { collectUsedImagePaths, retainImagePaths } from "./menu-used-images.js";

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
