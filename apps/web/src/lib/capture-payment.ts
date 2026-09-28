import type { CapturePaymentIntentMethodV1, CapturePaymentIntentTimingV1, DeliveryQuoteV1 } from "@super-restaurant/shared-types";

const moneyInputPattern = /^\d{1,7}([.,]\d{1,2})?$/u;

/**
 * Parses a free-text cash-tender field into exact minor units, or `null` if it is not a valid
 * amount. Accepts only whole pesos with up to two optional decimal digits (comma or dot as the
 * separator) -- never a locale-dependent, partial-prefix parse like `Number.parseFloat`, which
 * would silently accept `"10abc"` or round away a third decimal digit. All arithmetic here is
 * integer-only (no float), matching how every other money figure in this app is minor units.
 * H12 note: an absent fraction (no "." or ",", e.g. "10") must count as ".00", not `NaN` -- the
 * `padEnd(2, "0")` below turns the empty slice into "00" before parsing, so this already covers
 * it; the dedicated regression test locks that in explicitly.
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

/**
 * True when a frozen `DeliveryQuoteV1` is still the quote for the currently-entered scheduled
 * delivery time -- a fact derived from the server's own `quote.scheduledFor`, never from local
 * state that a later, unrelated mutation (e.g. fixing the payment intent) could silently clear.
 * `scheduledFor` is the raw `datetime-local` input value ("" means "as soon as possible"). A
 * malformed value never matches: it is treated the same as an actually-different time, so confirm
 * stays blocked until the operator either fixes the field or re-quotes.
 */
export function quoteMatchesRequestedTime(quote: DeliveryQuoteV1 | null, scheduledFor: string): boolean {
  if (quote === null) return true;
  if (scheduledFor === "") return quote.scheduledFor === null;
  const parsed = new Date(scheduledFor);
  if (!Number.isFinite(parsed.getTime())) return false;
  return quote.scheduledFor === parsed.toISOString();
}

/**
 * H15: the `datetime-local` scheduled-for input's expected value ("YYYY-MM-DDTHH:mm", in the
 * browser's local time zone -- the inverse of `requestDeliveryQuote`'s `new Date(scheduledFor)`)
 * for a rehydrated capture's frozen delivery quote, or `""` when there is nothing to prefill
 * (no quote, or an immediate/ASAP quote with `scheduledFor` null). Pure so the rehydration
 * behavior is unit-testable without mounting the workspace component.
 */
export function deliveryQuoteScheduledForInputValue(quote: DeliveryQuoteV1 | null): string {
  if (quote === null || quote.scheduledFor === null) return "";
  const parsed = new Date(quote.scheduledFor);
  if (!Number.isFinite(parsed.getTime())) return "";
  const pad = (value: number): string => value.toString(10).padStart(2, "0");
  const year = parsed.getFullYear().toString(10).padStart(4, "0");
  const month = pad(parsed.getMonth() + 1);
  const day = pad(parsed.getDate());
  const hours = pad(parsed.getHours());
  const minutes = pad(parsed.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * H17: true when a workspace hydration is switching to a DIFFERENT capture than the one
 * currently on screen (not the initial load, and not a re-hydration of the same capture after
 * an unrelated mutation) -- the signal `applyWorkspace` uses to clear capture-local-only UI state
 * (the scheduled-for field, the stale-quote flag, the cash-tender notice, any leftover error)
 * before applying the new capture's own facts, so nothing from the capture the operator just
 * left leaks onto the one they just opened.
 */
export function isSwitchingToAnotherCapture(
  previousCaptureDraftId: string | undefined,
  nextCaptureDraftId: string,
): boolean {
  return previousCaptureDraftId !== undefined && previousCaptureDraftId !== nextCaptureDraftId;
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
