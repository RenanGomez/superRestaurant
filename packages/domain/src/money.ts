import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyRoundingModeError,
  InvalidMoneyAmountError,
  InvalidRatioError,
  MoneyOverflowError,
} from "./errors.js";

export type MoneyRoundingMode = "trunc" | "floor" | "ceil" | "half-away-from-zero";

const ISO_4217_FORMAT = /^[A-Z]{3}$/u;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Immutable monetary value in the currency's minor unit.
 *
 * Amounts are represented as safe JavaScript integers at the public boundary.
 * Arithmetic and ratio rounding use BigInt internally, then reject values outside
 * the safe-integer range. Ratio division never converts through Number/float.
 * The default tie policy is symmetric half-away-from-zero.
 */
export class Money {
  public readonly amountMinor: number;
  public readonly currency: string;

  public constructor(amountMinor: number, currency: string) {
    assertSafeInteger(amountMinor);
    assertCurrencyFormat(currency);

    this.amountMinor = amountMinor;
    this.currency = currency;
    Object.freeze(this);
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return this.withAmount(BigInt(this.amountMinor) + BigInt(other.amountMinor));
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return this.withAmount(BigInt(this.amountMinor) - BigInt(other.amountMinor));
  }

  public compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);

    if (this.amountMinor < other.amountMinor) {
      return -1;
    }

    if (this.amountMinor > other.amountMinor) {
      return 1;
    }

    return 0;
  }

  public multiplyRatio(
    numerator: bigint,
    denominator: bigint,
    roundingMode: MoneyRoundingMode = "half-away-from-zero",
  ): Money {
    assertRoundingMode(roundingMode);
    if (denominator <= 0n) {
      throw new InvalidRatioError();
    }

    const dividend = BigInt(this.amountMinor) * numerator;
    return this.withAmount(roundQuotient(dividend, denominator, roundingMode));
  }

  public equals(other: Money): boolean {
    return this.amountMinor === other.amountMinor && this.currency === other.currency;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  private withAmount(amountMinor: bigint): Money {
    return new Money(toSafeInteger(amountMinor), this.currency);
  }
}

function assertRoundingMode(roundingMode: unknown): asserts roundingMode is MoneyRoundingMode {
  if (
    roundingMode !== "trunc"
    && roundingMode !== "floor"
    && roundingMode !== "ceil"
    && roundingMode !== "half-away-from-zero"
  ) {
    throw new InvalidMoneyRoundingModeError(roundingMode);
  }
}

function assertSafeInteger(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new InvalidMoneyAmountError(amountMinor);
  }
}

function assertCurrencyFormat(currency: string): void {
  if (!ISO_4217_FORMAT.test(currency)) {
    throw new InvalidCurrencyError(currency);
  }
}

function toSafeInteger(amountMinor: bigint): number {
  if (amountMinor > MAX_SAFE_INTEGER_BIGINT || amountMinor < MIN_SAFE_INTEGER_BIGINT) {
    throw new MoneyOverflowError();
  }

  return Number(amountMinor);
}

function roundQuotient(
  dividend: bigint,
  denominator: bigint,
  roundingMode: MoneyRoundingMode,
): bigint {
  const quotient = dividend / denominator;
  const remainder = dividend % denominator;

  if (remainder === 0n || roundingMode === "trunc") {
    return quotient;
  }

  if (roundingMode === "floor") {
    return dividend < 0n ? quotient - 1n : quotient;
  }

  if (roundingMode === "ceil") {
    return dividend > 0n ? quotient + 1n : quotient;
  }

  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  if (absoluteRemainder * 2n < denominator) {
    return quotient;
  }

  return dividend < 0n ? quotient - 1n : quotient + 1n;
}
