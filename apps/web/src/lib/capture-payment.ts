import type { CapturePaymentIntentMethodV1, CapturePaymentIntentTimingV1 } from "@super-restaurant/shared-types";

/**
 * Suggested cash tender amounts for a given authoritative total (minor units): the exact total,
 * plus the next round 100/200/500 (pesos) above it that is strictly greater than the total --
 * duplicates and non-strictly-greater roundings are dropped, so "Exacto" never repeats among the
 * shortcuts and every shortcut is either the exact total or unambiguously "with change". These
 * are input shortcuts only: the server (`paymentProjection.changeDueMinor`) always computes the
 * actual change, never this helper.
 */
export function suggestTenderAmounts(totalMinor: number): readonly number[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) return [];
  const roundings = [10_000, 20_000, 50_000] as const; // 100/200/500 MXN pesos in minor units
  const suggestions = [totalMinor];
  for (const rounding of roundings) {
    const roundedUp = Math.ceil(totalMinor / rounding) * rounding;
    // A rounding that lands exactly on the total is not a distinct shortcut from "Exacto".
    if (roundedUp > totalMinor && !suggestions.includes(roundedUp)) suggestions.push(roundedUp);
  }
  return Object.freeze(suggestions);
}

/**
 * Human-readable method label and a short warning matching the prototype's per-method notice:
 * cash warns "against delivery"/"at the counter" depending on server-derived timing, card is
 * always settled manually at handoff, and transfer is always pending evidence. Purely
 * descriptive; never decides eligibility or amounts.
 */
export interface DescribedPaymentMethod {
  readonly label: string;
  readonly notice: string;
}

export function describePaymentMethod(
  method: CapturePaymentIntentMethodV1,
  timing: CapturePaymentIntentTimingV1,
): DescribedPaymentMethod {
  if (method === "cash") {
    return {
      label: "Efectivo",
      notice: timing === "on_fulfillment" ? "Cobro contra entrega" : "Cobro en mostrador",
    };
  }
  if (method === "card_manual") {
    return { label: "Tarjeta", notice: "Se liquida con terminal manual al entregar" };
  }
  return { label: "Transferencia", notice: "Pendiente de evidencia de pago" };
}
