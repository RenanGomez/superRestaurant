import type { CapturePaymentIntentMethodV1, CapturePaymentIntentTimingV1 } from "@super-restaurant/shared-types";

const moneyInputPattern = /^\d{1,7}([.,]\d{1,2})?$/u;

/**
 * Parses a free-text cash-tender field into exact minor units, or `null` if it is not a valid
 * amount. Accepts only whole pesos with up to two optional decimal digits (comma or dot as the
 * separator) -- never a locale-dependent, partial-prefix parse like `Number.parseFloat`, which
 * would silently accept `"10abc"` or round away a third decimal digit. All arithmetic here is
 * integer-only (no float), matching how every other money figure in this app is minor units.
 */
export function parseMoneyInputToMinor(text: string): number | null {
  const trimmed = text.trim();
  if (!moneyInputPattern.test(trimmed)) return null;
  const separatorIndex = trimmed.search(/[.,]/u);
  const wholePart = separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex);
  const fractionPart = (separatorIndex === -1 ? "" : trimmed.slice(separatorIndex + 1)).padEnd(2, "0");
  const wholeMinor = Number.parseInt(wholePart, 10) * 100;
  const fractionMinor = Number.parseInt(fractionPart, 10);
  const totalMinor = wholeMinor + fractionMinor;
  return Number.isSafeInteger(totalMinor) ? totalMinor : null;
}

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
