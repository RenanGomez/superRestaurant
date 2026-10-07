import { parseBranchDaySummaryRequestV1, parseBranchDaySummaryV1 } from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const scope = {
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
};
const id = (suffix: string): string => `2ee5f057-7971-468d-b197-f946911743${suffix}`;

const request = { date: "2026-10-05", schemaVersion: 1, scope } as const;
expect(parseBranchDaySummaryRequestV1(request) !== undefined, "exact request parses");
for (const invalid of [
  { ...request, date: "2026-02-30" },
  { ...request, date: "2026-5-1" },
  { ...request, date: "1999-12-31" },
  { ...request, date: "2026-10-05T00:00:00Z" },
  { ...request, date: 20261005 },
  { ...request, schemaVersion: 2 },
  { ...request, extra: true },
  { schemaVersion: 1, scope },
  { ...request, scope: { ...scope, branchId: "x" } },
  { ...request, scope: { restaurantId: scope.restaurantId } },
  null,
  [],
]) expect(parseBranchDaySummaryRequestV1(invalid) === undefined, "request rejects invalid shapes");

const channels = [
  { amountMinor: 0, channel: "table", paymentCount: 0, tipMinor: 0 },
  { amountMinor: 10100, channel: "counter", paymentCount: 2, tipMinor: 500 },
  { amountMinor: 2000, channel: "takeout", paymentCount: 1, tipMinor: 100 },
  { amountMinor: 12500, channel: "delivery", paymentCount: 2, tipMinor: 0 },
];
const methods = [
  { amountMinor: 13600, method: "cash", paymentCount: 3, tipMinor: 500 },
  { amountMinor: 9000, method: "card_manual", paymentCount: 1, tipMinor: 0 },
  { amountMinor: 2000, method: "transfer", paymentCount: 1, tipMinor: 100 },
];
const closedRegister = {
  cashRegisterSessionId: id("01"), cashierId: id("02"), closedAt: "2026-10-05T14:00:00.000Z",
  countedClosingBalanceMinor: 23300, differenceMinor: -200, expectedCashBalanceMinor: 23500,
  movements: [
    { amountMinor: 5000, count: 1, direction: "in", type: "cash_in" },
    { amountMinor: 10000, count: 1, direction: "in", type: "cash_sale" },
  ],
  openedAt: "2026-10-05T08:00:00.000Z", openingFloatMinor: 10000, registerId: id("03"), status: "closed",
};
const openRegister = {
  cashRegisterSessionId: id("04"), cashierId: id("02"), closedAt: null, countedClosingBalanceMinor: null,
  differenceMinor: null, expectedCashBalanceMinor: 6500, movements: [],
  openedAt: "2026-10-05T15:00:00.000Z", openingFloatMinor: 5000, registerId: id("05"), status: "open",
};
const summary = {
  cancellations: { captures: 1, orders: 1, refundPendingMinor: 5500 },
  currency: "MXN",
  date: "2026-10-05",
  deliveriesSettled: { cashCollectedMinor: 3500, count: 1 },
  deliveryFees: { amountMinor: 3000, orderCount: 1 },
  ordersPaid: { amountMinor: 22600, count: 4 },
  salesByChannel: channels,
  salesByMethod: methods,
  schemaVersion: 1,
  scope,
  shifts: [
    { closedAt: "2026-10-05T14:00:00.000Z", name: "Turno matutino", openedAt: "2026-10-05T08:00:00.000Z",
      registers: [closedRegister], shiftId: id("06"), status: "closed" },
    { closedAt: null, name: "Turno vespertino", openedAt: "2026-10-05T15:00:00.000Z",
      registers: [openRegister], shiftId: id("07"), status: "open" },
  ],
  timeZone: "America/Hermosillo",
  totals: { cashTipsMinor: 500, paymentCount: 5, salesMinor: 24600, tipsMinor: 600 },
};

const parsed = parseBranchDaySummaryV1(summary);
expect(parsed !== undefined, "coherent summary parses");
expect(parsed?.totals.salesMinor === 24600 && parsed.shifts.length === 2 && parsed.cancellations.orders === 1,
  "parsed summary keeps the figures");
expect(Object.isFrozen(parsed) && Object.isFrozen(parsed?.salesByChannel), "parsed summary is frozen");
expect(parsed?.cancellations.refundPendingMinor === 5500, "pending refund obligations are kept");
// Additive field: an older producer omits it and it reads as zero.
const legacy = parseBranchDaySummaryV1({ ...summary, cancellations: { captures: 1, orders: 1 } });
expect(legacy?.cancellations.refundPendingMinor === 0 && legacy.cancellations.orders === 1, "missing refundPendingMinor reads as 0");
for (const bad of [
  { captures: 1, orders: 1, refundPendingMinor: -1 }, { captures: 1, orders: 1, refundPendingMinor: 1.5 },
  { captures: 1, orders: 1, refundPendingMinor: 2 ** 53 }, { captures: 1, orders: 1, refundPendingMinor: "5500" },
  { captures: 1, orders: 0, refundPendingMinor: 100 }, { captures: 1, orders: 1, refundPendingMinor: 1, extra: 1 },
  { captures: 1, orders: 1, extra: 1 },
]) expect(parseBranchDaySummaryV1({ ...summary, cancellations: bad }) === undefined, `cancellations reject ${JSON.stringify(bad)}`);

// An empty day is all zeros, never null.
const empty = {
  ...summary,
  cancellations: { captures: 0, orders: 0, refundPendingMinor: 0 },
  deliveriesSettled: { cashCollectedMinor: 0, count: 0 },
  deliveryFees: { amountMinor: 0, orderCount: 0 },
  ordersPaid: { amountMinor: 0, count: 0 },
  salesByChannel: channels.map((row) => ({ ...row, amountMinor: 0, paymentCount: 0, tipMinor: 0 })),
  salesByMethod: methods.map((row) => ({ ...row, amountMinor: 0, paymentCount: 0, tipMinor: 0 })),
  shifts: [],
  totals: { cashTipsMinor: 0, paymentCount: 0, salesMinor: 0, tipsMinor: 0 },
};
expect(parseBranchDaySummaryV1(empty) !== undefined, "empty day parses");

const mutated: readonly [string, unknown][] = [
  ["channel sum drifts", { ...summary, salesByChannel: channels.map((row, i) => i === 1 ? { ...row, amountMinor: 10101 } : row) }],
  ["method sum drifts", { ...summary, salesByMethod: methods.map((row, i) => i === 1 ? { ...row, amountMinor: 9001 } : row) }],
  ["total drifts", { ...summary, totals: { ...summary.totals, salesMinor: 24601 } }],
  ["payment count drifts", { ...summary, totals: { ...summary.totals, paymentCount: 6 } }],
  ["tips drift", { ...summary, totals: { ...summary.totals, tipsMinor: 601 } }],
  ["cash tips differ from the cash method", { ...summary, totals: { ...summary.totals, cashTipsMinor: 400 } }],
  ["cash tips above all tips", { ...summary, totals: { ...summary.totals, cashTipsMinor: 700 } }],
  ["missing channel", { ...summary, salesByChannel: channels.slice(1) }],
  ["channels out of order", { ...summary, salesByChannel: [channels[1], channels[0], channels[2], channels[3]] }],
  ["unknown channel", { ...summary, salesByChannel: channels.map((row, i) => i === 2 ? { ...row, channel: "takeaway" } : row) }],
  ["unknown method", { ...summary, salesByMethod: methods.map((row, i) => i === 2 ? { ...row, method: "wire" } : row) }],
  ["money with a fraction", { ...summary, totals: { ...summary.totals, salesMinor: 24600.5 } }],
  ["negative money", { ...summary, ordersPaid: { amountMinor: -1, count: 4 } }],
  ["unsafe integer", { ...summary, deliveriesSettled: { cashCollectedMinor: 2 ** 53, count: 1 } }],
  ["fees without orders", { ...summary, deliveryFees: { amountMinor: 3000, orderCount: 0 } }],
  ["more fee orders than paid orders", { ...summary, deliveryFees: { amountMinor: 3000, orderCount: 5 } }],
  ["paid orders without money", { ...summary, ordersPaid: { amountMinor: 0, count: 4 } }],
  ["bad currency", { ...summary, currency: "mxn" }],
  ["bad zone", { ...summary, timeZone: "Mars/Olympus" }],
  ["bad date", { ...summary, date: "2026-13-01" }],
  ["extra key", { ...summary, extra: 1 }],
  ["missing key", Object.fromEntries(Object.entries(summary).filter(([key]) => key !== "cancellations"))],
  ["too many shifts", { ...summary, shifts: Array.from({ length: 51 }, () => summary.shifts[0]) }],
  ["open shift with a close time", { ...summary, shifts: [{ ...summary.shifts[1], closedAt: "2026-10-05T16:00:00.000Z" }] }],
  ["closed register without a count", { ...summary, shifts: [{ ...summary.shifts[0],
    registers: [{ ...closedRegister, countedClosingBalanceMinor: null }] }] }],
  ["closed register with a wrong difference", { ...summary, shifts: [{ ...summary.shifts[0],
    registers: [{ ...closedRegister, differenceMinor: -199 }] }] }],
  ["open register with a count", { ...summary, shifts: [{ ...summary.shifts[1],
    registers: [{ ...openRegister, countedClosingBalanceMinor: 100 }] }] }],
  ["unknown movement type", { ...summary, shifts: [{ ...summary.shifts[0], registers: [{ ...closedRegister,
    movements: [{ amountMinor: 1, count: 1, direction: "in", type: "gift" }] }] }] }],
  ["zero-count movement", { ...summary, shifts: [{ ...summary.shifts[0], registers: [{ ...closedRegister,
    movements: [{ amountMinor: 1, count: 0, direction: "in", type: "cash_in" }] }] }] }],
  ["bad shift id", { ...summary, shifts: [{ ...summary.shifts[0], shiftId: "nope" }] }],
  ["bad timestamp", { ...summary, shifts: [{ ...summary.shifts[0], openedAt: "2026-10-05T08:00:00Z" }] }],
  ["wrong scope", { ...summary, scope: { restaurantId: scope.restaurantId } }],
  ["null", null],
];
for (const [name, value] of mutated) expect(parseBranchDaySummaryV1(value) === undefined, `summary rejects: ${name}`);

// Hostile objects: accessor properties and prototype pollution must not parse.
const accessor = { ...summary };
Object.defineProperty(accessor, "currency", { enumerable: true, get: () => "MXN" });
expect(parseBranchDaySummaryV1(accessor) === undefined, "summary rejects accessor properties");
expect(parseBranchDaySummaryV1(Object.assign(Object.create({ inherited: true }), summary)) === undefined,
  "summary rejects a non-plain prototype");
