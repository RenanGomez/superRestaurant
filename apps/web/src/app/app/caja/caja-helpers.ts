import type { CashPaymentQuoteV1, CashRegisterMovementTypeV1 } from "@super-restaurant/shared-types";

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

/** Fixed peso notes that can cover this balance. Exacto is offered separately. */
export function quickCashAmounts(balanceMinor: number): readonly number[] {
  return [10_000, 20_000, 50_000].filter((amount) => amount >= balanceMinor);
}

export function canCollectPayment(input: {
  readonly quote: CashPaymentQuoteV1 | null;
  readonly balanceMinor: number;
  readonly method: "cash" | "card_manual";
  readonly receivedMinor: number | null;
  readonly tipMinor: number | null;
  readonly terminalId: string;
  readonly reference: string;
  readonly busy: boolean;
}): boolean {
  const { quote, balanceMinor, method, receivedMinor, tipMinor, terminalId, reference, busy } = input;
  if (busy || quote === null || tipMinor === null || quote.amountMinor !== balanceMinor || quote.tipMinor !== tipMinor || quote.method !== method) return false;
  if (method === "cash") return receivedMinor !== null && receivedMinor >= balanceMinor && quote.tenderedAmountMinor === receivedMinor;
  return quote.tenderedAmountMinor === null && terminalId.trim().length > 0 && reference.trim().length >= 6;
}
