import {
  parseAssignDeliveryCommandV1,
  parseBranchDeliveriesRequestV1,
  parseBranchDeliveriesV1,
  parseBranchMembersRequestV1,
  parseBranchMembersV1,
  parseBranchOperationalContextV1,
  parseCashPaymentQuoteV1,
  parseCompleteDeliveryCommandV1,
  parseDispatchDeliveryCommandV1,
  parseFailDeliveryCommandV1,
  parseOrderDeliveryResultV1,
  parseQuoteCashPaymentRequestV1,
  parseSettleDeliveryCommandV1,
  parseSettleDeliveryResultV1,
  type BranchDeliveriesV1,
  type BranchMemberV1,
  type BranchScope,
  type CashPaymentQuoteV1,
  type OrderDeliveryResultV1,
  type SettleDeliveryResultV1,
} from "@super-restaurant/shared-types";

export type DeliveryApiFailure = "conflict" | "invalid" | "not_found" | "unauthorized" | "unavailable";
export type DeliveryApiResult<T> = Readonly<{ status: "ok"; value: T }> | Readonly<{ status: DeliveryApiFailure }>;

export type DeliveryTransitionKind = "assign" | "complete" | "dispatch" | "fail";

export function listDeliveries(token: string, baseUrl: string, scope: BranchScope): Promise<DeliveryApiResult<BranchDeliveriesV1>> {
  const body = parseBranchDeliveriesRequestV1({ schemaVersion: 1, scope });
  if (body === undefined) return Promise.resolve(failure("invalid"));
  return post(token, `${baseUrl}/api/v1/deliveries/list`, body, (raw) => {
    const value = parseBranchDeliveriesV1(raw);
    return value !== undefined && value.scope.restaurantId === scope.restaurantId && value.scope.branchId === scope.branchId ? value : undefined;
  });
}

export async function listCouriers(token: string, baseUrl: string, scope: BranchScope): Promise<DeliveryApiResult<readonly BranchMemberV1[]>> {
  const body = parseBranchMembersRequestV1({ roles: ["courier"], schemaVersion: 1, scope });
  if (body === undefined) return failure("invalid");
  const result = await post(token, `${baseUrl}/api/v1/access/branch-members`, body, (raw) => {
    const value = parseBranchMembersV1(raw);
    return value !== undefined && value.scope.restaurantId === scope.restaurantId && value.scope.branchId === scope.branchId ? value : undefined;
  });
  return result.status === "ok" ? Object.freeze({ status: "ok", value: result.value.members }) : result;
}

export async function readBranchTimeZone(token: string, baseUrl: string, scope: BranchScope): Promise<string | undefined> {
  const result = await post(token, `${baseUrl}/api/v1/access/branch/context`, scope, (raw) => {
    const value = parseBranchOperationalContextV1(raw);
    return value !== undefined && value.scope.restaurantId === scope.restaurantId && value.scope.branchId === scope.branchId ? value.timeZone : undefined;
  });
  return result.status === "ok" ? result.value : undefined;
}

export function transitionDelivery(
  token: string,
  baseUrl: string,
  kind: DeliveryTransitionKind,
  input: unknown,
): Promise<DeliveryApiResult<OrderDeliveryResultV1>> {
  const command = kind === "assign" ? parseAssignDeliveryCommandV1(input)
    : kind === "dispatch" ? parseDispatchDeliveryCommandV1(input)
    : kind === "complete" ? parseCompleteDeliveryCommandV1(input)
    : parseFailDeliveryCommandV1(input);
  return command === undefined
    ? Promise.resolve(failure("invalid"))
    : post(token, `${baseUrl}/api/v1/deliveries/${kind}`, command, parseOrderDeliveryResultV1);
}

export function settleDelivery(token: string, baseUrl: string, input: unknown): Promise<DeliveryApiResult<SettleDeliveryResultV1>> {
  const command = parseSettleDeliveryCommandV1(input);
  return command === undefined
    ? Promise.resolve(failure("invalid"))
    : post(token, `${baseUrl}/api/v1/deliveries/settle`, command, parseSettleDeliveryResultV1);
}

/** Read-only preview: the server derives the change; this client never computes money. */
export async function quoteCashPayment(token: string, baseUrl: string, input: unknown): Promise<CashPaymentQuoteV1 | undefined> {
  const request = parseQuoteCashPaymentRequestV1(input);
  if (request === undefined) return undefined;
  const result = await post(token, `${baseUrl}/api/v1/payments/quote`, request, parseCashPaymentQuoteV1);
  return result.status === "ok" ? result.value : undefined;
}

async function post<T>(
  token: string,
  url: string,
  body: unknown,
  parser: (value: unknown) => T | undefined,
): Promise<DeliveryApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
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

function statusFailure(status: number): DeliveryApiFailure {
  if (status === 400) return "invalid";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "unavailable";
}

function failure(status: DeliveryApiFailure): Readonly<{ status: DeliveryApiFailure }> {
  return Object.freeze({ status });
}
