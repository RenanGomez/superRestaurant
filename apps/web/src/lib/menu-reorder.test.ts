import assert from "node:assert/strict";
import test from "node:test";
import { dropIndicatorSide, parseReorderIndex, reorder, reorderSubset } from "./menu-reorder.js";

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
