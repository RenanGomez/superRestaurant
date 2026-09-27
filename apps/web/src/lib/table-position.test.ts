import assert from "node:assert/strict";
import test from "node:test";
import { clampTablePosition, savedTablePosition } from "./table-position.js";

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
