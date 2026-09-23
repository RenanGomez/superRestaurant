import { Inject, Injectable } from "@nestjs/common";
import {
  CAPTURE_FULFILLMENT_CHANNELS,
  CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
  parseCustomerRecentOrderListV1,
  parseCustomerRecentOrdersQueryV1,
  type BranchScope,
  type CustomerRecentOrderListV1,
  type CustomerRecentOrdersQueryV1,
} from "@super-restaurant/shared-types";
import type { Order } from "@super-restaurant/domain";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { decodeOrderRecord } from "./persistence/order-persistence-codec.js";

const listSql = "select app_private.list_customer_recent_orders($1::uuid, $2::jsonb) as result";

export type CustomerOrderHistoryErrorCode = "authorization" | "request" | "unavailable";

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

@Injectable()
export class PostgresCustomerOrderHistory implements CustomerOrderHistoryPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async list(
    actorId: string,
    query: CustomerRecentOrdersQueryV1,
  ): Promise<CustomerRecentOrderListV1 | "forbidden"> {
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
    const result = publicList(outcome.result, query);
    if (result === undefined) throw unavailable();
    return result;
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

function publicList(value: unknown, query: CustomerRecentOrdersQueryV1): CustomerRecentOrderListV1 | undefined {
  const envelope = exactRecord(value, ["schemaVersion", "scope", "customerId", "orders"]);
  if (envelope === undefined || own(envelope, "schemaVersion") !== CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION) return undefined;
  const scope = exactRecord(own(envelope, "scope"), ["restaurantId", "branchId"]);
  const restaurantId = scope === undefined ? undefined : uuid(own(scope, "restaurantId"));
  const branchId = scope === undefined ? undefined : uuid(own(scope, "branchId"));
  const customerId = uuid(own(envelope, "customerId"));
  const rawOrders = denseArray(own(envelope, "orders"), query.limit);
  if (restaurantId !== query.scope.restaurantId || branchId !== query.scope.branchId
    || customerId !== query.customerId || rawOrders === undefined) return undefined;
  const orders = rawOrders.map((raw) => publicOrder(raw, query.scope));
  if (orders.some((order) => order === undefined)) return undefined;
  return parseCustomerRecentOrderListV1({
    customerId,
    orders,
    schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
    scope: query.scope,
  });
}

function publicOrder(value: unknown, scope: BranchScope): CustomerRecentOrderListV1["orders"][number] | undefined {
  const record = exactRecord(value, ["confirmedAt", "fulfillmentChannel", "order"]);
  if (record === undefined) return undefined;
  const confirmedAt = timestamp(own(record, "confirmedAt"));
  const fulfillmentChannel = member(own(record, "fulfillmentChannel"), CAPTURE_FULFILLMENT_CHANNELS);
  if (confirmedAt === undefined || fulfillmentChannel === undefined) return undefined;
  let order: Order;
  try { order = decodeOrderRecord(own(record, "order")); } catch { return undefined; }
  if (order.restaurantId !== scope.restaurantId || order.branchId !== scope.branchId) return undefined;
  return {
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
