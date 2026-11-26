import type {
  BranchMembershipListV1,
  InventoryUnitV1,
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
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const UNIT_CODES: ReadonlySet<string> = new Set(["g", "ml", "piece"]);

const listAlertsSql = "select * from app_private.list_inventory_alerts($1::uuid,$2::uuid,$3::uuid)";
const averageCostSql =
  "select * from app_private.inventory_average_cost($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)";
const listProductCostsSql =
  "select * from app_private.list_inventory_product_costs($1::uuid,$2::uuid,$3::uuid)";
const readMarginSql =
  "select * from app_private.read_inventory_product_margin($1::uuid,$2::uuid,$3::uuid,$4::uuid)";

const ALERT_QUERY_KEYS = Object.freeze(["restaurantId", "branchId"] as const);
const COST_QUERY_KEYS = Object.freeze(["restaurantId", "branchId", "warehouseId", "itemId"] as const);
const PRODUCT_COST_QUERY_KEYS = Object.freeze(["restaurantId", "productId"] as const);
const MARGIN_QUERY_KEYS = Object.freeze(["restaurantId", "branchId", "productId"] as const);

export type CostingApplicationErrorCode = "request" | "authorization" | "conflict" | "missing" | "unavailable";

export class CostingApplicationError extends Error {
  public constructor(public readonly code: CostingApplicationErrorCode) {
    super(`INVENTORY_COSTING_${code.toUpperCase()}`);
    this.name = "CostingApplicationError";
  }
}

export interface InventoryStockAlertV1 {
  readonly itemId: string;
  readonly itemName: string;
  readonly unitCode: InventoryUnitV1;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly quantity: number;
  readonly minQuantity: number;
  readonly deficit: number;
}

export interface InventoryStockAlertListV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly alerts: readonly InventoryStockAlertV1[];
}

export interface InventoryAverageCostV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly valueMinor: number;
  readonly unitCostMinor: number;
  readonly currency: string | null;
  readonly roundingRemainder: number;
}

export interface InventoryProductCostV1 {
  readonly itemId: string;
  readonly itemName: string;
  readonly unitCode: InventoryUnitV1;
  readonly quantity: number;
  readonly purchaseUnitFactor: number;
  readonly unitCostMinor: number;
  readonly lineCostMinor: number;
  readonly currency: string | null;
}

export interface InventoryProductCostListV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly productId: string;
  readonly costs: readonly InventoryProductCostV1[];
}

export interface InventoryProductMarginV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly productId: string;
  readonly priceMinor: number;
  readonly costMinor: number;
  readonly marginMinor: number;
  readonly currency: string;
}

@Injectable()
export class CostingService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(MEMBERSHIP_DIRECTORY) private readonly directory: MembershipDirectoryPort,
    @Inject(DATABASE_CLIENT) private readonly database: TransactionalDatabaseClientPort,
  ) {}

  public async listAlerts(principal: AuthenticatedPrincipal, input: unknown): Promise<InventoryStockAlertListV1> {
    const query = parseAlertsQuery(input);
    if (query === undefined) throw requestError();
    await this.authorizeBranch(principal, query.restaurantId, query.branchId);

    const rows = await this.rows((database) => database.query(listAlertsSql, [
      principal.actorId,
      query.restaurantId,
      query.branchId,
    ]));
    const alerts: InventoryStockAlertV1[] = [];
    for (const row of rows) {
      const alert = toAlert(row);
      if (alert === undefined) throw unavailable();
      alerts.push(alert);
    }
    return Object.freeze({
      schemaVersion: 1,
      restaurantId: query.restaurantId,
      branchId: query.branchId,
      alerts: Object.freeze(alerts),
    });
  }

  public async readCost(principal: AuthenticatedPrincipal, input: unknown): Promise<InventoryAverageCostV1> {
    const query = parseCostQuery(input);
    if (query === undefined) throw requestError();
    await this.authorizeBranch(principal, query.restaurantId, query.branchId);

    const rows = await this.rows((database) => database.query(averageCostSql, [
      principal.actorId,
      query.restaurantId,
      query.branchId,
      query.warehouseId,
      query.itemId,
    ]));
    if (rows.length !== 1) throw unavailable();
    const cost = toAverageCost(rows[0], query);
    if (cost === undefined) throw unavailable();
    return cost;
  }

  public async listProductCosts(
    principal: AuthenticatedPrincipal,
    input: unknown,
  ): Promise<InventoryProductCostListV1> {
    const query = parseProductCostQuery(input);
    if (query === undefined) throw requestError();
    await this.authorizeRestaurant(principal, query.restaurantId);

    const rows = await this.rows((database) => database.query(listProductCostsSql, [
      principal.actorId,
      query.restaurantId,
      query.productId,
    ]));
    const costs: InventoryProductCostV1[] = [];
    for (const row of rows) {
      const cost = toProductCost(row);
      if (cost === undefined) throw unavailable();
      costs.push(cost);
    }
    return Object.freeze({
      schemaVersion: 1,
      restaurantId: query.restaurantId,
      productId: query.productId,
      costs: Object.freeze(costs),
    });
  }

  public async readMargin(principal: AuthenticatedPrincipal, input: unknown): Promise<InventoryProductMarginV1> {
    const query = parseMarginQuery(input);
    if (query === undefined) throw requestError();
    await this.authorizeBranch(principal, query.restaurantId, query.branchId);

    const rows = await this.rows((database) => database.query(readMarginSql, [
      principal.actorId,
      query.restaurantId,
      query.branchId,
      query.productId,
    ]));
    if (rows.length === 0) throw new CostingApplicationError("missing");
    if (rows.length !== 1) throw unavailable();
    const margin = toMargin(rows[0], query);
    if (margin === undefined) throw unavailable();
    return margin;
  }

  private async authorizeBranch(
    principal: AuthenticatedPrincipal,
    restaurantId: string,
    branchId: string,
  ): Promise<void> {
    try {
      await this.authorization.authorizeBranch(principal, { restaurantId, branchId }, "catalog.read");
    } catch {
      throw new CostingApplicationError("authorization");
    }
  }

  private async authorizeRestaurant(
    principal: AuthenticatedPrincipal,
    restaurantId: string,
  ): Promise<void> {
    let memberships: BranchMembershipListV1;
    try {
      memberships = await this.directory.listActiveMemberships(principal);
    } catch {
      throw unavailable();
    }
    const granted = memberships.memberships.some((membership) =>
      membership.scope.restaurantId === restaurantId
      && rolesGrantPermission(membership.roles, "catalog.read"));
    if (!granted) throw new CostingApplicationError("authorization");
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
      if (error instanceof CostingApplicationError) throw error;
      const state = sqlState(error);
      if (state === "22000" || state === "23514" || state === "22003") {
        throw new CostingApplicationError("request");
      }
      if (state === "23503" || state === "23505") throw new CostingApplicationError("conflict");
      if (state === "42501") throw new CostingApplicationError("authorization");
      throw unavailable();
    }
  }
}

interface AlertsQuery {
  readonly restaurantId: string;
  readonly branchId: string;
}

interface CostQuery {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly itemId: string;
}

interface ProductCostQuery {
  readonly restaurantId: string;
  readonly productId: string;
}

interface MarginQuery {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly productId: string;
}

function parseAlertsQuery(input: unknown): AlertsQuery | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, ALERT_QUERY_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  const branchId = uuidValue(record, "branchId");
  return restaurantId === undefined || branchId === undefined ? undefined : { restaurantId, branchId };
}

function parseCostQuery(input: unknown): CostQuery | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, COST_QUERY_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  const branchId = uuidValue(record, "branchId");
  const warehouseId = uuidValue(record, "warehouseId");
  const itemId = uuidValue(record, "itemId");
  return restaurantId === undefined || branchId === undefined || warehouseId === undefined || itemId === undefined
    ? undefined
    : { restaurantId, branchId, warehouseId, itemId };
}

function parseProductCostQuery(input: unknown): ProductCostQuery | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, PRODUCT_COST_QUERY_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  const productId = uuidValue(record, "productId");
  return restaurantId === undefined || productId === undefined ? undefined : { restaurantId, productId };
}

function parseMarginQuery(input: unknown): MarginQuery | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, MARGIN_QUERY_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  const branchId = uuidValue(record, "branchId");
  const productId = uuidValue(record, "productId");
  return restaurantId === undefined || branchId === undefined || productId === undefined
    ? undefined
    : { restaurantId, branchId, productId };
}

function toAlert(row: unknown): InventoryStockAlertV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const itemId = uuidField(record, "item_id");
  const warehouseId = uuidField(record, "warehouse_id");
  const itemName = textField(record, "item_name");
  const warehouseName = textField(record, "warehouse_name");
  const unitCode = unitField(record, "unit_code");
  const quantity = int4Field(record, "quantity");
  const minQuantity = int4Field(record, "min_quantity");
  const deficit = int4Field(record, "deficit");
  if (itemId === undefined || warehouseId === undefined || itemName === undefined
    || warehouseName === undefined || unitCode === undefined || quantity === undefined
    || minQuantity === undefined || minQuantity < 0 || deficit === undefined || deficit < 0
  ) {
    return undefined;
  }
  return Object.freeze({ itemId, itemName, unitCode, warehouseId, warehouseName, quantity, minQuantity, deficit });
}

function toAverageCost(row: unknown, query: CostQuery): InventoryAverageCostV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const quantity = int4Field(record, "quantity");
  const valueMinor = int8Field(record, "value_minor");
  const unitCostMinor = int8Field(record, "unit_cost_minor");
  const currency = currencyField(record, "currency");
  const roundingRemainder = int4Field(record, "rounding_remainder");
  if (quantity === undefined || quantity < 0 || valueMinor === undefined || valueMinor < 0
    || unitCostMinor === undefined || unitCostMinor < 0 || currency === undefined
    || roundingRemainder === undefined || roundingRemainder < 0
  ) {
    return undefined;
  }
  if (unitCostMinor > 0 && currency === null) return undefined;
  return Object.freeze({
    schemaVersion: 1,
    restaurantId: query.restaurantId,
    branchId: query.branchId,
    warehouseId: query.warehouseId,
    itemId: query.itemId,
    quantity,
    valueMinor,
    unitCostMinor,
    currency,
    roundingRemainder,
  });
}

function toProductCost(row: unknown): InventoryProductCostV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const itemId = uuidField(record, "item_id");
  const itemName = textField(record, "item_name");
  const unitCode = unitField(record, "unit_code");
  const quantity = int4Field(record, "quantity");
  const purchaseUnitFactor = int4Field(record, "purchase_unit_factor");
  const unitCostMinor = int8Field(record, "unit_cost_minor");
  const lineCostMinor = int8Field(record, "line_cost_minor");
  const currency = currencyField(record, "currency");
  if (itemId === undefined || itemName === undefined || unitCode === undefined
    || quantity === undefined || quantity <= 0 || purchaseUnitFactor === undefined
    || purchaseUnitFactor <= 0 || unitCostMinor === undefined || unitCostMinor < 0
    || lineCostMinor === undefined || lineCostMinor < 0 || currency === undefined
  ) {
    return undefined;
  }
  if (unitCostMinor > 0 && currency === null) return undefined;
  return Object.freeze({
    itemId,
    itemName,
    unitCode,
    quantity,
    purchaseUnitFactor,
    unitCostMinor,
    lineCostMinor,
    currency,
  });
}

function toMargin(row: unknown, query: MarginQuery): InventoryProductMarginV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const productId = uuidField(record, "product_id");
  const priceMinor = int8Field(record, "price_minor");
  const costMinor = int8Field(record, "cost_minor");
  const marginMinor = int8Field(record, "margin_minor");
  const currency = currencyField(record, "currency");
  if (productId === undefined || productId !== query.productId || priceMinor === undefined
    || priceMinor < 0 || costMinor === undefined || costMinor < 0 || marginMinor === undefined
    || currency === undefined || currency === null
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 1,
    restaurantId: query.restaurantId,
    branchId: query.branchId,
    productId,
    priceMinor,
    costMinor,
    marginMinor,
    currency,
  });
}

function uuidValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = ownValue(record, key);
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function uuidField(record: Record<string, unknown>, key: string): string | undefined {
  return uuidValue(record, key);
}

function textField(record: Record<string, unknown>, key: string): string | undefined {
  const value = ownValue(record, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function unitField(record: Record<string, unknown>, key: string): InventoryUnitV1 | undefined {
  const value = ownValue(record, key);
  return typeof value === "string" && UNIT_CODES.has(value) ? value as InventoryUnitV1 : undefined;
}

function currencyField(record: Record<string, unknown>, key: string): string | null | undefined {
  const value = ownValue(record, key);
  if (value === null || value === undefined) return null;
  return typeof value === "string" && CURRENCY_PATTERN.test(value) ? value : undefined;
}

function int4Field(record: Record<string, unknown>, key: string): number | undefined {
  return safeIntegerValue(ownValue(record, key), 10);
}

function int8Field(record: Record<string, unknown>, key: string): number | undefined {
  return safeIntegerValue(ownValue(record, key), 16);
}

function safeIntegerValue(value: unknown, maximumDigits: number): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== "string" || !new RegExp(`^-?\\d{1,${maximumDigits}}$`, "u").test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
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

function requestError(): CostingApplicationError {
  return new CostingApplicationError("request");
}

function unavailable(): CostingApplicationError {
  return new CostingApplicationError("unavailable");
}
