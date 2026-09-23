import { CAPTURE_FULFILLMENT_CHANNELS, type CaptureFulfillmentChannelV1 } from "./commercial-capture.js";
import type { BranchScope } from "./index.js";
import { ORDER_ITEM_STATUSES, ORDER_STATUSES } from "./orders.js";

export const CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION = 1 as const;
export const CUSTOMER_RECENT_ORDER_LIMIT = 20 as const;

export interface CustomerRecentOrdersQueryV1 {
  readonly customerId: string;
  readonly limit: number;
  readonly schemaVersion: typeof CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface CustomerRecentOrderModifierV1 {
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly modifierId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export interface CustomerRecentOrderItemV1 {
  readonly modifiers: readonly CustomerRecentOrderModifierV1[];
  readonly orderItemId: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly status: (typeof ORDER_ITEM_STATUSES)[number];
  readonly unit: string;
  readonly unitPriceMinor: number;
}

export interface CustomerRecentOrderV1 {
  readonly confirmedAt: string;
  readonly currency: string;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1;
  readonly items: readonly CustomerRecentOrderItemV1[];
  readonly orderId: string;
  readonly status: (typeof ORDER_STATUSES)[number];
}

export interface CustomerRecentOrderListV1 {
  readonly customerId: string;
  readonly orders: readonly CustomerRecentOrderV1[];
  readonly schemaVersion: typeof CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export function parseCustomerRecentOrdersQueryV1(value: unknown): CustomerRecentOrdersQueryV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "customerId", "limit"]);
  if (record === undefined || own(record, "schemaVersion") !== CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const customerId = uuid(own(record, "customerId"));
  const limit = integer(own(record, "limit"), 1, CUSTOMER_RECENT_ORDER_LIMIT);
  return scope === undefined || customerId === undefined || limit === undefined
    ? undefined
    : Object.freeze({ customerId, limit, schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION, scope });
}

export function parseCustomerRecentOrderListV1(value: unknown): CustomerRecentOrderListV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "customerId", "orders"]);
  if (record === undefined || own(record, "schemaVersion") !== CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const customerId = uuid(own(record, "customerId"));
  const rawOrders = denseArray(own(record, "orders"), CUSTOMER_RECENT_ORDER_LIMIT);
  if (scope === undefined || customerId === undefined || rawOrders === undefined) return undefined;
  const orders: CustomerRecentOrderV1[] = [];
  const ids = new Set<string>();
  let previousConfirmedAt: string | undefined;
  for (const rawOrder of rawOrders) {
    const order = parseOrder(rawOrder);
    if (order === undefined || ids.has(order.orderId)
      || (previousConfirmedAt !== undefined && order.confirmedAt > previousConfirmedAt)) return undefined;
    ids.add(order.orderId);
    previousConfirmedAt = order.confirmedAt;
    orders.push(order);
  }
  return Object.freeze({
    customerId,
    orders: Object.freeze(orders),
    schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
    scope,
  });
}

function parseOrder(value: unknown): CustomerRecentOrderV1 | undefined {
  const record = exactRecord(value, ["orderId", "confirmedAt", "fulfillmentChannel", "status", "currency", "items"]);
  if (record === undefined) return undefined;
  const orderId = uuid(own(record, "orderId"));
  const confirmedAt = timestamp(own(record, "confirmedAt"));
  const fulfillmentChannel = member(own(record, "fulfillmentChannel"), CAPTURE_FULFILLMENT_CHANNELS);
  const status = member(own(record, "status"), ORDER_STATUSES);
  const currency = currencyCode(own(record, "currency"));
  const rawItems = denseArray(own(record, "items"), 200);
  if (orderId === undefined || confirmedAt === undefined || fulfillmentChannel === undefined
    || status === undefined || currency === undefined || rawItems === undefined) return undefined;
  const items: CustomerRecentOrderItemV1[] = [];
  const ids = new Set<string>();
  for (const rawItem of rawItems) {
    const item = parseItem(rawItem);
    if (item === undefined || ids.has(item.orderItemId)) return undefined;
    ids.add(item.orderItemId);
    items.push(item);
  }
  return Object.freeze({
    confirmedAt,
    currency,
    fulfillmentChannel,
    items: Object.freeze(items),
    orderId,
    status,
  });
}

function parseItem(value: unknown): CustomerRecentOrderItemV1 | undefined {
  const record = exactRecord(value, [
    "orderItemId", "productId", "productName", "quantity", "status", "unit", "unitPriceMinor", "modifiers",
  ]);
  if (record === undefined) return undefined;
  const orderItemId = uuid(own(record, "orderItemId"));
  const productId = uuid(own(record, "productId"));
  const productName = text(own(record, "productName"), 1, 120);
  const quantity = integer(own(record, "quantity"), 1, 1_000_000);
  const status = member(own(record, "status"), ORDER_ITEM_STATUSES);
  const unit = text(own(record, "unit"), 1, 32);
  const unitPriceMinor = integer(own(record, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
  const rawModifiers = denseArray(own(record, "modifiers"), 200);
  if (orderItemId === undefined || productId === undefined || productName === undefined || quantity === undefined
    || status === undefined || unit === undefined || unitPriceMinor === undefined || rawModifiers === undefined) return undefined;
  const modifiers: CustomerRecentOrderModifierV1[] = [];
  const keys = new Set<string>();
  for (const rawModifier of rawModifiers) {
    const modifier = parseModifier(rawModifier);
    const key = modifier === undefined ? "" : `${modifier.groupId ?? ""}\u0000${modifier.modifierId}`;
    if (modifier === undefined || keys.has(key)) return undefined;
    keys.add(key);
    modifiers.push(modifier);
  }
  return Object.freeze({
    modifiers: Object.freeze(modifiers),
    orderItemId,
    productId,
    productName,
    quantity,
    status,
    unit,
    unitPriceMinor,
  });
}

function parseModifier(value: unknown): CustomerRecentOrderModifierV1 | undefined {
  const record = exactRecord(value, ["groupId", "groupName", "modifierId", "name", "quantity", "unitPriceMinor"]);
  if (record === undefined) return undefined;
  const rawGroupId = own(record, "groupId");
  const rawGroupName = own(record, "groupName");
  const groupId = rawGroupId === null ? null : uuid(rawGroupId);
  const groupName = rawGroupName === null ? null : text(rawGroupName, 1, 80);
  const modifierId = uuid(own(record, "modifierId"));
  const name = text(own(record, "name"), 1, 80);
  const quantity = integer(own(record, "quantity"), 1, 1_000);
  const unitPriceMinor = integer(own(record, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
  return groupId === undefined || groupName === undefined || (groupId === null) !== (groupName === null)
    || modifierId === undefined || name === undefined || quantity === undefined || unitPriceMinor === undefined
    ? undefined
    : Object.freeze({ groupId, groupName, modifierId, name, quantity, unitPriceMinor });
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  if (record === undefined) return undefined;
  const restaurantId = uuid(own(record, "restaurantId"));
  const branchId = uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined
    : Object.freeze({ branchId, restaurantId }) as BranchScope;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
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

function member<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === "string" && values.includes(value) ? value as T[number] : undefined;
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function text(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum
    && value === value.trim() && !CONTROL_PATTERN.test(value) ? value : undefined;
}

function currencyCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z]{3}$/u.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length !== 24) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
