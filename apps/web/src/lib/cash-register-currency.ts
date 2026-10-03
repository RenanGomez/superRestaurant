import { DEFAULT_PESO_CURRENCY } from "./capture-payment";
import { currencyFractionDigits } from "./money-scale";

export type RegisterCurrencyResolution =
  | { readonly status: "ok"; readonly currency: string }
  | { readonly status: "mixed" }
  | { readonly status: "unsupported" };

/** Open payable orders outrank the current catalog because their currency is frozen.
 * More than one order currency blocks opening; a newly published catalog cannot rewrite history.
 * With no payable orders, use the catalog, then the fixed MXN fallback. */
export function resolveRegisterCurrency(
  orderCurrencies: readonly string[], catalogCurrency: string | null,
): RegisterCurrencyResolution {
  const distinct = new Set(orderCurrencies);
  if (distinct.size > 1) return { status: "mixed" };
  const currency = distinct.values().next().value ?? catalogCurrency ?? DEFAULT_PESO_CURRENCY;
  return currencyFractionDigits(currency) === null ? { status: "unsupported" } : { status: "ok", currency };
}
