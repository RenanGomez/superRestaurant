import { CAPTURE_FULFILLMENT_CHANNELS, type CaptureFulfillmentChannelV1 } from "./commercial-capture.js";
import type { BranchScope } from "./index.js";
import { parseCaptureMutationResultV1, type CaptureMutationResultV1 } from "./commercial-capture.js";
import { ORDER_ITEM_STATUSES, ORDER_STATUSES } from "./orders.js";

export const CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION = 1 as const;
export const CUSTOMER_RECENT_ORDER_LIMIT = 20 as const;
export const REPEAT_ORDER_PREVIEW_ISSUE_CODES = Object.freeze([
  "historical_item_cancelled",
  "product_removed",
  "product_inactive",
  "category_inactive",
  "historical_modifier_unmapped",
  "modifier_group_unavailable",
  "modifier_group_inactive",
  "modifier_option_removed",
  "modifier_option_inactive",
  "modifier_quantity_invalid",
  "modifier_group_requirements_changed",
  "product_price_changed",
  "modifier_price_changed",
] as const);

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

export interface CustomerRepeatOrderPreviewQueryV1 {
  readonly customerId: string;
  readonly orderId: string;
  readonly schemaVersion: typeof CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface CustomerRepeatOrderPreviewIssueV1 {
  readonly code: (typeof REPEAT_ORDER_PREVIEW_ISSUE_CODES)[number];
  readonly currentAmountMinor: number | null;
  readonly groupId: string | null;
  readonly historicalAmountMinor: number | null;
  readonly modifierId: string | null;
  readonly severity: "blocking" | "warning";
}

export interface CustomerRepeatOrderPreviewLineV1 {
  readonly currentName: string | null;
  readonly currentUnitPriceMinor: number | null;
  readonly historicalName: string;
  readonly issues: readonly CustomerRepeatOrderPreviewIssueV1[];
  readonly productId: string;
  readonly quantity: number;
  readonly sourceOrderItemId: string;
  readonly status: "blocked" | "ready";
}

export interface CustomerRepeatOrderPreviewV1 {
  readonly blockedLineCount: number;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly customerId: string;
  readonly hasPriceChanges: boolean;
  readonly lines: readonly CustomerRepeatOrderPreviewLineV1[];
  readonly readyLineCount: number;
  readonly schemaVersion: typeof CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly sourceOrderId: string;
}

export interface RepeatCustomerOrderIntoCaptureCommandV1 {
  readonly attentionLeaseId: string;
  readonly captureDraftId: string;
  readonly customerId: string;
  readonly deviceId: string;
  readonly eventId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly schemaVersion: typeof CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly sourceOrderId: string;
}

export interface CustomerRepeatOrderCaptureResultV1 {
  readonly capture: CaptureMutationResultV1;
  readonly preview: CustomerRepeatOrderPreviewV1;
  readonly schemaVersion: typeof CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION;
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

export function parseCustomerRepeatOrderPreviewQueryV1(value: unknown): CustomerRepeatOrderPreviewQueryV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "customerId", "orderId"]);
  if (record === undefined || own(record, "schemaVersion") !== CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const customerId = uuid(own(record, "customerId"));
  const orderId = uuid(own(record, "orderId"));
  return scope === undefined || customerId === undefined || orderId === undefined
    ? undefined
    : Object.freeze({ customerId, orderId, schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION, scope });
}

export function parseCustomerRepeatOrderPreviewV1(value: unknown): CustomerRepeatOrderPreviewV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "customerId", "sourceOrderId", "catalogVersion", "currency",
    "readyLineCount", "blockedLineCount", "hasPriceChanges", "lines",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const customerId = uuid(own(record, "customerId"));
  const sourceOrderId = uuid(own(record, "sourceOrderId"));
  const catalogVersion = uuid(own(record, "catalogVersion"));
  const currency = currencyCode(own(record, "currency"));
  const readyLineCount = integer(own(record, "readyLineCount"), 0, 200);
  const blockedLineCount = integer(own(record, "blockedLineCount"), 0, 200);
  const hasPriceChanges = own(record, "hasPriceChanges");
  const rawLines = denseArray(own(record, "lines"), 200);
  if (scope === undefined || customerId === undefined || sourceOrderId === undefined || catalogVersion === undefined
    || currency === undefined || readyLineCount === undefined || blockedLineCount === undefined
    || typeof hasPriceChanges !== "boolean" || rawLines === undefined) return undefined;
  const lines: CustomerRepeatOrderPreviewLineV1[] = [];
  const ids = new Set<string>();
  for (const rawLine of rawLines) {
    const line = parsePreviewLine(rawLine);
    if (line === undefined || ids.has(line.sourceOrderItemId)) return undefined;
    ids.add(line.sourceOrderItemId);
    lines.push(line);
  }
  const actualReady = lines.filter(({ status }) => status === "ready").length;
  const actualPriceChanges = lines.some(({ issues }) => issues.some(({ code }) =>
    code === "product_price_changed" || code === "modifier_price_changed"));
  if (readyLineCount !== actualReady || blockedLineCount !== lines.length - actualReady
    || hasPriceChanges !== actualPriceChanges) return undefined;
  return Object.freeze({
    blockedLineCount,
    catalogVersion,
    currency,
    customerId,
    hasPriceChanges,
    lines: Object.freeze(lines),
    readyLineCount,
    schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
    scope,
    sourceOrderId,
  });
}

export function parseRepeatCustomerOrderIntoCaptureCommandV1(
  value: unknown,
): RepeatCustomerOrderIntoCaptureCommandV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "customerId", "sourceOrderId", "captureDraftId", "expectedVersion",
    "attentionLeaseId", "eventId", "idempotencyKey", "deviceId", "occurredAt",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const customerId = uuid(own(record, "customerId"));
  const sourceOrderId = uuid(own(record, "sourceOrderId"));
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const expectedVersion = integer(own(record, "expectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const attentionLeaseId = uuid(own(record, "attentionLeaseId"));
  const eventId = uuid(own(record, "eventId"));
  const idempotencyKey = uuid(own(record, "idempotencyKey"));
  const deviceId = uuid(own(record, "deviceId"));
  const occurredAt = timestamp(own(record, "occurredAt"));
  if (scope === undefined || customerId === undefined || sourceOrderId === undefined || captureDraftId === undefined
    || expectedVersion === undefined || attentionLeaseId === undefined || eventId === undefined
    || idempotencyKey === undefined || deviceId === undefined || occurredAt === undefined) return undefined;
  return Object.freeze({
    attentionLeaseId,
    captureDraftId,
    customerId,
    deviceId,
    eventId,
    expectedVersion,
    idempotencyKey,
    occurredAt,
    schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
    scope,
    sourceOrderId,
  });
}

export function parseCustomerRepeatOrderCaptureResultV1(
  value: unknown,
): CustomerRepeatOrderCaptureResultV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "capture", "preview"]);
  if (record === undefined || own(record, "schemaVersion") !== CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION) return undefined;
  const capture = parseCaptureMutationResultV1(own(record, "capture"));
  const preview = parseCustomerRepeatOrderPreviewV1(own(record, "preview"));
  return capture === undefined || preview === undefined
    ? undefined
    : Object.freeze({ capture, preview, schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION });
}

function parsePreviewLine(value: unknown): CustomerRepeatOrderPreviewLineV1 | undefined {
  const record = exactRecord(value, [
    "sourceOrderItemId", "productId", "historicalName", "currentName", "quantity", "status",
    "currentUnitPriceMinor", "issues",
  ]);
  if (record === undefined) return undefined;
  const sourceOrderItemId = uuid(own(record, "sourceOrderItemId"));
  const productId = uuid(own(record, "productId"));
  const historicalName = text(own(record, "historicalName"), 1, 120);
  const rawCurrentName = own(record, "currentName");
  const currentName = rawCurrentName === null ? null : text(rawCurrentName, 1, 120);
  const quantity = integer(own(record, "quantity"), 1, 1_000_000);
  const status = member(own(record, "status"), ["blocked", "ready"] as const);
  const rawCurrentPrice = own(record, "currentUnitPriceMinor");
  const currentUnitPriceMinor = rawCurrentPrice === null
    ? null
    : integer(rawCurrentPrice, 0, Number.MAX_SAFE_INTEGER);
  const rawIssues = denseArray(own(record, "issues"), 50);
  if (sourceOrderItemId === undefined || productId === undefined || historicalName === undefined
    || currentName === undefined || quantity === undefined || status === undefined
    || currentUnitPriceMinor === undefined || rawIssues === undefined) return undefined;
  const issues: CustomerRepeatOrderPreviewIssueV1[] = [];
  const keys = new Set<string>();
  for (const rawIssue of rawIssues) {
    const issue = parsePreviewIssue(rawIssue);
    const key = issue === undefined ? "" : `${issue.code}\u0000${issue.groupId ?? ""}\u0000${issue.modifierId ?? ""}`;
    if (issue === undefined || keys.has(key)) return undefined;
    keys.add(key);
    issues.push(issue);
  }
  const hasBlocking = issues.some(({ severity }) => severity === "blocking");
  if ((status === "ready" && (hasBlocking || currentName === null || currentUnitPriceMinor === null))
    || (status === "blocked" && (!hasBlocking || currentUnitPriceMinor !== null))) return undefined;
  return Object.freeze({
    currentName,
    currentUnitPriceMinor,
    historicalName,
    issues: Object.freeze(issues),
    productId,
    quantity,
    sourceOrderItemId,
    status,
  });
}

function parsePreviewIssue(value: unknown): CustomerRepeatOrderPreviewIssueV1 | undefined {
  const record = exactRecord(value, [
    "code", "severity", "groupId", "modifierId", "historicalAmountMinor", "currentAmountMinor",
  ]);
  if (record === undefined) return undefined;
  const code = member(own(record, "code"), REPEAT_ORDER_PREVIEW_ISSUE_CODES);
  const severity = member(own(record, "severity"), ["blocking", "warning"] as const);
  const groupId = nullableUuid(own(record, "groupId"));
  const modifierId = nullableUuid(own(record, "modifierId"));
  const historicalAmountMinor = nullableInteger(own(record, "historicalAmountMinor"));
  const currentAmountMinor = nullableInteger(own(record, "currentAmountMinor"));
  if (code === undefined || severity === undefined || groupId === undefined || modifierId === undefined
    || historicalAmountMinor === undefined || currentAmountMinor === undefined) return undefined;
  const priceChange = code === "product_price_changed" || code === "modifier_price_changed";
  if (priceChange !== (severity === "warning")
    || (priceChange
      ? historicalAmountMinor === null || currentAmountMinor === null
      : historicalAmountMinor !== null || currentAmountMinor !== null)) return undefined;
  return Object.freeze({ code, currentAmountMinor, groupId, historicalAmountMinor, modifierId, severity });
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

function nullableInteger(value: unknown): number | null | undefined {
  return value === null ? null : integer(value, 0, Number.MAX_SAFE_INTEGER);
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function nullableUuid(value: unknown): string | null | undefined {
  return value === null ? null : uuid(value);
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
