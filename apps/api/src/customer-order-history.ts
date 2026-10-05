import { Inject, Injectable } from "@nestjs/common";
import {
  CAPTURE_FULFILLMENT_CHANNELS,
  CUSTOMER_RECENT_ORDER_LIMIT,
  CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
  parseCustomerRecentOrderListV1,
  parseCustomerRecentOrdersQueryV1,
  parseCustomerRepeatOrderPreviewQueryV1,
  parseCustomerRepeatOrderPreviewV1,
  parseCustomerRepeatOrderCaptureResultV1,
  parseCaptureMutationResultV1,
  parseRepeatCustomerOrderIntoCaptureCommandV1,
  type BranchScope,
  type CustomerRepeatOrderCaptureResultV1,
  type CustomerRecentOrderListV1,
  type CustomerRecentOrdersQueryV1,
  type CustomerRepeatOrderPreviewQueryV1,
  type CustomerRepeatOrderPreviewV1,
  type RepeatCustomerOrderIntoCaptureCommandV1,
  type RbacPermissionCode,
} from "@super-restaurant/shared-types";
import { buildRepeatOrderPlan, type Order, type RepeatOrderPlan } from "@super-restaurant/domain";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { MENU_CATALOG_PORT, type MenuCatalogPort } from "./menu-catalog.js";
import { toDomainMenuCatalog } from "./menu-catalog-domain.js";
import { decodeCaptureRecord } from "./persistence/capture-persistence-codec.js";
import { decodeOrderRecord } from "./persistence/order-persistence-codec.js";
import type { CaptureRepeatSelectionPlan } from "./capture-repeat-order-plan.js";

export type { CaptureRepeatSelectionPlan } from "./capture-repeat-order-plan.js";

const listSql = "select app_private.list_customer_recent_orders($1::uuid, $2::jsonb) as result";
const repeatIntoCaptureSql = "select app_private.repeat_customer_order_into_capture($1::uuid, $2::jsonb, $3::jsonb) as result";

export type CustomerOrderHistoryErrorCode = "authorization" | "conflict" | "not_found" | "request" | "unavailable";

export class CustomerOrderHistoryError extends Error {
  public constructor(public readonly code: CustomerOrderHistoryErrorCode) {
    super(`CUSTOMER_ORDER_HISTORY_${code.toUpperCase()}`);
    this.name = "CustomerOrderHistoryError";
  }
}

export interface CustomerOrderHistoryPort {
  list(actorId: string, query: CustomerRecentOrdersQueryV1): Promise<CustomerRecentOrderListV1 | "forbidden">;
}

export const CUSTOMER_ORDER_HISTORY_PORT = Symbol("CUSTOMER_ORDER_HISTORY_PORT");

export interface CustomerOrderRepeatSourcePort {
  read(actorId: string, query: CustomerRepeatOrderPreviewQueryV1): Promise<Order | "forbidden" | "missing">;
}

export const CUSTOMER_ORDER_REPEAT_SOURCE_PORT = Symbol("CUSTOMER_ORDER_REPEAT_SOURCE_PORT");

export interface CustomerOrderRepeatCapturePort {
  apply(
    actorId: string,
    command: RepeatCustomerOrderIntoCaptureCommandV1,
    plan: CaptureRepeatSelectionPlan,
  ): Promise<unknown>;
}

export const CUSTOMER_ORDER_REPEAT_CAPTURE_PORT = Symbol("CUSTOMER_ORDER_REPEAT_CAPTURE_PORT");

interface InternalHistoryRead {
  readonly orders: readonly Order[];
  readonly publicList: CustomerRecentOrderListV1;
}

@Injectable()
export class PostgresCustomerOrderHistory implements CustomerOrderHistoryPort, CustomerOrderRepeatSourcePort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async list(
    actorId: string,
    query: CustomerRecentOrdersQueryV1,
  ): Promise<CustomerRecentOrderListV1 | "forbidden"> {
    const result = await this.readInternal(actorId, query);
    return result === "forbidden" ? result : result.publicList;
  }

  public async read(
    actorId: string,
    query: CustomerRepeatOrderPreviewQueryV1,
  ): Promise<Order | "forbidden" | "missing"> {
    const historyQuery = parseCustomerRecentOrdersQueryV1({
      customerId: query.customerId,
      limit: CUSTOMER_RECENT_ORDER_LIMIT,
      schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
      scope: query.scope,
    });
    if (historyQuery === undefined) throw unavailable();
    const result = await this.readInternal(actorId, historyQuery);
    if (result === "forbidden") return result;
    return result.orders.find(({ orderId }) => orderId === query.orderId) ?? "missing";
  }

  private async readInternal(
    actorId: string,
    query: CustomerRecentOrdersQueryV1,
  ): Promise<InternalHistoryRead | "forbidden"> {
    let rows: readonly unknown[];
    try {
      rows = (await this.database.query(listSql, [actorId, JSON.stringify(query)])).rows;
    } catch { throw unavailable(); }
    if (rows.length !== 1) throw unavailable();
    const row = exactRecord(rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    const outcome = parseOutcome(own(row, "result"));
    if (outcome === undefined) throw unavailable();
    if (outcome.status !== "ok") {
      if (outcome.status === "denied") return "forbidden";
      throw unavailable();
    }
    const result = internalList(outcome.result, query);
    if (result === undefined) throw unavailable();
    return result;
  }
}

@Injectable()
export class PostgresCustomerOrderRepeatCapture implements CustomerOrderRepeatCapturePort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async apply(
    actorId: string,
    input: RepeatCustomerOrderIntoCaptureCommandV1,
    plan: CaptureRepeatSelectionPlan,
  ): Promise<unknown> {
    const command = parseRepeatCustomerOrderIntoCaptureCommandV1(input);
    if (command === undefined || !UUID_PATTERN.test(actorId)) throw applicationError("request");
    let rows: readonly unknown[];
    try {
      rows = (await this.database.query(repeatIntoCaptureSql, [
        actorId,
        JSON.stringify(command),
        JSON.stringify(plan),
      ])).rows;
    } catch { throw unavailable(); }
    if (rows.length !== 1) throw unavailable();
    const row = exactRecord(rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return own(row, "result");
  }
}

@Injectable()
export class CustomerOrderHistoryService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CUSTOMER_ORDER_HISTORY_PORT) private readonly history: CustomerOrderHistoryPort,
  ) {}

  public async list(principal: AuthenticatedPrincipal, input: unknown): Promise<CustomerRecentOrderListV1> {
    const query = parseInput(input);
    if (query === undefined) throw applicationError("request");
    let actorId: string;
    try {
      const customerRead = await this.authorization.authorizeBranch(principal, query.scope, "customers.read");
      const orderRead = await this.authorization.authorizeBranch(principal, query.scope, "orders.read");
      if (customerRead.principal.actorId !== orderRead.principal.actorId) throw new Error("ACTOR_MISMATCH");
      actorId = customerRead.principal.actorId;
    } catch { throw applicationError("authorization"); }
    try {
      const result = await this.history.list(actorId, query);
      if (result === "forbidden") throw applicationError("authorization");
      if (!sameScope(result.scope, query.scope) || result.customerId !== query.customerId
        || result.orders.length > query.limit) throw unavailable();
      return result;
    } catch (error: unknown) {
      if (error instanceof CustomerOrderHistoryError) throw error;
      throw unavailable();
    }
  }
}

@Injectable()
export class CustomerOrderRepeatPreviewService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CUSTOMER_ORDER_REPEAT_SOURCE_PORT) private readonly source: CustomerOrderRepeatSourcePort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
  ) {}

  public async preview(principal: AuthenticatedPrincipal, input: unknown): Promise<CustomerRepeatOrderPreviewV1> {
    const query = parsePreviewInput(input);
    if (query === undefined) throw applicationError("request");
    const actorId = await authorizePermissions(this.authorization, principal, query.scope,
      ["customers.read", "orders.read", "catalog.read"]);
    try {
      const plan = await loadRepeatPlan(actorId, query, this.source, this.catalogs);
      const preview = publicPreview(plan, query);
      if (preview === undefined) throw unavailable();
      return preview;
    } catch (error: unknown) {
      if (error instanceof CustomerOrderHistoryError) throw error;
      throw unavailable();
    }
  }

}

@Injectable()
export class CustomerOrderRepeatCaptureService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CUSTOMER_ORDER_REPEAT_SOURCE_PORT) private readonly source: CustomerOrderRepeatSourcePort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
    @Inject(CUSTOMER_ORDER_REPEAT_CAPTURE_PORT) private readonly persistence: CustomerOrderRepeatCapturePort,
  ) {}

  public async apply(
    principal: AuthenticatedPrincipal,
    input: unknown,
    routeCustomerId: unknown,
    routeOrderId: unknown,
  ): Promise<CustomerRepeatOrderCaptureResultV1> {
    const command = parseRepeatCustomerOrderIntoCaptureCommandV1(input);
    const customerId = uuid(routeCustomerId);
    const sourceOrderId = uuid(routeOrderId);
    if (command === undefined || command.expectedVersion >= Number.MAX_SAFE_INTEGER
      || customerId !== command.customerId || sourceOrderId !== command.sourceOrderId) {
      throw applicationError("request");
    }
    const actorId = await authorizePermissions(this.authorization, principal, command.scope,
      ["captures.update", "customers.read", "orders.read", "catalog.read"]);
    try {
      const query = parseCustomerRepeatOrderPreviewQueryV1({
        customerId: command.customerId,
        orderId: command.sourceOrderId,
        schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
        scope: command.scope,
      });
      if (query === undefined) throw applicationError("request");
      const plan = await loadRepeatPlan(actorId, query, this.source, this.catalogs);
      if (plan.readyLineCount === 0) throw applicationError("conflict");
      const selectionPlan = captureSelectionPlan(plan, command.customerId);
      const raw = await this.persistence.apply(actorId, command, selectionPlan);
      const response = exactRecord(raw, ["status", "record"]);
      if (response === undefined) {
        const statusOnly = exactRecord(raw, ["status"]);
        if (statusOnly?.status === "denied") throw applicationError("authorization");
        if (statusOnly?.status === "conflict") throw applicationError("conflict");
        if (statusOnly?.status === "rejected") throw applicationError("request");
        throw unavailable();
      }
      if (response.status !== "applied" && response.status !== "replayed") throw unavailable();
      const record = decodeCaptureRecord(own(response, "record"), command.scope);
      if (record.detail.captureDraftId !== command.captureDraftId
        || record.detail.version !== command.expectedVersion + 1
        || record.detail.status !== "draft" || record.detail.attentionStatus !== "claimed"
        || record.detail.attentionLeaseId !== command.attentionLeaseId
        || record.detail.customerSnapshotRef === null) throw unavailable();
      const capture = parseCaptureMutationResultV1({
        detail: record.detail,
        replayed: response.status === "replayed",
        schemaVersion: 1,
      });
      const preview = publicPreview(plan, query);
      const result = capture === undefined || preview === undefined ? undefined
        : parseCustomerRepeatOrderCaptureResultV1({ capture, preview, schemaVersion: 1 });
      if (result === undefined) throw unavailable();
      return result;
    } catch (error: unknown) {
      if (error instanceof CustomerOrderHistoryError) throw error;
      throw unavailable();
    }
  }
}

async function authorizePermissions(
  authorization: MembershipAuthorizationService,
  principal: AuthenticatedPrincipal,
  scope: BranchScope,
  permissions: readonly RbacPermissionCode[],
): Promise<string> {
  try {
    const decisions = await Promise.all(permissions.map((permission) =>
      authorization.authorizeBranch(principal, scope, permission)));
    const actorId = decisions[0]?.principal.actorId;
    if (actorId === undefined || decisions.some(({ principal: decisionPrincipal }) =>
      decisionPrincipal.actorId !== actorId)) throw new Error("ACTOR_MISMATCH");
    return actorId;
  } catch { throw applicationError("authorization"); }
}

async function loadRepeatPlan(
  actorId: string,
  query: CustomerRepeatOrderPreviewQueryV1,
  source: CustomerOrderRepeatSourcePort,
  catalogs: MenuCatalogPort,
): Promise<RepeatOrderPlan> {
  const [sourceOrder, catalogState] = await Promise.all([
    source.read(actorId, query),
    catalogs.read(actorId, query.scope),
  ]);
  if (sourceOrder === "forbidden" || catalogState === "forbidden") throw applicationError("authorization");
  if (sourceOrder === "missing") throw applicationError("not_found");
  if (!sameScope(catalogState.scope, query.scope) || catalogState.catalog === null
    || sourceOrder.restaurantId !== query.scope.restaurantId
    || sourceOrder.branchId !== query.scope.branchId
    || sourceOrder.orderId !== query.orderId) throw unavailable();
  return buildRepeatOrderPlan(
    sourceOrder,
    toDomainMenuCatalog(catalogState.catalog, query.scope.restaurantId),
  );
}

function captureSelectionPlan(plan: RepeatOrderPlan, customerId: string): CaptureRepeatSelectionPlan {
  const lines = plan.lines.filter((line) => line.status === "ready").map((line) => {
    if (line.selection === null) throw unavailable();
    return Object.freeze({
      ...(line.selection.variantId === null ? {} : { variantId: line.selection.variantId }),
      modifierGroups: Object.freeze(line.selection.modifierGroups.map((group) => Object.freeze({
        groupId: group.groupId,
        selections: Object.freeze(group.selections.map((selection) => Object.freeze({
          optionId: selection.optionId,
          quantity: selection.quantity,
        }))),
      }))),
      productId: line.selection.productId,
      quantity: line.quantity,
      sourceOrderItemId: line.sourceOrderItemId,
    });
  });
  return Object.freeze({
    catalogVersion: plan.catalogVersion,
    customerId,
    lines: Object.freeze(lines),
    schemaVersion: 1 as const,
    sourceOrderId: plan.sourceOrderId,
  });
}

function internalList(value: unknown, query: CustomerRecentOrdersQueryV1): InternalHistoryRead | undefined {
  const envelope = exactRecord(value, ["schemaVersion", "scope", "customerId", "orders"]);
  if (envelope === undefined || own(envelope, "schemaVersion") !== CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION) return undefined;
  const scope = exactRecord(own(envelope, "scope"), ["restaurantId", "branchId"]);
  const restaurantId = scope === undefined ? undefined : uuid(own(scope, "restaurantId"));
  const branchId = scope === undefined ? undefined : uuid(own(scope, "branchId"));
  const customerId = uuid(own(envelope, "customerId"));
  const rawOrders = denseArray(own(envelope, "orders"), query.limit);
  if (restaurantId !== query.scope.restaurantId || branchId !== query.scope.branchId
    || customerId !== query.customerId || rawOrders === undefined) return undefined;
  const decoded = rawOrders.map((raw) => decodeHistoryOrder(raw, query.scope));
  if (decoded.some((entry) => entry === undefined)) return undefined;
  const entries = decoded as readonly DecodedHistoryOrder[];
  const publicList = parseCustomerRecentOrderListV1({
    customerId,
    orders: entries.map(({ publicOrder }) => publicOrder),
    schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
    scope: query.scope,
  });
  return publicList === undefined ? undefined : Object.freeze({
    orders: Object.freeze(entries.map(({ order }) => order)),
    publicList,
  });
}

interface DecodedHistoryOrder {
  readonly order: Order;
  readonly publicOrder: CustomerRecentOrderListV1["orders"][number];
}

function decodeHistoryOrder(value: unknown, scope: BranchScope): DecodedHistoryOrder | undefined {
  const record = exactRecord(value, ["confirmedAt", "fulfillmentChannel", "order"]);
  if (record === undefined) return undefined;
  const confirmedAt = timestamp(own(record, "confirmedAt"));
  const fulfillmentChannel = member(own(record, "fulfillmentChannel"), CAPTURE_FULFILLMENT_CHANNELS);
  if (confirmedAt === undefined || fulfillmentChannel === undefined) return undefined;
  let order: Order;
  try { order = decodeOrderRecord(own(record, "order")); } catch { return undefined; }
  if (order.restaurantId !== scope.restaurantId || order.branchId !== scope.branchId) return undefined;
  const publicOrder = {
    confirmedAt,
    currency: order.currency,
    fulfillmentChannel,
    items: order.items.map((item) => ({
      modifiers: item.snapshot.modifiers.map((modifier) => ({
        groupId: modifier.groupId ?? null,
        groupName: modifier.groupName ?? null,
        modifierId: modifier.modifierId,
        name: modifier.name,
        quantity: modifier.quantity,
        unitPriceMinor: modifier.unitPrice.amountMinor,
      })),
      orderItemId: item.orderItemId,
      productId: item.snapshot.productId,
      productName: item.snapshot.name,
      quantity: item.quantity,
      status: item.status,
      unit: item.snapshot.unit,
      unitPriceMinor: item.snapshot.unitPrice.amountMinor,
    })),
    orderId: order.orderId,
    status: order.status,
  };
  return Object.freeze({ order, publicOrder });
}

function parseInput(value: unknown): CustomerRecentOrdersQueryV1 | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId", "customerId", "limit"]);
  if (record === undefined) return undefined;
  const rawLimit = own(record, "limit");
  const limit = typeof rawLimit === "string" && /^(?:[1-9]|1[0-9]|20)$/u.test(rawLimit)
    ? Number(rawLimit)
    : rawLimit;
  return parseCustomerRecentOrdersQueryV1({
    customerId: own(record, "customerId"),
    limit,
    schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
    scope: { branchId: own(record, "branchId"), restaurantId: own(record, "restaurantId") },
  });
}

function parsePreviewInput(value: unknown): CustomerRepeatOrderPreviewQueryV1 | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId", "customerId", "orderId"]);
  return record === undefined ? undefined : parseCustomerRepeatOrderPreviewQueryV1({
    customerId: own(record, "customerId"),
    orderId: own(record, "orderId"),
    schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
    scope: { branchId: own(record, "branchId"), restaurantId: own(record, "restaurantId") },
  });
}

function publicPreview(
  plan: RepeatOrderPlan,
  query: CustomerRepeatOrderPreviewQueryV1,
): CustomerRepeatOrderPreviewV1 | undefined {
  if (plan.sourceOrderId !== query.orderId || plan.restaurantId !== query.scope.restaurantId
    || plan.sourceBranchId !== query.scope.branchId) return undefined;
  return parseCustomerRepeatOrderPreviewV1({
    blockedLineCount: plan.blockedLineCount,
    catalogVersion: plan.catalogVersion,
    currency: plan.currency,
    customerId: query.customerId,
    hasPriceChanges: plan.hasPriceChanges,
    lines: plan.lines.map((line) => ({
      blockedReason: line.blockedReason,
      currentName: line.currentName,
      currentUnitPriceMinor: line.currentSnapshot?.unitPrice.amountMinor ?? null,
      historicalName: line.historicalName,
      issues: line.issues.map((issue) => ({
        code: issue.code,
        currentAmountMinor: issue.currentAmountMinor ?? null,
        groupId: issue.groupId ?? null,
        historicalAmountMinor: issue.historicalAmountMinor ?? null,
        modifierId: issue.modifierId ?? null,
        severity: issue.severity,
      })),
      productId: line.productId,
      quantity: line.quantity,
      sourceOrderItemId: line.sourceOrderItemId,
      status: line.status,
    })),
    readyLineCount: plan.readyLineCount,
    schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
    scope: query.scope,
    sourceOrderId: plan.sourceOrderId,
  });
}

type SqlOutcome = Readonly<{ status: "ok"; result: unknown }>
  | Readonly<{ status: "denied" | "rejected" }>;

function parseOutcome(value: unknown): SqlOutcome | undefined {
  const record = exactRecordAny(value);
  if (record === undefined) return undefined;
  const status = own(record, "status");
  if ((status === "denied" || status === "rejected") && Reflect.ownKeys(record).length === 1) {
    return Object.freeze({ status });
  }
  return status === "ok" && Reflect.ownKeys(record).length === 2 && Reflect.ownKeys(record).includes("result")
    ? Object.freeze({ result: own(record, "result"), status })
    : undefined;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  const record = exactRecordAny(value);
  if (record === undefined) return undefined;
  const ownKeys = Reflect.ownKeys(record);
  return ownKeys.length === keys.length && keys.every((key) => ownKeys.includes(key)) ? record : undefined;
}

function exactRecordAny(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch { return undefined; }
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function denseArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return undefined;
  }
  return value;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length !== 24) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : undefined;
}

function member<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === "string" && values.includes(value) ? value as T[number] : undefined;
}

function sameScope(left: BranchScope, right: BranchScope): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

function unavailable(): CustomerOrderHistoryError {
  return applicationError("unavailable");
}

function applicationError(code: CustomerOrderHistoryErrorCode): CustomerOrderHistoryError {
  return new CustomerOrderHistoryError(code);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
