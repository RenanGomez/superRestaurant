import type { BranchDeliveryItemV1, DeliveryStateV1 } from "@super-restaurant/shared-types";

/** Board columns, in operating order. `unassigned` is filled from the order tray, never from the delivery list. */
export type DeliveryColumnId = "unassigned" | "assigned" | "en_route" | "to_settle" | "failed";

export interface DeliveryColumns {
  readonly assigned: readonly BranchDeliveryItemV1[];
  readonly en_route: readonly BranchDeliveryItemV1[];
  readonly failed: readonly BranchDeliveryItemV1[];
  readonly to_settle: readonly BranchDeliveryItemV1[];
}

export const DELIVERY_COLUMN_LABELS: Readonly<Record<DeliveryColumnId, string>> = Object.freeze({
  assigned: "Asignadas",
  en_route: "En ruta",
  failed: "Fallidas",
  to_settle: "Entregadas por liquidar",
  unassigned: "Por asignar",
});

const COLUMN_BY_STATE: Readonly<Partial<Record<DeliveryStateV1, keyof DeliveryColumns>>> = Object.freeze({
  assigned: "assigned",
  delivered: "to_settle",
  en_route: "en_route",
  failed: "failed",
});

/** Groups the server list by state. `pending` and `settled` are not board work and are dropped. */
export function groupDeliveriesByState(items: readonly BranchDeliveryItemV1[]): DeliveryColumns {
  const columns: Record<keyof DeliveryColumns, BranchDeliveryItemV1[]> = {
    assigned: [], en_route: [], failed: [], to_settle: [],
  };
  for (const item of items) {
    const column = COLUMN_BY_STATE[item.delivery.state];
    if (column !== undefined) columns[column].push(item);
  }
  return Object.freeze({
    assigned: Object.freeze(columns.assigned),
    en_route: Object.freeze(columns.en_route),
    failed: Object.freeze(columns.failed),
    to_settle: Object.freeze(columns.to_settle),
  });
}

export function paymentMethodLabel(method: "cash" | "card_manual" | "transfer"): string {
  return method === "cash" ? "Efectivo" : method === "card_manual" ? "Tarjeta" : "Transferencia";
}

/** Names the next payment location without treating a card or transfer balance as courier cash. */
export function courierCollectionMessage(method: "cash" | "card_manual" | "transfer" | null, remainingMinor: number): {
  readonly kind: "paid" | "cash" | "caja" | "undefined";
  readonly label: string;
} {
  if (remainingMinor === 0) return { kind: "paid", label: "Pagado" };
  if (method === "cash") return { kind: "cash", label: "Cobrar en efectivo" };
  if (method === "card_manual") return { kind: "caja", label: "Pago pendiente en Caja (tarjeta)" };
  if (method === "transfer") return { kind: "caja", label: "Pago pendiente en Caja (transferencia)" };
  return { kind: "undefined", label: "Pago pendiente por definir" };
}

/** Up to two uppercase initials; `?` when the courier has no display name. */
export function courierInitials(label: string | null): string {
  const words = (label ?? "").trim().split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toLocaleUpperCase("es-MX");
}

/**
 * Cash tendered to pre-fill in the settlement sheet: the frozen intent's amount when it is a cash intent
 * with a positive tender, otherwise `null` (the sheet then means "exact cash"). The server re-validates it.
 */
export function prefillTenderedMinor(item: Pick<BranchDeliveryItemV1, "paymentIntent">): number | null {
  const intent = item.paymentIntent;
  if (intent === null || intent.method !== "cash") return null;
  return intent.tenderedAmountMinor !== null && intent.tenderedAmountMinor > 0 ? intent.tenderedAmountMinor : null;
}

/** Tip to pre-fill: the frozen intent's tip for cash intents, otherwise 0. */
export function prefillTipMinor(item: Pick<BranchDeliveryItemV1, "paymentIntent">): number {
  const intent = item.paymentIntent;
  return intent !== null && intent.method === "cash" ? intent.tipMinor : 0;
}

/** Card and transfer intents are collected in Caja, never through a delivery settlement. */
export function settlesInCaja(item: Pick<BranchDeliveryItemV1, "orderStatus" | "paymentIntent">): boolean {
  return item.orderStatus !== "paid" && item.paymentIntent !== null && item.paymentIntent.method !== "cash";
}

/** A failed delivery can be re-assigned only while attempts remain (server enforces the same cap). */
export function canReassign(item: Pick<BranchDeliveryItemV1, "delivery">, maxAttempts: number): boolean {
  return item.delivery.state === "failed" && item.delivery.attemptCount < maxAttempts;
}
