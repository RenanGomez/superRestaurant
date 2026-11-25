import { DomainError } from "../errors.js";
import { parseInventoryUnit, type InventoryUnit } from "./units.js";

export type MovementKind =
  | "receipt"
  | "sale_consumption"
  | "sale_reversal"
  | "waste"
  | "adjustment"
  | "transfer_out"
  | "transfer_in"
  | "count_adjustment";

export interface InventoryMovement {
  id: string;
  warehouseId: string;
  itemId: string;
  kind: MovementKind;
  quantityDelta: number;
  unit: InventoryUnit;
  occurredAt: string;
  actorId: string;
  reason: string | null;
  idempotencyKey: string;
  compensatesMovementId?: string | null;
  unitCostMinor?: number | null;
  currency?: string | null;
}

export class InvalidMovementQuantityError extends DomainError {
  public readonly code = "INVALID_INVENTORY_MOVEMENT_QUANTITY";

  public constructor(quantityDelta: number) {
    super("Inventory movement quantityDelta must be a non-zero safe integer.");
    this.quantityDelta = quantityDelta;
  }

  public readonly quantityDelta: number;
}

export class ZeroMovementQuantityError extends DomainError {
  public readonly code = "INVENTORY_MOVEMENT_QUANTITY_ZERO";

  public constructor() {
    super("Inventory movement quantityDelta must be different from zero.");
  }
}

export class MovementReasonRequiredError extends DomainError {
  public readonly code = "INVENTORY_MOVEMENT_REASON_REQUIRED";

  public constructor(kind: MovementKind) {
    super(`Inventory movement ${kind} requires a non-empty reason.`);
    this.kind = kind;
  }

  public readonly kind: MovementKind;
}

export class MovementActorRequiredError extends DomainError {
  public readonly code = "INVENTORY_MOVEMENT_ACTOR_REQUIRED";

  public constructor(kind: MovementKind) {
    super(`Inventory movement ${kind} requires a non-empty actorId.`);
    this.kind = kind;
  }

  public readonly kind: MovementKind;
}

export class SaleConsumptionIdempotencyKeyRequiredError extends DomainError {
  public readonly code = "INVENTORY_SALE_CONSUMPTION_KEY_REQUIRED";

  public constructor() {
    super("Inventory sale consumption requires a non-empty idempotency key.");
  }
}

export class SaleReversalCompensationRequiredError extends DomainError {
  public readonly code = "INVENTORY_SALE_REVERSAL_COMPENSATION_REQUIRED";

  public constructor() {
    super("Inventory sale reversal requires a compensatesMovementId reference.");
  }
}

export class TransferPairRequiredError extends DomainError {
  public readonly code = "INVENTORY_TRANSFER_PAIR_REQUIRED";

  public constructor(kind: "transfer_out" | "transfer_in") {
    super(`Inventory ${kind} requires the compensating movement reference of its transfer pair.`);
    this.kind = kind;
  }

  public readonly kind: "transfer_out" | "transfer_in";
}

export class InvalidTransferDirectionError extends DomainError {
  public readonly code = "INVALID_INVENTORY_TRANSFER_DIRECTION";

  public constructor(kind: "transfer_out" | "transfer_in", quantityDelta: number) {
    super("Inventory transfer_out must be negative and transfer_in must be positive.");
    this.kind = kind;
    this.quantityDelta = quantityDelta;
  }

  public readonly kind: "transfer_out" | "transfer_in";
  public readonly quantityDelta: number;
}

export class TransferPairMismatchError extends DomainError {
  public readonly code = "INVENTORY_TRANSFER_PAIR_MISMATCH";

  public constructor(reason: "kinds" | "item" | "unit" | "quantity" | "warehouse") {
    super(`Inventory transfer pair is inconsistent at ${reason}.`);
    this.reason = reason;
  }

  public readonly reason: "kinds" | "item" | "unit" | "quantity" | "warehouse";
}

const MANUAL_KINDS: ReadonlySet<MovementKind> = new Set<MovementKind>([
  "waste",
  "adjustment",
  "count_adjustment",
  "transfer_out",
  "transfer_in",
]);

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function balanceKey(movement: InventoryMovement): string {
  return `${movement.warehouseId}:${movement.itemId}`;
}

export function validateMovement(movement: InventoryMovement): void {
  if (!Number.isSafeInteger(movement.quantityDelta)) {
    throw new InvalidMovementQuantityError(movement.quantityDelta);
  }
  if (movement.quantityDelta === 0) {
    throw new ZeroMovementQuantityError();
  }

  parseInventoryUnit(movement.unit);

  if (MANUAL_KINDS.has(movement.kind)) {
    if (!isNonEmpty(movement.reason)) {
      throw new MovementReasonRequiredError(movement.kind);
    }
    if (!isNonEmpty(movement.actorId)) {
      throw new MovementActorRequiredError(movement.kind);
    }
  }

  if (movement.kind === "sale_consumption" && !isNonEmpty(movement.idempotencyKey)) {
    throw new SaleConsumptionIdempotencyKeyRequiredError();
  }

  if (movement.kind === "sale_reversal" && !isNonEmpty(movement.compensatesMovementId)) {
    throw new SaleReversalCompensationRequiredError();
  }

  if (movement.kind === "transfer_out" || movement.kind === "transfer_in") {
    if (!isNonEmpty(movement.compensatesMovementId)) {
      throw new TransferPairRequiredError(movement.kind);
    }
    if (movement.kind === "transfer_out" && movement.quantityDelta > 0) {
      throw new InvalidTransferDirectionError(movement.kind, movement.quantityDelta);
    }
    if (movement.kind === "transfer_in" && movement.quantityDelta < 0) {
      throw new InvalidTransferDirectionError(movement.kind, movement.quantityDelta);
    }
  }
}

export function applyMovement(
  balances: Record<string, number>,
  movement: InventoryMovement,
): Record<string, number> {
  const key = balanceKey(movement);
  const current = balances[key] ?? 0;

  return { ...balances, [key]: current + movement.quantityDelta };
}

export function sumBalances(movements: readonly InventoryMovement[]): Record<string, number> {
  return movements.reduce<Record<string, number>>(
    (balances, movement) => applyMovement(balances, movement),
    {},
  );
}

export function reconcileBalances(
  stored: Record<string, number>,
  movements: readonly InventoryMovement[],
): { ok: boolean; diffs: Array<{ key: string; stored: number; expected: number }> } {
  const expected = sumBalances(movements);
  const keys = new Set([...Object.keys(stored), ...Object.keys(expected)]);
  const diffs: Array<{ key: string; stored: number; expected: number }> = [];

  for (const key of [...keys].sort()) {
    const storedQuantity = stored[key] ?? 0;
    const expectedQuantity = expected[key] ?? 0;
    if (storedQuantity !== expectedQuantity) {
      diffs.push({ key, stored: storedQuantity, expected: expectedQuantity });
    }
  }

  return { ok: diffs.length === 0, diffs };
}

export function validateTransferPair(
  transferOut: InventoryMovement,
  transferIn: InventoryMovement,
): void {
  validateMovement(transferOut);
  validateMovement(transferIn);

  if (transferOut.kind !== "transfer_out" || transferIn.kind !== "transfer_in") {
    throw new TransferPairMismatchError("kinds");
  }
  if (transferOut.itemId !== transferIn.itemId) {
    throw new TransferPairMismatchError("item");
  }
  if (transferOut.unit !== transferIn.unit) {
    throw new TransferPairMismatchError("unit");
  }
  if (transferOut.quantityDelta + transferIn.quantityDelta !== 0) {
    throw new TransferPairMismatchError("quantity");
  }
  if (transferOut.warehouseId === transferIn.warehouseId) {
    throw new TransferPairMismatchError("warehouse");
  }
}
