import {
  parseCustomerRecentOrderListV1,
  parseCustomerRecentOrdersQueryV1,
  parseCustomerRepeatOrderCaptureResultV1,
  parseCustomerRepeatOrderPreviewQueryV1,
  parseCustomerRepeatOrderPreviewV1,
  parseRepeatCustomerOrderIntoCaptureCommandV1,
  type CustomerRecentOrderListV1,
  type CustomerRecentOrderItemV1,
  type CustomerRepeatOrderCaptureResultV1,
  type CustomerRepeatOrderPreviewV1,
} from "@super-restaurant/shared-types";

export type CustomerOrderOperation = "recentOrders" | "repeatOrder" | "repeatPreview";
export type CustomerOrderResult = CustomerRecentOrderListV1 | CustomerRepeatOrderCaptureResultV1
  | CustomerRepeatOrderPreviewV1;
export type CustomerOrderRequestResult = Readonly<{ ok: true; value: CustomerOrderResult }>
  | Readonly<{ ok: false; error: "conflict" | "denied" | "invalid" | "missing" | "unavailable" }>;

export function countOrderArticles(items: readonly Pick<CustomerRecentOrderItemV1, "quantity">[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export async function requestCustomerOrder(
  token: string,
  baseUrl: string,
  operation: CustomerOrderOperation,
  input: unknown,
): Promise<CustomerOrderRequestResult> {
  try {
    if (operation === "recentOrders") {
      const parsed = parseCustomerRecentOrdersQueryV1(input);
      if (parsed === undefined) return { error: "invalid", ok: false };
      const url = scopedUrl(baseUrl, `/api/v1/customers/${encodeURIComponent(parsed.customerId)}/orders/recent`, parsed.scope);
      url.searchParams.set("limit", String(parsed.limit));
      const response = await get(token, url);
      if (!response.ok) return failure(response.status);
      const value = parseCustomerRecentOrderListV1(await response.json());
      if (value === undefined || !sameScope(value.scope, parsed.scope) || value.customerId !== parsed.customerId
        || value.orders.length > parsed.limit) return { error: "unavailable", ok: false };
      return { ok: true, value };
    }
    if (operation === "repeatPreview") {
      const parsed = parseCustomerRepeatOrderPreviewQueryV1(input);
      if (parsed === undefined) return { error: "invalid", ok: false };
      const path = `/api/v1/customers/${encodeURIComponent(parsed.customerId)}/orders/${encodeURIComponent(parsed.orderId)}/repeat-preview`;
      const response = await get(token, scopedUrl(baseUrl, path, parsed.scope));
      if (!response.ok) return failure(response.status);
      const value = parseCustomerRepeatOrderPreviewV1(await response.json());
      if (value === undefined || !sameScope(value.scope, parsed.scope) || value.customerId !== parsed.customerId
        || value.sourceOrderId !== parsed.orderId) return { error: "unavailable", ok: false };
      return { ok: true, value };
    }
    const parsed = parseRepeatCustomerOrderIntoCaptureCommandV1(input);
    if (parsed === undefined) return { error: "invalid", ok: false };
    const path = `/api/v1/customers/${encodeURIComponent(parsed.customerId)}/orders/${encodeURIComponent(parsed.sourceOrderId)}/repeat`;
    const response = await fetch(new URL(path, `${baseUrl}/`), {
      body: JSON.stringify(parsed), cache: "no-store", headers: {
        authorization: `Bearer ${token}`, "content-type": "application/json",
      }, method: "POST", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return failure(response.status);
    const value = parseCustomerRepeatOrderCaptureResultV1(await response.json());
    if (value === undefined || !sameScope(value.preview.scope, parsed.scope)
      || value.preview.customerId !== parsed.customerId || value.preview.sourceOrderId !== parsed.sourceOrderId
      || value.capture.detail.captureDraftId !== parsed.captureDraftId
      || value.capture.detail.version !== parsed.expectedVersion + 1
      || !sameScope(value.capture.detail.scope, parsed.scope)) return { error: "unavailable", ok: false };
    return { ok: true, value };
  } catch { return { error: "unavailable", ok: false }; }
}

function scopedUrl(baseUrl: string, path: string, scope: Readonly<{ restaurantId: string; branchId: string }>): URL {
  const url = new URL(path, `${baseUrl}/`);
  url.searchParams.set("restaurantId", scope.restaurantId);
  url.searchParams.set("branchId", scope.branchId);
  return url;
}

function get(token: string, url: URL): Promise<Response> {
  return fetch(url, { cache: "no-store", headers: { authorization: `Bearer ${token}` }, method: "GET",
    signal: AbortSignal.timeout(10_000) });
}

function sameScope(
  value: Readonly<{ restaurantId: string; branchId: string }>,
  expected: Readonly<{ restaurantId: string; branchId: string }>,
): boolean {
  return value.restaurantId === expected.restaurantId && value.branchId === expected.branchId;
}

function failure(status: number): CustomerOrderRequestResult {
  return { ok: false, error: status === 409 ? "conflict"
    : status === 401 || status === 403 ? "denied"
      : status === 404 ? "missing" : status === 400 ? "invalid" : "unavailable" };
}
