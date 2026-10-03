/** Currencies whose minor-unit scale this web client can capture and display exactly. */
const FRACTION_DIGITS: Readonly<Record<string, number>> = Object.freeze({
  CAD: 2, EUR: 2, JPY: 0, MXN: 2, USD: 2,
});

export function currencyFractionDigits(currency: string): number | null {
  return Object.hasOwn(FRACTION_DIGITS, currency) ? FRACTION_DIGITS[currency] ?? null : null;
}
