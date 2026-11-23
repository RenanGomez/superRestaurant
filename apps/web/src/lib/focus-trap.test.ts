import assert from "node:assert/strict";
import test from "node:test";
import { trapFocusIndex } from "./focus-trap.js";

test("trapFocusIndex wraps at both ends and leaves the middle to the browser", () => {
  assert.equal(trapFocusIndex(3, 2, false), 0);
  assert.equal(trapFocusIndex(3, 0, true), 2);
  assert.equal(trapFocusIndex(3, 1, false), null);
  assert.equal(trapFocusIndex(3, 1, true), null);
});

test("trapFocusIndex pulls outside focus in and ignores an empty dialog", () => {
  assert.equal(trapFocusIndex(3, -1, false), 0);
  assert.equal(trapFocusIndex(3, -1, true), 2);
  assert.equal(trapFocusIndex(0, -1, false), null);
  assert.equal(trapFocusIndex(1, 0, false), 0);
});
