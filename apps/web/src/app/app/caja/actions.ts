"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { BranchScope } from "@super-restaurant/shared-types";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import {
  closeCashRegister,
  collectPayment,
  getCashRegisterReport,
  getCheckoutOrder,
  openCashRegister,
  type FinancialApiFailure,
} from "../../../lib/finance";
import { BRANCH_PREFERENCE_COOKIE, findMembership, listMemberships, parseBranchPreference } from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";
import { CASH_REGISTER_COOKIE, CASH_REGISTER_SESSION_COOKIE, DEVICE_COOKIE } from "./context";

export async function openCashRegisterAction(formData: FormData): Promise<void> {
  const context = await getAuthorizedContext();
  const cookieStore = await cookies();
  const registerId = getOrCreateUuidCookie(cookieStore, CASH_REGISTER_COOKIE, context.cookiesSecure);
  const deviceId = getOrCreateUuidCookie(cookieStore, DEVICE_COOKIE, context.cookiesSecure);
  const command = {
    cashRegisterSessionId: uuidField(formData, "cashRegisterSessionId"),
    currency: normalizedCurrency(formData),
    deviceId,
    eventId: uuidField(formData, "eventId"),
    idempotencyKey: boundedTextField(formData, "idempotencyKey", 200),
    occurredAt: timestampField(formData, "occurredAt"),
    openingFloatMinor: nonNegativeIntegerField(formData, "openingFloatMinor"),
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

export async function collectPaymentAction(formData: FormData): Promise<void> {
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
  const amountMinor = positiveIntegerField(formData, "amountMinor");
  const provider = boundedTextField(formData, "provider", 120);
  const terminalId = boundedTextField(formData, "terminalId", 100);
  const reference = optionalBoundedTextField(formData, "reference", 200);
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
  });
  if (result.status !== "ok") redirect(`/app/caja?orderId=${orderId}&cashError=${errorCode(result.status)}`);
  cookieStore.set(CASH_REGISTER_SESSION_COOKIE, cashRegisterSessionId, cookieOptions(context.cookiesSecure));
  revalidatePath("/app/caja");
  const nextOrder = result.value.remainingBalanceMinor === 0 ? "" : `&orderId=${orderId}`;
  redirect(`/app/caja?cashStatus=payment_collected${nextOrder}`);
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
  const countedClosingBalanceMinor = nonNegativeIntegerField(formData, "countedClosingBalanceMinor");
  const reason = optionalBoundedTextField(formData, "reason", 500);
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

function normalizedCurrency(formData: FormData): string | undefined {
  const value = textField(formData, "currency")?.trim().toUpperCase();
  return value !== undefined && /^[A-Z]{3}$/u.test(value) ? value : undefined;
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

function nonNegativeIntegerField(formData: FormData, name: string): number | undefined {
  const value = textField(formData, name);
  if (value === undefined || !/^(0|[1-9]\d*)$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function positiveIntegerField(formData: FormData, name: string): number | undefined {
  const value = nonNegativeIntegerField(formData, name);
  return value !== undefined && value > 0 ? value : undefined;
}

function errorCode(status: FinancialApiFailure): string {
  return status === "invalid" ? "invalid_input" : status;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
