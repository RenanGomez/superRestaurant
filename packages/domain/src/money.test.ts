import assert from "node:assert/strict";
import test from "node:test";

import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  InvalidMoneyRoundingModeError,
  InvalidRatioError,
  Money,
  MoneyOverflowError,
} from "./index.js";

const MONEY_PROPERTY_SEED = 0x5eedc0de;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const roundingModes = ["trunc", "floor", "ceil", "half-away-from-zero"] as const;

test("Money only accepts safe integer minor units and uppercase ISO-4217 format", () => {
  assert.throws(() => new Money(1.25, "MXN"), InvalidMoneyAmountError);
  assert.throws(() => new Money(Number.MAX_SAFE_INTEGER + 1, "MXN"), InvalidMoneyAmountError);
  assert.throws(() => new Money(1, "mxn"), InvalidCurrencyError);
  assert.throws(() => new Money(1, "US"), InvalidCurrencyError);
  assert.throws(() => new Money(1, "USD "), InvalidCurrencyError);
  assert.deepEqual(new Money(1, "XTS"), new Money(1, "XTS"));
});

test("Money is immutable and adds, subtracts, and compares within one currency", () => {
  const subtotal = new Money(250, "MXN");
  const tax = new Money(40, "MXN");

  assert.equal(Object.isFrozen(subtotal), true);
  assert.deepEqual(subtotal.add(tax), new Money(290, "MXN"));
  assert.deepEqual(subtotal.subtract(tax), new Money(210, "MXN"));
  assert.equal(subtotal.compare(tax), 1);
  assert.equal(subtotal.equals(new Money(250, "MXN")), true);
});

test("Money rejects operations across currencies", () => {
  const pesos = new Money(100, "MXN");
  const dollars = new Money(100, "USD");

  assert.throws(() => pesos.add(dollars), CurrencyMismatchError);
  assert.throws(() => pesos.subtract(dollars), CurrencyMismatchError);
  assert.throws(() => pesos.compare(dollars), CurrencyMismatchError);
});

test("Money detects addition and ratio overflow", () => {
  assert.throws(
    () => new Money(Number.MAX_SAFE_INTEGER, "USD").add(new Money(1, "USD")),
    MoneyOverflowError,
  );
  assert.throws(
    () => new Money(Number.MIN_SAFE_INTEGER, "USD").subtract(new Money(1, "USD")),
    MoneyOverflowError,
  );
  assert.throws(
    () => new Money(Number.MAX_SAFE_INTEGER, "USD").multiplyRatio(2n, 1n),
    MoneyOverflowError,
  );
});

test("Money ratio arithmetic is exact and defaults to half-away-from-zero ties", () => {
  assert.equal(new Money(99, "MXN").multiplyRatio(7n, 4n).amountMinor, 173);
  assert.equal(new Money(5, "MXN").multiplyRatio(1n, 2n).amountMinor, 3);
  assert.equal(new Money(-5, "MXN").multiplyRatio(1n, 2n).amountMinor, -3);
  assert.equal(new Money(4, "MXN").multiplyRatio(1n, 3n).amountMinor, 1);
  assert.equal(new Money(-4, "MXN").multiplyRatio(1n, 3n).amountMinor, -1);
});

test("Money supports explicit exact rounding modes for positive and negative values", () => {
  const positive = new Money(5, "MXN");
  const negative = new Money(-5, "MXN");

  assert.equal(positive.multiplyRatio(1n, 2n, "trunc").amountMinor, 2);
  assert.equal(negative.multiplyRatio(1n, 2n, "trunc").amountMinor, -2);
  assert.equal(positive.multiplyRatio(1n, 2n, "floor").amountMinor, 2);
  assert.equal(negative.multiplyRatio(1n, 2n, "floor").amountMinor, -3);
  assert.equal(positive.multiplyRatio(1n, 2n, "ceil").amountMinor, 3);
  assert.equal(negative.multiplyRatio(1n, 2n, "ceil").amountMinor, -2);
  assert.equal(positive.multiplyRatio(1n, 2n, "half-away-from-zero").amountMinor, 3);
  assert.equal(negative.multiplyRatio(1n, 2n, "half-away-from-zero").amountMinor, -3);
  assert.throws(() => positive.multiplyRatio(1n, 0n), InvalidRatioError);
  assert.throws(
    () => positive.multiplyRatio(1n, 2n, "bankers" as never),
    InvalidMoneyRoundingModeError,
  );
});

test("Money property: BigInt arithmetic, rounding, signs, ties, and safe-integer boundaries stay exact", () => {
  const random = deterministicRandom(MONEY_PROPERTY_SEED);
  const amounts = [
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER - 1,
    Number.MIN_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER + 1,
    5,
    -5,
  ];

  for (let caseIndex = 0; caseIndex < 96; caseIndex += 1) {
    const amount = caseIndex < amounts.length ? amounts[caseIndex]! : propertyAmount(random);
    const other = caseIndex < amounts.length ? amounts[(caseIndex + 1) % amounts.length]! : propertyAmount(random);
    const numerator = caseIndex < 8 ? [-3n, -1n, 0n, 1n, 3n, 7n, -7n, 2n][caseIndex]! : BigInt(random.int(-9, 9));
    const denominator = caseIndex < 4 ? 2n : BigInt(random.int(1, 9));
    const money = new Money(amount, "MXN");

    assertMoneyResult(() => money.add(new Money(other, "MXN")), BigInt(amount) + BigInt(other), `add case ${caseIndex}`);
    assertMoneyResult(() => money.subtract(new Money(other, "MXN")), BigInt(amount) - BigInt(other), `subtract case ${caseIndex}`);

    for (const roundingMode of roundingModes) {
      const expected = roundRatio(BigInt(amount) * numerator, denominator, roundingMode);
      assertMoneyResult(
        () => money.multiplyRatio(numerator, denominator, roundingMode),
        expected,
        `ratio case ${caseIndex} (${roundingMode})`,
      );
    }
  }
});

function assertMoneyResult(operation: () => Money, expected: bigint, label: string): void {
  if (expected > MAX_SAFE_INTEGER_BIGINT || expected < MIN_SAFE_INTEGER_BIGINT) {
    assert.throws(operation, MoneyOverflowError, label);
    return;
  }

  assert.equal(operation().amountMinor, Number(expected), label);
}

function roundRatio(
  dividend: bigint,
  denominator: bigint,
  roundingMode: (typeof roundingModes)[number],
): bigint {
  const quotient = dividend / denominator;
  const remainder = dividend % denominator;
  if (remainder === 0n || roundingMode === "trunc") return quotient;

  if (roundingMode === "floor") return dividend < 0n ? quotient - 1n : quotient;
  if (roundingMode === "ceil") return dividend > 0n ? quotient + 1n : quotient;

  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  return absoluteRemainder * 2n < denominator
    ? quotient
    : dividend < 0n ? quotient - 1n : quotient + 1n;
}

function propertyAmount(random: ReturnType<typeof deterministicRandom>): number {
  switch (random.int(0, 5)) {
    case 0:
      return Number.MAX_SAFE_INTEGER - random.int(0, 32);
    case 1:
      return Number.MIN_SAFE_INTEGER + random.int(0, 32);
    default:
      return random.int(-1_000_000, 1_000_000);
  }
}

function deterministicRandom(seed: number): { int(min: number, max: number): number } {
  let state = seed >>> 0;
  return {
    int(min: number, max: number): number {
      state = (state * 1664525 + 1013904223) >>> 0;
      return min + (state % (max - min + 1));
    },
  };
}
