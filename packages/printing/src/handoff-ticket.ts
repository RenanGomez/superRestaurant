import type { CalculatedOrderTotals, Order, OrderItem } from "@super-restaurant/domain";
import type { CaptureCustomerSnapshotV1, CaptureFulfillmentSnapshotV1 } from "@super-restaurant/shared-types";
import { EscPosEncoder } from "./escpos.js";

export class UnsupportedCurrencyExponentError extends Error {
  public constructor(currency: string) {
    super(`Printing assumes two decimal places; ${currency} has a different exponent.`);
    this.name = "UnsupportedCurrencyExponentError";
  }
}

/** Amounts remain integer minor units; division by 100 is only for display. */
function formatMinor(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("amountMinor must be a safe integer");
  const formatter = new Intl.NumberFormat("es-MX", { style: "currency", currency });
  if (formatter.resolvedOptions().maximumFractionDigits !== 2) {
    throw new UnsupportedCurrencyExponentError(currency);
  }
  return formatter.format(amountMinor / 100);
}

export interface HandoffTicketInput {
  readonly order: Pick<Order, "orderId" | "channel" | "currency" | "items"> & {
    readonly items: readonly OrderItem[];
  };
  /** Caller supplies the persisted monetary snapshot; this renderer never recalculates it. */
  readonly totals: Pick<CalculatedOrderTotals,
    "subtotalBeforeOrderDiscount" | "lineDiscountTotal" | "orderDiscount" | "total">;
  readonly customer: CaptureCustomerSnapshotV1 | null;
  readonly fulfillment: CaptureFulfillmentSnapshotV1 | null;
  readonly deliveryInstructions: string | null;
  readonly dateIso: string;
  readonly folio?: string;
}

function maskedPhone(value: string): string {
  const digits = value.replace(/\D/gu, "");
  return `***${digits.slice(-4)}`;
}

function addressLines(snapshot: CaptureFulfillmentSnapshotV1): string[] {
  return [
    [snapshot.streetLine, snapshot.unit].filter(Boolean).join(" "),
    [snapshot.locality, snapshot.region, snapshot.postalCode].filter(Boolean).join(", "),
  ].filter(Boolean);
}

/** Deterministic handoff layout from frozen order, customer, fulfillment and totals snapshots. */
export function renderHandoffTicket(input: HandoffTicketInput): Uint8Array {
  const { order, totals } = input;
  const encoder = new EscPosEncoder().init().align("center").bold(true)
    .line(`ENTREGA ${input.folio ?? order.orderId.slice(-8)}`)
    .bold(false).align("left")
    .line(`Canal: ${order.channel}`)
    .line(`Fecha: ${input.dateIso}`);

  if (input.customer !== null) {
    encoder.line(`Cliente: ${input.customer.displayName}`);
    encoder.line(`Tel: ${maskedPhone(input.customer.phoneDisplayValue)}`);
  }
  if (order.channel === "delivery" && input.fulfillment !== null) {
    for (const line of addressLines(input.fulfillment)) encoder.line(line);
  }
  encoder.line("------------------------");
  for (const item of order.items) {
    encoder.line(`${item.quantity} x ${item.snapshot.name}  ${formatMinor(item.snapshot.unitPrice.amountMinor, order.currency)}`);
    for (const modifier of item.snapshot.modifiers) {
      encoder.line(`  + ${modifier.quantity} x ${modifier.name}  ${formatMinor(modifier.unitPrice.amountMinor, order.currency)}`);
    }
  }
  encoder.line("------------------------")
    .line(`Subtotal: ${formatMinor(totals.subtotalBeforeOrderDiscount.amountMinor, order.currency)}`)
    .line(`Descuento líneas: ${formatMinor(totals.lineDiscountTotal.amountMinor, order.currency)}`)
    .line(`Descuento orden: ${formatMinor(totals.orderDiscount.amountMinor, order.currency)}`)
    .bold(true)
    .line(`Total: ${formatMinor(totals.total.amountMinor, order.currency)}`)
    .bold(false);
  if (input.deliveryInstructions) encoder.line(`Instrucciones: ${input.deliveryInstructions}`);
  return encoder.feed(3).cut("partial").bytes();
}
