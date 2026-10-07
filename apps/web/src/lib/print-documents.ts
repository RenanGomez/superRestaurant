import type { OrderDetailV1, OrderPaymentV1, PaymentCollectionSummaryV1 } from "@super-restaurant/shared-types";
import { formatMinorUnits } from "./branch-order-work-tray";
import { halfTicketLines } from "./line-halves";

export interface PrintDocument {
  readonly title: string;
  readonly lines: readonly string[];
}

type PrintedPayment = Pick<
  OrderPaymentV1,
  "method" | "amountMinor" | "tipMinor" | "tenderedAmountMinor" | "changeMinor" | "transferReference"
>;

export interface PrintHeader {
  readonly restaurantName: string;
  readonly branchName: string;
}

/** The server's `shortFolio` when present (same first-8-characters rule), else the same derivation from the id. */
const shortFolio = (order: OrderDetailV1) => order.shortFolio ?? order.orderId.slice(0, 8).toUpperCase();
const METHOD_LABELS = { cash: "Efectivo", transfer: "Transferencia", card_manual: "Tarjeta" } as const;
const context = (order: OrderDetailV1): string[] => [
  `Orden ${shortFolio(order)}`,
  `Canal: ${order.fulfillment.channel}`,
  ...(order.tableId === null ? [] : [`Mesa: ${order.tableId}`]),
  ...(order.fulfillment.customerLabel === null ? [] : [`Cliente: ${order.fulfillment.customerLabel}`]),
  ...(order.createdAt === null ? [] : [`Hora: ${new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: order.timeZone }).format(new Date(order.createdAt))}`]),
];

/** `stationId` is read only when the authorized detail projection actually carries it. */
export function buildKitchenDocuments(order: OrderDetailV1): readonly PrintDocument[] {
  const groups = new Map<string, string[]>();
  for (const item of order.items) {
    if (item.status !== "sent" && item.status !== "preparing" && item.status !== "ready" && item.status !== "delivered") continue;
    const stationId = "stationId" in item && typeof item.stationId === "string" ? item.stationId : "Sin estación asignada";
    const lines = groups.get(stationId) ?? [];
    lines.push(`${item.quantity} × ${item.name}${item.variantName ? ` · ${item.variantName}` : ""}`);
    for (const half of item.fractionBreakdown ?? []) {
      const detail = halfTicketLines(half);
      lines.push(detail.title, ...detail.details.map((text) => `  ${text}`));
    }
    lines.push(...item.modifiers.map((modifier) => `  ${modifier.quantity} × ${modifier.name}`));
    if (item.note) lines.push(`Nota: ${item.note}`);
    groups.set(stationId, lines);
  }
  return [...groups].map(([station, lines]) => ({ title: `Comanda · ${station}`, lines: [...context(order), "", ...lines] }));
}

/** Shows only amounts returned by the server. A payment summary represents one captured payment. */
export function buildCustomerTicket(
  order: OrderDetailV1, payments: readonly PaymentCollectionSummaryV1[], header: PrintHeader,
): PrintDocument {
  const money = (minor: number) => formatMinorUnits(minor, order.currency);
  const lines = [header.restaurantName, header.branchName, ...context(order), ""];
  for (const item of order.items) {
    if (item.status === "cancelled") continue;
    lines.push(`${item.quantity} × ${item.name}${item.variantName ? ` · ${item.variantName}` : ""}  ${money(item.lineTotalMinor)}`);
    for (const half of item.fractionBreakdown ?? []) {
      const detail = halfTicketLines(half);
      lines.push(`  ${detail.title}`, ...detail.details.map((text) => `    ${text}`));
    }
    lines.push(...item.modifiers.map((modifier) => `  ${modifier.quantity} × ${modifier.name}`));
  }
  lines.push("", `Productos (IVA incluido si aplica): ${money(order.totals.itemsTotalMinor)}`);
  if (order.totals.deliveryChargeMinor !== 0) lines.push(`Envío: ${money(order.totals.deliveryChargeMinor)}`);
  if (order.totals.tipMinor !== 0) lines.push(`Propina: ${money(order.totals.tipMinor)}`);
  lines.push(`Total: ${money(order.totals.totalMinor)}`);
  const ofOrder = payments.filter((entry) => entry.orderId === order.orderId && entry.scope.branchId === order.scope.branchId && entry.scope.restaurantId === order.scope.restaurantId);
  // The just-collected receipt (it carries the server balance) wins; otherwise the detail's own captured payments.
  const listed: readonly PrintedPayment[] = ofOrder.length > 0 ? ofOrder : order.payments;
  for (const payment of listed) {
    lines.push(`${METHOD_LABELS[payment.method]}: ${money(payment.amountMinor)}`);
    if (payment.tipMinor > 0) lines.push(`Propina del pago: ${money(payment.tipMinor)}`);
    if (payment.tenderedAmountMinor !== null) lines.push(`Recibido: ${money(payment.tenderedAmountMinor)}`);
    if (payment.changeMinor !== null) lines.push(`Cambio: ${money(payment.changeMinor)}`);
    if (payment.transferReference) lines.push(`Referencia: ${payment.transferReference}`);
  }
  // The balance is only ever the server's figure; the detail's payments carry none, so none is derived here.
  const latest = ofOrder.at(-1);
  if (latest !== undefined) lines.push(`Saldo: ${money(latest.remainingBalanceMinor)}`);
  else if (order.payments.length === 0) {
    lines.push(order.shortFolio === null ? "Pagos y saldo no disponibles en este detalle" : "Sin pagos registrados");
  }
  lines.push("", "Gracias");
  return { title: "Ticket de cliente", lines };
}
