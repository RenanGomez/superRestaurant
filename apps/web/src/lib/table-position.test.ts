import assert from "node:assert/strict";
import test from "node:test";
import { clampPan, clampTablePosition, firstFreeSlot, moveTableByKeyboard, resizeTableCells, savedTablePosition } from "./table-position.js";

test("pan never leaves the content: flush with the origin or the far edge, fixed when it fits", () => {
  const viewport = { width: 500, height: 400 };
  const content = { width: 600, height: 2100 };
  assert.deepEqual(clampPan({ x: 30, y: 12 }, viewport, content), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: -40, y: -300 }, viewport, content), { x: -40, y: -300 });
  assert.deepEqual(clampPan({ x: -900, y: -9000 }, viewport, content), { x: -100, y: -1700 });
  assert.deepEqual(clampPan({ x: -50, y: -50 }, viewport, { width: 400, height: 300 }), { x: 0, y: 0 });
});

test("resizing moves in whole cells and stays within 2..8 and inside the grid", () => {
  assert.deepEqual(resizeTableCells({ x: 0, y: 0, width: 4, height: 4 }, 1.6, -1.4), { width: 6, height: 3 });
  assert.deepEqual(resizeTableCells({ x: 0, y: 0, width: 4, height: 4 }, 40, 40), { width: 8, height: 8 });
  assert.deepEqual(resizeTableCells({ x: 0, y: 0, width: 4, height: 4 }, -40, -40), { width: 2, height: 2 });
  assert.deepEqual(resizeTableCells({ x: 20, y: 96, width: 4, height: 4 }, 3, 3), { width: 4, height: 4 });
  assert.deepEqual(resizeTableCells({ x: 22, y: 98, width: 2, height: 2 }, 5, 5), { width: 2, height: 2 });
});

test("a new table goes in the first free 4 by 4 slot, row by row", () => {
  assert.deepEqual(firstFreeSlot([]), { x: 0, y: 0 });
  assert.deepEqual(firstFreeSlot([{ x: 0, y: 0, width: 4, height: 4 }]), { x: 4, y: 0 });
  assert.deepEqual(firstFreeSlot([{ x: 1, y: 0, width: 2, height: 2 }]), { x: 3, y: 0 });
  const fullRow = Array.from({ length: 6 }, (_, index) => ({ x: index * 4, y: 0, width: 4, height: 4 }));
  assert.deepEqual(firstFreeSlot(fullRow), { x: 0, y: 4 });
  const full = Array.from({ length: 25 }, (_, row) => ({ x: 0, y: row * 4, width: 24, height: 4 }));
  assert.equal(firstFreeSlot(full), undefined);
});

test("movement stays within the 24 by 100 canvas, accounting for table size", () => {
  assert.deepEqual(clampTablePosition({ x: -2, y: 120 }, 4, 6), { x: 0, y: 94 });
  assert.deepEqual(clampTablePosition({ x: 22, y: -1 }, 4, 6), { x: 20, y: 0 });
});

test("the server receives integer grid coordinates after pixel movement", () => {
  assert.deepEqual(savedTablePosition({ x: 1.6, y: 2.4 }, 4, 4), { x: 2, y: 2 });
  assert.deepEqual(savedTablePosition({ x: 24, y: 100 }, 8, 8), { x: 16, y: 92 });
});

test("shrinking a table allows movement into the newly available edge cells", () => {
  assert.deepEqual(clampTablePosition({ x: 22, y: 98 }, 4, 4), { x: 20, y: 96 });
  assert.deepEqual(clampTablePosition({ x: 22, y: 98 }, 2, 2), { x: 22, y: 98 });
  assert.deepEqual(savedTablePosition({ x: 22, y: 98 }, 2, 2), { x: 22, y: 98 });
});

test("each arrow moves one saved grid cell, or four with Shift", () => {
  const start = { x: 5, y: 6 };
  assert.deepEqual(moveTableByKeyboard(start, "ArrowRight", false, 4, 4), { x: 6, y: 6 });
  assert.deepEqual(moveTableByKeyboard(start, "ArrowDown", true, 4, 4), { x: 5, y: 10 });
  assert.deepEqual(moveTableByKeyboard({ x: 5.2, y: 6.2 }, "ArrowLeft", false, 4, 4), { x: 4, y: 6 });
  assert.deepEqual(moveTableByKeyboard({ x: 19, y: 95 }, "ArrowRight", true, 4, 4), { x: 20, y: 95 });
});
