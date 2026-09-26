import { Inject, Injectable } from "@nestjs/common";
import { parseBranchScope, type BranchScope } from "@super-restaurant/shared-types";

import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const listSql = "select app_private.list_branch_active_orders($1::uuid, $2::jsonb) as result";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const CHANNELS = ["table", "counter", "takeout", "delivery"] as const;
const STATUSES = ["draft", "open", "partially_paid"] as const;
const ITEM_STATUSES = ["pending", "sent", "preparing", "ready", "delivered", "cancelled"] as const;

export interface BranchOrderCursor {
  readonly updatedAt: string;
  readonly orderId: string;
}

export interface BranchActiveOrder {
  readonly orderId: string;
  readonly tableId: string | null;
  readonly channel: typeof CHANNELS[number];
  readonly shiftId: string | null;
  readonly status: typeof STATUSES[number];
  readonly version: number;
  readonly updatedAt: string;
  readonly itemStatuses: readonly typeof ITEM_STATUSES[number][];
}

export interface BranchOrderPage {
  readonly schemaVersion: 1;
  readonly scope: BranchScope;
  readonly orders: readonly BranchActiveOrder[];
  readonly next: BranchOrderCursor | null;
}

export interface BranchOrderTrayPort {
  listActive(actorId: string, scope: BranchScope, limit: number, after: BranchOrderCursor | null): Promise<BranchOrderPage | "denied">;
}

/** Internal reader only. The unified tray must authorize both Capture and Order before calling it. */
@Injectable()
export class PostgresBranchOrderTray implements BranchOrderTrayPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async listActive(actorId: string, scope: BranchScope, limit: number, after: BranchOrderCursor | null): Promise<BranchOrderPage | "denied"> {
    if (!UUID.test(actorId) || parseBranchScope(scope) === undefined || !Number.isSafeInteger(limit)
      || limit < 1 || limit > 100 || (after !== null && parseCursor(after) === undefined)) throw unavailable();
    let rows: readonly unknown[];
    try {
      rows = (await this.database.query(listSql, [actorId, JSON.stringify({ schemaVersion: 1, scope, limit, after })])).rows;
    } catch { throw unavailable(); }
    if (rows.length !== 1) throw unavailable();
    const envelope = exact(rows[0], ["result"]);
    if (envelope === undefined) throw unavailable();
    const result = value(envelope, "result");
    const denied = exact(result, ["status"]);
    if (denied !== undefined && value(denied, "status") === "denied") return "denied";
    const page = parseBranchOrderPage(result);
    if (page === undefined || page.orders.length > limit || page.scope.restaurantId !== scope.restaurantId
      || page.scope.branchId !== scope.branchId) throw unavailable();
    return page;
  }
}

export function parseBranchOrderPage(input: unknown): BranchOrderPage | undefined {
  const record = exact(input, ["schemaVersion", "scope", "orders", "next"]);
  if (record === undefined || value(record, "schemaVersion") !== 1) return undefined;
  const scope = parseBranchScope(value(record, "scope"));
  const rawOrders = value(record, "orders");
  const rawNext = value(record, "next");
  if (scope === undefined || !Array.isArray(rawOrders) || rawOrders.length > 100) return undefined;
  const orders: BranchActiveOrder[] = [];
  for (const raw of rawOrders) {
    const order = parseOrder(raw);
    if (order === undefined || orders.some((previous) => previous.orderId === order.orderId)) return undefined;
    const previous = orders.at(-1);
    if (previous !== undefined && (previous.updatedAt < order.updatedAt
      || (previous.updatedAt === order.updatedAt && previous.orderId >= order.orderId))) return undefined;
    orders.push(order);
  }
  const next = rawNext === null ? null : parseCursor(rawNext);
  if (next === undefined || (next !== null && (orders.length === 0
    || next.orderId !== orders.at(-1)?.orderId
    || `${next.updatedAt.slice(0, 23)}Z` !== orders.at(-1)?.updatedAt))) return undefined;
  return Object.freeze({ schemaVersion: 1, scope, orders: Object.freeze(orders), next });
}

function parseOrder(input: unknown): BranchActiveOrder | undefined {
  const record = exact(input, ["orderId", "tableId", "channel", "shiftId", "status", "version", "updatedAt", "itemStatuses"]);
  if (record === undefined) return undefined;
  const orderId = value(record, "orderId");
  const tableId = value(record, "tableId");
  const channel = value(record, "channel");
  const shiftId = value(record, "shiftId");
  const status = value(record, "status");
  const version = value(record, "version");
  const updatedAt = value(record, "updatedAt");
  const itemStatuses = value(record, "itemStatuses");
  if (!uuid(orderId) || (tableId !== null && !uuid(tableId)) || (shiftId !== null && !uuid(shiftId))
    || !member(channel, CHANNELS) || !member(status, STATUSES) || !Number.isSafeInteger(version)
    || (version as number) < 1 || !timestamp(updatedAt) || !Array.isArray(itemStatuses)
    || itemStatuses.length > 100 || !Array.from({ length: itemStatuses.length }, (_, index) => index)
      .every((index) => Object.hasOwn(itemStatuses, index) && member(itemStatuses[index], ITEM_STATUSES))
    || (channel === "table") !== (tableId !== null)) return undefined;
  return Object.freeze({ orderId, tableId, channel, shiftId, status, version,
    updatedAt, itemStatuses: Object.freeze([...itemStatuses]) }) as BranchActiveOrder;
}

function parseCursor(input: unknown): BranchOrderCursor | undefined {
  const record = exact(input, ["updatedAt", "orderId"]);
  if (record === undefined || !cursorTimestamp(value(record, "updatedAt")) || !uuid(value(record, "orderId"))) return undefined;
  return Object.freeze({ updatedAt: value(record, "updatedAt"), orderId: value(record, "orderId") }) as BranchOrderCursor;
}

function exact(input: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) return undefined;
    const actual = Reflect.ownKeys(input);
    if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return input as Readonly<Record<string, unknown>>;
  } catch { return undefined; }
}

function value(record: Readonly<Record<string, unknown>>, key: string): unknown { return record[key]; }
function uuid(input: unknown): input is string { return typeof input === "string" && UUID.test(input); }
function timestamp(input: unknown): input is string {
  if (typeof input !== "string" || !TIMESTAMP.test(input)) return false;
  const milliseconds = Date.parse(input);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === input;
}
function cursorTimestamp(input: unknown): input is string {
  return typeof input === "string" && CURSOR_TIMESTAMP.test(input)
    && timestamp(`${input.slice(0, 23)}Z`);
}
function member<const T extends readonly string[]>(input: unknown, options: T): input is T[number] {
  return typeof input === "string" && (options as readonly string[]).includes(input);
}
function unavailable(): Error { return new Error("BRANCH_ORDER_TRAY_UNAVAILABLE"); }
