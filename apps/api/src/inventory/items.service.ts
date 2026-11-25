import {
  parseInventoryItemV1,
  parseInventoryWarehouseV1,
  type BranchMembershipListV1,
  type InventoryItemV1,
  type InventoryUnitV1,
  type InventoryWarehouseV1,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "../auth/authentication.js";
import { MembershipAuthorizationService } from "../auth/membership-authorization.js";
import { MEMBERSHIP_DIRECTORY, type MembershipDirectoryPort } from "../auth/membership-directory.js";
import { rolesGrantPermission } from "../auth/rbac-policy.js";
import {
  DATABASE_CLIENT,
  type DatabaseClientPort,
  type DatabaseQueryResult,
  type TransactionalDatabaseClientPort,
} from "../database.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const listItemsSql = "select * from app_private.list_inventory_items($1::uuid, $2::uuid)";
const listWarehousesSql = "select * from app_private.list_inventory_warehouses($1::uuid, $2::uuid, $3::uuid)";
const readItemForManageSql = "select * from app_private.read_inventory_item_for_manage($1::uuid, $2::uuid)";
const readWarehouseForManageSql = "select * from app_private.read_inventory_warehouse_for_manage($1::uuid, $2::uuid)";

const insertItemSql =
  "select * from app_private.create_inventory_item($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::integer,$7::integer,$8::boolean)";
const insertWarehouseSql =
  "select * from app_private.create_inventory_warehouse($1::uuid,$2::uuid,$3::uuid,$4::text,$5::boolean)";
const updateItemSql =
  "select * from app_private.update_inventory_item($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::integer,$7::integer,$8::boolean)";
const updateWarehouseSql =
  "select * from app_private.update_inventory_warehouse($1::uuid,$2::uuid,$3::text,$4::boolean)";

const ITEM_CREATE_KEYS = Object.freeze([
  "restaurantId",
  "sku",
  "name",
  "unitCode",
  "purchaseUnitFactor",
  "minQuantity",
  "active",
] as const);
const ITEM_PATCH_KEYS = Object.freeze([
  "name",
  "sku",
  "minQuantity",
  "active",
  "purchaseUnitFactor",
] as const);
const WAREHOUSE_CREATE_KEYS = Object.freeze(["restaurantId", "branchId", "name", "active"] as const);
const WAREHOUSE_PATCH_KEYS = Object.freeze(["name", "active"] as const);

export type InventoryApplicationErrorCode = "request" | "authorization" | "conflict" | "missing" | "unavailable";

export class InventoryApplicationError extends Error {
  public constructor(public readonly code: InventoryApplicationErrorCode) {
    super(`INVENTORY_${code.toUpperCase()}`);
    this.name = "InventoryApplicationError";
  }
}

export interface InventoryItemListV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly items: readonly InventoryItemV1[];
}

export interface InventoryWarehouseListV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly warehouses: readonly InventoryWarehouseV1[];
}

export interface CreateInventoryItemCommand {
  readonly restaurantId: string;
  readonly sku: string | null;
  readonly name: string;
  readonly unitCode: InventoryUnitV1;
  readonly purchaseUnitFactor: number;
  readonly minQuantity: number;
  readonly active: boolean;
}

export interface CreateInventoryWarehouseCommand {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly active: boolean;
}

@Injectable()
export class ItemsService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(MEMBERSHIP_DIRECTORY) private readonly directory: MembershipDirectoryPort,
    @Inject(DATABASE_CLIENT) private readonly database: TransactionalDatabaseClientPort,
  ) {}

  public async listItems(principal: AuthenticatedPrincipal, input: unknown): Promise<InventoryItemListV1> {
    const query = parseItemsQuery(input);
    if (query === undefined) throw requestError();
    await this.authorizeRestaurant(principal, query.restaurantId, "catalog.read");

    const rows = await this.rows((database) => database.query(listItemsSql, [principal.actorId, query.restaurantId]));
    const items: InventoryItemV1[] = [];
    for (const row of rows) {
      const item = toItem(row);
      if (item === undefined) throw unavailable();
      items.push(item);
    }
    return Object.freeze({ schemaVersion: 1, restaurantId: query.restaurantId, items: Object.freeze(items) });
  }

  public async listWarehouses(principal: AuthenticatedPrincipal, input: unknown): Promise<InventoryWarehouseListV1> {
    const query = parseWarehousesQuery(input);
    if (query === undefined) throw requestError();
    await this.authorizeBranchScope(principal, query.restaurantId, query.branchId, "catalog.read");

    const rows = await this.rows((database) => database.query(listWarehousesSql, [
      principal.actorId,
      query.restaurantId,
      query.branchId,
    ]));
    const warehouses: InventoryWarehouseV1[] = [];
    for (const row of rows) {
      const warehouse = toWarehouse(row);
      if (warehouse === undefined) throw unavailable();
      warehouses.push(warehouse);
    }
    return Object.freeze({
      schemaVersion: 1,
      restaurantId: query.restaurantId,
      branchId: query.branchId,
      warehouses: Object.freeze(warehouses),
    });
  }

  public async createItem(principal: AuthenticatedPrincipal, input: unknown): Promise<InventoryItemV1> {
    const command = parseCreateItem(input);
    if (command === undefined) throw requestError();
    await this.authorizeRestaurant(principal, command.restaurantId, "catalog.manage");

    const rows = await this.rows((database) => database.query(insertItemSql, [
      principal.actorId,
      command.restaurantId,
      command.sku,
      command.name,
      command.unitCode,
      command.purchaseUnitFactor,
      command.minQuantity,
      command.active,
    ]));
    if (rows.length !== 1) throw unavailable();
    const item = toItem(rows[0]);
    if (item === undefined) throw unavailable();
    return item;
  }

  public async createWarehouse(principal: AuthenticatedPrincipal, input: unknown): Promise<InventoryWarehouseV1> {
    const command = parseCreateWarehouse(input);
    if (command === undefined) throw requestError();
    await this.authorizeBranchScope(principal, command.restaurantId, command.branchId, "catalog.manage");

    const rows = await this.rows((database) => database.query(insertWarehouseSql, [
      principal.actorId,
      command.restaurantId,
      command.branchId,
      command.name,
      command.active,
    ]));
    if (rows.length !== 1) throw unavailable();
    const warehouse = toWarehouse(rows[0]);
    if (warehouse === undefined) throw unavailable();
    return warehouse;
  }

  public async updateItem(principal: AuthenticatedPrincipal, id: unknown, input: unknown): Promise<InventoryItemV1> {
    const itemId = parseId(id);
    const patch = parsePatch(input, ITEM_PATCH_KEYS);
    if (itemId === undefined || patch === undefined) throw requestError();

    const existing = await this.readItem(principal, itemId);
    if (existing === undefined) throw new InventoryApplicationError("missing");
    await this.authorizeRestaurant(principal, existing.restaurantId, "catalog.manage");

    const merged = mergeItem(existing, patch);
    if (merged === undefined) throw requestError();

    const rows = await this.rows((database) => database.query(updateItemSql, [
      principal.actorId,
      itemId,
      merged.sku,
      merged.name,
      merged.unitCode,
      merged.purchaseUnitFactor,
      merged.minQuantity,
      merged.active,
    ]));
    if (rows.length !== 1) throw unavailable();
    const updated = toItem(rows[0]);
    if (updated === undefined || updated.id !== itemId) throw unavailable();
    return updated;
  }

  public async updateWarehouse(
    principal: AuthenticatedPrincipal,
    id: unknown,
    input: unknown,
  ): Promise<InventoryWarehouseV1> {
    const warehouseId = parseId(id);
    const patch = parsePatch(input, WAREHOUSE_PATCH_KEYS);
    if (warehouseId === undefined || patch === undefined) throw requestError();

    const existing = await this.readWarehouse(principal, warehouseId);
    if (existing === undefined) throw new InventoryApplicationError("missing");
    await this.authorizeBranchScope(principal, existing.restaurantId, existing.branchId, "catalog.manage");

    const merged = mergeWarehouse(existing, patch);
    if (merged === undefined) throw requestError();

    const rows = await this.rows((database) => database.query(updateWarehouseSql, [
      principal.actorId,
      warehouseId,
      merged.name,
      merged.active,
    ]));
    if (rows.length !== 1) throw unavailable();
    const updated = toWarehouse(rows[0]);
    if (updated === undefined || updated.id !== warehouseId) throw unavailable();
    return updated;
  }

  private async readItem(principal: AuthenticatedPrincipal, id: string): Promise<InventoryItemV1 | undefined> {
    const rows = await this.rows((database) => database.query(readItemForManageSql, [principal.actorId, id]));
    if (rows.length === 0) return undefined;
    if (rows.length !== 1) throw unavailable();
    const item = toItem(rows[0]);
    if (item === undefined) throw unavailable();
    return item;
  }

  private async readWarehouse(principal: AuthenticatedPrincipal, id: string): Promise<InventoryWarehouseV1 | undefined> {
    const rows = await this.rows((database) => database.query(readWarehouseForManageSql, [principal.actorId, id]));
    if (rows.length === 0) return undefined;
    if (rows.length !== 1) throw unavailable();
    const warehouse = toWarehouse(rows[0]);
    if (warehouse === undefined) throw unavailable();
    return warehouse;
  }

  private async authorizeRestaurant(
    principal: AuthenticatedPrincipal,
    restaurantId: string,
    permission: "catalog.read" | "catalog.manage",
  ): Promise<void> {
    let memberships: BranchMembershipListV1;
    try {
      memberships = await this.directory.listActiveMemberships(principal);
    } catch {
      throw unavailable();
    }
    const granted = memberships.memberships.some((membership) =>
      membership.scope.restaurantId === restaurantId
      && rolesGrantPermission(membership.roles, permission));
    if (!granted) throw new InventoryApplicationError("authorization");
  }

  private async authorizeBranchScope(
    principal: AuthenticatedPrincipal,
    restaurantId: string,
    branchId: string,
    permission: "catalog.read" | "catalog.manage",
  ): Promise<void> {
    try {
      await this.authorization.authorizeBranch(principal, { restaurantId, branchId }, permission);
    } catch {
      throw new InventoryApplicationError("authorization");
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
      if (error instanceof InventoryApplicationError) throw error;
      const state = sqlState(error);
      if (state === "23505" || state === "23503") throw new InventoryApplicationError("conflict");
      if (state === "23514") throw new InventoryApplicationError("request");
      if (state === "42501") throw new InventoryApplicationError("authorization");
      throw unavailable();
    }
  }
}

function parseItemsQuery(input: unknown): { restaurantId: string } | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, ["restaurantId"])) return undefined;
  const restaurantId = ownValue(record, "restaurantId");
  return typeof restaurantId === "string" && UUID_PATTERN.test(restaurantId)
    ? { restaurantId }
    : undefined;
}

function parseWarehousesQuery(input: unknown): { restaurantId: string; branchId: string } | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, ["restaurantId", "branchId"])) return undefined;
  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  return typeof restaurantId === "string" && UUID_PATTERN.test(restaurantId)
    && typeof branchId === "string" && UUID_PATTERN.test(branchId)
    ? { restaurantId, branchId }
    : undefined;
}

function parseId(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function parseCreateItem(input: unknown): CreateInventoryItemCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, ITEM_CREATE_KEYS)) return undefined;
  const restaurantId = ownValue(record, "restaurantId");
  if (typeof restaurantId !== "string" || !UUID_PATTERN.test(restaurantId)) return undefined;

  const candidate = {
    id: restaurantId,
    restaurantId,
    sku: Object.hasOwn(record, "sku") ? ownValue(record, "sku") : null,
    name: ownValue(record, "name"),
    unitCode: ownValue(record, "unitCode"),
    purchaseUnitFactor: Object.hasOwn(record, "purchaseUnitFactor") ? ownValue(record, "purchaseUnitFactor") : 1,
    minQuantity: Object.hasOwn(record, "minQuantity") ? ownValue(record, "minQuantity") : 0,
    active: Object.hasOwn(record, "active") ? ownValue(record, "active") : true,
  };
  const parsed = parseInventoryItemV1(candidate);
  if (parsed === undefined) return undefined;
  return Object.freeze({
    restaurantId: parsed.restaurantId,
    sku: parsed.sku,
    name: parsed.name,
    unitCode: parsed.unitCode,
    purchaseUnitFactor: parsed.purchaseUnitFactor,
    minQuantity: parsed.minQuantity,
    active: parsed.active,
  });
}

function parseCreateWarehouse(input: unknown): CreateInventoryWarehouseCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, WAREHOUSE_CREATE_KEYS)) return undefined;
  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  if (typeof restaurantId !== "string" || !UUID_PATTERN.test(restaurantId)) return undefined;
  if (typeof branchId !== "string" || !UUID_PATTERN.test(branchId)) return undefined;

  const candidate = {
    id: branchId,
    restaurantId,
    branchId,
    name: ownValue(record, "name"),
    active: Object.hasOwn(record, "active") ? ownValue(record, "active") : true,
  };
  const parsed = parseInventoryWarehouseV1(candidate);
  if (parsed === undefined) return undefined;
  return Object.freeze({
    restaurantId: parsed.restaurantId,
    branchId: parsed.branchId,
    name: parsed.name,
    active: parsed.active,
  });
}

function parsePatch(
  input: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, allowedKeys)) return undefined;
  const keys = Reflect.ownKeys(record);
  if (keys.length === 0) return undefined;
  const patch: Record<string, unknown> = {};
  for (const key of keys) patch[key as string] = ownValue(record, key as string);
  return Object.freeze(patch);
}

function mergeItem(existing: InventoryItemV1, patch: Readonly<Record<string, unknown>>): InventoryItemV1 | undefined {
  return parseInventoryItemV1({
    id: existing.id,
    restaurantId: existing.restaurantId,
    sku: Object.hasOwn(patch, "sku") ? patch["sku"] : existing.sku,
    name: Object.hasOwn(patch, "name") ? patch["name"] : existing.name,
    unitCode: existing.unitCode,
    purchaseUnitFactor: Object.hasOwn(patch, "purchaseUnitFactor") ? patch["purchaseUnitFactor"] : existing.purchaseUnitFactor,
    minQuantity: Object.hasOwn(patch, "minQuantity") ? patch["minQuantity"] : existing.minQuantity,
    active: Object.hasOwn(patch, "active") ? patch["active"] : existing.active,
  });
}

function mergeWarehouse(
  existing: InventoryWarehouseV1,
  patch: Readonly<Record<string, unknown>>,
): InventoryWarehouseV1 | undefined {
  return parseInventoryWarehouseV1({
    id: existing.id,
    restaurantId: existing.restaurantId,
    branchId: existing.branchId,
    name: Object.hasOwn(patch, "name") ? patch["name"] : existing.name,
    active: Object.hasOwn(patch, "active") ? patch["active"] : existing.active,
  });
}

function toItem(row: unknown): InventoryItemV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  return parseInventoryItemV1({
    id: ownValue(record, "id"),
    restaurantId: ownValue(record, "restaurant_id"),
    sku: ownValue(record, "sku"),
    name: ownValue(record, "name"),
    unitCode: ownValue(record, "unit_code"),
    purchaseUnitFactor: ownValue(record, "purchase_unit_factor"),
    minQuantity: ownValue(record, "min_quantity"),
    active: ownValue(record, "active"),
  });
}

function toWarehouse(row: unknown): InventoryWarehouseV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  return parseInventoryWarehouseV1({
    id: ownValue(record, "id"),
    restaurantId: ownValue(record, "restaurant_id"),
    branchId: ownValue(record, "branch_id"),
    name: ownValue(record, "name"),
    active: ownValue(record, "active"),
  });
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

function requestError(): InventoryApplicationError {
  return new InventoryApplicationError("request");
}

function unavailable(): InventoryApplicationError {
  return new InventoryApplicationError("unavailable");
}
