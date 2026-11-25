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
  restaurantId: string;
  branchId: string;
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

export interface InventoryScope {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly warehouseIds: readonly string[];
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

export class MovementScopeMismatchError extends DomainError {
  public readonly code = "INVENTORY_SCOPE_MISMATCH";

  public constructor(field: "restaurantId" | "branchId" | "warehouseId") {
    super(`Inventory movement ${field} is outside the authorized restaurant/branch scope.`);
    this.field = field;
  }

  public readonly field: "restaurantId" | "branchId" | "warehouseId";
}

export class InvalidMovementTimestampError extends DomainError {
  public readonly code = "INVALID_MOVEMENT_TIMESTAMP";

  public constructor(occurredAt: string) {
    super("Inventory movement occurredAt must be a canonical ISO-8601 UTC timestamp.");
    this.occurredAt = occurredAt;
  }

  public readonly occurredAt: string;
}

export class InventoryIdempotencyConflictError extends DomainError {
  public readonly code = "INVENTORY_IDEMPOTENCY_CONFLICT";

  public constructor(idempotencyKey: string) {
    super("An inventory idempotency key cannot be reused with a different payload.");
    this.idempotencyKey = idempotencyKey;
  }

  public readonly idempotencyKey: string;
}

export class InventoryBalanceOverflowError extends DomainError {
  public readonly code = "INVENTORY_BALANCE_OVERFLOW";

  public constructor(key: string) {
    super("Inventory balance accumulation exceeds the JavaScript safe-integer range.");
    this.key = key;
  }

  public readonly key: string;
}

export class InvalidInventoryBalanceError extends DomainError {
  public readonly code = "INVALID_INVENTORY_BALANCE";

  public constructor(key: string, value: number) {
    super("Inventory balances must be safe integers.");
    this.key = key;
    this.value = value;
  }

  public readonly key: string;
  public readonly value: number;
}

const MANUAL_KINDS: ReadonlySet<MovementKind> = new Set<MovementKind>([
  "waste",
  "adjustment",
  "count_adjustment",
  "sale_reversal",
  "transfer_out",
  "transfer_in",
]);

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function balanceKey(movement: InventoryMovement): string {
  return `${movement.warehouseId}:${movement.itemId}`;
}

interface SeenMovements {
  readonly ids: Set<string>;
  readonly idempotencyKeys: Map<string, string>;
}

const ledgerSeen = new WeakMap<Record<string, number>, SeenMovements>();

function movementPayload(movement: InventoryMovement): string {
  return JSON.stringify([
    movement.id,
    movement.restaurantId,
    movement.branchId,
    movement.warehouseId,
    movement.itemId,
    movement.kind,
    movement.quantityDelta,
    movement.unit,
    movement.occurredAt,
    movement.actorId,
    movement.reason,
    movement.idempotencyKey,
    movement.compensatesMovementId ?? null,
    movement.unitCostMinor ?? null,
    movement.currency ?? null,
  ]);
}

function cloneBalances(
  balances: Record<string, number>,
  seen: SeenMovements,
): Record<string, number> {
  const next = { ...balances };
  ledgerSeen.set(next, seen);
  return next;
}

export function validateMovementInScope(movement: InventoryMovement, scope: InventoryScope): void {
  validateMovement(movement);
  if (!isNonEmpty(scope.restaurantId) || movement.restaurantId !== scope.restaurantId) {
    throw new MovementScopeMismatchError("restaurantId");
  }
  if (!isNonEmpty(scope.branchId) || movement.branchId !== scope.branchId) {
    throw new MovementScopeMismatchError("branchId");
  }
  if (!scope.warehouseIds.includes(movement.warehouseId)) {
    throw new MovementScopeMismatchError("warehouseId");
  }
}

export function validateMovement(movement: InventoryMovement): void {
  if (!Number.isSafeInteger(movement.quantityDelta)) {
    throw new InvalidMovementQuantityError(movement.quantityDelta);
  }
  if (movement.quantityDelta === 0) {
    throw new ZeroMovementQuantityError();
  }

  parseInventoryUnit(movement.unit);

  if (!isCanonicalUtcTimestamp(movement.occurredAt)) {
    throw new InvalidMovementTimestampError(movement.occurredAt);
  }

  if (!isNonEmpty(movement.restaurantId)) {
    throw new MovementScopeMismatchError("restaurantId");
  }
  if (!isNonEmpty(movement.branchId)) {
    throw new MovementScopeMismatchError("branchId");
  }

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
  const seen = ledgerSeen.get(balances);
  const payload = movementPayload(movement);

  if (seen !== undefined && isNonEmpty(movement.id) && seen.ids.has(movement.id)) {
    return cloneBalances(balances, seen);
  }
  if (seen !== undefined && isNonEmpty(movement.idempotencyKey)) {
    const previous = seen.idempotencyKeys.get(movement.idempotencyKey);
    if (previous !== undefined) {
      if (previous !== payload) {
        throw new InventoryIdempotencyConflictError(movement.idempotencyKey);
      }
      return cloneBalances(balances, seen);
    }
  }

  const current = balances[key] ?? 0;
  if (!Number.isSafeInteger(current)) {
    throw new InvalidInventoryBalanceError(key, current);
  }

  const nextQuantity = current + movement.quantityDelta;
  if (!Number.isSafeInteger(nextQuantity)) {
    throw new InventoryBalanceOverflowError(key);
  }

  const next = { ...balances, [key]: nextQuantity };
  const ids = new Set<string>(seen?.ids);
  const idempotencyKeys = new Map<string, string>(seen?.idempotencyKeys);
  if (isNonEmpty(movement.id)) {
    ids.add(movement.id);
  }
  if (isNonEmpty(movement.idempotencyKey)) {
    idempotencyKeys.set(movement.idempotencyKey, payload);
  }
  ledgerSeen.set(next, { ids, idempotencyKeys });

  return next;
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
  for (const [key, value] of Object.entries(stored)) {
    if (!Number.isSafeInteger(value)) {
      throw new InvalidInventoryBalanceError(key, value);
    }
  }

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
