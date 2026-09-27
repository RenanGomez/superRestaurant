import { parseDeliveryQuoteV1, parseDeliveryZoneListV1, parseListDeliveryZonesQueryV1,
  parseRequestDeliveryQuoteCommandV1, parseUpsertDeliveryZoneCommandV1, parseUpsertDeliveryZoneResultV1,
  type DeliveryQuoteV1, type DeliveryZoneListV1, type UpsertDeliveryZoneResultV1 } from "@super-restaurant/shared-types";

export type DeliveryRequestResult<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly error: "invalid" | "denied" | "missing" | "conflict" | "unavailable" };
export type DeliveryOperation = "list" | "upsert" | "quote";

function canonicalize(input: string, maxLength: number): string[] {
  if (typeof input !== "string") return [];
  const entries = input.split(/[,\n]/u).map((value) => value.trim()).filter(Boolean);
  if (entries.length > 500 || entries.some((value) => value.length > maxLength || /[\p{Cc}\p{Cf}]/u.test(value))) return [];
  return [...new Set(entries)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function canonicalizePostalCodes(input: string): string[] { return canonicalize(input, 32); }
export function canonicalizeLocalities(input: string): string[] { return canonicalize(input, 200); }

/** Converts a decimal field to minor units without floating point arithmetic. */
export function parseDeliveryFeeMinor(input: string): number | undefined {
  if (!/^\d+(?:\.\d{1,2})?$/u.test(input)) return undefined;
  const [whole = "", fractional = ""] = input.split(".");
  const amount = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : undefined;
}

export function formatDeliveryQuote(quote: DeliveryQuoteV1, locale: string): { status: string; fee: string; window: string; expiry: string } {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: quote.timeZone });
  const fee = new Intl.NumberFormat(locale, { style: "currency", currency: quote.currency }).format((quote.override?.feeMinor ?? quote.feeMinor) / 100);
  return {
    status: quote.coverageStatus === "covered" ? "Con cobertura" : "Fuera de cobertura",
    fee,
    window: `${date.format(new Date(quote.override?.promiseStart ?? quote.promiseStart))} – ${date.format(new Date(quote.override?.promiseEnd ?? quote.promiseEnd))}`,
    expiry: date.format(new Date(quote.expiresAt)),
  };
}

/** A quote belongs only to the currently displayed Capture address snapshot. */
export function quoteMatchesDeliverySnapshot(
  quote: DeliveryQuoteV1,
  captureDraftId: string | undefined,
  fulfillmentSnapshotRef: string | null | undefined,
): boolean {
  return captureDraftId !== undefined && fulfillmentSnapshotRef != null
    && quote.captureDraftId === captureDraftId && quote.addressSnapshotRef === fulfillmentSnapshotRef;
}

export async function requestDelivery(token: string, baseUrl: string, operation: DeliveryOperation, input: unknown):
  Promise<DeliveryRequestResult<DeliveryZoneListV1 | UpsertDeliveryZoneResultV1 | DeliveryQuoteV1>> {
  const listCommand = operation === "list" ? parseListDeliveryZonesQueryV1(input) : undefined;
  const upsertCommand = operation === "upsert" ? parseUpsertDeliveryZoneCommandV1(input) : undefined;
  const quoteCommand = operation === "quote" ? parseRequestDeliveryQuoteCommandV1(input) : undefined;
  const command = listCommand ?? upsertCommand ?? quoteCommand;
  if (command === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/delivery-zones/${operation}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command),
    });
    if (!response.ok) return { ok: false, error: response.status === 400 ? "invalid"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 409 ? "conflict" : "unavailable" };
    const body: unknown = await response.json();
    if (operation === "list") {
      const value = parseDeliveryZoneListV1(body);
      if (value === undefined || listCommand === undefined || listCommand.scope.restaurantId !== value.scope.restaurantId
        || listCommand.scope.kind !== value.scope.kind || (listCommand.scope.kind === "branch"
          && (value.scope.kind !== "branch" || listCommand.scope.branchId !== value.scope.branchId))) return { ok: false, error: "unavailable" };
      return { ok: true, value };
    }
    if (operation === "upsert") {
      const value = parseUpsertDeliveryZoneResultV1(body);
      if (value === undefined || upsertCommand === undefined || value.zone.zoneId !== upsertCommand.zoneId
        || value.zone.restaurantId !== upsertCommand.scope.restaurantId || value.zone.branchId !== upsertCommand.scope.branchId
        || value.zone.version !== upsertCommand.expectedVersion + 1) return { ok: false, error: "unavailable" };
      return { ok: true, value };
    }
    const value = parseDeliveryQuoteV1(body);
    if (value === undefined || quoteCommand === undefined || value.restaurantId !== quoteCommand.scope.restaurantId
      || value.branchId !== quoteCommand.scope.branchId || value.captureDraftId !== quoteCommand.captureDraftId
      || value.scheduledFor !== quoteCommand.scheduledFor) return { ok: false, error: "unavailable" };
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}
