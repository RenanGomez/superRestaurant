import assert from "node:assert/strict";
import test from "node:test";
import { tableShapeClass } from "./table-shape.js";

test("each table shape maps to a distinct corner class", () => {
  assert.equal(tableShapeClass("round"), "rounded-full");
  assert.equal(tableShapeClass("square"), "rounded-sm");
  assert.equal(tableShapeClass("rectangle"), "rounded-md");
  assert.equal(tableShapeClass("unknown"), "rounded-md");
  assert.equal(new Set(["round", "square", "rectangle"].map(tableShapeClass)).size, 3);
});
