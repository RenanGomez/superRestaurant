import {
  parseCaptureMutationResultV1,
  parseCreateCaptureDraftCommandV1,
  parseSetCaptureCustomerCommandV1,
  parseSetCaptureFulfillmentCommandV1,
} from "@super-restaurant/shared-types";
export type CaptureRequestResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: "invalid" | "denied" | "conflict" | "missing" | "unavailable" };
export type CaptureOperation = "create" | "customer" | "fulfillment";
const paths = { create: "", customer: "/customer", fulfillment: "/fulfillment" } as const;
const parsers = {
  create: parseCreateCaptureDraftCommandV1,
  customer: parseSetCaptureCustomerCommandV1,
  fulfillment: parseSetCaptureFulfillmentCommandV1,
} as const;
export async function requestCapture(token: string, baseUrl: string, operation: CaptureOperation, input: unknown): Promise<CaptureRequestResult<NonNullable<ReturnType<typeof parseCaptureMutationResultV1>>>> {
  const command = parsers[operation](input as never);
  if (command === undefined) return { ok: false, error: "invalid" };
  try {
    const response = await fetch(`${baseUrl}/api/v1/captures${paths[operation]}`, { method: "POST", cache: "no-store",
      signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command) });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "conflict"
      : response.status === 401 || response.status === 403 ? "denied" : response.status === 404 ? "missing"
        : response.status === 400 ? "invalid" : "unavailable" };
    const value = parseCaptureMutationResultV1(await response.json());
    if (value === undefined || value.detail.scope.restaurantId !== command.scope.restaurantId
      || value.detail.scope.branchId !== command.scope.branchId || value.detail.captureDraftId !== command.captureDraftId
      || value.detail.version !== command.expectedVersion + 1) return { ok: false, error: "unavailable" };
    return { ok: true, value };
  } catch { return { ok: false, error: "unavailable" }; }
}
