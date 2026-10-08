import assert from "node:assert/strict";
import test from "node:test";
import { shouldRevalidateOnReturn } from "./revalidate-on-return.js";

test("a short absence never revalidates", () => {
  assert.equal(shouldRevalidateOnReturn(1_000, null, 1_000 + 14_999), false);
  assert.equal(shouldRevalidateOnReturn(null, null, 100_000), false);
});

test("a 15 second absence revalidates when nothing ran recently", () => {
  assert.equal(shouldRevalidateOnReturn(1_000, null, 16_000), true);
  assert.equal(shouldRevalidateOnReturn(1_000, 1_000 - 30_000, 16_000), true);
});

test("the cooldown blocks a second run inside 30 seconds", () => {
  assert.equal(shouldRevalidateOnReturn(100_000, 90_000, 119_999), false);
  assert.equal(shouldRevalidateOnReturn(100_000, 90_000, 120_000), true);
});
