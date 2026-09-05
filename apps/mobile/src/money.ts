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
