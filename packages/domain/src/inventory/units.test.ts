import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFraction,
  assertInventoryQuantity,
  convertPurchaseQuantity,
  InvalidInventoryFactorError,
  InvalidInventoryFractionError,
  InvalidInventoryQuantityError,
  InvalidInventoryUnitError,
  parseInventoryUnit,
  unitsAreEqual,
} from "./units.js";

test("parseInventoryUnit accepts only the three declared inventory units", () => {
  assert.equal(parseInventoryUnit("g"), "g");
  assert.equal(parseInventoryUnit("ml"), "ml");
  assert.equal(parseInventoryUnit("piece"), "piece");
  assert.throws(() => parseInventoryUnit("kg"), InvalidInventoryUnitError);
  assert.throws(() => parseInventoryUnit(""), InvalidInventoryUnitError);
  assert.throws(() => parseInventoryUnit("G"), (error: unknown) => {
    return error instanceof InvalidInventoryUnitError && error.code === "INVALID_INVENTORY_UNIT";
  });
});

test("assertInventoryQuantity rejects negative, decimal, NaN, and unbounded values", () => {
  assert.equal(assertInventoryQuantity(0), 0);
  assert.equal(assertInventoryQuantity(42), 42);
  assert.throws(() => assertInventoryQuantity(-1), InvalidInventoryQuantityError);
  assert.throws(() => assertInventoryQuantity(1.5), InvalidInventoryQuantityError);
  assert.throws(() => assertInventoryQuantity(Number.NaN), InvalidInventoryQuantityError);
  assert.throws(() => assertInventoryQuantity(Number.POSITIVE_INFINITY), InvalidInventoryQuantityError);
});

test("convertPurchaseQuantity multiplies whole quantities by a positive whole factor", () => {
  assert.equal(convertPurchaseQuantity(12, 800), 9600);
  assert.equal(convertPurchaseQuantity(0, 25), 0);
  assert.throws(() => convertPurchaseQuantity(5, 0), InvalidInventoryFactorError);
  assert.throws(() => convertPurchaseQuantity(5, -2), InvalidInventoryFactorError);
  assert.throws(() => convertPurchaseQuantity(5, 1.5), InvalidInventoryFactorError);
  assert.throws(() => convertPurchaseQuantity(-1, 2), InvalidInventoryQuantityError);
  assert.throws(() => convertPurchaseQuantity(Number.MAX_SAFE_INTEGER, 2), (error: unknown) => {
    return error instanceof InvalidInventoryQuantityError && error.code === "INVALID_INVENTORY_QUANTITY";
  });
});

test("applyFraction uses integer arithmetic with half-up rounding and remainder audit", () => {
  assert.deepEqual(applyFraction(150, 1, 2), { quantity: 75, remainder: 0 });
  assert.deepEqual(applyFraction(151, 1, 2), { quantity: 76, remainder: 1 });
  assert.deepEqual(applyFraction(1, 1, 2), { quantity: 1, remainder: 1 });
  assert.deepEqual(applyFraction(3, 1, 3), { quantity: 1, remainder: 0 });
  assert.deepEqual(applyFraction(10, 1, 3), { quantity: 3, remainder: 1 });
  assert.deepEqual(applyFraction(11, 1, 3), { quantity: 4, remainder: 2 });
  assert.throws(() => applyFraction(150, 1, 0), InvalidInventoryFractionError);
  assert.throws(() => applyFraction(150, 0, 2), InvalidInventoryFractionError);
  assert.throws(() => applyFraction(150, -1, 2), InvalidInventoryFractionError);
  assert.throws(() => applyFraction(150, 1, -2), InvalidInventoryFractionError);
  assert.throws(() => applyFraction(150, 1.5, 2), (error: unknown) => {
    return error instanceof InvalidInventoryFractionError && error.code === "INVALID_INVENTORY_FRACTION";
  });
  assert.throws(() => applyFraction(-1, 1, 2), InvalidInventoryQuantityError);
  assert.throws(() => applyFraction(Number.MAX_SAFE_INTEGER, 2, 1), (error: unknown) => {
    return error instanceof InvalidInventoryQuantityError && error.code === "INVALID_INVENTORY_QUANTITY";
  });
});

test("unitsAreEqual compares identical inventory units", () => {
  assert.equal(unitsAreEqual("g", "g"), true);
  assert.equal(unitsAreEqual("piece", "piece"), true);
  assert.equal(unitsAreEqual("g", "ml"), false);
  assert.equal(unitsAreEqual("ml", "piece"), false);
});
