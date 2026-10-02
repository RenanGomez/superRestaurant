import type { BranchScope } from "./index.js";
import { parseKdsEventV1 } from "./realtime.js";

export const ORDER_COMMAND_SCHEMA_VERSION = 1 as const;
export const CREATE_ORDER_COMMAND_V2_SCHEMA_VERSION = 2 as const;
export const ACTIVE_TABLE_ORDER_LIST_V2_SCHEMA_VERSION = 2 as const;
export const MAX_ORDER_ITEM_MODIFIER_GROUPS = 50 as const;
export const MAX_SEND_ORDER_TO_KITCHEN_ITEM_IDS = 200 as const;
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

/**
 * S9.1 web-order-actions: opens a draft order (if still draft) and transitions every currently
 * pending line to "sent" in one operator-facing command, instead of the client sequencing "open"
 * then one "transition" request per line itself -- which cannot resume cleanly after a lost
 * response mid-batch.
 */
export interface SendOrderToKitchenCommandV1 extends OrderAuditInputV1 {
  readonly expectedVersion: number;
  readonly orderId: string;
  readonly orderItemIds: readonly string[];
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

export const ORDER_DETAIL_SCHEMA_VERSION = 1 as const;
export const ORDER_DETAIL_ACTIONS = Object.freeze([
  "open", "sendToKitchen", "markReady", "markDelivered", "cancelItem", "checkout",
] as const);

export type OrderDetailActionV1 = (typeof ORDER_DETAIL_ACTIONS)[number];

export interface OrderDetailRequestV1 {
  readonly schemaVersion: typeof ORDER_DETAIL_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly orderId: string;
}

export interface OrderDetailModifierV1 {
  readonly modifierId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export interface OrderDetailItemV1 {
  readonly orderItemId: string;
  readonly status: (typeof ORDER_ITEM_STATUSES)[number];
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly note: string | null;
  readonly modifiers: readonly OrderDetailModifierV1[];
  /**
   * Server-computed per line, from this line's own status plus the caller's granted roles --
   * `orders.cancel.pending` for a still-pending line vs. `orders.cancel.sent` once it reached KDS.
   * The order-level `OrderDetailV1.availableActions` only covers order-wide actions (open, send to
   * kitchen, checkout); a per-line action (cancelItem, markReady, markDelivered) is only ever read
   * from here, never inferred from the order-level list.
   */
  readonly availableActions: readonly OrderDetailActionV1[];
}

export interface OrderDetailTotalsV1 {
  readonly currency: string;
  /** Items after line/order discount and tax -- never delivery or tip. */
  readonly itemsTotalMinor: number;
  readonly deliveryChargeMinor: number;
  readonly tipMinor: number;
  readonly totalMinor: number;
}

export interface OrderDetailPaymentIntentV1 {
  readonly method: "cash" | "card_manual" | "transfer";
  readonly tenderedAmountMinor: number | null;
  readonly tipMinor: number;
}

/**
 * Deliberately reduced: the fulfillment snapshot (customer/address/payment-intent PII) is not yet
 * joined here -- only the Order's own channel/tableId are read from `OrderPersistencePort.read`, so
 * this endpoint ships without new SQL (see the context packet's "sin SQL nuevo si el puerto de
 * persistencia basta"). `customerLabel`/`addressLabel`/`paymentIntent` are always `null` for now.
 */
export interface OrderDetailFulfillmentV1 {
  readonly channel: OrderChannelV1;
  readonly tableId: string | null;
  readonly customerLabel: string | null;
  readonly addressLabel: string | null;
  readonly paymentIntent: OrderDetailPaymentIntentV1 | null;
}

export interface OrderDetailV1 {
  readonly schemaVersion: typeof ORDER_DETAIL_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly orderId: string;
  readonly status: (typeof ORDER_STATUSES)[number];
  readonly channel: OrderChannelV1;
  readonly tableId: string | null;
  readonly currency: string;
  readonly timeZone: string;
  /**
   * Both are `null` today: `OrderPersistencePort.read` returns only the aggregate and its version,
   * not a row timestamp, so this endpoint does not yet expose either -- never invented client-side.
   */
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly version: number;
  readonly items: readonly OrderDetailItemV1[];
  readonly totals: OrderDetailTotalsV1;
  readonly fulfillment: OrderDetailFulfillmentV1;
  readonly availableActions: readonly OrderDetailActionV1[];
}

export function parseOrderDetailRequestV1(value: unknown): OrderDetailRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "orderId"]);
  if (record === undefined || own(record, "schemaVersion") !== ORDER_DETAIL_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const orderId = uuid(own(record, "orderId"));
  return scope === undefined || orderId === undefined
    ? undefined
    : Object.freeze({ orderId, schemaVersion: ORDER_DETAIL_SCHEMA_VERSION, scope });
}

export function parseOrderDetailV1(value: unknown): OrderDetailV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "orderId", "status", "channel", "tableId", "currency", "timeZone",
    "createdAt", "updatedAt", "version", "items", "totals", "fulfillment", "availableActions",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== ORDER_DETAIL_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const orderId = uuid(own(record, "orderId"));
  const status = own(record, "status");
  const channel = own(record, "channel");
  const rawTableId = own(record, "tableId");
  const tableId = rawTableId === null ? null : uuid(rawTableId);
  const currency = text(own(record, "currency"), 3, 3);
  const timeZone = text(own(record, "timeZone"), 1, 100);
  const rawCreatedAt = own(record, "createdAt");
  const createdAt = rawCreatedAt === null ? null : timestamp(rawCreatedAt);
  const rawUpdatedAt = own(record, "updatedAt");
  const updatedAt = rawUpdatedAt === null ? null : timestamp(rawUpdatedAt);
  const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
  const rawItems = exactDenseArray(own(record, "items"), 1_000);
  const totals = parseDetailTotals(own(record, "totals"));
  const fulfillment = parseDetailFulfillment(own(record, "fulfillment"), channel);
  const rawActions = exactDenseArray(own(record, "availableActions"), ORDER_DETAIL_ACTIONS.length);
  if (
    scope === undefined || orderId === undefined || typeof status !== "string"
    || !(ORDER_STATUSES as readonly string[]).includes(status) || typeof channel !== "string"
    || !(ORDER_CHANNELS as readonly string[]).includes(channel) || tableId === undefined
    || (channel === "table") !== (tableId !== null) || currency === undefined || timeZone === undefined
    || createdAt === undefined || updatedAt === undefined || version === undefined || rawItems === undefined
    || totals === undefined || fulfillment === undefined || rawActions === undefined
  ) return undefined;
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); } catch { return undefined; }
  const items: OrderDetailItemV1[] = [];
  const itemIds = new Set<string>();
  for (const raw of rawItems) {
    const item = parseDetailItem(raw, currency);
    if (item === undefined || itemIds.has(item.orderItemId)) return undefined;
    itemIds.add(item.orderItemId);
    items.push(item);
  }
  const actions: OrderDetailActionV1[] = [];
  for (const raw of rawActions) {
    if (typeof raw !== "string" || !(ORDER_DETAIL_ACTIONS as readonly string[]).includes(raw) || actions.includes(raw as OrderDetailActionV1)) {
      return undefined;
    }
    actions.push(raw as OrderDetailActionV1);
  }
  return Object.freeze({
    availableActions: Object.freeze(actions),
    channel: channel as OrderChannelV1,
    createdAt,
    currency,
    fulfillment,
    items: Object.freeze(items),
    orderId,
    schemaVersion: ORDER_DETAIL_SCHEMA_VERSION,
    scope,
    status: status as OrderDetailV1["status"],
    tableId,
    timeZone,
    totals,
    updatedAt,
    version,
  });
}

function parseDetailItem(value: unknown, currency: string): OrderDetailItemV1 | undefined {
  const record = exactRecord(value, [
    "orderItemId", "status", "name", "quantity", "unitPriceMinor", "lineTotalMinor", "note", "modifiers", "availableActions",
  ]);
  if (record === undefined) return undefined;
  const orderItemId = uuid(own(record, "orderItemId"));
  const status = own(record, "status");
  const name = text(own(record, "name"), 1, 200);
  const quantity = integer(own(record, "quantity"), 1, 1_000);
  const unitPriceMinor = integer(own(record, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
  const lineTotalMinor = integer(own(record, "lineTotalMinor"), 0, Number.MAX_SAFE_INTEGER);
  const rawNote = own(record, "note");
  const note = rawNote === null ? null : text(rawNote, 1, 500);
  const rawModifiers = exactDenseArray(own(record, "modifiers"), 5_000);
  const rawActions = exactDenseArray(own(record, "availableActions"), ORDER_DETAIL_ACTIONS.length);
  if (
    orderItemId === undefined || typeof status !== "string" || !(ORDER_ITEM_STATUSES as readonly string[]).includes(status)
    || name === undefined || quantity === undefined || unitPriceMinor === undefined || lineTotalMinor === undefined
    || note === undefined || rawModifiers === undefined || rawActions === undefined
  ) return undefined;
  const modifiers: OrderDetailModifierV1[] = [];
  for (const raw of rawModifiers) {
    const modifier = parseDetailModifier(raw);
    if (modifier === undefined) return undefined;
    modifiers.push(modifier);
  }
  const availableActions: OrderDetailActionV1[] = [];
  for (const raw of rawActions) {
    if (typeof raw !== "string" || !(ORDER_DETAIL_ACTIONS as readonly string[]).includes(raw) || availableActions.includes(raw as OrderDetailActionV1)) {
      return undefined;
    }
    availableActions.push(raw as OrderDetailActionV1);
  }
  void currency;
  return Object.freeze({
    availableActions: Object.freeze(availableActions), lineTotalMinor, modifiers: Object.freeze(modifiers),
    name, note, orderItemId, quantity, status: status as OrderDetailItemV1["status"], unitPriceMinor,
  });
}

function parseDetailModifier(value: unknown): OrderDetailModifierV1 | undefined {
  const record = exactRecord(value, ["modifierId", "name", "quantity", "unitPriceMinor"]);
  if (record === undefined) return undefined;
  const modifierId = uuid(own(record, "modifierId"));
  const name = text(own(record, "name"), 1, 200);
  const quantity = integer(own(record, "quantity"), 1, 1_000);
  const unitPriceMinor = integer(own(record, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
  return modifierId === undefined || name === undefined || quantity === undefined || unitPriceMinor === undefined
    ? undefined
    : Object.freeze({ modifierId, name, quantity, unitPriceMinor });
}

function parseDetailTotals(value: unknown): OrderDetailTotalsV1 | undefined {
  const record = exactRecord(value, ["currency", "itemsTotalMinor", "deliveryChargeMinor", "tipMinor", "totalMinor"]);
  if (record === undefined) return undefined;
  const currency = text(own(record, "currency"), 3, 3);
  const itemsTotalMinor = integer(own(record, "itemsTotalMinor"), 0, Number.MAX_SAFE_INTEGER);
  const deliveryChargeMinor = integer(own(record, "deliveryChargeMinor"), 0, Number.MAX_SAFE_INTEGER);
  const tipMinor = integer(own(record, "tipMinor"), 0, Number.MAX_SAFE_INTEGER);
  const totalMinor = integer(own(record, "totalMinor"), 0, Number.MAX_SAFE_INTEGER);
  if (
    currency === undefined || !/^[A-Z]{3}$/u.test(currency) || itemsTotalMinor === undefined
    || deliveryChargeMinor === undefined || tipMinor === undefined || totalMinor === undefined
    || itemsTotalMinor + deliveryChargeMinor + tipMinor !== totalMinor
  ) return undefined;
  return Object.freeze({ currency, deliveryChargeMinor, itemsTotalMinor, tipMinor, totalMinor });
}

function parseDetailFulfillment(value: unknown, channel: unknown): OrderDetailFulfillmentV1 | undefined {
  const record = exactRecord(value, ["channel", "tableId", "customerLabel", "addressLabel", "paymentIntent"]);
  if (record === undefined || own(record, "channel") !== channel) return undefined;
  const rawTableId = own(record, "tableId");
  const tableId = rawTableId === null ? null : uuid(rawTableId);
  const rawCustomerLabel = own(record, "customerLabel");
  const customerLabel = rawCustomerLabel === null ? null : text(rawCustomerLabel, 1, 160);
  const rawAddressLabel = own(record, "addressLabel");
  const addressLabel = rawAddressLabel === null ? null : text(rawAddressLabel, 1, 200);
  const rawPaymentIntent = own(record, "paymentIntent");
  const paymentIntent = rawPaymentIntent === null ? null : parseDetailPaymentIntent(rawPaymentIntent);
  if (
    typeof channel !== "string" || !(ORDER_CHANNELS as readonly string[]).includes(channel)
    || tableId === undefined || customerLabel === undefined || addressLabel === undefined || paymentIntent === undefined
  ) return undefined;
  return Object.freeze({
    addressLabel, channel: channel as OrderChannelV1, customerLabel, paymentIntent, tableId,
  });
}

function parseDetailPaymentIntent(value: unknown): OrderDetailPaymentIntentV1 | undefined {
  const record = exactRecord(value, ["method", "tenderedAmountMinor", "tipMinor"]);
  if (record === undefined) return undefined;
  const method = own(record, "method");
  const rawTendered = own(record, "tenderedAmountMinor");
  const tenderedAmountMinor = rawTendered === null ? null : integer(rawTendered, 0, Number.MAX_SAFE_INTEGER);
  const tipMinor = integer(own(record, "tipMinor"), 0, Number.MAX_SAFE_INTEGER);
  return typeof method !== "string" || !["cash", "card_manual", "transfer"].includes(method)
    || tenderedAmountMinor === undefined || tipMinor === undefined
    ? undefined
    : Object.freeze({ method: method as OrderDetailPaymentIntentV1["method"], tenderedAmountMinor, tipMinor });
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

export function parseSendOrderToKitchenCommandV1(value: unknown): SendOrderToKitchenCommandV1 | undefined {
  const record = exactRecord(value, ["schemaVersion","scope","orderId","orderItemIds","expectedVersion","eventId","idempotencyKey","deviceId","occurredAt"]);
  if (record === undefined || own(record,"schemaVersion") !== ORDER_COMMAND_SCHEMA_VERSION) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record,"scope"));
  const orderId = uuid(own(record,"orderId"));
  const orderItemIds = parseOrderItemIds(own(record,"orderItemIds"));
  const expectedVersion = integer(own(record,"expectedVersion"),1,Number.MAX_SAFE_INTEGER);
  return common === undefined || scope === undefined || orderId === undefined || orderItemIds === undefined || expectedVersion === undefined
    ? undefined : Object.freeze({ ...common, expectedVersion, orderId, orderItemIds, schemaVersion: ORDER_COMMAND_SCHEMA_VERSION, scope });
}

function parseOrderItemIds(value: unknown): readonly string[] | undefined {
  const array = exactDenseArray(value, MAX_SEND_ORDER_TO_KITCHEN_ITEM_IDS);
  if (array === undefined || array.length === 0) return undefined;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of array) {
    const id = uuid(entry);
    if (id === undefined || seen.has(id)) return undefined;
    seen.add(id);
    ids.push(id);
  }
  return Object.freeze(ids);
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
