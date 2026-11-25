import { DomainError } from "../errors.js";

export type InventoryUnit = "g" | "ml" | "piece";

const INVENTORY_UNITS: readonly InventoryUnit[] = ["g", "ml", "piece"];

export class InvalidInventoryUnitError extends DomainError {
  public readonly code = "INVALID_INVENTORY_UNIT";

  public constructor(unit: string) {
    super("Inventory unit must be one of g, ml, or piece.");
    this.unit = unit;
  }

  public readonly unit: string;
}

export class InvalidInventoryQuantityError extends DomainError {
  public readonly code = "INVALID_INVENTORY_QUANTITY";

  public constructor(quantity: number) {
    super("Inventory quantity must be a non-negative safe integer.");
    this.quantity = quantity;
  }

  public readonly quantity: number;
}

export class InvalidInventoryFactorError extends DomainError {
  public readonly code = "INVALID_INVENTORY_FACTOR";

  public constructor(factor: number) {
    super("Inventory purchase factor must be a positive safe integer.");
    this.factor = factor;
  }

  public readonly factor: number;
}

export class InvalidInventoryFractionError extends DomainError {
  public readonly code = "INVALID_INVENTORY_FRACTION";

  public constructor(numerator: number, denominator: number) {
    super("Inventory fractions require a positive safe-integer numerator and denominator.");
    this.numerator = numerator;
    this.denominator = denominator;
  }

  public readonly numerator: number;
  public readonly denominator: number;
}

export function parseInventoryUnit(value: string): InventoryUnit {
  if (!INVENTORY_UNITS.includes(value as InventoryUnit)) {
    throw new InvalidInventoryUnitError(value);
  }

  return value as InventoryUnit;
}

export function assertInventoryQuantity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidInventoryQuantityError(value);
  }

  return value;
}

export function convertPurchaseQuantity(quantity: number, factor: number): number {
  const base = assertInventoryQuantity(quantity);
  if (!Number.isSafeInteger(factor) || factor <= 0) {
    throw new InvalidInventoryFactorError(factor);
  }

  const converted = base * factor;
  if (!Number.isSafeInteger(converted)) {
    throw new InvalidInventoryQuantityError(converted);
  }

  return converted;
}

/**
 * Applies a fraction to a whole inventory quantity using integer math.
 *
 * `quantity` is the rounded result (half-up) of `(quantity * numerator) / denominator`.
 * `remainder` is the exact leftover of `(quantity * numerator) % denominator`
 * (0 … denominator - 1) that was not applied to the rounded quantity.
 */
export function applyFraction(
  quantity: number,
  numerator: number,
  denominator: number,
): { quantity: number; remainder: number } {
  const base = assertInventoryQuantity(quantity);
  if (!Number.isSafeInteger(numerator) || numerator <= 0) {
    throw new InvalidInventoryFractionError(numerator, denominator);
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new InvalidInventoryFractionError(numerator, denominator);
  }

  const product = base * numerator;
  if (!Number.isSafeInteger(product)) {
    throw new InvalidInventoryQuantityError(product);
  }

  const whole = Math.floor(product / denominator);
  const residual = product - whole * denominator;
  if (residual === 0) {
    return { quantity: whole, remainder: 0 };
  }

  const rounded = residual >= denominator - residual ? whole + 1 : whole;
  if (!Number.isSafeInteger(rounded)) {
    throw new InvalidInventoryQuantityError(rounded);
  }

  return { quantity: rounded, remainder: residual };
}

/**
 * Compares that both sides are the same inventory unit.
 */
export function unitsAreCompatible(left: InventoryUnit, right: InventoryUnit): boolean {
  return left === right;
}
