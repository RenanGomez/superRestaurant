import assert from "node:assert/strict";
import test from "node:test";
import { dropIndicatorSide, hoverIndexAt, parseReorderIndex, reorder, reorderListSelector, reorderSubset, tentativeOrder } from "./menu-reorder.js";

test("tentativeOrder previews the drag without renumbering or mutating", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(tentativeOrder(list, 1, 1), ["a", "b", "c"]);
  assert.deepEqual(tentativeOrder(list, 0, 2), ["b", "c", "a"]);
  assert.deepEqual(tentativeOrder(list, 2, 0), ["c", "a", "b"]);
  assert.deepEqual(tentativeOrder(list, 2, 1), ["a", "c", "b"]);
  assert.deepEqual(tentativeOrder(list, 0, 9), ["a", "b", "c"]);
  assert.deepEqual(list, ["a", "b", "c"]);
});

test("cancelling a drag is returning to the origin: the tentative order equals the original", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(tentativeOrder(list, 2, 2), list);
  assert.notEqual(tentativeOrder(list, 2, 2), list);
});

test("hoverIndexAt maps a coordinate to a row and clamps at both ends", () => {
  const bounds = [{ bottom: 50, top: 0 }, { bottom: 110, top: 60 }, { bottom: 170, top: 120 }];
  assert.equal(hoverIndexAt(bounds, -20), 0);
  assert.equal(hoverIndexAt(bounds, 70), 1);
  assert.equal(hoverIndexAt(bounds, 55), 1);
  assert.equal(hoverIndexAt(bounds, 400), 2);
  assert.equal(hoverIndexAt([], 10), 0);
});

test("parseReorderIndex accepts only non-negative integers", () => {
  assert.equal(parseReorderIndex("0"), 0);
  assert.equal(parseReorderIndex("12"), 12);
  for (const bad of [null, undefined, "", "-1", "1.5", "x"]) assert.equal(parseReorderIndex(bad), null);
});

test("dropIndicatorSide puts the line after the target when moving down and before when moving up", () => {
  assert.equal(dropIndicatorSide(0, 2), "after");
  assert.equal(dropIndicatorSide(3, 1), "before");
  assert.equal(dropIndicatorSide(2, 2), null);
  assert.equal(dropIndicatorSide(2, null), null);
});

const item = (id: string, displayOrder: number, group = "a") => ({ displayOrder, group, id });
const pairs = (list: readonly { id: string; displayOrder: number }[]) => list.map((entry) => [entry.id, entry.displayOrder]);

test("reorder moves an item and renumbers 1..n", () => {
  assert.deepEqual(pairs(reorder([item("x", 7), item("y", 3), item("z", 9)], 2, 0)), [["z", 1], ["x", 2], ["y", 3]]);
});

test("reorder ignores invalid indexes but still normalizes, without mutating input", () => {
  const input = [item("x", 5), item("y", 9)];
  assert.deepEqual(pairs(reorder(input, 0, 5)), [["x", 1], ["y", 2]]);
  assert.deepEqual(input.map((entry) => entry.id), ["x", "y"]);
});

test("reorderSubset reorders only members and leaves the rest untouched", () => {
  const all = [item("a1", 1), item("b1", 4, "b"), item("a2", 2), item("a3", 3)];
  const result = reorderSubset(all, (entry) => entry.group === "a", 0, 2);
  assert.deepEqual(result.map((entry) => entry.id), ["a2", "b1", "a3", "a1"]);
  assert.deepEqual(result.filter((entry) => entry.group === "a").map((entry) => entry.displayOrder), [1, 2, 3]);
  assert.deepEqual(result[1], all[1]);
});

test("reorderListSelector escapes quotes, backslashes and newlines without CSS", () => {
  assert.equal(reorderListSelector("categories"), '[data-reorder-list="categories"]');
  assert.equal(reorderListSelector("products-abc-123"), '[data-reorder-list="products-abc-123"]');
  assert.equal(reorderListSelector('a"b'), '[data-reorder-list="a\\"b"]');
  assert.equal(reorderListSelector("a\\b"), '[data-reorder-list="a\\\\b"]');
  assert.equal(reorderListSelector("a\nb"), '[data-reorder-list="a\\a b"]');
  assert.equal(reorderListSelector('x"y\\z'), reorderListSelector('x"y\\z'));
});
