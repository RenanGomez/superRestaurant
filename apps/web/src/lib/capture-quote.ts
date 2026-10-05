import {
  parseCaptureLineQuoteRequestV1, parseCaptureLineQuoteResultV1,
  type CaptureLineQuoteResultV1,
} from "@super-restaurant/shared-types";
import type { CaptureRequestResult } from "./capture-workspace";

/** A read-only estimate. Invalid or stale responses never become a displayed server price. */
export async function quoteLinePrice(token: string, baseUrl: string, input: unknown): Promise<CaptureRequestResult<CaptureLineQuoteResultV1>> {
  const request = parseCaptureLineQuoteRequestV1(input);
  if (request === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures/line-quote`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied"
        : response.status === 400 ? "invalid" : "unavailable" };
    const value = parseCaptureLineQuoteResultV1(await response.json());
    if (value === undefined || value.catalogVersion !== request.catalogVersion) return { ok: false, error: "unavailable" };
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}

export function visibleLineEstimate(
  localMinor: number | null,
  currentKey: string | null,
  server: { readonly key: string; readonly value: CaptureLineQuoteResultV1 } | null,
): { readonly label: "Estimado" | "Estimado del servidor"; readonly minor: number | null } {
  return currentKey !== null && server?.key === currentKey
    ? { label: "Estimado del servidor", minor: server.value.lineTotalMinor }
    : { label: "Estimado", minor: localMinor };
}
