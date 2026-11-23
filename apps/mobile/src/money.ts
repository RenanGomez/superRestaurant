/**
 * Money rendering for the mobile client.
 *
 * Amounts always arrive as integers in the currency's minor unit together with
 * the ISO code the contract carries; this module never assumes a currency,
 * a minor-unit exponent, a locale or a symbol, and never converts to float.
 * Grouping is implemented locally instead of through `Intl` so the rendered
 * string is identical on Hermes, on web and in tests.
 */
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const FRACTION_DIGITS: Readonly<Record<string, number>> = Object.freeze({
  CAD: 2, EUR: 2, JPY: 0, MXN: 2, USD: 2, XTS: 2,
});

/** Exact BigInt parser from major-unit text (e.g. "125.50") to minor units; never uses float. */
export function parseMinorUnitsInput(text: string, currency: string): number | null {
  if (!Object.hasOwn(FRACTION_DIGITS, currency)) return null;
  const digits = FRACTION_DIGITS[currency];
  if (digits === undefined) return null;
  const trimmed = text.trim();
  const pattern = digits === 0 ? /^\d+$/u : new RegExp(`^\\d+([.,]\\d{1,${digits}})?$`, "u");
  if (!pattern.test(trimmed)) return null;
  const sep = trimmed.search(/[.,]/u);
  const whole = sep === -1 ? trimmed : trimmed.slice(0, sep);
  const frac = (sep === -1 ? "" : trimmed.slice(sep + 1)).padEnd(digits, "0");
  const total = BigInt(whole) * (10n ** BigInt(digits)) + BigInt(frac || "0");
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

/** Formats non-negative minor units into plain editable text using BigInt only (no float). */
export function formatMinorUnitsInput(amountMinor: number, currency: string): string | null {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Object.hasOwn(FRACTION_DIGITS, currency)) return null;
  const digits = FRACTION_DIGITS[currency];
  if (digits === undefined) return null;
  const minor = BigInt(amountMinor);
  const scale = 10n ** BigInt(digits);
  return digits === 0 ? minor.toString() : `${minor / scale}.${(minor % scale).toString().padStart(digits, "0")}`;
}

/** Renders `1234, "MXN"` as `"1,234 u.m. · MXN"`, matching the web client. */
export function formatMinorAmount(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || !CURRENCY_PATTERN.test(currency)) {
    throw new Error("MOBILE_MONEY_INVALID");
  }
  return `${groupMinorUnits(amountMinor)} u.m. · ${currency}`;
}

/**
 * Renders one amount for a screen, never guessing: an amount or a currency the
 * contract did not deliver cleanly is reported as unavailable instead of being
 * rounded, converted or given a default code.
 */
export function renderMinorAmount(amountMinor: number, currency: string): string {
  return isRenderableMinorAmount(amountMinor, currency)
    ? formatMinorAmount(amountMinor, currency)
    : "Precio no disponible";
}

/** True when a value can be rendered by {@link formatMinorAmount}. */
export function isRenderableMinorAmount(amountMinor: unknown, currency: unknown): boolean {
  return typeof amountMinor === "number" && Number.isSafeInteger(amountMinor)
    && typeof currency === "string" && CURRENCY_PATTERN.test(currency);
}

function groupMinorUnits(amountMinor: number): string {
  const negative = amountMinor < 0;
  const digits = Math.abs(amountMinor).toString();
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    const remaining = digits.length - index;
    grouped += digits[index];
    if (remaining > 1 && remaining % 3 === 1) grouped += ",";
  }
  return negative ? `-${grouped}` : grouped;
}
