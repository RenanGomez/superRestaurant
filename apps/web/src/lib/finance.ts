import {
  parseCashRegisterOperationalReportV1,
  parseCashRegisterReportQueryV1,
  parseCashRegisterSummaryV1,
  parseCheckoutOrderQueryV1,
  parseCheckoutOrderSummaryV1,
  parseCloseCashRegisterCommandV1,
  parseCollectPaymentCommandV1,
  parseOpenCashRegisterCommandV1,
  parsePaymentCollectionSummaryV1,
  type CashRegisterOperationalReportV1,
  type CashRegisterReportQueryV1,
  type CashRegisterSummaryV1,
  type CheckoutOrderSummaryV1,
  type CloseCashRegisterCommandV1,
  type CollectPaymentCommandV1,
  type OpenCashRegisterCommandV1,
  type PaymentCollectionSummaryV1,
} from "@super-restaurant/shared-types";

export type FinancialApiFailure = "conflict" | "invalid" | "not_found" | "unauthorized" | "unavailable";
export type FinancialApiResult<T> = Readonly<{ status: "ok"; value: T }> | Readonly<{ status: FinancialApiFailure }>;

export function getCashRegisterReport(
  accessToken: string,
  apiBaseUrl: string,
  input: unknown,
): Promise<FinancialApiResult<CashRegisterOperationalReportV1>> {
  const query = parseCashRegisterReportQueryV1(input);
  if (query === undefined) return Promise.resolve(failure("invalid"));
  return request(accessToken, `${apiBaseUrl}/api/v1/cash-registers/report?${reportParams(query)}`, "GET", undefined, parseCashRegisterOperationalReportV1);
}

export function getCheckoutOrder(
  accessToken: string,
  apiBaseUrl: string,
  input: unknown,
): Promise<FinancialApiResult<CheckoutOrderSummaryV1>> {
  const query = parseCheckoutOrderQueryV1(input);
  if (query === undefined) return Promise.resolve(failure("invalid"));
  const params = new URLSearchParams({
    branchId: query.scope.branchId,
    cashRegisterSessionId: query.cashRegisterSessionId,
    deviceId: query.deviceId,
    orderId: query.orderId,
    registerId: query.registerId,
    restaurantId: query.scope.restaurantId,
  });
  return request(accessToken, `${apiBaseUrl}/api/v1/payments/checkout?${params}`, "GET", undefined, parseCheckoutOrderSummaryV1);
}

export function openCashRegister(
  accessToken: string,
  apiBaseUrl: string,
  input: unknown,
): Promise<FinancialApiResult<CashRegisterSummaryV1>> {
  const command = parseOpenCashRegisterCommandV1(input);
  return command === undefined
    ? Promise.resolve(failure("invalid"))
    : request(accessToken, `${apiBaseUrl}/api/v1/cash-registers/open`, "POST", command, parseCashRegisterSummaryV1);
}

export function collectPayment(
  accessToken: string,
  apiBaseUrl: string,
  input: unknown,
): Promise<FinancialApiResult<PaymentCollectionSummaryV1>> {
  const command = parseCollectPaymentCommandV1(input);
  return command === undefined
    ? Promise.resolve(failure("invalid"))
    : request(accessToken, `${apiBaseUrl}/api/v1/payments/collect`, "POST", command, parsePaymentCollectionSummaryV1);
}

export function closeCashRegister(
  accessToken: string,
  apiBaseUrl: string,
  input: unknown,
): Promise<FinancialApiResult<CashRegisterSummaryV1>> {
  const command = parseCloseCashRegisterCommandV1(input);
  return command === undefined
    ? Promise.resolve(failure("invalid"))
    : request(accessToken, `${apiBaseUrl}/api/v1/cash-registers/close`, "POST", command, parseCashRegisterSummaryV1);
}

function reportParams(query: CashRegisterReportQueryV1): URLSearchParams {
  const params = new URLSearchParams({
    branchId: query.scope.branchId,
    deviceId: query.deviceId,
    registerId: query.registerId,
    restaurantId: query.scope.restaurantId,
  });
  if (query.cashRegisterSessionId !== null) params.set("cashRegisterSessionId", query.cashRegisterSessionId);
  return params;
}

async function request<T>(
  accessToken: string,
  url: string,
  method: "GET" | "POST",
  body: CloseCashRegisterCommandV1 | CollectPaymentCommandV1 | OpenCashRegisterCommandV1 | undefined,
  parser: (value: unknown) => T | undefined,
): Promise<FinancialApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      method,
    });
  } catch {
    return failure("unavailable");
  }
  if (!response.ok) return failure(statusFailure(response.status));
  try {
    const value = parser(await response.json());
    return value === undefined ? failure("unavailable") : Object.freeze({ status: "ok", value });
  } catch {
    return failure("unavailable");
  }
}

function statusFailure(status: number): FinancialApiFailure {
  if (status === 400) return "invalid";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "unavailable";
}

function failure(status: FinancialApiFailure): Readonly<{ status: FinancialApiFailure }> {
  return Object.freeze({ status });
}
