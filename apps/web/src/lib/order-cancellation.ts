import {
  ORDER_CANCELLATION_REASON_MAX_LENGTH,
  parseCancelOrderResultV1,
  parseCancelledWorkTrayV1,
  type BranchScope,
  type CancelOrderCommandV1,
  type CancelOrderResultV1,
  type CancelledWorkCursorV1,
  type CancelledWorkItemV1,
  type CancelledWorkTrayV1,
  type OrderDetailV1,
  type OrderRefundObligationV1,
} from "@super-restaurant/shared-types";
import { formatMinorUnits, formatOrderWorkTime } from "./branch-order-work-tray";

export type CancelOrderRequestError =
  | "invalid" | "denied" | "not_found" | "conflict" | "delivery_active" | "payment_in_flight" | "unavailable";

export type CancelOrderRequestResult =
  | { readonly ok: true; readonly value: CancelOrderResultV1 }
  | { readonly ok: false; readonly error: CancelOrderRequestError };

export type CancelledTrayRequestResult =
  | { readonly ok: true; readonly value: CancelledWorkTrayV1 }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "unavailable" };

export const CANCELLED_TRAY_LIMIT = 25;

/** Maps a 409 body (`{ code }`) to the specific blocker; any other conflict is a stale version. */
export function conflictErrorFromBody(body: unknown): "conflict" | "delivery_active" | "payment_in_flight" {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const code = (body as { readonly code?: unknown }).code;
    if (code === "DELIVERY_ACTIVE") return "delivery_active";
    if (code === "PAYMENT_IN_FLIGHT") return "payment_in_flight";
  }
  return "conflict";
}

export async function postCancelOrder(token: string, baseUrl: string, command: CancelOrderCommandV1): Promise<CancelOrderRequestResult> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/orders/cancel`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    if (response.ok) {
      const value = parseCancelOrderResultV1(await response.json().catch(() => undefined));
      if (value === undefined || value.orderId !== command.orderId || value.scope.restaurantId !== command.scope.restaurantId
        || value.scope.branchId !== command.scope.branchId) return { error: "unavailable", ok: false };
      return { ok: true, value };
    }
    if (response.status === 409) return { error: conflictErrorFromBody(await response.json().catch(() => undefined)), ok: false };
    return {
      error: response.status === 400 ? "invalid" : response.status === 401 || response.status === 403 ? "denied"
        : response.status === 404 ? "not_found" : "unavailable",
      ok: false,
    };
  } catch { return { error: "unavailable", ok: false }; }
}

export async function requestCancelledWorkTray(
  token: string, baseUrl: string, scope: BranchScope, cursor: CancelledWorkCursorV1 | null, limit: number,
): Promise<CancelledTrayRequestResult> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/orders/cancelled`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ cursor, limit, schemaVersion: 1, scope }),
    });
    if (!response.ok) {
      return { error: response.status === 400 ? "invalid" : response.status === 401 || response.status === 403 ? "denied" : "unavailable", ok: false };
    }
    const value = parseCancelledWorkTrayV1(await response.json().catch(() => undefined));
    if (value === undefined || value.scope.restaurantId !== scope.restaurantId || value.scope.branchId !== scope.branchId) {
      return { error: "unavailable", ok: false };
    }
    return { ok: true, value };
  } catch { return { error: "unavailable", ok: false }; }
}

/** Single construction point for the whole-order cancellation contract; the reason is trimmed once. */
export function buildCancelOrderCommand(input: {
  readonly scope: BranchScope;
  readonly orderId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly deviceId: string;
}): CancelOrderCommandV1 {
  return {
    deviceId: input.deviceId.toLowerCase(), eventId: input.eventId, expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey, occurredAt: input.occurredAt, orderId: input.orderId,
    reason: input.reason.trim(), schemaVersion: 1, scope: input.scope,
  };
}

/** Trimmed reason when it satisfies the 1..200 contract, else `undefined` (confirm stays disabled). */
export function validCancelReason(reason: string): string | undefined {
  const trimmed = reason.trim();
  return trimmed.length >= 1 && trimmed.length <= ORDER_CANCELLATION_REASON_MAX_LENGTH && !/[\p{Cc}\p{Cf}]/u.test(trimmed)
    ? trimmed : undefined;
}

/** Whether the order already holds captured money (the detail does not expose the amount). */
export function orderHasCapturedMoney(detail: Pick<OrderDetailV1, "status">): boolean {
  return detail.status === "partially_paid" || detail.status === "paid";
}

/** Shown in the dialog before confirming; the exact amount only exists in the server's result. */
export function cancelOrderWarning(detail: Pick<OrderDetailV1, "status">): string | undefined {
  return orderHasCapturedMoney(detail)
    ? "Esta orden ya tiene dinero cobrado. Se cancela igual y queda pendiente devolverlo en caja."
    : undefined;
}

/** `Queda pendiente devolver $X en caja`, or `undefined` when nothing was captured. */
export function refundObligationMessage(obligation: OrderRefundObligationV1): string | undefined {
  if (obligation.status !== "pending") return undefined;
  const total = obligation.capturedMinor + obligation.capturedTipMinor;
  const tip = obligation.capturedTipMinor > 0 ? ` (incluye ${formatMinorUnits(obligation.capturedTipMinor, obligation.currency)} de propina)` : "";
  return `Queda pendiente devolver ${formatMinorUnits(total, obligation.currency)} en caja${tip}.`;
}

export function cancelOrderResultMessage(result: CancelOrderResultV1): string {
  const base = result.replayed ? "La orden ya estaba cancelada con este mismo registro." : "Orden cancelada.";
  const refund = refundObligationMessage(result.refundObligation);
  return refund === undefined ? base : `${base} ${refund}`;
}

const CANCEL_ERROR_MESSAGES: Record<CancelOrderRequestError, string> = {
  conflict: "La orden cambió mientras tanto. Se actualizó; revisa y vuelve a intentar.",
  delivery_active: "Primero marca la entrega como no realizada o liquídala.",
  denied: "Tu rol no permite cancelar órdenes completas. Pide a un gerente o supervisor.",
  invalid: "No se pudo enviar la cancelación. Revisa el motivo.",
  not_found: "La orden ya no está disponible.",
  payment_in_flight: "Hay un cobro en proceso para esta orden. Espera a que termine o se rechace y vuelve a intentar.",
  unavailable: "No se pudo confirmar el resultado. Se recargó la orden; revisa su estado antes de repetir.",
};

export function cancelOrderErrorMessage(error: CancelOrderRequestError): string {
  return CANCEL_ERROR_MESSAGES[error];
}

const SOURCE_LABELS = {
  counter: "Mostrador", integration: "Integración", phone: "Teléfono", self_service: "Autoservicio",
  table: "Mesa", whatsapp_manual: "WhatsApp",
} as const;
const CHANNEL_LABELS = { counter: "Mostrador", delivery: "Domicilio", table: "Mesa", takeout: "Para llevar" } as const;

export function cancelledItemKey(item: CancelledWorkItemV1): string {
  return item.kind === "order" ? `order:${item.orderId}` : `capture:${item.captureDraftId}`;
}

export function cancelledItemTitle(item: CancelledWorkItemV1): string {
  return item.kind === "order" ? `Orden · ${CHANNEL_LABELS[item.channel]}` : `Captura ${item.folio} · ${SOURCE_LABELS[item.sourceChannel]}`;
}

/** Local time of the cancellation; captures carry no time zone, so they use the branch's device zone. */
export function cancelledItemTime(item: CancelledWorkItemV1, fallbackTimeZone: string): string {
  const timeZone = item.kind === "order" ? item.timeZone : fallbackTimeZone;
  const date = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", timeZone }).format(new Date(item.cancelledAt));
  return `${date}, ${formatOrderWorkTime(item.cancelledAt, timeZone)}`;
}

/** `Devolución pendiente $X` only for orders with a pending obligation. */
export function cancelledItemRefundLabel(item: CancelledWorkItemV1): string | undefined {
  if (item.kind !== "order" || item.refundObligation.status !== "pending") return undefined;
  const { capturedMinor, capturedTipMinor, currency } = item.refundObligation;
  return `Devolución pendiente ${formatMinorUnits(capturedMinor + capturedTipMinor, currency)}`;
}

export function cancelledItemTotalLabel(item: CancelledWorkItemV1): string | undefined {
  return item.kind === "order" && item.totalMinor !== null ? formatMinorUnits(item.totalMinor, item.refundObligation.currency) : undefined;
}

/** Appending a page: drops anything already shown so a refresh racing "Cargar más" cannot duplicate rows. */
export function mergeCancelledItems(current: readonly CancelledWorkItemV1[], page: readonly CancelledWorkItemV1[]): readonly CancelledWorkItemV1[] {
  const seen = new Set(current.map(cancelledItemKey));
  return [...current, ...page.filter((item) => !seen.has(cancelledItemKey(item)))];
}
