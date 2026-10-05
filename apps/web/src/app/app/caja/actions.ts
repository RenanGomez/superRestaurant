"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { parseCashPaymentQuoteV1, type BranchOrderWorkCursorV1, type BranchScope } from "@super-restaurant/shared-types";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { isPayableBranchOrderWorkStatus, requestBranchOrderWorkTray } from "../../../lib/branch-order-work-tray";
import { resolveRegisterCurrency } from "../../../lib/cash-register-currency";
import { parseMoneyInputToMinor } from "../../../lib/capture-payment";
import {
  closeCashRegister,
  collectPayment,
  getCashRegisterReport,
  getCheckoutOrder,
  openCashRegister,
  type FinancialApiFailure,
} from "../../../lib/finance";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { getMenuCatalog } from "../../../lib/menu-catalog";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { CASH_REGISTER_COOKIE, CASH_REGISTER_SESSION_COOKIE, DEVICE_COOKIE } from "./context";

export async function openCashRegisterAction(formData: FormData): Promise<void> {
  const context = await getAuthorizedContext();
  const orderCurrencies = await readPayableOrderCurrencies(context);
  if (orderCurrencies === undefined) redirect("/app/caja?cashError=unavailable");
  const catalog = orderCurrencies.length === 0
    ? await getMenuCatalog(context.accessToken, context.apiBaseUrl, context.scope) : null;
  if (catalog === undefined) redirect("/app/caja?cashError=unavailable");
  const resolution = resolveRegisterCurrency(orderCurrencies, catalog?.catalog?.currency ?? null);
  if (resolution.status === "mixed") redirect("/app/caja?cashError=mixed_currency");
  if (resolution.status === "unsupported") redirect("/app/caja?cashError=unsupported_currency");
  const openingFloatMinor = parseMoneyInputToMinor(textField(formData, "openingFloatPesos") ?? "", resolution.currency);
  if (openingFloatMinor === null) redirect("/app/caja?cashError=invalid_amount");
  const cookieStore = await cookies();
  const registerId = getOrCreateUuidCookie(cookieStore, CASH_REGISTER_COOKIE, context.cookiesSecure);
  const deviceId = getOrCreateUuidCookie(cookieStore, DEVICE_COOKIE, context.cookiesSecure);
  const command = {
    cashRegisterSessionId: uuidField(formData, "cashRegisterSessionId"),
    currency: resolution.currency,
    deviceId,
    eventId: uuidField(formData, "eventId"),
    idempotencyKey: boundedTextField(formData, "idempotencyKey", 200),
    occurredAt: timestampField(formData, "occurredAt"),
    openingFloatMinor,
    registerId,
    schemaVersion: 1,
    scope: context.scope,
    shiftId: uuidField(formData, "shiftId"),
  };
  const result = await openCashRegister(context.accessToken, context.apiBaseUrl, command);
  if (result.status !== "ok") redirect(`/app/caja?cashError=${errorCode(result.status)}`);
  cookieStore.set(CASH_REGISTER_SESSION_COOKIE, result.value.cashRegisterSessionId, cookieOptions(context.cookiesSecure));
  revalidatePath("/app/caja");
  redirect("/app/caja?cashStatus=opened");
}

export async function quotePaymentAction(input: {
  readonly cashRegisterSessionId: string;
  readonly orderId: string;
  readonly amountPesos: string;
  readonly receivedPesos: string;
  readonly tipPesos: string;
  readonly method: "cash" | "card_manual";
}): Promise<{ status: string; value?: ReturnType<typeof parseCashPaymentQuoteV1> }> {
  const context = await getAuthorizedContext();
  const cookieStore = await cookies();
  const registerId = readUuidCookie(cookieStore, CASH_REGISTER_COOKIE);
  const deviceId = readUuidCookie(cookieStore, DEVICE_COOKIE);
  if (registerId === undefined || deviceId === undefined || !validUuid(input.cashRegisterSessionId) || !validUuid(input.orderId)) return { status: "context_invalid" };
  const checkout = await getCheckoutOrder(context.accessToken, context.apiBaseUrl, {
    cashRegisterSessionId: input.cashRegisterSessionId, deviceId, orderId: input.orderId, registerId, schemaVersion: 1, scope: context.scope,
  });
  if (checkout.status !== "ok") return { status: errorCode(checkout.status) };
  const currency = checkout.value.currency;
  const enteredAmount = parseMoneyInputToMinor(input.amountPesos, currency);
  const received = input.method === "cash" ? parseMoneyInputToMinor(input.receivedPesos, currency) : null;
  const tipMinor = input.tipPesos.trim() === "" ? 0 : parseMoneyInputToMinor(input.tipPesos, currency);
  if (enteredAmount === null || enteredAmount <= 0 || tipMinor === null || (input.method === "cash" && (received === null || received <= 0))) return { status: "invalid_amount" };
  // For an insufficient tender, quote a partial amount. The server then returns the unpaid balance.
  const insufficient = received !== null && received < enteredAmount;
  const request = {
    amountMinor: insufficient ? received : enteredAmount,
    cashRegisterSessionId: input.cashRegisterSessionId,
    method: input.method,
    orderId: input.orderId,
    schemaVersion: 1,
    scope: context.scope,
    tenderedAmountMinor: insufficient ? null : received,
    tipMinor,
  };
  try {
    const response = await fetch(`${context.apiBaseUrl}/api/v1/payments/quote`, {
      method: "POST", cache: "no-store",
      headers: { authorization: `Bearer ${context.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) return { status: response.status === 409 ? "conflict" : response.status === 400 ? "invalid_amount" : "unavailable" };
    const value = parseCashPaymentQuoteV1(await response.json());
    return value === undefined || value.orderId !== input.orderId || value.cashRegisterSessionId !== input.cashRegisterSessionId
      || value.scope.restaurantId !== context.scope.restaurantId || value.scope.branchId !== context.scope.branchId
      || value.amountMinor !== request.amountMinor || value.tipMinor !== tipMinor || value.method !== input.method
      || value.tenderedAmountMinor !== request.tenderedAmountMinor
      ? { status: "unavailable" } : { status: "ok", value };
  } catch { return { status: "unavailable" }; }
}

export async function collectPaymentAction(formData: FormData): Promise<{ status: string; value?: import("@super-restaurant/shared-types").PaymentCollectionSummaryV1 }> {
  const context = await getAuthorizedContext();
  const cookieStore = await cookies();
  const registerId = readUuidCookie(cookieStore, CASH_REGISTER_COOKIE);
  const deviceId = readUuidCookie(cookieStore, DEVICE_COOKIE);
  const cashRegisterSessionId = uuidField(formData, "cashRegisterSessionId");
  const orderId = uuidField(formData, "orderId");
  if (registerId === undefined || deviceId === undefined || cashRegisterSessionId === undefined || orderId === undefined) {
    redirect("/app/caja?cashError=context_invalid");
  }
  const checkout = await getCheckoutOrder(context.accessToken, context.apiBaseUrl, {
    cashRegisterSessionId, deviceId, orderId, registerId, schemaVersion: 1, scope: context.scope,
  });
  if (checkout.status !== "ok") redirect(`/app/caja?orderId=${orderId}&cashError=${errorCode(checkout.status)}`);
  const method = textField(formData, "method");
  const amountMinor = parseMoneyInputToMinor(textField(formData, "amountPesos") ?? "", checkout.value.currency);
  const tenderedAmountMinor = method === "cash" ? parseMoneyInputToMinor(textField(formData, "receivedPesos") ?? "", checkout.value.currency) : null;
  const tipText = textField(formData, "tipPesos") ?? "";
  const tipMinor = tipText.trim() === "" ? 0 : parseMoneyInputToMinor(tipText, checkout.value.currency);
  if (amountMinor === null || amountMinor === 0 || tipMinor === null || (method === "cash" && (tenderedAmountMinor === null || tenderedAmountMinor < amountMinor))) return { status: "invalid_amount" };
  const provider = method === "card_manual" ? "Terminal externa" : undefined;
  const terminalId = boundedTextField(formData, "terminalId", 100);
  const reference = optionalBoundedTextField(formData, "reference", 200);
  if (method === "card_manual" && (terminalId === undefined || reference === undefined || reference === null || reference.length < 6)) return { status: "invalid_input" };
  const cardManualEvidence = method === "card_manual"
    ? { externalConfirmed: true, provider, reference, terminalId }
    : null;
  const result = await collectPayment(context.accessToken, context.apiBaseUrl, {
    amountMinor,
    cardManualEvidence,
    cashRegisterExpectedVersion: checkout.value.cashRegisterVersion,
    cashRegisterSessionId,
    deviceId,
    eventId: uuidField(formData, "eventId"),
    idempotencyKey: boundedTextField(formData, "idempotencyKey", 200),
    localSequence: checkout.value.nextLocalSequence,
    method,
    occurredAt: timestampField(formData, "occurredAt"),
    orderExpectedVersion: checkout.value.orderVersion,
    orderId,
    paymentId: uuidField(formData, "paymentId"),
    schemaVersion: 1,
    scope: context.scope,
    tenderedAmountMinor,
    tipMinor,
  });
  if (result.status !== "ok") return { status: errorCode(result.status) };
  cookieStore.set(CASH_REGISTER_SESSION_COOKIE, cashRegisterSessionId, cookieOptions(context.cookiesSecure));
  revalidatePath("/app/caja");
  return { status: "ok", value: result.value };
}

export async function closeCashRegisterAction(formData: FormData): Promise<void> {
  if (textField(formData, "confirmClose") !== "yes") redirect("/app/caja?cashError=close_not_confirmed");
  const context = await getAuthorizedContext();
  const cookieStore = await cookies();
  const registerId = readUuidCookie(cookieStore, CASH_REGISTER_COOKIE);
  const deviceId = readUuidCookie(cookieStore, DEVICE_COOKIE);
  const cashRegisterSessionId = uuidField(formData, "cashRegisterSessionId");
  if (registerId === undefined || deviceId === undefined || cashRegisterSessionId === undefined) {
    redirect("/app/caja?cashError=context_invalid");
  }
  const report = await getCashRegisterReport(context.accessToken, context.apiBaseUrl, {
    cashRegisterSessionId, deviceId, registerId, schemaVersion: 1, scope: context.scope,
  });
  if (report.status !== "ok") redirect(`/app/caja?cashError=${errorCode(report.status)}`);
  const countedClosingBalanceMinor = parseMoneyInputToMinor(textField(formData, "countedClosingBalancePesos") ?? "", report.value.register.currency);
  if (countedClosingBalanceMinor === null) redirect("/app/caja?cashError=invalid_amount");
  const reason = optionalBoundedTextField(formData, "reason", 500);
  if (countedClosingBalanceMinor !== report.value.register.expectedCashBalanceMinor && (reason === null || reason === undefined)) {
    redirect("/app/caja?cashError=reason_required");
  }
  const result = await closeCashRegister(context.accessToken, context.apiBaseUrl, {
    cashRegisterExpectedVersion: report.value.register.version,
    cashRegisterSessionId,
    countedClosingBalanceMinor,
    deviceId,
    eventId: uuidField(formData, "eventId"),
    idempotencyKey: boundedTextField(formData, "idempotencyKey", 200),
    occurredAt: timestampField(formData, "occurredAt"),
    reason,
    schemaVersion: 1,
    scope: context.scope,
  });
  if (result.status !== "ok") redirect(`/app/caja?cashError=${errorCode(result.status)}`);
  cookieStore.set(CASH_REGISTER_SESSION_COOKIE, cashRegisterSessionId, cookieOptions(context.cookiesSecure));
  revalidatePath("/app/caja");
  redirect("/app/caja?cashStatus=closed");
}

interface AuthorizedFinancialContext {
  readonly accessToken: string;
  readonly apiBaseUrl: string;
  readonly cookiesSecure: boolean;
  readonly scope: BranchScope;
}

async function readPayableOrderCurrencies(context: AuthorizedFinancialContext): Promise<readonly string[] | undefined> {
  const currencies = new Set<string>();
  let cursor: BranchOrderWorkCursorV1 | null = null;
  // Scan every available page; a bounded failure blocks opening rather than missing a second currency.
  for (let page = 0; page < 50; page += 1) {
    const tray = await requestBranchOrderWorkTray(context.accessToken, context.apiBaseUrl, context.scope, cursor, 100);
    if (!tray.ok) return undefined;
    for (const order of tray.value.items) {
      if (isPayableBranchOrderWorkStatus(order.status)) currencies.add(order.totals.currency);
    }
    if (currencies.size > 1 || tray.value.nextCursor === null) return [...currencies];
    cursor = tray.value.nextCursor;
  }
  return undefined;
}

async function getAuthorizedContext(): Promise<AuthorizedFinancialContext> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) redirect("/login");
  const cookieStore = await cookies();
  const scope = parseBranchPreference(cookieStore.get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app?branchError=invalid_selection");
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  if (memberships === undefined || findMembership(memberships.memberships, scope) === undefined
    || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) {
    redirect("/app?branchError=not_authorized");
  }
  return { accessToken: session.access_token, apiBaseUrl: env.apiBaseUrl, cookiesSecure: env.cookiesSecure, scope };
}

function getOrCreateUuidCookie(store: Awaited<ReturnType<typeof cookies>>, name: string, secure: boolean): string {
  const existing = readUuidCookie(store, name);
  if (existing !== undefined) return existing;
  const value = randomUUID();
  store.set(name, value, cookieOptions(secure));
  return value;
}

function readUuidCookie(store: Awaited<ReturnType<typeof cookies>>, name: string): string | undefined {
  const value = store.get(name)?.value;
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function cookieOptions(secure: boolean) {
  return { httpOnly: true, path: "/", sameSite: "lax" as const, secure };
}

function textField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function boundedTextField(formData: FormData, name: string, maximum: number): string | undefined {
  const value = textField(formData, name)?.trim();
  return value !== undefined && value.length >= 1 && value.length <= maximum && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined;
}

function optionalBoundedTextField(formData: FormData, name: string, maximum: number): string | null | undefined {
  const value = textField(formData, name)?.trim();
  return value === "" ? null : value !== undefined && value.length <= maximum && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined;
}

function uuidField(formData: FormData, name: string): string | undefined {
  const value = textField(formData, name);
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function timestampField(formData: FormData, name: string): string | undefined {
  const value = textField(formData, name);
  if (value === undefined || value.length !== 24) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : undefined;
}

function errorCode(status: FinancialApiFailure): string {
  return status === "invalid" ? "invalid_input" : status;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function validUuid(value: string): boolean { return UUID_PATTERN.test(value); }
