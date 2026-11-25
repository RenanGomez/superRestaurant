import type { BranchMembershipListV1 } from "@super-restaurant/shared-types";
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
const ORDER_STATUSES: ReadonlySet<string> = new Set(["draft", "sent", "received", "cancelled"]);

const listSuppliersSql =
  "select * from app_private.list_inventory_suppliers($1::uuid,$2::uuid,$3::boolean)";
const readSupplierForManageSql =
  "select * from app_private.read_inventory_supplier_for_manage($1::uuid,$2::uuid)";
const createSupplierSql =
  "select * from app_private.create_inventory_supplier($1::uuid,$2::uuid,$3::text,$4::text,$5::boolean)";
const updateSupplierSql =
  "select * from app_private.update_inventory_supplier($1::uuid,$2::uuid,$3::text,$4::text,$5::boolean)";
const listPurchaseOrdersSql =
  "select * from app_private.list_inventory_purchase_orders($1::uuid,$2::uuid,$3::uuid,$4::text,$5::integer)";
const readPurchaseOrderSql =
  "select * from app_private.read_inventory_purchase_order($1::uuid,$2::uuid)";
const createPurchaseOrderSql =
  "select app_private.inventory_create_purchase_order($1::uuid,$2::uuid,$3::uuid,$4::jsonb) as result";
const receivePurchaseOrderSql =
  "select app_private.inventory_receive_purchase_order($1::uuid,$2::uuid,$3::jsonb) as result";

const SUPPLIER_LIST_KEYS = Object.freeze(["restaurantId", "includeInactive"] as const);
const SUPPLIER_CREATE_KEYS = Object.freeze(["restaurantId", "name", "contact", "active"] as const);
const SUPPLIER_PATCH_KEYS = Object.freeze(["name", "contact", "active"] as const);
const ORDER_LIST_KEYS = Object.freeze(["restaurantId", "branchId", "status", "limit"] as const);
const ORDER_CREATE_KEYS = Object.freeze([
  "restaurantId",
  "branchId",
  "supplierId",
  "currency",
  "idempotencyKey",
  "orderedAt",
  "lines",
] as const);
const ORDER_LINE_KEYS = Object.freeze(["itemId", "quantity", "unitCode", "unitCostMinor"] as const);
const RECEIVE_KEYS = Object.freeze(["warehouseId", "deviceId", "occurredAt", "receivedAt"] as const);

export type PurchasingApplicationErrorCode =
  | "request"
  | "authorization"
  | "conflict"
  | "missing"
  | "idempotency-conflict"
  | "unavailable";

export class PurchasingApplicationError extends Error {
  public constructor(public readonly code: PurchasingApplicationErrorCode) {
    super(`INVENTORY_PURCHASING_${code.toUpperCase()}`);
    this.name = "PurchasingApplicationError";
  }
}

export interface InventorySupplierV1 {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly contact: string | null;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface InventorySupplierListV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly includeInactive: boolean;
  readonly suppliers: readonly InventorySupplierV1[];
}

export interface PurchaseOrderSummaryV1 {
  readonly id: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly status: string;
  readonly currency: string;
  readonly orderedAt: string;
  readonly receivedAt: string | null;
  readonly receivedBy: string | null;
  readonly totalMinor: number;
}

export interface PurchaseOrderLineV1 {
  readonly itemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly unitCode: string;
  readonly unitCostMinor: number;
}

export interface PurchaseOrderV1 extends PurchaseOrderSummaryV1 {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly lines: readonly PurchaseOrderLineV1[];
}

export interface PurchaseOrderListV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orders: readonly PurchaseOrderSummaryV1[];
}

export interface CreatePurchaseOrderResultV1 {
  readonly orderId: string;
  readonly status: string;
  readonly replayed: boolean;
}

export interface PurchaseOrderReceiptMovementV1 {
  readonly lineId: string;
  readonly movementId: string;
}

export interface ReceivePurchaseOrderResultV1 {
  readonly status: "received";
  readonly movements: readonly PurchaseOrderReceiptMovementV1[];
}

interface CreateSupplierCommand {
  readonly restaurantId: string;
  readonly name: string;
  readonly contact: string | null;
  readonly active: boolean;
}

interface SupplierPatch {
  readonly name?: string;
  readonly contact?: string | null;
  readonly active?: boolean;
}

interface CreatePurchaseOrderCommand {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly supplierId: string;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly orderedAt: string | undefined;
  readonly lines: readonly {
    readonly itemId: string;
    readonly quantity: number;
    readonly unitCode: string;
    readonly unitCostMinor: number;
  }[];
}

interface ReceivePurchaseOrderCommand {
  readonly warehouseId: string;
  readonly deviceId: string | undefined;
  readonly occurredAt: string | undefined;
  readonly receivedAt: string | undefined;
}

@Injectable()
export class PurchasingService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(MEMBERSHIP_DIRECTORY) private readonly directory: MembershipDirectoryPort,
    @Inject(DATABASE_CLIENT) private readonly database: TransactionalDatabaseClientPort,
  ) {}

  public async listSuppliers(principal: AuthenticatedPrincipal, input: unknown): Promise<InventorySupplierListV1> {
    const query = parseSupplierListQuery(input);
    if (query === undefined) throw requestError();
    await this.authorizeRestaurant(principal, query.restaurantId);

    const rows = await this.rows((database) => database.query(listSuppliersSql, [
      principal.actorId,
      query.restaurantId,
      query.includeInactive,
    ]));
    const suppliers: InventorySupplierV1[] = [];
    for (const row of rows) {
      const supplier = toSupplier(row);
      if (supplier === undefined) throw unavailable();
      suppliers.push(supplier);
    }
    return Object.freeze({
      schemaVersion: 1,
      restaurantId: query.restaurantId,
      includeInactive: query.includeInactive,
      suppliers: Object.freeze(suppliers),
    });
  }

  public async createSupplier(principal: AuthenticatedPrincipal, input: unknown): Promise<InventorySupplierV1> {
    const command = parseCreateSupplier(input);
    if (command === undefined) throw requestError();
    await this.authorizeRestaurant(principal, command.restaurantId);

    const rows = await this.rows((database) => database.query(createSupplierSql, [
      principal.actorId,
      command.restaurantId,
      command.name,
      command.contact,
      command.active,
    ]));
    if (rows.length !== 1) throw unavailable();
    const supplier = toSupplier(rows[0]);
    if (supplier === undefined) throw unavailable();
    return supplier;
  }

  public async updateSupplier(
    principal: AuthenticatedPrincipal,
    id: unknown,
    input: unknown,
  ): Promise<InventorySupplierV1> {
    const supplierId = parseId(id);
    const patch = parseSupplierPatch(input);
    if (supplierId === undefined || patch === undefined) throw requestError();

    const existing = await this.readSupplierForManage(principal, supplierId);
    if (existing === undefined) throw new PurchasingApplicationError("missing");
    await this.authorizeRestaurant(principal, existing.restaurantId);

    const merged = mergeSupplier(existing, patch);
    if (merged === undefined) throw requestError();

    const rows = await this.rows((database) => database.query(updateSupplierSql, [
      principal.actorId,
      supplierId,
      merged.name,
      merged.contact,
      merged.active,
    ]));
    if (rows.length === 0) throw new PurchasingApplicationError("missing");
    if (rows.length !== 1) throw unavailable();
    const supplier = toSupplier(rows[0]);
    if (supplier === undefined || supplier.id !== supplierId) throw unavailable();
    return supplier;
  }

  public async listPurchaseOrders(
    principal: AuthenticatedPrincipal,
    input: unknown,
  ): Promise<PurchaseOrderListV1> {
    const query = parseOrderListQuery(input);
    if (query === undefined) throw requestError();
    await this.authorizeBranch(principal, query.restaurantId, query.branchId);

    const rows = await this.rows((database) => database.query(listPurchaseOrdersSql, [
      principal.actorId,
      query.restaurantId,
      query.branchId,
      query.status ?? null,
      query.limit,
    ]));
    const orders: PurchaseOrderSummaryV1[] = [];
    for (const row of rows) {
      const order = toOrderSummary(row);
      if (order === undefined) throw unavailable();
      orders.push(order);
    }
    return Object.freeze({
      schemaVersion: 1,
      restaurantId: query.restaurantId,
      branchId: query.branchId,
      orders: Object.freeze(orders),
    });
  }

  public async createPurchaseOrder(
    principal: AuthenticatedPrincipal,
    input: unknown,
  ): Promise<CreatePurchaseOrderResultV1> {
    const command = parseCreateOrder(input);
    if (command === undefined) throw requestError();
    await this.authorizeBranch(principal, command.restaurantId, command.branchId);

    const payload: Record<string, unknown> = {
      supplierId: command.supplierId,
      currency: command.currency,
      idempotencyKey: command.idempotencyKey,
      lines: command.lines,
    };
    if (command.orderedAt !== undefined) payload["orderedAt"] = command.orderedAt;

    const rows = await this.rows((database) => database.query(createPurchaseOrderSql, [
      principal.actorId,
      command.restaurantId,
      command.branchId,
      JSON.stringify(payload),
    ]));
    const result = toCreateOrderResult(rows);
    if (result === undefined) throw unavailable();
    return result;
  }

  public async readPurchaseOrder(principal: AuthenticatedPrincipal, id: unknown): Promise<PurchaseOrderV1> {
    const orderId = parseId(id);
    if (orderId === undefined) throw requestError();

    const rows = await this.rows((database) => database.query(readPurchaseOrderSql, [
      principal.actorId,
      orderId,
    ]));
    if (rows.length === 0) throw new PurchasingApplicationError("missing");
    if (rows.length !== 1) throw unavailable();
    const order = toPurchaseOrder(rows[0]);
    if (order === undefined || order.id !== orderId) throw unavailable();
    return order;
  }

  public async receivePurchaseOrder(
    principal: AuthenticatedPrincipal,
    id: unknown,
    input: unknown,
  ): Promise<ReceivePurchaseOrderResultV1> {
    const orderId = parseId(id);
    const command = parseReceive(input);
    if (orderId === undefined || command === undefined) throw requestError();

    const existing = await this.readPurchaseOrder(principal, orderId);
    await this.authorizeBranch(principal, existing.restaurantId, existing.branchId);

    const payload: Record<string, unknown> = { warehouseId: command.warehouseId };
    if (command.deviceId !== undefined) payload["deviceId"] = command.deviceId;
    if (command.occurredAt !== undefined) payload["occurredAt"] = command.occurredAt;
    if (command.receivedAt !== undefined) payload["receivedAt"] = command.receivedAt;

    const rows = await this.rows((database) => database.query(receivePurchaseOrderSql, [
      principal.actorId,
      orderId,
      JSON.stringify(payload),
    ]));
    const result = toReceiveResult(rows);
    if (result === undefined) throw unavailable();
    return result;
  }

  private async readSupplierForManage(
    principal: AuthenticatedPrincipal,
    supplierId: string,
  ): Promise<InventorySupplierV1 | undefined> {
    const rows = await this.rows((database) => database.query(readSupplierForManageSql, [
      principal.actorId,
      supplierId,
    ]));
    if (rows.length === 0) return undefined;
    if (rows.length !== 1) throw unavailable();
    const supplier = toSupplier(rows[0]);
    if (supplier === undefined) throw unavailable();
    return supplier;
  }

  private async authorizeRestaurant(principal: AuthenticatedPrincipal, restaurantId: string): Promise<void> {
    let memberships: BranchMembershipListV1;
    try {
      memberships = await this.directory.listActiveMemberships(principal);
    } catch {
      throw unavailable();
    }
    const granted = memberships.memberships.some((membership) =>
      membership.scope.restaurantId === restaurantId
      && rolesGrantPermission(membership.roles, "catalog.manage"));
    if (!granted) throw new PurchasingApplicationError("authorization");
  }

  private async authorizeBranch(
    principal: AuthenticatedPrincipal,
    restaurantId: string,
    branchId: string,
  ): Promise<void> {
    try {
      await this.authorization.authorizeBranch(principal, { restaurantId, branchId }, "catalog.manage");
    } catch {
      throw new PurchasingApplicationError("authorization");
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
      if (error instanceof PurchasingApplicationError) throw error;
      const message = errorMessage(error);
      if (message.includes("INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT")) {
        throw new PurchasingApplicationError("idempotency-conflict");
      }
      const state = sqlState(error);
      if (state === "22000" || state === "22003" || state === "23514") throw new PurchasingApplicationError("request");
      if (state === "23503" || state === "23505") throw new PurchasingApplicationError("conflict");
      if (state === "42501") throw new PurchasingApplicationError("authorization");
      throw unavailable();
    }
  }
}

function parseSupplierListQuery(
  input: unknown,
): { restaurantId: string; includeInactive: boolean } | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, SUPPLIER_LIST_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  if (restaurantId === undefined) return undefined;
  const includeInactive = Object.hasOwn(record, "includeInactive")
    ? parseBoolean(ownValue(record, "includeInactive"))
    : false;
  if (includeInactive === undefined) return undefined;
  return { restaurantId, includeInactive };
}

function parseCreateSupplier(input: unknown): CreateSupplierCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, SUPPLIER_CREATE_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  if (restaurantId === undefined) return undefined;

  const name = parseSupplierName(ownValue(record, "name"));
  if (name === undefined) return undefined;
  const contact = Object.hasOwn(record, "contact") ? parseContact(ownValue(record, "contact")) : null;
  if (contact === undefined) return undefined;
  const active = Object.hasOwn(record, "active") ? parseBoolean(ownValue(record, "active")) : true;
  if (active === undefined) return undefined;

  return Object.freeze({ restaurantId, name, contact, active });
}

function parseSupplierPatch(input: unknown): SupplierPatch | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, SUPPLIER_PATCH_KEYS)) return undefined;
  const keys = Reflect.ownKeys(record);
  if (keys.length === 0) return undefined;

  const patch: { name?: string; contact?: string | null; active?: boolean } = {};
  if (Object.hasOwn(record, "name")) {
    const name = parseSupplierName(ownValue(record, "name"));
    if (name === undefined) return undefined;
    patch.name = name;
  }
  if (Object.hasOwn(record, "contact")) {
    const contact = parseContact(ownValue(record, "contact"));
    if (contact === undefined) return undefined;
    patch.contact = contact;
  }
  if (Object.hasOwn(record, "active")) {
    const active = parseBoolean(ownValue(record, "active"));
    if (active === undefined) return undefined;
    patch.active = active;
  }
  return Object.freeze(patch);
}

function parseOrderListQuery(
  input: unknown,
): { restaurantId: string; branchId: string; status?: string; limit: number } | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, ORDER_LIST_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  const branchId = uuidValue(record, "branchId");
  if (restaurantId === undefined || branchId === undefined) return undefined;

  let status: string | undefined;
  if (Object.hasOwn(record, "status")) {
    const value = ownValue(record, "status");
    if (typeof value !== "string" || !ORDER_STATUSES.has(value)) return undefined;
    status = value;
  }

  const limit = Object.hasOwn(record, "limit") ? parseLimit(ownValue(record, "limit")) : 100;
  if (limit === undefined) return undefined;

  return status === undefined
    ? { restaurantId, branchId, limit }
    : { restaurantId, branchId, status, limit };
}

function parseCreateOrder(input: unknown): CreatePurchaseOrderCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, ORDER_CREATE_KEYS)) return undefined;
  const restaurantId = uuidValue(record, "restaurantId");
  const branchId = uuidValue(record, "branchId");
  const supplierId = uuidValue(record, "supplierId");
  if (restaurantId === undefined || branchId === undefined || supplierId === undefined) return undefined;

  const currency = ownValue(record, "currency");
  if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) return undefined;

  const idempotencyKey = ownValue(record, "idempotencyKey");
  if (typeof idempotencyKey !== "string"
    || idempotencyKey !== idempotencyKey.trim()
    || idempotencyKey.length < 1
    || idempotencyKey.length > 200
    || /[\u0000-\u001f\u007f]/u.test(idempotencyKey)) return undefined;

  let orderedAt: string | undefined;
  if (Object.hasOwn(record, "orderedAt")) {
    const value = ownValue(record, "orderedAt");
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
    orderedAt = value;
  }

  const rawLines = ownValue(record, "lines");
  if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 200) return undefined;
  const lines: CreatePurchaseOrderCommand["lines"][number][] = [];
  for (const rawLine of rawLines) {
    const line = parseOrderLine(rawLine);
    if (line === undefined) return undefined;
    lines.push(line);
  }

  return Object.freeze({ restaurantId, branchId, supplierId, currency, idempotencyKey, orderedAt, lines });
}

function parseOrderLine(input: unknown): CreatePurchaseOrderCommand["lines"][number] | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, ORDER_LINE_KEYS)) return undefined;
  const itemId = uuidValue(record, "itemId");
  if (itemId === undefined) return undefined;

  const quantity = ownValue(record, "quantity");
  if (typeof quantity !== "number"
    || !Number.isSafeInteger(quantity)
    || quantity < 1
    || quantity > 999999999) return undefined;

  const unitCode = ownValue(record, "unitCode");
  if (typeof unitCode !== "string" || !UNIT_CODES.has(unitCode)) return undefined;

  const unitCostMinor = ownValue(record, "unitCostMinor");
  if (typeof unitCostMinor !== "number"
    || !Number.isSafeInteger(unitCostMinor)
    || unitCostMinor < 0) return undefined;

  return Object.freeze({ itemId, quantity, unitCode, unitCostMinor });
}

function parseReceive(input: unknown): ReceivePurchaseOrderCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined || !hasOnlyKeys(record, RECEIVE_KEYS)) return undefined;
  const warehouseId = uuidValue(record, "warehouseId");
  if (warehouseId === undefined) return undefined;

  let deviceId: string | undefined;
  if (Object.hasOwn(record, "deviceId")) {
    const value = ownValue(record, "deviceId");
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) return undefined;
    deviceId = value;
  }

  let occurredAt: string | undefined;
  if (Object.hasOwn(record, "occurredAt")) {
    const value = ownValue(record, "occurredAt");
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
    occurredAt = value;
  }
  let receivedAt: string | undefined;
  if (Object.hasOwn(record, "receivedAt")) {
    const value = ownValue(record, "receivedAt");
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
    receivedAt = value;
  }

  return Object.freeze({ warehouseId, deviceId, occurredAt, receivedAt });
}

function parseSupplierName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 160 ? value : undefined;
}

function parseContact(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? value : undefined;
}

function mergeSupplier(
  existing: InventorySupplierV1,
  patch: SupplierPatch,
): { name: string; contact: string | null; active: boolean } | undefined {
  const name = patch.name ?? existing.name;
  const contact = Object.hasOwn(patch, "contact") ? patch.contact ?? null : existing.contact;
  const active = patch.active ?? existing.active;
  return Object.freeze({ name, contact, active });
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

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseId(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function uuidValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = ownValue(record, key);
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function toSupplier(row: unknown): InventorySupplierV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const id = ownValue(record, "id");
  const restaurantId = ownValue(record, "restaurant_id");
  const name = ownValue(record, "name");
  const contact = ownValue(record, "contact");
  const active = ownValue(record, "active");
  const createdAt = timestampText(ownValue(record, "created_at"));
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  if (typeof restaurantId !== "string" || !UUID_PATTERN.test(restaurantId)) return undefined;
  if (typeof name !== "string" || name.trim().length === 0) return undefined;
  if (!(contact === null || typeof contact === "string")) return undefined;
  if (typeof active !== "boolean") return undefined;
  if (typeof createdAt !== "string" || createdAt.length === 0) return undefined;
  return Object.freeze({ id, restaurantId, name, contact, active, createdAt });
}

function toOrderSummary(row: unknown): PurchaseOrderSummaryV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const id = ownValue(record, "id");
  const supplierId = ownValue(record, "supplier_id");
  const supplierName = ownValue(record, "supplier_name");
  const status = ownValue(record, "status");
  const currency = ownValue(record, "currency");
  const orderedAt = timestampText(ownValue(record, "ordered_at"));
  const receivedAtValue = ownValue(record, "received_at");
  const receivedAt = receivedAtValue === null ? null : timestampText(receivedAtValue);
  const receivedBy = ownValue(record, "received_by");
  const totalMinor = int8Value(ownValue(record, "total_minor"));

  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  if (typeof supplierId !== "string" || !UUID_PATTERN.test(supplierId)) return undefined;
  if (typeof supplierName !== "string" || supplierName.trim().length === 0) return undefined;
  if (typeof status !== "string" || !ORDER_STATUSES.has(status)) return undefined;
  if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) return undefined;
  if (typeof orderedAt !== "string" || orderedAt.length === 0) return undefined;
  if (!(receivedAt === null || (typeof receivedAt === "string" && receivedAt.length > 0))) return undefined;
  if (!(receivedBy === null || (typeof receivedBy === "string" && UUID_PATTERN.test(receivedBy)))) return undefined;
  if (totalMinor === undefined || totalMinor === null) return undefined;

  return Object.freeze({
    id,
    supplierId,
    supplierName,
    status,
    currency,
    orderedAt,
    receivedAt,
    receivedBy,
    totalMinor,
  });
}

function toPurchaseOrder(row: unknown): PurchaseOrderV1 | undefined {
  const summary = toOrderSummary(row);
  if (summary === undefined) return undefined;
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const restaurantId = ownValue(record, "restaurant_id");
  const branchId = ownValue(record, "branch_id");
  if (typeof restaurantId !== "string" || !UUID_PATTERN.test(restaurantId)) return undefined;
  if (typeof branchId !== "string" || !UUID_PATTERN.test(branchId)) return undefined;

  const rawLines = ownValue(record, "lines");
  if (!Array.isArray(rawLines)) return undefined;
  const lines: PurchaseOrderLineV1[] = [];
  for (const rawLine of rawLines) {
    const line = toOrderLine(rawLine);
    if (line === undefined) return undefined;
    lines.push(line);
  }
  return Object.freeze({
    ...summary,
    restaurantId,
    branchId,
    lines: Object.freeze(lines),
  });
}

function toOrderLine(row: unknown): PurchaseOrderLineV1 | undefined {
  const record = plainRecord(row);
  if (record === undefined) return undefined;
  const itemId = ownValue(record, "item_id");
  const itemName = ownValue(record, "item_name");
  const quantity = ownValue(record, "quantity");
  const unitCode = ownValue(record, "unit_code");
  const unitCostMinor = int8Value(ownValue(record, "unit_cost_minor"));
  if (typeof itemId !== "string" || !UUID_PATTERN.test(itemId)) return undefined;
  if (typeof itemName !== "string" || itemName.trim().length === 0) return undefined;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) return undefined;
  if (typeof unitCode !== "string" || !UNIT_CODES.has(unitCode)) return undefined;
  if (unitCostMinor === undefined || unitCostMinor === null || unitCostMinor < 0) return undefined;
  return Object.freeze({ itemId, itemName, quantity, unitCode, unitCostMinor });
}

function toCreateOrderResult(rows: readonly unknown[]): CreatePurchaseOrderResultV1 | undefined {
  if (rows.length !== 1) return undefined;
  const result = resultValue(rows[0]);
  if (result === undefined) return undefined;
  const orderId = ownValue(result, "orderId");
  const status = ownValue(result, "status");
  const replayed = ownValue(result, "replayed");
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) return undefined;
  if (typeof status !== "string" || !ORDER_STATUSES.has(status)) return undefined;
  if (replayed !== undefined && typeof replayed !== "boolean") return undefined;
  return Object.freeze({ orderId, status, replayed: replayed === true });
}

function toReceiveResult(rows: readonly unknown[]): ReceivePurchaseOrderResultV1 | undefined {
  if (rows.length !== 1) return undefined;
  const result = resultValue(rows[0]);
  if (result === undefined) return undefined;
  const status = ownValue(result, "status");
  const rawMovements = ownValue(result, "movements");
  if (status !== "received") return undefined;
  if (!Array.isArray(rawMovements)) return undefined;

  const movements: PurchaseOrderReceiptMovementV1[] = [];
  const seen = new Set<string>();
  for (const rawMovement of rawMovements) {
    const record = plainRecord(rawMovement);
    if (record === undefined) return undefined;
    const lineId = ownValue(record, "lineId");
    const movementId = ownValue(record, "movementId");
    if (typeof lineId !== "string" || !UUID_PATTERN.test(lineId)) return undefined;
    if (typeof movementId !== "string" || !UUID_PATTERN.test(movementId)) return undefined;
    if (seen.has(lineId)) return undefined;
    seen.add(lineId);
    movements.push(Object.freeze({ lineId, movementId }));
  }
  return Object.freeze({ status: "received", movements: Object.freeze(movements) });
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

function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function requestError(): PurchasingApplicationError {
  return new PurchasingApplicationError("request");
}

function unavailable(): PurchasingApplicationError {
  return new PurchasingApplicationError("unavailable");
}
