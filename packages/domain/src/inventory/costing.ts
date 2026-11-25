import {
  CurrencyMismatchError,
  DomainError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  MoneyOverflowError,
  NegativeMoneyAmountError,
} from "../errors.js";
import type { InventoryMovement } from "./stock-ledger.js";
import { assertInventoryQuantity } from "./units.js";

const ISO_4217_FORMAT = /^[A-Z]{3}$/u;

export interface WeightedCostState {
  quantityOnHand: number;
  valueMinor: number;
  currency: string;
}

export class InventoryInsufficientStockError extends DomainError {
  public readonly code = "INVENTORY_INSUFFICIENT_STOCK";

  public constructor(requested: number, available: number) {
    super("Inventory consumption cannot exceed the quantity on hand.");
    this.requested = requested;
    this.available = available;
  }

  public readonly requested: number;
  public readonly available: number;
}

export class InvalidCostingQuantityError extends DomainError {
  public readonly code = "INVENTORY_COSTING_QUANTITY_INVALID";

  public constructor(quantity: number) {
    super("Costing quantities must be positive safe integers.");
    this.quantity = quantity;
  }

  public readonly quantity: number;
}

export class MarginRevenueZeroError extends DomainError {
  public readonly code = "MARGIN_REVENUE_ZERO";

  public constructor() {
    super("Margin requires a positive revenue amount.");
  }
}

function assertCurrency(currency: string): string {
  if (!ISO_4217_FORMAT.test(currency)) {
    throw new InvalidCurrencyError(currency);
  }

  return currency;
}

function assertNonNegativeMoney(amountMinor: number, field: string): number {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new InvalidMoneyAmountError(amountMinor);
  }
  if (amountMinor < 0) {
    throw new NegativeMoneyAmountError(field);
  }

  return amountMinor;
}

function assertPositiveQuantity(quantity: number): number {
  assertInventoryQuantity(quantity);
  if (quantity === 0) {
    throw new InvalidCostingQuantityError(quantity);
  }

  return quantity;
}

function addSafe(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new MoneyOverflowError();
  }

  return sum;
}

function multiplySafe(left: number, right: number): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyOverflowError();
  }

  return product;
}

function roundHalfUpDivision(numerator: number, denominator: number): number {
  const negative = numerator < 0;
  const magnitude = Math.abs(numerator);
  const quotient = Math.floor(magnitude / denominator);
  const remainder = magnitude - quotient * denominator;
  const rounded = remainder >= denominator - remainder ? quotient + 1 : quotient;

  if (rounded === 0) {
    return 0;
  }

  return negative ? -rounded : rounded;
}

export function emptyCostState(currency: string): WeightedCostState {
  return { quantityOnHand: 0, valueMinor: 0, currency: assertCurrency(currency) };
}

export function applyReceipt(
  state: WeightedCostState,
  receipt: { quantity: number; totalCostMinor: number },
): WeightedCostState {
  const quantity = assertPositiveQuantity(receipt.quantity);
  const totalCostMinor = assertNonNegativeMoney(receipt.totalCostMinor, "totalCostMinor");

  return {
    quantityOnHand: addSafe(state.quantityOnHand, quantity),
    valueMinor: addSafe(state.valueMinor, totalCostMinor),
    currency: state.currency,
  };
}

export function applyConsumption(
  state: WeightedCostState,
  quantity: number,
): { state: WeightedCostState; costMinor: number } {
  assertInventoryQuantity(quantity);
  if (quantity === 0) {
    return { state: { ...state }, costMinor: 0 };
  }
  if (quantity > state.quantityOnHand) {
    throw new InventoryInsufficientStockError(quantity, state.quantityOnHand);
  }

  const costMinor = roundHalfUpDivision(
    multiplySafe(state.valueMinor, quantity),
    state.quantityOnHand,
  );
  const remainingQuantity = state.quantityOnHand - quantity;

  return {
    state: {
      quantityOnHand: remainingQuantity,
      valueMinor:
        remainingQuantity === 0 ? 0 : assertNonNegativeMoney(state.valueMinor - costMinor, "valueMinor"),
      currency: state.currency,
    },
    costMinor,
  };
}

export function applyAdjustment(state: WeightedCostState, delta: number): WeightedCostState {
  if (!Number.isSafeInteger(delta)) {
    throw new InvalidCostingQuantityError(delta);
  }

  const quantityOnHand = state.quantityOnHand + delta;
  if (!Number.isSafeInteger(quantityOnHand) || quantityOnHand < 0) {
    throw new InventoryInsufficientStockError(-delta, state.quantityOnHand);
  }

  return {
    quantityOnHand,
    valueMinor: quantityOnHand === 0 ? 0 : state.valueMinor,
    currency: state.currency,
  };
}

export function recomputeFromLedger(
  movements: readonly InventoryMovement[],
  currency: string,
): WeightedCostState {
  let state = emptyCostState(currency);

  for (const movement of movements) {
    if (movement.currency != null && movement.currency !== currency) {
      throw new CurrencyMismatchError(currency, movement.currency);
    }

    switch (movement.kind) {
      case "receipt":
      case "sale_reversal":
      case "transfer_in": {
        const unitCostMinor = assertNonNegativeMoney(movement.unitCostMinor ?? 0, "unitCostMinor");
        state = applyReceipt(state, {
          quantity: movement.quantityDelta,
          totalCostMinor: multiplySafe(unitCostMinor, movement.quantityDelta),
        });
        break;
      }
      case "sale_consumption":
      case "waste":
      case "transfer_out": {
        state = applyConsumption(state, -movement.quantityDelta).state;
        break;
      }
      case "adjustment":
      case "count_adjustment": {
        state = applyAdjustment(state, movement.quantityDelta);
        break;
      }
    }
  }

  return state;
}

export function marginBps(revenueMinor: number, costMinor: number): number {
  const revenue = assertNonNegativeMoney(revenueMinor, "revenueMinor");
  const cost = assertNonNegativeMoney(costMinor, "costMinor");
  if (revenue === 0) {
    throw new MarginRevenueZeroError();
  }

  return roundHalfUpDivision(multiplySafe(revenue - cost, 10_000), revenue);
}
