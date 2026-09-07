import type { BranchScope } from "./index.js";
import { parseKdsEventV1 } from "./realtime.js";

export const ORDER_COMMAND_SCHEMA_VERSION = 1 as const;
export const CREATE_ORDER_COMMAND_V2_SCHEMA_VERSION = 2 as const;
export const ACTIVE_TABLE_ORDER_LIST_V2_SCHEMA_VERSION = 2 as const;
export const MAX_ORDER_ITEM_MODIFIER_GROUPS = 50 as const;
export const ORDER_CHANNELS = Object.freeze(["table", "counter", "takeout", "delivery"] as const);
export const ORDER_ITEM_FORWARD_STATUSES = Object.freeze(["sent", "preparing", "ready", "delivered"] as const);
export const ORDER_ITEM_STATUSES = Object.freeze(["pending", "sent", "preparing", "ready", "delivered", "cancelled"] as const);
export const ORDER_STATUSES = Object.freeze(["draft", "open", "partially_paid", "paid", "closed", "cancelled"] as const);
export const ACTIVE_TABLE_ORDER_STATUSES = Object.freeze(["draft", "open", "partially_paid"] as const);

export type OrderChannelV1 = (typeof ORDER_CHANNELS)[number];
export type OrderItemForwardStatusV1 = (typeof ORDER_ITEM_FORWARD_STATUSES)[number];

export interface OrderAuditInputV1 {
  readonly deviceId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface CreateOrderCommandV1 extends OrderAuditInputV1 {
  readonly channel: OrderChannelV1;
  readonly currency: string;
  readonly orderId: string;
  readonly schemaVersion: typeof ORDER_COMMAND_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly tableId: string | null;
  readonly timeZone: string;
}

/** Additive mobile command: v1 remains valid for existing clients, while v2 binds a new order to an operational shift. */
export interface CreateOrderCommandV2 extends Omit<CreateOrderCommandV1, "schemaVersion"> {
  readonly schemaVersion: typeof CREATE_ORDER_COMMAND_V2_SCHEMA_VERSION;
  readonly shiftId: string;
}

export interface ActiveTableOrderSummaryV1 {
  readonly itemCount: number;
  readonly orderId: string;
  readonly shiftId: string | null;
  readonly status: (typeof ACTIVE_TABLE_ORDER_STATUSES)[number];
  readonly tableId: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ActiveTableOrderListV1 {
  readonly orders: readonly ActiveTableOrderSummaryV1[];
  readonly schemaVersion: typeof ORDER_COMMAND_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly tableId: string;
}

export interface ActiveTableOrderMoneyV1 {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface ActiveTableOrderModifierV1 {
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly optionId: string;
  readonly optionName: string;
  readonly quantity: number;
  readonly unitPrice: ActiveTableOrderMoneyV1;
}

export interface ActiveTableOrderItemV1 {
  readonly modifiers: readonly ActiveTableOrderModifierV1[];
  readonly orderItemId: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly status: (typeof ORDER_ITEM_STATUSES)[number];
  readonly unit: string;
  readonly unitPrice: ActiveTableOrderMoneyV1;
}

export interface ActiveTableOrderSummaryV2 extends ActiveTableOrderSummaryV1 {
  readonly currency: string;
  readonly items: readonly ActiveTableOrderItemV1[];
}

export interface ActiveTableOrderListV2 {
  readonly orders: readonly ActiveTableOrderSummaryV2[];
  readonly schemaVersion: typeof ACTIVE_TABLE_ORDER_LIST_V2_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly tableId: string;
}

export interface ModifierOptionSelectionV1 {
  readonly optionId: string;
  readonly quantity: number;
}

export interface ModifierGroupSelectionV1 {
  readonly groupId: string;
  readonly selections: readonly ModifierOptionSelectionV1[];
}

export interface AddOrderItemCommandV1 extends OrderAuditInputV1 {
  readonly expectedVersion: number;
  readonly modifierGroups: readonly ModifierGroupSelectionV1[];
  readonly orderId: string;
  readonly orderItemId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly schemaVersion: typeof ORDER_COMMAND_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface OpenOrderCommandV1 extends OrderAuditInputV1 {
  readonly expectedVersion: number;
  readonly orderId: string;
  readonly schemaVersion: typeof ORDER_COMMAND_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface TransitionOrderItemCommandV1 extends OrderAuditInputV1 {
  readonly expectedVersion: number;
  readonly orderId: string;
  readonly orderItemId: string;
  readonly schemaVersion: typeof ORDER_COMMAND_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly to: OrderItemForwardStatusV1;
}

export interface CancelOrderItemCommandV1 extends OrderAuditInputV1 {
  readonly expectedVersion: number;
  readonly orderId: string;
  readonly orderItemId: string;
  readonly reason: string;
  readonly schemaVersion: typeof ORDER_COMMAND_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface OrderMutationSummaryV1 {
  readonly kdsEvent: import("./realtime.js").KdsEventV1 | null;
  readonly orderId: string;
  readonly orderStatus: "draft" | "open" | "partially_paid" | "paid" | "closed" | "cancelled";
  readonly replayed: boolean;
  readonly schemaVersion: typeof ORDER_COMMAND_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly version: number;
}

export function parseOrderMutationSummaryV1(value: unknown): OrderMutationSummaryV1 | undefined {
  const record = exactRecord(value, ["schemaVersion","scope","orderId","version","orderStatus","replayed","kdsEvent"]);
  if (record === undefined || own(record,"schemaVersion") !== ORDER_COMMAND_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record,"scope"));
  const orderId = uuid(own(record,"orderId"));
  const version = integer(own(record,"version"), 1, Number.MAX_SAFE_INTEGER);
  const orderStatus = own(record,"orderStatus");
  const replayed = own(record,"replayed");
  const rawKdsEvent = own(record,"kdsEvent");
  const kdsEvent = rawKdsEvent === null ? null : parseKdsEventV1(rawKdsEvent);
  if (scope === undefined || orderId === undefined || version === undefined
    || typeof orderStatus !== "string" || !(ORDER_STATUSES as readonly string[]).includes(orderStatus)
    || typeof replayed !== "boolean" || kdsEvent === undefined) return undefined;
  if (kdsEvent !== null && (kdsEvent.scope.restaurantId !== scope.restaurantId
    || kdsEvent.scope.branchId !== scope.branchId || kdsEvent.orderId !== orderId)) return undefined;
  return Object.freeze({
    kdsEvent,
    orderId,
    orderStatus: orderStatus as OrderMutationSummaryV1["orderStatus"],
    replayed,
    schemaVersion: ORDER_COMMAND_SCHEMA_VERSION,
    scope,
    version,
  });
}

export function parseActiveTableOrderListV1(value: unknown): ActiveTableOrderListV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "tableId", "orders"]);
  if (record === undefined || own(record, "schemaVersion") !== ORDER_COMMAND_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const tableId = uuid(own(record, "tableId"));
  const rawOrders = exactDenseArray(own(record, "orders"), 100);
  if (scope === undefined || tableId === undefined || rawOrders === undefined) return undefined;
  const orders: ActiveTableOrderSummaryV1[] = [];
  const ids = new Set<string>();
  for (const value of rawOrders) {
    const order = parseActiveTableOrderSummaryV1(value, tableId);
    if (order === undefined || ids.has(order.orderId)) return undefined;
    ids.add(order.orderId);
    orders.push(order);
  }
  return Object.freeze({ orders: Object.freeze(orders), schemaVersion: ORDER_COMMAND_SCHEMA_VERSION, scope, tableId });
}

export function parseActiveTableOrderListV2(value: unknown): ActiveTableOrderListV2 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "tableId", "orders"]);
  if (record === undefined || own(record, "schemaVersion") !== ACTIVE_TABLE_ORDER_LIST_V2_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const tableId = uuid(own(record, "tableId"));
  const rawOrders = exactDenseArray(own(record, "orders"), 100);
  if (scope === undefined || tableId === undefined || rawOrders === undefined) return undefined;
  const orders: ActiveTableOrderSummaryV2[] = [];
  const ids = new Set<string>();
  for (const value of rawOrders) {
    const order = parseActiveTableOrderSummaryV2(value, tableId);
    if (order === undefined || ids.has(order.orderId)) return undefined;
    ids.add(order.orderId);
    orders.push(order);
  }
  return Object.freeze({
    orders: Object.freeze(orders),
    schemaVersion: ACTIVE_TABLE_ORDER_LIST_V2_SCHEMA_VERSION,
    scope,
    tableId,
  });
}

export function parseCreateOrderCommandV2(value: unknown): CreateOrderCommandV2 | undefined {
  const record = exactRecord(value, ["schemaVersion","scope","orderId","shiftId","channel","tableId","currency","timeZone","eventId","idempotencyKey","deviceId","occurredAt"]);
  if (record === undefined || own(record,"schemaVersion") !== CREATE_ORDER_COMMAND_V2_SCHEMA_VERSION) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record,"scope"));
  const orderId = uuid(own(record,"orderId"));
  const shiftId = uuid(own(record,"shiftId"));
  const channel = own(record,"channel");
  const tableValue = own(record,"tableId");
  const tableId = tableValue === null ? null : uuid(tableValue);
  const currency = text(own(record,"currency"),3,3);
  const timeZone = text(own(record,"timeZone"),1,100);
  if (common === undefined || scope === undefined || orderId === undefined || shiftId === undefined
    || typeof channel !== "string" || !(ORDER_CHANNELS as readonly string[]).includes(channel)
    || tableId === undefined || (channel === "table") !== (tableId !== null)
    || currency === undefined || !/^[A-Z]{3}$/u.test(currency) || timeZone === undefined) return undefined;
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); } catch { return undefined; }
  return Object.freeze({
    ...common,
    channel: channel as OrderChannelV1,
    currency,
    orderId,
    schemaVersion: CREATE_ORDER_COMMAND_V2_SCHEMA_VERSION,
    scope,
    shiftId,
    tableId,
    timeZone,
  });
}

export function parseCreateOrderCommandV1(value: unknown): CreateOrderCommandV1 | undefined {
  const record = exactRecord(value, ["schemaVersion","scope","orderId","channel","tableId","currency","timeZone","eventId","idempotencyKey","deviceId","occurredAt"]);
  if (record === undefined || own(record,"schemaVersion") !== ORDER_COMMAND_SCHEMA_VERSION) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record,"scope"));
  const orderId = uuid(own(record,"orderId"));
  const channel = own(record,"channel");
  const tableValue = own(record,"tableId");
  const tableId = tableValue === null ? null : uuid(tableValue);
  const currency = text(own(record,"currency"),3,3);
  const timeZone = text(own(record,"timeZone"),1,100);
  if (common === undefined || scope === undefined || orderId === undefined || typeof channel !== "string"
    || !(ORDER_CHANNELS as readonly string[]).includes(channel) || tableId === undefined
    || (channel === "table") !== (tableId !== null) || currency === undefined || !/^[A-Z]{3}$/u.test(currency)
    || timeZone === undefined) return undefined;
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); } catch { return undefined; }
  return Object.freeze({ ...common, channel: channel as OrderChannelV1, currency, orderId, schemaVersion: 1, scope, tableId, timeZone });
}

export function parseAddOrderItemCommandV1(value: unknown): AddOrderItemCommandV1 | undefined {
  const record = exactRecord(value, ["schemaVersion","scope","orderId","expectedVersion","orderItemId","productId","quantity","modifierGroups","eventId","idempotencyKey","deviceId","occurredAt"]);
  if (record === undefined || own(record,"schemaVersion") !== 1) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record,"scope"));
  const orderId = uuid(own(record,"orderId"));
  const orderItemId = uuid(own(record,"orderItemId"));
  const productId = uuid(own(record,"productId"));
  const expectedVersion = integer(own(record,"expectedVersion"),1,Number.MAX_SAFE_INTEGER);
  const quantity = integer(own(record,"quantity"),1,1_000);
  const modifierGroups = parseGroups(own(record,"modifierGroups"));
  return common === undefined || scope === undefined || orderId === undefined || orderItemId === undefined
    || productId === undefined || expectedVersion === undefined || quantity === undefined || modifierGroups === undefined
    ? undefined
    : Object.freeze({ ...common, expectedVersion, modifierGroups, orderId, orderItemId, productId, quantity, schemaVersion: 1, scope });
}

export function parseOpenOrderCommandV1(value: unknown): OpenOrderCommandV1 | undefined {
  const record = exactRecord(value, ["schemaVersion","scope","orderId","expectedVersion","eventId","idempotencyKey","deviceId","occurredAt"]);
  if (record === undefined || own(record,"schemaVersion") !== 1) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record,"scope"));
  const orderId = uuid(own(record,"orderId"));
  const expectedVersion = integer(own(record,"expectedVersion"),1,Number.MAX_SAFE_INTEGER);
  return common === undefined || scope === undefined || orderId === undefined || expectedVersion === undefined
    ? undefined : Object.freeze({ ...common, expectedVersion, orderId, schemaVersion: 1, scope });
}

export function parseTransitionOrderItemCommandV1(value: unknown): TransitionOrderItemCommandV1 | undefined {
  const record = exactRecord(value, ["schemaVersion","scope","orderId","expectedVersion","orderItemId","to","eventId","idempotencyKey","deviceId","occurredAt"]);
  if (record === undefined || own(record,"schemaVersion") !== 1) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record,"scope"));
  const orderId = uuid(own(record,"orderId"));
  const orderItemId = uuid(own(record,"orderItemId"));
  const expectedVersion = integer(own(record,"expectedVersion"),1,Number.MAX_SAFE_INTEGER);
  const to = own(record,"to");
  return common === undefined || scope === undefined || orderId === undefined || orderItemId === undefined
    || expectedVersion === undefined || typeof to !== "string" || !(ORDER_ITEM_FORWARD_STATUSES as readonly string[]).includes(to)
    ? undefined : Object.freeze({ ...common, expectedVersion, orderId, orderItemId, schemaVersion: 1, scope, to: to as OrderItemForwardStatusV1 });
}

export function parseCancelOrderItemCommandV1(value: unknown): CancelOrderItemCommandV1 | undefined {
  const record = exactRecord(value, ["schemaVersion","scope","orderId","expectedVersion","orderItemId","reason","eventId","idempotencyKey","deviceId","occurredAt"]);
  if (record === undefined || own(record,"schemaVersion") !== ORDER_COMMAND_SCHEMA_VERSION) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record,"scope"));
  const orderId = uuid(own(record,"orderId"));
  const orderItemId = uuid(own(record,"orderItemId"));
  const expectedVersion = integer(own(record,"expectedVersion"),1,Number.MAX_SAFE_INTEGER);
  const reason = text(own(record,"reason"),1,500);
  return common === undefined || scope === undefined || orderId === undefined || orderItemId === undefined
    || expectedVersion === undefined || reason === undefined
    ? undefined
    : Object.freeze({ ...common, expectedVersion, orderId, orderItemId, reason, schemaVersion: ORDER_COMMAND_SCHEMA_VERSION, scope });
}

function parseCommon(record: Readonly<Record<string, unknown>>): OrderAuditInputV1 | undefined {
  const eventId = uuid(own(record,"eventId"));
  const deviceId = uuid(own(record,"deviceId"));
  const idempotencyKey = text(own(record,"idempotencyKey"),1,200);
  const occurredAt = timestamp(own(record,"occurredAt"));
  return eventId === undefined || deviceId === undefined || idempotencyKey === undefined || occurredAt === undefined
    ? undefined : Object.freeze({ deviceId, eventId, idempotencyKey, occurredAt });
}

function parseActiveTableOrderSummaryV1(value: unknown, expectedTableId: string): ActiveTableOrderSummaryV1 | undefined {
  const record = exactRecord(value, ["orderId", "tableId", "shiftId", "status", "version", "itemCount", "updatedAt"]);
  if (record === undefined) return undefined;
  const orderId = uuid(own(record, "orderId"));
  const tableId = uuid(own(record, "tableId"));
  const rawShiftId = own(record, "shiftId");
  const shiftId = rawShiftId === null ? null : uuid(rawShiftId);
  const status = own(record, "status");
  const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
  const itemCount = integer(own(record, "itemCount"), 0, 100_000);
  const updatedAt = timestamp(own(record, "updatedAt"));
  if (orderId === undefined || tableId === undefined || tableId !== expectedTableId || shiftId === undefined
    || typeof status !== "string" || !(ACTIVE_TABLE_ORDER_STATUSES as readonly string[]).includes(status)
    || version === undefined || itemCount === undefined || updatedAt === undefined) return undefined;
  return Object.freeze({
    itemCount,
    orderId,
    shiftId,
    status: status as ActiveTableOrderSummaryV1["status"],
    tableId,
    updatedAt,
    version,
  });
}

function parseActiveTableOrderSummaryV2(value: unknown, expectedTableId: string): ActiveTableOrderSummaryV2 | undefined {
  const record = exactRecord(value, [
    "orderId", "tableId", "shiftId", "status", "version", "itemCount", "currency", "items", "updatedAt",
  ]);
  if (record === undefined) return undefined;
  const orderId = uuid(own(record, "orderId"));
  const tableId = uuid(own(record, "tableId"));
  const rawShiftId = own(record, "shiftId");
  const shiftId = rawShiftId === null ? null : uuid(rawShiftId);
  const status = own(record, "status");
  const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
  const itemCount = integer(own(record, "itemCount"), 0, 100);
  const currency = text(own(record, "currency"), 3, 3);
  const rawItems = exactDenseArray(own(record, "items"), 100);
  const updatedAt = timestamp(own(record, "updatedAt"));
  if (orderId === undefined || tableId === undefined || tableId !== expectedTableId || shiftId === undefined
    || typeof status !== "string" || !(ACTIVE_TABLE_ORDER_STATUSES as readonly string[]).includes(status)
    || version === undefined || itemCount === undefined || currency === undefined || !/^[A-Z]{3}$/u.test(currency)
    || rawItems === undefined || itemCount !== rawItems.length || updatedAt === undefined) return undefined;
  const items: ActiveTableOrderItemV1[] = [];
  const itemIds = new Set<string>();
  for (const value of rawItems) {
    const item = parseActiveTableOrderItemV1(value, currency);
    if (item === undefined || itemIds.has(item.orderItemId)) return undefined;
    itemIds.add(item.orderItemId);
    items.push(item);
  }
  return Object.freeze({
    currency,
    itemCount,
    items: Object.freeze(items),
    orderId,
    shiftId,
    status: status as ActiveTableOrderSummaryV2["status"],
    tableId,
    updatedAt,
    version,
  });
}

function parseActiveTableOrderItemV1(value: unknown, currency: string): ActiveTableOrderItemV1 | undefined {
  const record = exactRecord(value, [
    "orderItemId", "productId", "productName", "quantity", "status", "unit", "unitPrice", "modifiers",
  ]);
  if (record === undefined) return undefined;
  const orderItemId = uuid(own(record, "orderItemId"));
  const productId = uuid(own(record, "productId"));
  const productName = text(own(record, "productName"), 1, 200);
  const quantity = integer(own(record, "quantity"), 1, 1_000);
  const status = own(record, "status");
  const unit = text(own(record, "unit"), 1, 50);
  const unitPrice = parseActiveTableOrderMoneyV1(own(record, "unitPrice"), currency);
  const rawModifiers = exactDenseArray(own(record, "modifiers"), 5_000);
  if (orderItemId === undefined || productId === undefined || productName === undefined || quantity === undefined
    || typeof status !== "string" || !(ORDER_ITEM_STATUSES as readonly string[]).includes(status)
    || unit === undefined || unitPrice === undefined || rawModifiers === undefined) return undefined;
  const modifiers: ActiveTableOrderModifierV1[] = [];
  for (const value of rawModifiers) {
    const modifier = parseActiveTableOrderModifierV1(value, currency);
    if (modifier === undefined) return undefined;
    modifiers.push(modifier);
  }
  return Object.freeze({
    modifiers: Object.freeze(modifiers),
    orderItemId,
    productId,
    productName,
    quantity,
    status: status as ActiveTableOrderItemV1["status"],
    unit,
    unitPrice,
  });
}

function parseActiveTableOrderModifierV1(value: unknown, currency: string): ActiveTableOrderModifierV1 | undefined {
  const record = exactRecord(value, [
    "groupId", "groupName", "optionId", "optionName", "quantity", "unitPrice",
  ]);
  if (record === undefined) return undefined;
  const rawGroupId = own(record, "groupId");
  const groupId = rawGroupId === null ? null : uuid(rawGroupId);
  const rawGroupName = own(record, "groupName");
  const groupName = rawGroupName === null ? null : text(rawGroupName, 1, 200);
  const optionId = uuid(own(record, "optionId"));
  const optionName = text(own(record, "optionName"), 1, 200);
  const quantity = integer(own(record, "quantity"), 1, 1_000);
  const unitPrice = parseActiveTableOrderMoneyV1(own(record, "unitPrice"), currency);
  return groupId === undefined || groupName === undefined || optionId === undefined || optionName === undefined
    || quantity === undefined || unitPrice === undefined
    ? undefined
    : Object.freeze({ groupId, groupName, optionId, optionName, quantity, unitPrice });
}

function parseActiveTableOrderMoneyV1(value: unknown, expectedCurrency: string): ActiveTableOrderMoneyV1 | undefined {
  const record = exactRecord(value, ["amountMinor", "currency"]);
  if (record === undefined) return undefined;
  const amountMinor = integer(own(record, "amountMinor"), 0, Number.MAX_SAFE_INTEGER);
  const currency = text(own(record, "currency"), 3, 3);
  return amountMinor === undefined || currency === undefined || !/^[A-Z]{3}$/u.test(currency) || currency !== expectedCurrency
    ? undefined
    : Object.freeze({ amountMinor, currency });
}

function parseGroups(value: unknown): readonly ModifierGroupSelectionV1[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ORDER_ITEM_MODIFIER_GROUPS) return undefined;
  const groups: ModifierGroupSelectionV1[] = [];
  const groupIds = new Set<string>();
  for (const entry of value as readonly unknown[]) {
    const record = exactRecord(entry,["groupId","selections"]);
    const groupId = record === undefined ? undefined : uuid(own(record,"groupId"));
    const rawSelections = record === undefined ? undefined : own(record,"selections");
    if (groupId === undefined || groupIds.has(groupId) || !Array.isArray(rawSelections) || rawSelections.length > 100) return undefined;
    groupIds.add(groupId);
    const selections: ModifierOptionSelectionV1[] = [];
    const optionIds = new Set<string>();
    for (const rawSelection of rawSelections as readonly unknown[]) {
      const selection = exactRecord(rawSelection,["optionId","quantity"]);
      const optionId = selection === undefined ? undefined : uuid(own(selection,"optionId"));
      const quantity = selection === undefined ? undefined : integer(own(selection,"quantity"),1,1_000);
      if (optionId === undefined || quantity === undefined || optionIds.has(optionId)) return undefined;
      optionIds.add(optionId);
      selections.push(Object.freeze({ optionId, quantity }));
    }
    groups.push(Object.freeze({ groupId, selections: Object.freeze(selections) }));
  }
  return Object.freeze(groups);
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value,["restaurantId","branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record,"restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record,"branchId"));
  return restaurantId === undefined || branchId === undefined ? undefined : Object.freeze({restaurantId,branchId}) as BranchScope;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string,unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype,null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys=Reflect.ownKeys(value);
    if (ownKeys.length!==keys.length || keys.some(key=>!ownKeys.includes(key))) return undefined;
    for (const key of keys) { const descriptor=Object.getOwnPropertyDescriptor(value,key); if (descriptor===undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined; }
    return value as Readonly<Record<string,unknown>>;
  } catch { return undefined; }
}
function exactDenseArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
  }
  return value;
}

function own(record: Readonly<Record<string,unknown>>, key: string): unknown { const descriptor=Object.getOwnPropertyDescriptor(record,key); return descriptor!==undefined && "value" in descriptor ? descriptor.value : undefined; }
function uuid(value: unknown): string | undefined { return typeof value==="string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined; }
function integer(value: unknown,min:number,max:number): number | undefined { return typeof value==="number" && Number.isSafeInteger(value) && value>=min && value<=max ? value : undefined; }
function text(value: unknown,min:number,max:number): string | undefined { return typeof value==="string" && value.length>=min && value.length<=max && value===value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined; }
function timestamp(value: unknown): string | undefined { if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined; try{return new Date(value).toISOString()===value?value:undefined;}catch{return undefined;} }
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
