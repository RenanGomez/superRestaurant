import type { BranchId, RestaurantId } from "./index.js";

export const INVENTORY_UNITS = Object.freeze(["g", "ml", "piece"] as const);
export type InventoryUnitV1 = (typeof INVENTORY_UNITS)[number];

export const INVENTORY_MOVEMENT_KINDS = Object.freeze([
  "receipt",
  "sale_consumption",
  "sale_reversal",
  "waste",
  "adjustment",
  "transfer_out",
  "transfer_in",
  "count_adjustment",
] as const);
export type InventoryMovementKindV1 = (typeof INVENTORY_MOVEMENT_KINDS)[number];

export const PURCHASE_ORDER_STATUSES = Object.freeze(["draft", "sent", "received", "cancelled"] as const);
export type PurchaseOrderStatusV1 = (typeof PURCHASE_ORDER_STATUSES)[number];

export interface InventoryItemV1 {
  readonly id: string;
  readonly restaurantId: RestaurantId;
  readonly sku: string | null;
  readonly name: string;
  readonly unitCode: InventoryUnitV1;
  readonly purchaseUnitFactor: number;
  readonly minQuantity: number;
  readonly active: boolean;
}

export interface InventoryWarehouseV1 {
  readonly id: string;
  readonly restaurantId: RestaurantId;
  readonly branchId: BranchId;
  readonly name: string;
  readonly active: boolean;
}

export interface InventoryMovementV1 {
  readonly id: string;
  readonly restaurantId: RestaurantId;
  readonly branchId: BranchId;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly kind: InventoryMovementKindV1;
  readonly quantityDelta: number;
  readonly unitCode: InventoryUnitV1;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly reason: string | null;
  readonly idempotencyKey: string;
  readonly compensatesMovementId: string | null;
  readonly transferPairId: string | null;
  readonly unitCostMinor: number | null;
  readonly currency: string | null;
  readonly recipeVersionId: string | null;
  readonly roundingRemainder: number;
}

export interface InventoryBalanceV1 {
  readonly restaurantId: RestaurantId;
  readonly branchId: BranchId;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly updatedAt: string;
}

export interface RecipeLineV1 {
  readonly itemId: string;
  readonly quantity: number;
  readonly unitCode: InventoryUnitV1;
}

export interface RecipeVersionV1 {
  readonly restaurantId: RestaurantId;
  readonly recipeId: string;
  readonly productId: string;
  readonly version: number;
  readonly lines: readonly RecipeLineV1[];
}

/** UI command: the server assigns `id` and `occurredAt`. */
export interface InventoryMovementRequestV1 {
  readonly restaurantId: RestaurantId;
  readonly branchId: BranchId;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly kind: InventoryMovementKindV1;
  readonly quantityDelta: number;
  readonly unitCode: InventoryUnitV1;
  readonly actorId: string;
  readonly reason: string | null;
  readonly idempotencyKey: string;
  readonly compensatesMovementId: string | null;
  /** Server-owned: the request only ever sends `null`; the ledger assigns the pair id. */
  readonly transferPairId: string | null;
  /** Counterpart warehouse: a UUID for `transfer_out`/`transfer_in`, `null` otherwise. */
  readonly toWarehouseId: string | null;
  readonly unitCostMinor: number | null;
  readonly currency: string | null;
}

export interface PurchaseOrderLineV1 {
  readonly itemId: string;
  readonly quantity: number;
  readonly unitCode: InventoryUnitV1;
  readonly unitCostMinor: number;
  readonly currency: string;
}

export interface PurchaseOrderV1 {
  readonly id: string;
  readonly restaurantId: RestaurantId;
  readonly branchId: BranchId;
  readonly supplierId: string;
  readonly status: PurchaseOrderStatusV1;
  readonly lines: readonly PurchaseOrderLineV1[];
}

// ---- Low-level validators ------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/iu;
const RFC3339_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const CONTROL_CHAR_PATTERN = /[\p{Cc}\p{Cf}]/u;
const MAX_RECIPE_LINES = 500;
const MAX_PURCHASE_ORDER_LINES = 1_000;

type PlainRecord = Readonly<Record<string, unknown>>;

function isInventoryId(value: unknown): value is string {
  return typeof value === "string" && (UUID_PATTERN.test(value) || ULID_PATTERN.test(value));
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return isSafeInteger(value) && value >= 1;
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximumLength
    && value === value.trim()
    && !CONTROL_CHAR_PATTERN.test(value);
}

function isNullableText(value: unknown, maximumLength: number): value is string | null {
  return value === null || isBoundedText(value, maximumLength);
}

function isInventoryUnit(value: unknown): value is InventoryUnitV1 {
  return typeof value === "string" && (INVENTORY_UNITS as readonly string[]).includes(value);
}

function isMovementKind(value: unknown): value is InventoryMovementKindV1 {
  return typeof value === "string" && (INVENTORY_MOVEMENT_KINDS as readonly string[]).includes(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339_UTC_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}

function isCurrency(value: unknown): value is string {
  return typeof value === "string" && CURRENCY_PATTERN.test(value);
}

function isMoneyPair(unitCostMinor: unknown, currency: unknown): boolean {
  if (unitCostMinor === null && currency === null) return true;
  return isNonNegativeInt(unitCostMinor) && isCurrency(currency);
}

function isTransferKind(kind: InventoryMovementKindV1): boolean {
  return kind === "transfer_out" || kind === "transfer_in";
}

function requiresReason(kind: InventoryMovementKindV1): boolean {
  return kind === "sale_reversal"
    || kind === "waste"
    || kind === "adjustment"
    || kind === "count_adjustment";
}

function hasValidSign(kind: InventoryMovementKindV1, quantityDelta: number): boolean {
  if (quantityDelta === 0) return false;
  switch (kind) {
    case "receipt":
    case "transfer_in":
    case "sale_reversal":
      return quantityDelta > 0;
    case "sale_consumption":
    case "transfer_out":
    case "waste":
      return quantityDelta < 0;
    case "adjustment":
    case "count_adjustment":
      return true;
  }
}

function hasValidReason(kind: InventoryMovementKindV1, reason: unknown): boolean {
  if (!requiresReason(kind)) return true;
  return isBoundedText(reason, 500);
}

function hasValidCompensation(kind: InventoryMovementKindV1, compensatesMovementId: unknown): boolean {
  const valid = compensatesMovementId === null || isInventoryId(compensatesMovementId);
  if (!valid) return false;
  if (kind === "sale_reversal") return isInventoryId(compensatesMovementId);
  return true;
}

function hasValidTransferPair(kind: InventoryMovementKindV1, transferPairId: unknown): boolean {
  if (isTransferKind(kind)) return isInventoryId(transferPairId);
  return transferPairId === null || isInventoryId(transferPairId);
}

function hasValidTransferTarget(kind: InventoryMovementKindV1, toWarehouseId: unknown): boolean {
  if (isTransferKind(kind)) return isInventoryId(toWarehouseId);
  return toWarehouseId === null;
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length) return undefined;
    for (const key of keys) {
      if (!ownKeys.includes(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    }
    return value as PlainRecord;
  } catch {
    return undefined;
  }
}

function exactArray(value: unknown, maximumLength: number): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > maximumLength) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return undefined;
  }
}

function ownValue(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

// ---- Public runtime parsers ----------------------------------------------------------------

export function parseInventoryItemV1(value: unknown): InventoryItemV1 | undefined {
  const record = exactRecord(value, [
    "id",
    "restaurantId",
    "sku",
    "name",
    "unitCode",
    "purchaseUnitFactor",
    "minQuantity",
    "active",
  ]);
  if (record === undefined) return undefined;

  const id = ownValue(record, "id");
  const restaurantId = ownValue(record, "restaurantId");
  const sku = ownValue(record, "sku");
  const name = ownValue(record, "name");
  const unitCode = ownValue(record, "unitCode");
  const purchaseUnitFactor = ownValue(record, "purchaseUnitFactor");
  const minQuantity = ownValue(record, "minQuantity");
  const active = ownValue(record, "active");

  if (
    !isInventoryId(id)
    || !isInventoryId(restaurantId)
    || !isNullableText(sku, 100)
    || !isBoundedText(name, 160)
    || !isInventoryUnit(unitCode)
    || !isPositiveInt(purchaseUnitFactor)
    || !isNonNegativeInt(minQuantity)
    || typeof active !== "boolean"
  ) {
    return undefined;
  }

  return Object.freeze({
    id,
    restaurantId: restaurantId as RestaurantId,
    sku,
    name,
    unitCode,
    purchaseUnitFactor,
    minQuantity,
    active,
  });
}

export function parseInventoryWarehouseV1(value: unknown): InventoryWarehouseV1 | undefined {
  const record = exactRecord(value, ["id", "restaurantId", "branchId", "name", "active"]);
  if (record === undefined) return undefined;

  const id = ownValue(record, "id");
  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  const name = ownValue(record, "name");
  const active = ownValue(record, "active");

  if (
    !isInventoryId(id)
    || !isInventoryId(restaurantId)
    || !isInventoryId(branchId)
    || !isBoundedText(name, 160)
    || typeof active !== "boolean"
  ) {
    return undefined;
  }

  return Object.freeze({
    id,
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
    name,
    active,
  });
}

export function parseInventoryMovementV1(value: unknown): InventoryMovementV1 | undefined {
  const record = exactRecord(value, [
    "id",
    "restaurantId",
    "branchId",
    "warehouseId",
    "itemId",
    "kind",
    "quantityDelta",
    "unitCode",
    "occurredAt",
    "actorId",
    "reason",
    "idempotencyKey",
    "compensatesMovementId",
    "transferPairId",
    "unitCostMinor",
    "currency",
    "recipeVersionId",
    "roundingRemainder",
  ]);
  if (record === undefined) return undefined;

  const id = ownValue(record, "id");
  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  const warehouseId = ownValue(record, "warehouseId");
  const itemId = ownValue(record, "itemId");
  const kind = ownValue(record, "kind");
  const quantityDelta = ownValue(record, "quantityDelta");
  const unitCode = ownValue(record, "unitCode");
  const occurredAt = ownValue(record, "occurredAt");
  const actorId = ownValue(record, "actorId");
  const reason = ownValue(record, "reason");
  const idempotencyKey = ownValue(record, "idempotencyKey");
  const compensatesMovementId = ownValue(record, "compensatesMovementId");
  const transferPairId = ownValue(record, "transferPairId");
  const unitCostMinor = ownValue(record, "unitCostMinor");
  const currency = ownValue(record, "currency");
  const recipeVersionId = ownValue(record, "recipeVersionId");
  const roundingRemainder = ownValue(record, "roundingRemainder");

  if (
    !isInventoryId(id)
    || !isInventoryId(restaurantId)
    || !isInventoryId(branchId)
    || !isInventoryId(warehouseId)
    || !isInventoryId(itemId)
    || !isMovementKind(kind)
    || !isSafeInteger(quantityDelta)
    || !hasValidSign(kind, quantityDelta)
    || !isInventoryUnit(unitCode)
    || !isIsoTimestamp(occurredAt)
    || !isInventoryId(actorId)
    || !isNullableText(reason, 500)
    || !hasValidReason(kind, reason)
    || !isIdempotencyKey(idempotencyKey)
    || !hasValidCompensation(kind, compensatesMovementId)
    || !hasValidTransferPair(kind, transferPairId)
    || !isMoneyPair(unitCostMinor, currency)
    || !(recipeVersionId === null || isInventoryId(recipeVersionId))
    || !isNonNegativeInt(roundingRemainder)
  ) {
    return undefined;
  }

  return Object.freeze({
    id,
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
    warehouseId,
    itemId,
    kind,
    quantityDelta,
    unitCode,
    occurredAt,
    actorId,
    reason,
    idempotencyKey,
    compensatesMovementId: compensatesMovementId as string | null,
    transferPairId: transferPairId as string | null,
    unitCostMinor: unitCostMinor as number | null,
    currency: currency as string | null,
    recipeVersionId: recipeVersionId as string | null,
    roundingRemainder,
  });
}

export function parseInventoryBalanceV1(value: unknown): InventoryBalanceV1 | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId", "warehouseId", "itemId", "quantity", "updatedAt"]);
  if (record === undefined) return undefined;

  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  const warehouseId = ownValue(record, "warehouseId");
  const itemId = ownValue(record, "itemId");
  const quantity = ownValue(record, "quantity");
  const updatedAt = ownValue(record, "updatedAt");

  if (
    !isInventoryId(restaurantId)
    || !isInventoryId(branchId)
    || !isInventoryId(warehouseId)
    || !isInventoryId(itemId)
    || !isSafeInteger(quantity)
    || !isIsoTimestamp(updatedAt)
  ) {
    return undefined;
  }

  return Object.freeze({
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
    warehouseId,
    itemId,
    quantity,
    updatedAt,
  });
}

export function parseRecipeLineV1(value: unknown): RecipeLineV1 | undefined {
  const record = exactRecord(value, ["itemId", "quantity", "unitCode"]);
  if (record === undefined) return undefined;

  const itemId = ownValue(record, "itemId");
  const quantity = ownValue(record, "quantity");
  const unitCode = ownValue(record, "unitCode");

  if (!isInventoryId(itemId) || !isPositiveInt(quantity) || !isInventoryUnit(unitCode)) return undefined;

  return Object.freeze({ itemId, quantity, unitCode });
}

export function parseRecipeVersionV1(value: unknown): RecipeVersionV1 | undefined {
  const record = exactRecord(value, ["restaurantId", "recipeId", "productId", "version", "lines"]);
  if (record === undefined) return undefined;

  const restaurantId = ownValue(record, "restaurantId");
  const recipeId = ownValue(record, "recipeId");
  const productId = ownValue(record, "productId");
  const version = ownValue(record, "version");
  const rawLines = exactArray(ownValue(record, "lines"), MAX_RECIPE_LINES);

  if (
    !isInventoryId(restaurantId)
    || !isInventoryId(recipeId)
    || !isInventoryId(productId)
    || !isPositiveInt(version)
    || rawLines === undefined
  ) {
    return undefined;
  }

  const lines: RecipeLineV1[] = [];
  for (const rawLine of rawLines) {
    const line = parseRecipeLineV1(rawLine);
    if (line === undefined) return undefined;
    lines.push(line);
  }

  return Object.freeze({
    restaurantId: restaurantId as RestaurantId,
    recipeId,
    productId,
    version,
    lines: Object.freeze(lines),
  });
}

export function parseInventoryMovementRequestV1(value: unknown): InventoryMovementRequestV1 | undefined {
  const record = exactRecord(value, [
    "restaurantId",
    "branchId",
    "warehouseId",
    "itemId",
    "kind",
    "quantityDelta",
    "unitCode",
    "actorId",
    "reason",
    "idempotencyKey",
    "compensatesMovementId",
    "transferPairId",
    "toWarehouseId",
    "unitCostMinor",
    "currency",
  ]);
  if (record === undefined) return undefined;

  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  const warehouseId = ownValue(record, "warehouseId");
  const itemId = ownValue(record, "itemId");
  const kind = ownValue(record, "kind");
  const quantityDelta = ownValue(record, "quantityDelta");
  const unitCode = ownValue(record, "unitCode");
  const actorId = ownValue(record, "actorId");
  const reason = ownValue(record, "reason");
  const idempotencyKey = ownValue(record, "idempotencyKey");
  const compensatesMovementId = ownValue(record, "compensatesMovementId");
  const transferPairId = ownValue(record, "transferPairId");
  const toWarehouseId = ownValue(record, "toWarehouseId");
  const unitCostMinor = ownValue(record, "unitCostMinor");
  const currency = ownValue(record, "currency");

  if (
    !isInventoryId(restaurantId)
    || !isInventoryId(branchId)
    || !isInventoryId(warehouseId)
    || !isInventoryId(itemId)
    || !isMovementKind(kind)
    || !isSafeInteger(quantityDelta)
    || !hasValidSign(kind, quantityDelta)
    || !isInventoryUnit(unitCode)
    || !isInventoryId(actorId)
    || !isNullableText(reason, 500)
    || !hasValidReason(kind, reason)
    || !isIdempotencyKey(idempotencyKey)
    || !hasValidCompensation(kind, compensatesMovementId)
    || transferPairId !== null
    || !hasValidTransferTarget(kind, toWarehouseId)
    || !isMoneyPair(unitCostMinor, currency)
  ) {
    return undefined;
  }

  return Object.freeze({
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
    warehouseId,
    itemId,
    kind,
    quantityDelta,
    unitCode,
    actorId,
    reason,
    idempotencyKey,
    compensatesMovementId: compensatesMovementId as string | null,
    transferPairId: null,
    toWarehouseId: toWarehouseId as string | null,
    unitCostMinor: unitCostMinor as number | null,
    currency: currency as string | null,
  });
}

export function parsePurchaseOrderLineV1(value: unknown): PurchaseOrderLineV1 | undefined {
  const record = exactRecord(value, ["itemId", "quantity", "unitCode", "unitCostMinor", "currency"]);
  if (record === undefined) return undefined;

  const itemId = ownValue(record, "itemId");
  const quantity = ownValue(record, "quantity");
  const unitCode = ownValue(record, "unitCode");
  const unitCostMinor = ownValue(record, "unitCostMinor");
  const currency = ownValue(record, "currency");

  if (
    !isInventoryId(itemId)
    || !isPositiveInt(quantity)
    || !isInventoryUnit(unitCode)
    || !isNonNegativeInt(unitCostMinor)
    || !isCurrency(currency)
  ) {
    return undefined;
  }

  return Object.freeze({ itemId, quantity, unitCode, unitCostMinor, currency });
}

export function parsePurchaseOrderV1(value: unknown): PurchaseOrderV1 | undefined {
  const record = exactRecord(value, ["id", "restaurantId", "branchId", "supplierId", "status", "lines"]);
  if (record === undefined) return undefined;

  const id = ownValue(record, "id");
  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  const supplierId = ownValue(record, "supplierId");
  const status = ownValue(record, "status");
  const rawLines = exactArray(ownValue(record, "lines"), MAX_PURCHASE_ORDER_LINES);

  if (
    !isInventoryId(id)
    || !isInventoryId(restaurantId)
    || !isInventoryId(branchId)
    || !isInventoryId(supplierId)
    || typeof status !== "string"
    || !(PURCHASE_ORDER_STATUSES as readonly string[]).includes(status)
    || rawLines === undefined
    || rawLines.length === 0
  ) {
    return undefined;
  }

  const lines: PurchaseOrderLineV1[] = [];
  const seen = new Set<string>();
  for (const rawLine of rawLines) {
    const line = parsePurchaseOrderLineV1(rawLine);
    if (line === undefined) return undefined;
    const lineKey = `${line.itemId}\u0000${line.unitCode}`;
    if (seen.has(lineKey)) return undefined;
    seen.add(lineKey);
    lines.push(line);
  }

  return Object.freeze({
    id,
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
    supplierId,
    status: status as PurchaseOrderStatusV1,
    lines: Object.freeze(lines),
  });
}
