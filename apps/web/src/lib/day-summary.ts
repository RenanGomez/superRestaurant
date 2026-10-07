import type { BranchDaySummaryV1 } from "@super-restaurant/shared-types";

import { formatMinorUnits, formatOrderWorkTime } from "./branch-order-work-tray";

const CHANNEL_LABELS = { counter: "Mostrador", delivery: "Entrega a domicilio", table: "Mesa", takeout: "Para llevar" } as const;
const METHOD_LABELS = { card_manual: "Tarjeta", cash: "Efectivo", transfer: "Transferencia" } as const;
const MOVEMENT_LABELS = {
  cash_adjustment: "Ajuste", cash_in: "Entrada", cash_out: "Salida", cash_refund: "Reembolso", cash_sale: "Venta en efectivo", tip_in: "Propina",
} as const;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Calendar date `YYYY-MM-DD`, real (no 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** "Today" is the restaurant's calendar day, never the viewer's device day. */
export function todayInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone, year: "numeric" }).formatToParts(now);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export interface DaySummaryRow { readonly key: string; readonly label: string; readonly count: number; readonly amount: string; readonly tip: string }
export interface DaySummaryShiftRow {
  readonly key: string;
  readonly shift: string;
  readonly status: string;
  readonly opened: string;
  readonly closed: string;
  readonly float: string;
  readonly expected: string;
  readonly counted: string;
  readonly difference: string;
  readonly movements: readonly string[];
}
export interface DaySummaryView {
  readonly empty: boolean;
  readonly cards: readonly { readonly key: string; readonly label: string; readonly value: string; readonly detail: string }[];
  readonly channels: readonly DaySummaryRow[];
  readonly methods: readonly DaySummaryRow[];
  readonly salesTotal: string;
  readonly shifts: readonly DaySummaryShiftRow[];
}

/** Pure mapping: every amount shown is the server's integer, formatted; nothing is recomputed. */
export function buildDaySummaryView(summary: BranchDaySummaryV1): DaySummaryView {
  const money = (minor: number): string => formatMinorUnits(minor, summary.currency);
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const row = (key: string, label: string, source: { paymentCount: number; amountMinor: number; tipMinor: number }): DaySummaryRow =>
    ({ amount: money(source.amountMinor), count: source.paymentCount, key, label, tip: money(source.tipMinor) });
  const time = (iso: string | null): string => iso === null ? "—" : formatOrderWorkTime(iso, summary.timeZone);
  const { totals, cancellations } = summary;
  return Object.freeze({
    cards: [
      { detail: `${plural(totals.paymentCount, "pago", "pagos")} · ${plural(summary.ordersPaid.count, "orden pagada", "órdenes pagadas")}`, key: "sales", label: "Ventas", value: money(totals.salesMinor) },
      { detail: `En efectivo: ${money(totals.cashTipsMinor)}`, key: "tips", label: "Propinas", value: money(totals.tipsMinor) },
      { detail: `${plural(summary.deliveryFees.orderCount, "orden con envío", "órdenes con envío")} · ${plural(summary.deliveriesSettled.count, "entrega liquidada", "entregas liquidadas")}`, key: "delivery", label: "Envíos", value: money(summary.deliveryFees.amountMinor) },
      { detail: plural(cancellations.captures, "captura cerrada", "capturas cerradas"), key: "cancelled", label: "Canceladas", value: plural(cancellations.orders, "orden", "órdenes") },
    ],
    channels: summary.salesByChannel.map((entry) => row(entry.channel, CHANNEL_LABELS[entry.channel], entry)),
    empty: totals.paymentCount === 0 && summary.shifts.length === 0 && cancellations.orders === 0 && cancellations.captures === 0,
    methods: summary.salesByMethod.map((entry) => row(entry.method, METHOD_LABELS[entry.method], entry)),
    salesTotal: money(totals.salesMinor),
    shifts: summary.shifts.flatMap((shift) => shift.registers.map((register, index) => ({
      closed: time(register.closedAt),
      counted: register.countedClosingBalanceMinor === null ? "—" : money(register.countedClosingBalanceMinor),
      difference: register.differenceMinor === null ? "—" : money(register.differenceMinor),
      expected: money(register.expectedCashBalanceMinor),
      float: money(register.openingFloatMinor),
      key: `${shift.shiftId}:${register.cashRegisterSessionId}:${index}`,
      movements: register.movements.map((movement) => `${MOVEMENT_LABELS[movement.type]} (${movement.count}): ${movement.direction === "out" ? "−" : "+"}${money(movement.amountMinor)}`),
      opened: time(register.openedAt),
      shift: shift.name,
      status: register.status === "open" ? "Abierta" : "Cerrada",
    }))),
  });
}
