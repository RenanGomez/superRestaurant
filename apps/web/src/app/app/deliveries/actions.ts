"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { parseBranchOrderWorkTrayRequestV1, type BranchScope, type OrderDetailV1 } from "@super-restaurant/shared-types";

import { getServerEnv } from "../../../env";
import { requestBranchOrderWorkTray, type BranchOrderTrayRequestResult } from "../../../lib/branch-order-work-tray";
import { authorizeBranch } from "../../../lib/branch-selection";
import { parseMoneyInputToMinor } from "../../../lib/capture-payment";
import {
  settleDelivery,
  transitionDelivery,
  listDeliveries,
  readDeliveryOrderDetail,
  type DeliveryApiFailure,
  type DeliveryTransitionKind,
} from "../../../lib/deliveries";
import { getCashRegisterReport, getCheckoutOrder } from "../../../lib/finance";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { requestOrderDetail } from "../../../lib/order-detail";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { CASH_REGISTER_COOKIE, CASH_REGISTER_SESSION_COOKIE, DEVICE_COOKIE } from "../caja/context";

const BOARD = "/app/deliveries";
const MANAGER_ROLES = new Set(["owner", "admin", "manager", "supervisor", "cashier"]);

export async function unassignedDeliveriesAction(input: unknown): Promise<BranchOrderTrayRequestResult> {
  const request = parseBranchOrderWorkTrayRequestV1(input);
  if (request === undefined || request.channel !== "delivery" || request.limit !== 100) return { error: "invalid", ok: false };
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined || request.scope.restaurantId !== scope.restaurantId || request.scope.branchId !== scope.branchId) {
    return { error: "invalid", ok: false };
  }
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return { error: "denied", ok: false };
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || !membership.roles.some((role) => MANAGER_ROLES.has(role))
    || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) {
    return { error: "denied", ok: false };
  }
  return requestBranchOrderWorkTray(session.access_token, env.apiBaseUrl, scope, request.cursor, 100, "delivery", true);
}

export type CourierOrderDetailResult =
  | { readonly ok: true; readonly detail: OrderDetailV1; readonly capturedMinor: number; readonly remainingMinor: number }
  | { readonly ok: false; readonly error: DeliveryApiFailure };

export async function courierOrderDetailAction(orderId: string): Promise<CourierOrderDetailResult> {
  if (!UUID_PATTERN.test(orderId)) return { ok: false, error: "invalid" };
  const context = await authorizedContext();
  const detail = await readDeliveryOrderDetail(context.accessToken, context.apiBaseUrl, context.scope, orderId);
  if (detail.status !== "ok") return { ok: false, error: detail.status };
  const list = await listDeliveries(context.accessToken, context.apiBaseUrl, context.scope);
  if (list.status !== "ok") return { ok: false, error: list.status };
  const item = list.value.items.find((entry) => entry.delivery.orderId === orderId);
  if (item === undefined || item.currency !== detail.value.totals.currency || item.totalMinor !== detail.value.totals.totalMinor) {
    return { ok: false, error: "conflict" };
  }
  return { ok: true, detail: detail.value, capturedMinor: item.capturedMinor, remainingMinor: item.remainingMinor };
}

export async function assignDeliveryAction(formData: FormData): Promise<void> {
  const courierUserId = uuidField(formData, "courierUserId");
  await runTransition("assign", formData, courierUserId === undefined ? {} : { courierUserId });
}

export async function dispatchDeliveryAction(formData: FormData): Promise<void> {
  await runTransition("dispatch", formData, {});
}

export async function completeDeliveryAction(formData: FormData): Promise<void> {
  await runTransition("complete", formData, {});
}

export async function failDeliveryAction(formData: FormData): Promise<void> {
  const reason = textField(formData, "reason")?.trim();
  const orderId = uuidField(formData, "orderId");
  if (reason === undefined || reason.length === 0 || reason.length > 300) {
    redirect(`${BOARD}?fail=${orderId ?? ""}&error=reason_required`);
  }
  await runTransition("fail", formData, { reason });
}

export async function settleDeliveryAction(formData: FormData): Promise<void> {
  const context = await authorizedContext();
  const orderId = uuidField(formData, "orderId");
  const expectedVersion = integerField(formData, "expectedVersion");
  if (orderId === undefined || expectedVersion === undefined) redirect(`${BOARD}?error=invalid`);
  const back = `${BOARD}?settle=${orderId}`;
  const cookieStore = await cookies();
  const registerId = readUuidCookie(cookieStore, CASH_REGISTER_COOKIE);
  const deviceId = readUuidCookie(cookieStore, DEVICE_COOKIE);
  const sessionId = readUuidCookie(cookieStore, CASH_REGISTER_SESSION_COOKIE);
  if (registerId === undefined || deviceId === undefined || sessionId === undefined) redirect(`${back}&error=no_register`);
  // Live server state, never the form: the list gives the delivery version, currency and prepaid flag.
  const list = await listDeliveries(context.accessToken, context.apiBaseUrl, context.scope);
  if (list.status !== "ok") redirect(`${BOARD}?error=${errorCode(list.status)}`);
  const item = list.value.items.find((entry) => entry.delivery.orderId === orderId);
  if (item === undefined || item.delivery.state !== "delivered" || item.delivery.version !== expectedVersion) {
    redirect(`${BOARD}?error=conflict`);
  }
  const prepaid = item.orderStatus === "paid";
  const tenderedText = textField(formData, "tenderedPesos")?.trim() ?? "";
  const tipText = textField(formData, "tipPesos")?.trim() ?? "";
  let tenderedAmountMinor: number | null = null;
  let tipMinor: number | null = null;
  if (!prepaid) {
    if (tenderedText !== "") {
      tenderedAmountMinor = parseMoneyInputToMinor(tenderedText, item.currency);
      if (tenderedAmountMinor === null || tenderedAmountMinor === 0) redirect(`${back}&error=invalid_amount`);
    }
    tipMinor = tipText === "" ? 0 : parseMoneyInputToMinor(tipText, item.currency);
    if (tipMinor === null) redirect(`${back}&error=invalid_amount`);
  }
  const report = await getCashRegisterReport(context.accessToken, context.apiBaseUrl, {
    cashRegisterSessionId: sessionId, deviceId, registerId, schemaVersion: 1, scope: context.scope,
  });
  if (report.status !== "ok" || report.value.register.status !== "open") redirect(`${back}&error=no_register`);
  let orderVersion: number;
  if (prepaid) {
    const detail = await requestOrderDetail(context.accessToken, context.apiBaseUrl, context.scope, orderId);
    if (!detail.ok) redirect(`${back}&error=${detail.error === "denied" ? "unauthorized" : detail.error}`);
    orderVersion = detail.value.version;
  } else {
    const checkout = await getCheckoutOrder(context.accessToken, context.apiBaseUrl, {
      cashRegisterSessionId: sessionId, deviceId, orderId, registerId, schemaVersion: 1, scope: context.scope,
    });
    if (checkout.status !== "ok") redirect(`${back}&error=${errorCode(checkout.status)}`);
    orderVersion = checkout.value.orderVersion;
  }
  const result = await settleDelivery(context.accessToken, context.apiBaseUrl, {
    ...audit(formData, deviceId, context.scope, orderId, expectedVersion),
    cashRegisterExpectedVersion: report.value.register.version,
    cashRegisterSessionId: sessionId,
    localSequence: report.value.nextLocalSequence,
    orderExpectedVersion: orderVersion,
    paymentId: uuidField(formData, "paymentId"),
    tenderedAmountMinor,
    tipMinor,
  });
  if (result.status !== "ok") redirect(`${back}&error=${errorCode(result.status)}`);
  revalidatePath(BOARD);
  const payment = result.value.payment;
  const change = payment === null || payment.changeMinor === null ? "" : `&change=${payment.changeMinor}&currency=${payment.currency}`;
  redirect(`${BOARD}?status=${payment === null ? "settled_prepaid" : "settled"}${change}`);
}

async function runTransition(kind: DeliveryTransitionKind, formData: FormData, extra: Readonly<Record<string, unknown>>): Promise<void> {
  const context = await authorizedContext();
  const orderId = uuidField(formData, "orderId");
  const expectedVersion = integerField(formData, "expectedVersion");
  if (orderId === undefined || expectedVersion === undefined) redirect(`${BOARD}?error=invalid`);
  const cookieStore = await cookies();
  const deviceId = getOrCreateUuidCookie(cookieStore, DEVICE_COOKIE, context.cookiesSecure);
  const result = await transitionDelivery(context.accessToken, context.apiBaseUrl, kind, {
    ...audit(formData, deviceId, context.scope, orderId, expectedVersion),
    ...extra,
  });
  if (result.status !== "ok") {
    const failedSheet = kind === "fail" && result.status !== "conflict" ? `fail=${orderId}&` : "";
    redirect(`${BOARD}?${failedSheet}error=${errorCode(result.status)}`);
  }
  revalidatePath(BOARD);
  redirect(`${BOARD}?status=${kind}`);
}

function audit(formData: FormData, deviceId: string, scope: BranchScope, orderId: string, expectedVersion: number) {
  return {
    deviceId,
    eventId: uuidField(formData, "eventId"),
    expectedVersion,
    idempotencyKey: boundedText(formData, "idempotencyKey", 200),
    occurredAt: timestampField(formData, "occurredAt"),
    orderId,
    schemaVersion: 1,
    scope,
  };
}

interface AuthorizedContext {
  readonly accessToken: string;
  readonly apiBaseUrl: string;
  readonly cookiesSecure: boolean;
  readonly scope: BranchScope;
}

async function authorizedContext(): Promise<AuthorizedContext> {
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
  store.set(name, value, { httpOnly: true, path: "/", sameSite: "lax", secure });
  return value;
}

function readUuidCookie(store: Awaited<ReturnType<typeof cookies>>, name: string): string | undefined {
  const value = store.get(name)?.value;
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function textField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function boundedText(formData: FormData, name: string, maximum: number): string | undefined {
  const value = textField(formData, name)?.trim();
  return value !== undefined && value.length >= 1 && value.length <= maximum && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined;
}

function uuidField(formData: FormData, name: string): string | undefined {
  const value = textField(formData, name);
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function integerField(formData: FormData, name: string): number | undefined {
  const value = textField(formData, name);
  return value !== undefined && /^\d{1,15}$/u.test(value) ? Number(value) : undefined;
}

function timestampField(formData: FormData, name: string): string | undefined {
  const value = textField(formData, name);
  if (value === undefined || value.length !== 24) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : undefined;
}

function errorCode(status: DeliveryApiFailure): string {
  return status === "invalid" ? "invalid_input" : status;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
