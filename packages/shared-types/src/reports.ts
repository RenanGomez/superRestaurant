import type { BranchScope } from "./index.js";

/**
 * Read-only summary of one calendar day of a Branch (T3 "resumen del día"). Money is integer minor units
 * plus an ISO currency; the day is a calendar date in the Restaurant's own IANA zone, never the viewer's.
 * Sales are captured payments of the day (tips apart), so `salesByChannel`, `salesByMethod` and
 * `totals.salesMinor` always add up to the same figure; the parser enforces that and fails closed.
 */
export const BRANCH_DAY_SUMMARY_SCHEMA_VERSION = 1 as const;
export const BRANCH_DAY_SUMMARY_CHANNELS = Object.freeze(["table", "counter", "takeout", "delivery"] as const);
export const BRANCH_DAY_SUMMARY_METHODS = Object.freeze(["cash", "card_manual", "transfer"] as const);
export const BRANCH_DAY_SUMMARY_MOVEMENT_TYPES = Object.freeze([
  "cash_sale", "cash_refund", "cash_in", "cash_out", "cash_adjustment", "tip_in",
] as const);
export const BRANCH_DAY_SUMMARY_MAX_SHIFTS = 50;
const MAX_REGISTERS_PER_SHIFT = 50;

export type BranchDaySummaryChannelV1 = (typeof BRANCH_DAY_SUMMARY_CHANNELS)[number];
export type BranchDaySummaryMethodV1 = (typeof BRANCH_DAY_SUMMARY_METHODS)[number];
export type BranchDaySummaryMovementTypeV1 = (typeof BRANCH_DAY_SUMMARY_MOVEMENT_TYPES)[number];

export interface BranchDaySummaryRequestV1 {
  readonly schemaVersion: typeof BRANCH_DAY_SUMMARY_SCHEMA_VERSION;
  readonly scope: BranchScope;
  /** Calendar day `YYYY-MM-DD` in the Restaurant's zone. */
  readonly date: string;
}

export interface BranchDaySummaryChannelSalesV1 {
  readonly channel: BranchDaySummaryChannelV1;
  readonly paymentCount: number;
  readonly amountMinor: number;
  readonly tipMinor: number;
}

export interface BranchDaySummaryMethodSalesV1 {
  readonly method: BranchDaySummaryMethodV1;
  readonly paymentCount: number;
  readonly amountMinor: number;
  readonly tipMinor: number;
}

export interface BranchDaySummaryTotalsV1 {
  readonly paymentCount: number;
  /** Captured payment amounts of the day, tips excluded. */
  readonly salesMinor: number;
  readonly tipsMinor: number;
  /** Tips received in cash (a subset of `tipsMinor`). */
  readonly cashTipsMinor: number;
}

export interface BranchDaySummaryMovementV1 {
  readonly type: BranchDaySummaryMovementTypeV1;
  readonly direction: "in" | "out";
  readonly count: number;
  readonly amountMinor: number;
}

export interface BranchDaySummaryRegisterV1 {
  readonly cashRegisterSessionId: string;
  readonly registerId: string;
  readonly cashierId: string;
  readonly status: "open" | "closed";
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly openingFloatMinor: number;
  /** Open session: float plus net movements so far. Closed session: the figure frozen at close. */
  readonly expectedCashBalanceMinor: number;
  readonly countedClosingBalanceMinor: number | null;
  readonly differenceMinor: number | null;
  readonly movements: readonly BranchDaySummaryMovementV1[];
}

export interface BranchDaySummaryShiftV1 {
  readonly shiftId: string;
  readonly name: string;
  readonly status: "open" | "closed";
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly registers: readonly BranchDaySummaryRegisterV1[];
}

export interface BranchDaySummaryV1 {
  readonly schemaVersion: typeof BRANCH_DAY_SUMMARY_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly date: string;
  readonly timeZone: string;
  readonly currency: string;
  readonly salesByChannel: readonly BranchDaySummaryChannelSalesV1[];
  readonly salesByMethod: readonly BranchDaySummaryMethodSalesV1[];
  readonly totals: BranchDaySummaryTotalsV1;
  /** Orders that reached paid/closed with their last payment in the day; amount excludes tips. */
  readonly ordersPaid: { readonly count: number; readonly amountMinor: number };
  /** Frozen delivery charge of those paid Orders. */
  readonly deliveryFees: { readonly orderCount: number; readonly amountMinor: number };
  readonly deliveriesSettled: { readonly count: number; readonly cashCollectedMinor: number };
  /**
   * `orders` are Orders cancelled in the day (cancellation journal `occurred_at`, not `updated_at`); `refundPendingMinor`
   * is the sum of their still-pending refund obligations (captured + tip) in `currency`; absent from older producers = 0.
   */
  readonly cancellations: {
    readonly orders: number; readonly captures: number; readonly refundPendingMinor: number;
  };
  readonly shifts: readonly BranchDaySummaryShiftV1[];
}

export function parseBranchDaySummaryRequestV1(value: unknown): BranchDaySummaryRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "date"]);
  if (record === undefined || own(record, "schemaVersion") !== BRANCH_DAY_SUMMARY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const date = calendarDate(own(record, "date"));
  return scope === undefined || date === undefined ? undefined
    : Object.freeze({ date, schemaVersion: BRANCH_DAY_SUMMARY_SCHEMA_VERSION, scope });
}

export function parseBranchDaySummaryV1(value: unknown): BranchDaySummaryV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "date", "timeZone", "currency", "salesByChannel", "salesByMethod", "totals",
    "ordersPaid", "deliveryFees", "deliveriesSettled", "cancellations", "shifts",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== BRANCH_DAY_SUMMARY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const date = calendarDate(own(record, "date"));
  const timeZone = timeZoneId(own(record, "timeZone"));
  const currency = typeof own(record, "currency") === "string" && /^[A-Z]{3}$/u.test(own(record, "currency") as string)
    ? own(record, "currency") as string : undefined;
  const salesByChannel = parseSales(own(record, "salesByChannel"), "channel", BRANCH_DAY_SUMMARY_CHANNELS);
  const salesByMethod = parseSales(own(record, "salesByMethod"), "method", BRANCH_DAY_SUMMARY_METHODS);
  const totals = parseTotals(own(record, "totals"));
  const ordersPaid = parsePair(own(record, "ordersPaid"), "count", "amountMinor");
  const deliveryFees = parsePair(own(record, "deliveryFees"), "orderCount", "amountMinor");
  const deliveriesSettled = parsePair(own(record, "deliveriesSettled"), "count", "cashCollectedMinor");
  const cancellations = parseCancellations(own(record, "cancellations"));
  const rawShifts = denseArray(own(record, "shifts"), BRANCH_DAY_SUMMARY_MAX_SHIFTS);
  const shifts = rawShifts?.map(parseShift);
  if (scope === undefined || date === undefined || timeZone === undefined || currency === undefined
    || salesByChannel === undefined || salesByMethod === undefined || totals === undefined
    || ordersPaid === undefined || deliveryFees === undefined || deliveriesSettled === undefined
    || cancellations === undefined || shifts === undefined || shifts.some((shift) => shift === undefined)) return undefined;
  // Coherence: every view of the same payments must agree; fail closed otherwise.
  const sum = (rows: readonly { amountMinor: number }[]): number => rows.reduce((total, row) => total + row.amountMinor, 0);
  const count = (rows: readonly { paymentCount: number }[]): number => rows.reduce((total, row) => total + row.paymentCount, 0);
  const tips = (rows: readonly { tipMinor: number }[]): number => rows.reduce((total, row) => total + row.tipMinor, 0);
  const cashTips = salesByMethod.find((row) => row.method === "cash")?.tipMinor;
  if (sum(salesByChannel) !== totals.salesMinor || sum(salesByMethod) !== totals.salesMinor
    || count(salesByChannel) !== totals.paymentCount || count(salesByMethod) !== totals.paymentCount
    || tips(salesByChannel) !== totals.tipsMinor || tips(salesByMethod) !== totals.tipsMinor
    || cashTips !== totals.cashTipsMinor
    || !Number.isSafeInteger(totals.salesMinor + totals.tipsMinor)
    || (deliveryFees.second > 0 && deliveryFees.first < 1)
    || deliveryFees.first > ordersPaid.first
    || (ordersPaid.first > 0 && ordersPaid.second < 1)) return undefined;
  return Object.freeze({
    cancellations: Object.freeze({
      captures: cancellations.captures, orders: cancellations.orders, refundPendingMinor: cancellations.refundPendingMinor,
    }),
    currency, date,
    deliveriesSettled: Object.freeze({ cashCollectedMinor: deliveriesSettled.second, count: deliveriesSettled.first }),
    deliveryFees: Object.freeze({ amountMinor: deliveryFees.second, orderCount: deliveryFees.first }),
    ordersPaid: Object.freeze({ amountMinor: ordersPaid.second, count: ordersPaid.first }),
    salesByChannel, salesByMethod,
    schemaVersion: BRANCH_DAY_SUMMARY_SCHEMA_VERSION, scope,
    shifts: Object.freeze(shifts as BranchDaySummaryShiftV1[]), timeZone, totals,
  });
}

function parseSales<const T extends readonly string[], K extends string>(
  value: unknown, key: K, allowed: T,
): readonly (Readonly<Record<K, T[number]>> & { paymentCount: number; amountMinor: number; tipMinor: number })[] | undefined {
  const rows = denseArray(value, allowed.length);
  if (rows === undefined || rows.length !== allowed.length) return undefined;
  const parsed: (Readonly<Record<K, T[number]>> & { paymentCount: number; amountMinor: number; tipMinor: number })[] = [];
  for (const [index, row] of rows.entries()) {
    const record = exactRecord(row, [key, "paymentCount", "amountMinor", "tipMinor"]);
    const label = record === undefined ? undefined : own(record, key);
    const paymentCount = record === undefined ? undefined : money(own(record, "paymentCount"));
    const amountMinor = record === undefined ? undefined : money(own(record, "amountMinor"));
    const tipMinor = record === undefined ? undefined : money(own(record, "tipMinor"));
    // Fixed order and every key present: a missing channel/method is a producer bug, not a zero.
    if (label !== allowed[index] || paymentCount === undefined || amountMinor === undefined || tipMinor === undefined
      || (paymentCount === 0 && (amountMinor !== 0 || tipMinor !== 0)) || (paymentCount > 0 && amountMinor < 1)) return undefined;
    parsed.push(Object.freeze({ [key]: label, amountMinor, paymentCount, tipMinor }) as never);
  }
  return Object.freeze(parsed);
}

function parseTotals(value: unknown): BranchDaySummaryTotalsV1 | undefined {
  const record = exactRecord(value, ["paymentCount", "salesMinor", "tipsMinor", "cashTipsMinor"]);
  const paymentCount = record === undefined ? undefined : money(own(record, "paymentCount"));
  const salesMinor = record === undefined ? undefined : money(own(record, "salesMinor"));
  const tipsMinor = record === undefined ? undefined : money(own(record, "tipsMinor"));
  const cashTipsMinor = record === undefined ? undefined : money(own(record, "cashTipsMinor"));
  return paymentCount === undefined || salesMinor === undefined || tipsMinor === undefined
    || cashTipsMinor === undefined || cashTipsMinor > tipsMinor ? undefined
    : Object.freeze({ cashTipsMinor, paymentCount, salesMinor, tipsMinor });
}

function parsePair(value: unknown, first: string, second: string): { first: number; second: number } | undefined {
  const record = exactRecord(value, [first, second]);
  const a = record === undefined ? undefined : money(own(record, first));
  const b = record === undefined ? undefined : money(own(record, second));
  return a === undefined || b === undefined ? undefined : { first: a, second: b };
}

/** `refundPendingMinor` is additive: a producer older than 20261007000700 omits it and it reads as 0. */
function parseCancellations(value: unknown): { orders: number; captures: number; refundPendingMinor: number } | undefined {
  const withAmount = value !== null && typeof value === "object" && !Array.isArray(value)
    && Reflect.ownKeys(value).length === 3 && Reflect.ownKeys(value).includes("refundPendingMinor");
  const record = exactRecord(value, withAmount ? ["orders", "captures", "refundPendingMinor"] : ["orders", "captures"]);
  const orders = record === undefined ? undefined : money(own(record, "orders"));
  const captures = record === undefined ? undefined : money(own(record, "captures"));
  const refundPendingMinor = record === undefined ? undefined : withAmount ? money(own(record, "refundPendingMinor")) : 0;
  return orders === undefined || captures === undefined || refundPendingMinor === undefined
    // An obligation can only exist when at least one Order was cancelled in the day.
    || (refundPendingMinor > 0 && orders < 1) ? undefined : { captures, orders, refundPendingMinor };
}

function parseShift(value: unknown): BranchDaySummaryShiftV1 | undefined {
  const record = exactRecord(value, ["shiftId", "name", "status", "openedAt", "closedAt", "registers"]);
  if (record === undefined) return undefined;
  const shiftId = uuid(own(record, "shiftId"));
  const name = text(own(record, "name"), 1, 80);
  const status = member(own(record, "status"), ["open", "closed"] as const);
  const openedAt = timestamp(own(record, "openedAt"));
  const closedAt = nullableTimestamp(own(record, "closedAt"));
  const rawRegisters = denseArray(own(record, "registers"), MAX_REGISTERS_PER_SHIFT);
  const registers = rawRegisters?.map(parseRegister);
  if (shiftId === undefined || name === undefined || status === undefined || openedAt === undefined
    || closedAt === undefined || registers === undefined || registers.some((register) => register === undefined)
    || (status === "open") !== (closedAt === null)) return undefined;
  return Object.freeze({
    closedAt, name, openedAt, registers: Object.freeze(registers as BranchDaySummaryRegisterV1[]), shiftId, status,
  });
}

function parseRegister(value: unknown): BranchDaySummaryRegisterV1 | undefined {
  const record = exactRecord(value, [
    "cashRegisterSessionId", "registerId", "cashierId", "status", "openedAt", "closedAt", "openingFloatMinor",
    "expectedCashBalanceMinor", "countedClosingBalanceMinor", "differenceMinor", "movements",
  ]);
  if (record === undefined) return undefined;
  const cashRegisterSessionId = uuid(own(record, "cashRegisterSessionId"));
  const registerId = uuid(own(record, "registerId"));
  const cashierId = uuid(own(record, "cashierId"));
  const status = member(own(record, "status"), ["open", "closed"] as const);
  const openedAt = timestamp(own(record, "openedAt"));
  const closedAt = nullableTimestamp(own(record, "closedAt"));
  const openingFloatMinor = money(own(record, "openingFloatMinor"));
  const expectedCashBalanceMinor = signedMoney(own(record, "expectedCashBalanceMinor"));
  const rawCounted = own(record, "countedClosingBalanceMinor");
  const rawDifference = own(record, "differenceMinor");
  const countedClosingBalanceMinor = rawCounted === null ? null : money(rawCounted);
  const differenceMinor = rawDifference === null ? null : signedMoney(rawDifference);
  const rawMovements = denseArray(own(record, "movements"), BRANCH_DAY_SUMMARY_MOVEMENT_TYPES.length * 2);
  const movements = rawMovements?.map(parseMovement);
  if (cashRegisterSessionId === undefined || registerId === undefined || cashierId === undefined
    || status === undefined || openedAt === undefined || closedAt === undefined || openingFloatMinor === undefined
    || expectedCashBalanceMinor === undefined || countedClosingBalanceMinor === undefined || differenceMinor === undefined
    || movements === undefined || movements.some((movement) => movement === undefined)) return undefined;
  const closed = status === "closed";
  // A closed session carries its count and difference; an open one carries neither.
  if (closed !== (closedAt !== null) || closed !== (countedClosingBalanceMinor !== null)
    || closed !== (differenceMinor !== null)
    || (closed && differenceMinor !== (countedClosingBalanceMinor as number) - expectedCashBalanceMinor)) return undefined;
  return Object.freeze({
    cashRegisterSessionId, cashierId, closedAt, countedClosingBalanceMinor, differenceMinor, expectedCashBalanceMinor,
    movements: Object.freeze(movements as BranchDaySummaryMovementV1[]), openedAt, openingFloatMinor, registerId, status,
  });
}

function parseMovement(value: unknown): BranchDaySummaryMovementV1 | undefined {
  const record = exactRecord(value, ["type", "direction", "count", "amountMinor"]);
  if (record === undefined) return undefined;
  const type = member(own(record, "type"), BRANCH_DAY_SUMMARY_MOVEMENT_TYPES);
  const direction = member(own(record, "direction"), ["in", "out"] as const);
  const count = money(own(record, "count"));
  const amountMinor = money(own(record, "amountMinor"));
  return type === undefined || direction === undefined || count === undefined || count < 1
    || amountMinor === undefined || amountMinor < 1 ? undefined
    : Object.freeze({ amountMinor, count, direction, type });
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined : Object.freeze({ restaurantId, branchId }) as BranchScope;
}

type PlainRecord = Record<string, unknown>;

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined;
  }
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key))
    ? value as PlainRecord : undefined;
}

function own(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function denseArray(value: unknown, max: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return undefined;
  return value;
}

function member<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase() : undefined;
}

/** Non-negative safe integer in minor units (counts use the same shape). */
function money(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function signedMoney(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? value as number : undefined;
}

function text(value: unknown, min: number, max: number): string | undefined {
  return typeof value === "string" && value === value.trim() && value.length >= min && value.length <= max
    ? value : undefined;
}

function calendarDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().startsWith(value)
    && value >= "2000-01-01" && value <= "2100-01-01" ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? value : undefined;
}

function nullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : timestamp(value);
}

function timeZoneId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 100 || value !== value.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return undefined;
  }
}
