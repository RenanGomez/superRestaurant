import {
  parseInventoryBalanceV1,
  parseInventoryMovementRequestV1,
  parseInventoryMovementV1,
  type InventoryBalanceV1,
  type InventoryMovementKindV1,
  type InventoryMovementV1,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "../auth/authentication.js";
import { MembershipAuthorizationService } from "../auth/membership-authorization.js";
import {
  DATABASE_CLIENT,
  type DatabaseClientPort,
  type DatabaseQueryResult,
  type TransactionalDatabaseClientPort,
} from "../database.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MANUAL_KINDS: ReadonlySet<InventoryMovementKindV1> = new Set([
  "adjustment",
  "waste",
  "count_adjustment",
  "transfer_out",
  "transfer_in",
]);
const TRANSFER_KINDS: ReadonlySet<InventoryMovementKindV1> = new Set(["transfer_out", "transfer_in"]);

const recordManualSql =
  "select app_private.inventory_record_manual_movement($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::integer,$8::text,$9::text,$10::uuid) as result";
const transferSql =
  "select app_private.inventory_transfer($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::integer,$8::text,$9::text,$10::text,$11::uuid) as result";
const listMovementsSql =
  "select * from app_private.list_inventory_movements($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::integer)";
const listBalancesSql =
  "select * from app_private.list_inventory_balances($1::uuid,$2::uuid,$3::uuid,$4::uuid)";

export type InventoryMovementApplicationErrorCode = "request" | "authorization" | "conflict" | "unavailable";

export class InventoryMovementApplicationError extends Error {
  public constructor(public readonly code: InventoryMovementApplicationErrorCode) {
    super(`INVENTORY_MOVEMENT_${code.toUpperCase()}`);
    this.name = "InventoryMovementApplicationError";
  }
}

export interface InventoryMovementRecordV1 {
  readonly status: "recorded" | "duplicate";
  readonly movementId: string;
  readonly balance: number | null;
}

export interface InventoryTransferResultV1 {
  readonly status: "recorded" | "duplicate";
  readonly transferPairId: string;
  readonly movements: readonly InventoryMovementV1[];
}

export interface InventoryMovementListV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly movements: readonly InventoryMovementV1[];
}

export interface InventoryBalanceListV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly balances: readonly InventoryBalanceV1[];
}

@Injectable()
export class MovementsService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(DATABASE_CLIENT) private readonly database: TransactionalDatabaseClientPort,
  ) {}

  public async recordMovement(
    principal: AuthenticatedPrincipal,
    input: unknown,
    deviceId: unknown,
  ): Promise<InventoryMovementRecordV1 | InventoryTransferResultV1> {
    const command = parseMovementRequest(input, principal.actorId);
    if (command === undefined || !MANUAL_KINDS.has(command.kind)) throw requestError();

    const device = parseOptionalId(deviceId);
    if (deviceId !== undefined && device === undefined) throw requestError();

    await this.authorize(principal, command.restaurantId, command.branchId, "catalog.manage");

    if (TRANSFER_KINDS.has(command.kind)) return this.recordTransfer(principal, command, device);
    return this.recordManual(principal, command, device);
  }

  public async listMovements(principal: AuthenticatedPrincipal, input: unknown): Promise<InventoryMovementListV1> {
    const query = parseMovementsQuery(input);
    if (query === undefined) throw requestError();
    await this.authorize(principal, query.restaurantId, query.branchId, "catalog.read");

    const rows = await this.rows((database) => database.query(listMovementsSql, [
      principal.actorId,
      query.restaurantId,
      query.branchId,
      query.warehouseId ?? null,
      query.itemId ?? null,
      query.limit,
    ]));
    const movements: InventoryMovementV1[] = [];
    for (const row of rows) {
      const movement = toMovement(row);
      if (movement === undefined) throw unavailable();
      movements.push(movement);
    }
    return Object.freeze({
      schemaVersion: 1,
      restaurantId: query.restaurantId,
      branchId: query.branchId,
      movements: Object.freeze(movements),
    });
  }

  public async listBalances(principal: AuthenticatedPrincipal, input: unknown): Promise<InventoryBalanceListV1> {
    const query = parseBalancesQuery(input);
    if (query === undefined) throw requestError();
    await this.authorize(principal, query.restaurantId, query.branchId, "catalog.read");

    const rows = await this.rows((database) => database.query(listBalancesSql, [
      principal.actorId,
      query.restaurantId,
      query.branchId,
      query.warehouseId ?? null,
    ]));
    const balances: InventoryBalanceV1[] = [];
    for (const row of rows) {
      const balance = toBalance(row, query.restaurantId, query.branchId);
      if (balance === undefined) throw unavailable();
      balances.push(balance);
    }
    return Object.freeze({
      schemaVersion: 1,
      restaurantId: query.restaurantId,
      branchId: query.branchId,
      balances: Object.freeze(balances),
    });
  }

  private async recordManual(
    principal: AuthenticatedPrincipal,
    command: ParsedMovementRequest,
    deviceId: string | undefined,
  ): Promise<InventoryMovementRecordV1> {
    const rows = await this.rows((database) => database.query(recordManualSql, [
      principal.actorId,
      command.restaurantId,
      command.branchId,
      command.warehouseId,
      command.itemId,
      command.kind,
      command.quantityDelta,
      command.reason,
      command.idempotencyKey,
      deviceId ?? null,
    ]));
    if (rows.length !== 1) throw unavailable();
    const result = toRecordedMovement(rows[0]);
    if (result === undefined) throw unavailable();
    return result;
  }

  private async recordTransfer(
    principal: AuthenticatedPrincipal,
    command: ParsedMovementRequest,
    deviceId: string | undefined,
  ): Promise<InventoryTransferResultV1> {
    const counterpart = command.toWarehouseId;
    if (counterpart === null
      || command.reason === null
      || command.reason.trim().length === 0
    ) {
      throw requestError();
    }

    const fromWarehouseId = command.kind === "transfer_out" ? command.warehouseId : counterpart;
    const toWarehouseId = command.kind === "transfer_out" ? counterpart : command.warehouseId;
    const quantity = Math.abs(command.quantityDelta);

    const rows = await this.rows((database) => database.query(transferSql, [
      principal.actorId,
      command.restaurantId,
      command.branchId,
      fromWarehouseId,
      toWarehouseId,
      command.itemId,
      quantity,
      command.unitCode,
      command.reason,
      command.idempotencyKey,
      deviceId ?? null,
    ]));
    if (rows.length !== 1) throw unavailable();
    const result = toTransferResult(rows[0]);
    if (result === undefined) throw unavailable();
    return result;
  }

  private async authorize(
    principal: AuthenticatedPrincipal,
    restaurantId: string,
    branchId: string,
    permission: "catalog.read" | "catalog.manage",
  ): Promise<void> {
    try {
      await this.authorization.authorizeBranch(principal, { restaurantId, branchId }, permission);
    } catch {
      throw new InventoryMovementApplicationError("authorization");
    }
  }

  private async rows(
    action: (database: DatabaseClientPort) => Promise<DatabaseQueryResult>,
  ): Promise<readonly unknown[]> {
    try {
      return await this.database.transaction(async (database) => {
        const result = await action(database);
        return result.rows;
      });
    } catch (error: unknown) {
      if (error instanceof InventoryMovementApplicationError) throw error;
      const state = sqlState(error);
      if (state === "23505" || state === "23503") throw new InventoryMovementApplicationError("conflict");
      if (state === "23514" || state === "22000") throw new InventoryMovementApplicationError("request");
      if (state === "42501") throw new InventoryMovementApplicationError("authorization");
      throw unavailable();
    }
  }
}

interface ParsedMovementRequest {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly kind: InventoryMovementKindV1;
  readonly quantityDelta: number;
  readonly unitCode: "g" | "ml" | "piece";
  readonly reason: string | null;
  readonly idempotencyKey: string;
  readonly compensatesMovementId: string | null;
  readonly toWarehouseId: string | null;
}

function parseMovementRequest(input: unknown, actorId: string): ParsedMovementRequest | undefined {
  const record = plainRecord(input);
  if (record === undefined || Object.hasOwn(record, "actorId")) return undefined;

  let parsed: ReturnType<typeof parseInventoryMovementRequestV1>;
  try {
    parsed = parseInventoryMovementRequestV1({ ...record, actorId });
  } catch {
    return undefined;
  }
  if (parsed === undefined) return undefined;
  if (parsed.compensatesMovementId !== null) return undefined;

  return Object.freeze({
    restaurantId: parsed.restaurantId,
    branchId: parsed.branchId,
    warehouseId: parsed.warehouseId,
    itemId: parsed.itemId,
    kind: parsed.kind,
    quantityDelta: parsed.quantityDelta,
    unitCode: parsed.unitCode,
    reason: parsed.reason,
    idempotencyKey: parsed.idempotencyKey,
    compensatesMovementId: parsed.compensatesMovementId,
    toWarehouseId: parsed.toWarehouseId,
  });
}

function parseMovementsQuery(
  input: unknown,
): { restaurantId: string; branchId: string; warehouseId?: string; itemId?: string; limit: number } | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, ["restaurantId", "branchId", "warehouseId", "itemId", "limit"])) {
    return undefined;
  }
  const restaurantId = uuidValue(record, "restaurantId");
  const branchId = uuidValue(record, "branchId");
  if (restaurantId === undefined || branchId === undefined) return undefined;

  const warehouseId = optionalUuid(record, "warehouseId");
  if (warehouseId === null) return undefined;
  const itemId = optionalUuid(record, "itemId");
  if (itemId === null) return undefined;

  const limit = Object.hasOwn(record, "limit") ? parseLimit(ownValue(record, "limit")) : 100;
  if (limit === undefined) return undefined;

  const query: { restaurantId: string; branchId: string; warehouseId?: string; itemId?: string; limit: number } = {
    restaurantId,
    branchId,
    limit,
  };
  if (warehouseId !== undefined) query.warehouseId = warehouseId;
  if (itemId !== undefined) query.itemId = itemId;
  return query;
}

function parseBalancesQuery(
  input: unknown,
): { restaurantId: string; branchId: string; warehouseId?: string } | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, ["restaurantId", "branchId", "warehouseId"])) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  const branchId = uuidValue(record, "branchId");
  if (restaurantId === undefined || branchId === undefined) return undefined;

  const warehouseId = optionalUuid(record, "warehouseId");
  if (warehouseId === null) return undefined;
  return warehouseId === undefined
    ? { restaurantId, branchId }
    : { restaurantId, branchId, warehouseId };
}

function optionalUuid(record: Record<string, unknown>, key: string): string | undefined | null {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = ownValue(record, key);
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 && value <= 200 ? value : undefined;
  }
  if (typeof value === "string" && /^[1-9]\d{0,2}$/u.test(value)) {
    const parsed = Number(value);
    return parsed <= 200 ? parsed : undefined;
  }
  return undefined;
}

function uuidValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = ownValue(record, key);
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function parseOptionalId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function toRecordedMovement(row: unknown): InventoryMovementRecordV1 | undefined {
  const result = resultValue(row);
  if (result === undefined) return undefined;
  const status = ownValue(result, "status");
  const movementId = ownValue(result, "movementId");
  const balance = ownValue(result, "balance");
  if (status !== "recorded" && status !== "duplicate") return undefined;
  if (typeof movementId !== "string" || !UUID_PATTERN.test(movementId)) return undefined;
  if (status === "recorded") {
    if (typeof balance !== "number" || !Number.isSafeInteger(balance)) return undefined;
    return Object.freeze({ status, movementId, balance });
  }
  return Object.freeze({ status, movementId, balance: null });
}

function toTransferResult(row: unknown): InventoryTransferResultV1 | undefined {
  const result = resultValue(row);
  if (result === undefined) return undefined;
  const status = ownValue(result, "status");
  const transferPairId = ownValue(result, "transferPairId");
  const rawMovements = ownValue(result, "movements");
  if (status !== "recorded" && status !== "duplicate") return undefined;
  if (typeof transferPairId !== "string" || !UUID_PATTERN.test(transferPairId)) return undefined;
  if (!Array.isArray(rawMovements) || rawMovements.length !== 2) return undefined;

  const movements: InventoryMovementV1[] = [];
  for (const rawMovement of rawMovements) {
    const movement = parseInventoryMovementV1(rawMovement);
    if (movement === undefined || movement.transferPairId !== transferPairId) return undefined;
    movements.push(movement);
  }
  return Object.freeze({ status, transferPairId, movements: Object.freeze(movements) });
}

function toMovement(row: unknown): InventoryMovementV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const unitCostMinor = int8Value(ownValue(record, "unit_cost_minor"));
  if (unitCostMinor === undefined) return undefined;
  return parseInventoryMovementV1({
    id: ownValue(record, "id"),
    restaurantId: ownValue(record, "restaurant_id"),
    branchId: ownValue(record, "branch_id"),
    warehouseId: ownValue(record, "warehouse_id"),
    itemId: ownValue(record, "item_id"),
    kind: ownValue(record, "kind"),
    quantityDelta: ownValue(record, "quantity_delta"),
    unitCode: ownValue(record, "unit_code"),
    occurredAt: timestampText(ownValue(record, "occurred_at")),
    actorId: ownValue(record, "actor_id"),
    reason: ownValue(record, "reason"),
    idempotencyKey: ownValue(record, "idempotency_key"),
    compensatesMovementId: ownValue(record, "compensates_movement_id"),
    transferPairId: ownValue(record, "transfer_pair_id"),
    unitCostMinor,
    currency: ownValue(record, "currency"),
    recipeVersionId: ownValue(record, "recipe_version_id"),
    roundingRemainder: ownValue(record, "rounding_remainder"),
  });
}

function toBalance(row: unknown, restaurantId: string, branchId: string): InventoryBalanceV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  return parseInventoryBalanceV1({
    restaurantId,
    branchId,
    warehouseId: ownValue(record, "warehouse_id"),
    itemId: ownValue(record, "item_id"),
    quantity: ownValue(record, "quantity"),
    updatedAt: timestampText(ownValue(record, "updated_at")),
  });
}

function int8Value(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value === "string" && /^-?\d{1,16}$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function timestampText(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function resultValue(row: unknown): Record<string, unknown> | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  return plainRecord(ownValue(record, "result"));
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  try {
    return Reflect.ownKeys(record).every((key) => typeof key === "string" && allowedKeys.includes(key));
  } catch {
    return false;
  }
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function requestError(): InventoryMovementApplicationError {
  return new InventoryMovementApplicationError("request");
}

function unavailable(): InventoryMovementApplicationError {
  return new InventoryMovementApplicationError("unavailable");
}
