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
  unitsAreCompatible,
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
});

test("applyFraction uses integer arithmetic with half-up rounding and remainder audit", () => {
  assert.deepEqual(applyFraction(150, 1, 2), { quantity: 75, remainder: 0 });
  assert.deepEqual(applyFraction(151, 1, 2), { quantity: 76, remainder: 1 });
  assert.deepEqual(applyFraction(1, 1, 2), { quantity: 1, remainder: 1 });
  assert.deepEqual(applyFraction(3, 1, 3), { quantity: 1, remainder: 0 });
  assert.deepEqual(applyFraction(10, 1, 3), { quantity: 3, remainder: 1 });
  assert.throws(() => applyFraction(150, 1, 0), InvalidInventoryFractionError);
  assert.throws(() => applyFraction(150, 0, 2), InvalidInventoryFractionError);
  assert.throws(() => applyFraction(150, -1, 2), InvalidInventoryFractionError);
  assert.throws(() => applyFraction(150, 1, -2), InvalidInventoryFractionError);
  assert.throws(() => applyFraction(150, 1.5, 2), (error: unknown) => {
    return error instanceof InvalidInventoryFractionError && error.code === "INVALID_INVENTORY_FRACTION";
  });
  assert.throws(() => applyFraction(-1, 1, 2), InvalidInventoryQuantityError);
});

test("unitsAreCompatible compares the unit dimension", () => {
  assert.equal(unitsAreCompatible("g", "g"), true);
  assert.equal(unitsAreCompatible("piece", "piece"), true);
  assert.equal(unitsAreCompatible("g", "ml"), false);
  assert.equal(unitsAreCompatible("ml", "piece"), false);
});
