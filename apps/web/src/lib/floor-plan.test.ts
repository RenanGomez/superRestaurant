import assert from "node:assert/strict";
import test from "node:test";
import { planCanvasStyle, planPlacement, planViewBox } from "./floor-plan.js";

test("view box wraps the tables with margin and never shrinks below the minimum", () => {
  const box = planViewBox([{ x: 0, y: 0, width: 4, height: 4 }, { x: 10, y: 2, width: 4, height: 4 }]);
  assert.equal(box.cols, 16);
  assert.equal(box.rows, 8);
  assert.equal(box.x, -1);
  assert.equal(box.y, -1);
  const tiny = planViewBox([{ x: 5, y: 5, width: 2, height: 2 }]);
  assert.equal(tiny.cols, 8);
  assert.equal(tiny.rows, 6);
  assert.deepEqual(planViewBox([]), { x: 0, y: 0, cols: 24, rows: 6 });
});

test("a table at the grid origin sits inside the margin, not on the canvas edge", () => {
  const rect = { x: 0, y: 0, width: 4, height: 4 };
  const placement = planPlacement(rect, planViewBox([rect]));
  assert.ok(Number.parseFloat(placement.left) > 0);
  assert.ok(Number.parseFloat(placement.top) > 0);
});

test("placement is clamped so no table leaves the canvas", () => {
  const box = { x: 0, y: 0, cols: 10, rows: 10 };
  const placement = planPlacement({ x: 8, y: -3, width: 4, height: 4 }, box);
  assert.equal(placement.left, "80%");
  assert.equal(placement.top, "0%");
  assert.equal(placement.width, "20%");
  assert.equal(placement.height, "40%");
});

test("canvas keeps the plan proportion, fills the width and caps the height", () => {
  const style = planCanvasStyle({ x: 0, y: 0, cols: 20, rows: 10 });
  assert.equal(style.aspectRatio, "20 / 10");
  assert.equal(style.width, "min(100%, 140vh)");
  assert.equal(style.minWidth, "280px");
});
