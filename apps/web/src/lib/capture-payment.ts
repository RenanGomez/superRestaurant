import type {
  CaptureFulfillmentChannelV1, CapturePaymentIntentMethodV1, CapturePaymentIntentProjectionV1,
  CapturePaymentIntentTimingV1, DeliveryQuoteV1,
} from "@super-restaurant/shared-types";
import { currencyFractionDigits } from "./money-scale";

/** Peso-only fallback while a restaurant has no published menu currency. */
export const DEFAULT_PESO_CURRENCY = "MXN";

/**
 * Parses a free-text amount into exact minor units, or `null` if it is not a valid
 * amount. Accepts whole units with at most the currency's decimal digits (comma or dot as the
 * separator) -- never a locale-dependent, partial-prefix parse like `Number.parseFloat`, which
 * would silently accept `"10abc"` or round away a third decimal digit. All arithmetic here is
 * integer-only (no float), matching how every other money figure in this app is minor units.
 * The result must fit in a safe integer because that is the API contract for minor units.
 * An absent fraction (e.g. "10") counts as zero minor units; the empty slice is
 * padded to the selected scale before parsing.
 */
export function parseMoneyInputToMinor(text: string, currency: string): number | null {
  const digits = currencyFractionDigits(currency);
  if (digits === null) return null;
  const trimmed = text.trim();
  const pattern = digits === 0 ? /^\d+$/u : new RegExp(`^\\d+([.,]\\d{1,${digits}})?$`, "u");
  if (!pattern.test(trimmed)) return null;
  const separatorIndex = trimmed.search(/[.,]/u);
  const wholePart = separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex);
  const fractionPart = (separatorIndex === -1 ? "" : trimmed.slice(separatorIndex + 1)).padEnd(digits, "0");
  const scale = 10n ** BigInt(digits);
  const totalMinor = BigInt(wholePart) * scale + BigInt(fractionPart || "0");
  return totalMinor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(totalMinor) : null;
}

/** Exact plain text for an editable amount, without grouping or a currency symbol. */
export function formatMinorForMoneyInput(amountMinor: number, currency: string): string | null {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError("Invalid money amount");
  const digits = currencyFractionDigits(currency);
  if (digits === null) return null;
  const minor = BigInt(amountMinor);
  const scale = 10n ** BigInt(digits);
  return digits === 0 ? minor.toString() : `${minor / scale}.${(minor % scale).toString().padStart(digits, "0")}`;
}

/**
 * Suggested cash tender amounts for a given authoritative total (minor units): the exact total,
 * plus the next round 100/200/500 major units above it that is strictly greater than the total --
 * duplicates and non-strictly-greater roundings are dropped, so "Exacto" never repeats among the
 * shortcuts and every shortcut is either the exact total or unambiguously "with change". These
 * are input shortcuts only: the server (`paymentProjection.changeDueMinor`) always computes the
 * actual change, never this helper.
 */
export function suggestTenderAmounts(totalMinor: number, currency: string): readonly number[] {
  const digits = currencyFractionDigits(currency);
  if (digits === null || !Number.isSafeInteger(totalMinor) || totalMinor < 0) return [];
  const scale = 10n ** BigInt(digits);
  const total = BigInt(totalMinor);
  const suggestions = [totalMinor];
  for (const major of [100n, 200n, 500n]) {
    const rounding = major * scale;
    const roundedUp = ((total + rounding - 1n) / rounding) * rounding;
    // A rounding that lands exactly on the total is not a distinct shortcut from "Exacto".
    if (roundedUp > total && roundedUp <= BigInt(Number.MAX_SAFE_INTEGER)) {
      const amount = Number(roundedUp);
      if (!suggestions.includes(amount)) suggestions.push(amount);
    }
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

/**
 * H20: true when a payment intent is set but confirm cannot possibly accept it as-is -- either
 * the server reports it explicitly stale/insufficient, or (both plans cleared/absent, so no
 * currency/pricing basis can even be established) it reads back as no projection at all. The
 * latter must block exactly like "stale": the API's own confirm guard and SQL's
 * payment_intent_stale check both refuse it, so treating a null projection as "nothing to check
 * yet" would let the operator hit a doomed confirm.
 */
export function paymentIntentBlocksConfirm(
  paymentIntent: unknown,
  paymentProjection: Pick<CapturePaymentIntentProjectionV1, "status"> | null,
): boolean {
  if (paymentIntent === null || paymentIntent === undefined) return false;
  return paymentProjection === null
    || paymentProjection.status === "stale" || paymentProjection.status === "insufficient";
}

export type DeliveryQuoteBlockReason = "missing" | "not_covered" | "expired" | "time_mismatch" | null;

/**
 * H21: the confirm guard for a delivery capture previously only compared the requested time
 * (`quoteMatchesRequestedTime`), so an absent, uncovered, or already-expired quote left the
 * confirm button enabled and let the operator hit a doomed submit. Returns the specific reason
 * (or `null` when nothing blocks) so the UI can show it and offer "Cotizar entrega":
 * - `"missing"`: no frozen quote at all yet;
 * - `"not_covered"`: the server never found coverage for the address;
 * - `"expired"`: the quote's own `expiresAt` has passed by `now` -- a client-side clock is only
 *   ever a courtesy warning here; the server is still the one that actually enforces expiry (H14);
 * - `"time_mismatch"`: the quote is for a different scheduled time than the field currently reads.
 * Precedence is missing > not_covered > expired > time_mismatch, matching how each fact would
 * independently be reported by the server if it were the one refusing confirm.
 */
export function deliveryQuoteBlocksConfirm(
  fulfillmentChannel: CaptureFulfillmentChannelV1 | null,
  quote: DeliveryQuoteV1 | null,
  scheduledFor: string,
  now: Date,
): DeliveryQuoteBlockReason {
  if (fulfillmentChannel !== "delivery") return null;
  if (quote === null) return "missing";
  if (quote.coverageStatus === "not_covered") return "not_covered";
  if (Date.parse(quote.expiresAt) <= now.getTime()) return "expired";
  if (!quoteMatchesRequestedTime(quote, scheduledFor)) return "time_mismatch";
  return null;
}

/**
 * H24: "Otro monto" fires on blur, Enter, AND the "Aplicar" button -- pressing Enter already
 * applies the value, so the blur that immediately follows must not resend the identical amount
 * (a redundant version bump that can stomp a tip/method change made in between). True only when
 * the parsed amount is neither the last amount this field actually applied nor the tender the
 * server's current intent already carries -- either means there is nothing new to send.
 *
 * H30: `appliedMinor` is meant to catch ONLY that brief same-cycle double-send, never to
 * permanently block a since-superseded amount. The caller is responsible for keeping it in sync
 * with the server's own current tender (e.g. resetting/re-syncing it whenever that tender changes
 * for any other reason, such as a suggestion chip or a method switch) -- a stale `appliedMinor`
 * that no longer reflects `currentIntentMinor` must never be trusted to block a resend.
 */
export function shouldSubmitTender(
  parsedMinor: number | null,
  appliedMinor: number | null,
  currentIntentMinor: number | null,
): boolean {
  return parsedMinor !== null && parsedMinor !== appliedMinor && parsedMinor !== currentIntentMinor;
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
