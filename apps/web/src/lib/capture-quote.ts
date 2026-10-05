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
    if (!response.ok) {
      if (response.status === 409) {
        let code: string | undefined;
        try {
          const body: unknown = await response.json();
          if (typeof body === "object" && body !== null && "code" in body && "reason" in body
            && body.code === "CAPTURE_LINE_QUOTE_REJECTED" && body.reason === "catalog_version_mismatch") {
            code = "catalog_version_mismatch";
          }
        } catch { /* A non-JSON conflict remains a generic conflict. */ }
        return { ok: false, error: "conflict", ...(code === undefined ? {} : { code }) };
      }
      return { ok: false, error: response.status === 401 || response.status === 403 ? "denied"
        : response.status === 400 ? "invalid" : "unavailable" };
    }
    const value = parseCaptureLineQuoteResultV1(await response.json());
    if (value === undefined || value.catalogVersion !== request.catalogVersion) return { ok: false, error: "unavailable" };
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}

export function visibleLineEstimate(
  localMinor: number | null,
  currentKey: string | null,
  server: { readonly key: string; readonly value: CaptureLineQuoteResultV1 } | null,
): { readonly label: "Estimado" | "Estimado del servidor"; readonly minor: number | null; readonly taxMinor: number | null } {
  return currentKey !== null && server?.key === currentKey
    ? { label: "Estimado del servidor", minor: server.value.lineTotalMinor, taxMinor: server.value.taxMinor }
    : { label: "Estimado", minor: localMinor, taxMinor: null };
}
