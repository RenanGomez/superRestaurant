import type { CashPaymentQuoteV1, CashRegisterMovementTypeV1 } from "@super-restaurant/shared-types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function buildReceiptHref(paymentId: string, orderId: string): string | null {
  if (!UUID_PATTERN.test(paymentId) || !UUID_PATTERN.test(orderId)) return null;
  return `/app/caja?receipt=${encodeURIComponent(paymentId)}&orderId=${encodeURIComponent(orderId)}`;
}

export function parseReceiptQuery(params: Readonly<Record<string, string | readonly string[] | undefined>>): {
  readonly paymentId: string;
  readonly orderId: string;
} | null {
  const paymentId = params.receipt;
  const orderId = params.orderId;
  return typeof paymentId === "string" && typeof orderId === "string"
    && UUID_PATTERN.test(paymentId) && UUID_PATTERN.test(orderId)
    ? { paymentId: paymentId.toLowerCase(), orderId: orderId.toLowerCase() } : null;
}

export function movementLabel(type: CashRegisterMovementTypeV1): string {
  return {
    cash_sale: "Venta en efectivo",
    tip_in: "Propina",
    cash_in: "Entrada",
    cash_out: "Salida",
    cash_adjustment: "Ajuste",
    cash_refund: "Reembolso",
  }[type];
}

/** This sum is only an input gate; the server computes and returns the change. */
export function requiredCashTenderMinor(balanceMinor: number, tipMinor: number): number | null {
  const required = balanceMinor + tipMinor;
  return Number.isSafeInteger(required) && required > 0 ? required : null;
}

/** Fixed peso notes that cover the balance and chosen tip. Exacto is offered separately. */
export function quickCashAmounts(balanceMinor: number, tipMinor = 0): readonly number[] {
  const required = requiredCashTenderMinor(balanceMinor, tipMinor);
  return required === null ? [] : [10_000, 20_000, 50_000].filter((amount) => amount >= required);
}

/** The entered payment may cover any positive part of the authoritative remaining balance. */
export function paymentAmountBounds(remainingMinor: number, typedMinor: number | null): typedMinor is number {
  return Number.isSafeInteger(remainingMinor) && remainingMinor > 0
    && typedMinor !== null && Number.isSafeInteger(typedMinor)
    && typedMinor >= 1 && typedMinor <= remainingMinor;
}

export function canCollectPayment(input: {
  readonly quote: CashPaymentQuoteV1 | null;
  readonly remainingMinor: number;
  readonly amountMinor: number | null;
  readonly method: "cash" | "card_manual";
  readonly receivedMinor: number | null;
  readonly tipMinor: number | null;
  readonly terminalId: string;
  readonly reference: string;
  readonly busy: boolean;
}): boolean {
  const { quote, remainingMinor, amountMinor, method, receivedMinor, tipMinor, terminalId, reference, busy } = input;
  if (busy || quote === null || tipMinor === null || !paymentAmountBounds(remainingMinor, amountMinor)
    || quote.amountMinor !== amountMinor || quote.tipMinor !== tipMinor || quote.method !== method) return false;
  if (method === "cash") {
    const required = requiredCashTenderMinor(amountMinor, tipMinor);
    return required !== null && receivedMinor !== null && receivedMinor >= required
      && quote.tenderedAmountMinor === receivedMinor && quote.changeMinor !== null;
  }
  return quote.tenderedAmountMinor === null && terminalId.trim().length > 0 && reference.trim().length >= 6;
}
