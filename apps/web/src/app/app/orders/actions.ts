"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { parseBranchOrderWorkTrayRequestV1, type BranchScope } from "@super-restaurant/shared-types";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { requestBranchOrderWorkTray, type BranchOrderTrayRequestResult } from "../../../lib/branch-order-work-tray";
import { BRANCH_PREFERENCE_COOKIE, parseBranchPreference } from "../../../lib/memberships";
import {
  parseAttemptIds,
  postOrderMutation,
  requestOrderDetail,
  type OrderDetailRequestResult,
  type OrderMutationRequestResult,
} from "../../../lib/order-detail";
import { createServerSupabaseClient } from "../../../lib/supabase-server";

const DEVICE_COOKIE = "sr-device-id";

export async function branchOrderWorkTrayAction(input: unknown): Promise<BranchOrderTrayRequestResult> {
  const request = parseBranchOrderWorkTrayRequestV1(input);
  if (request === undefined) return { error: "invalid", ok: false };
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined || request.scope.restaurantId !== scope.restaurantId || request.scope.branchId !== scope.branchId) {
    return { error: "invalid", ok: false };
  }
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return { error: "denied", ok: false };
  const env = getServerEnv();
  if (await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) return { error: "denied", ok: false };
  return requestBranchOrderWorkTray(session.access_token, env.apiBaseUrl, scope, request.cursor, request.limit, request.channel);
}

export async function orderDetailAction(orderId: string): Promise<OrderDetailRequestResult> {
  const context = await authorizedOrderContext();
  if (context === undefined) return { error: "denied", ok: false };
  if (!isUuid(orderId)) return { error: "invalid", ok: false };
  return requestOrderDetail(context.accessToken, context.apiBaseUrl, context.scope, orderId);
}

/**
 * `eventId`/`idempotencyKey` are generated once by the caller (the detail panel, per operation --
 * see `useAttemptIds` in order-detail-panel.tsx) and passed in here unchanged, instead of this
 * action minting a fresh pair on every invocation. A lost-response retry must resend the *same*
 * command, not a new one: two distinct idempotency keys for what the operator experiences as one
 * action would let a retried "send to kitchen" or "cancel" apply twice, or leave a batch half-sent
 * on a genuine conflict. Same pattern as `capture-workspace.tsx`'s own `base()`.
 */
export async function openOrderAction(
  orderId: string,
  expectedVersion: number,
  eventId: string,
  idempotencyKey: string,
): Promise<OrderMutationRequestResult> {
  const context = await authorizedOrderContext();
  if (context === undefined) return { error: "denied", ok: false };
  if (!isUuid(orderId)) return { error: "invalid", ok: false };
  const attempt = parseAttemptIds(eventId, idempotencyKey);
  if (attempt === undefined) return { error: "invalid", ok: false };
  return postOrderMutation(context.accessToken, context.apiBaseUrl, "orders/open", {
    ...(await audit(attempt)), expectedVersion, orderId, schemaVersion: 1, scope: context.scope,
  });
}

export async function transitionOrderItemAction(
  orderId: string,
  orderItemId: string,
  expectedVersion: number,
  to: "sent" | "preparing" | "ready" | "delivered",
  eventId: string,
  idempotencyKey: string,
): Promise<OrderMutationRequestResult> {
  const context = await authorizedOrderContext();
  if (context === undefined) return { error: "denied", ok: false };
  if (!isUuid(orderId) || !isUuid(orderItemId)) return { error: "invalid", ok: false };
  const attempt = parseAttemptIds(eventId, idempotencyKey);
  if (attempt === undefined) return { error: "invalid", ok: false };
  return postOrderMutation(context.accessToken, context.apiBaseUrl, "orders/items/transition", {
    ...(await audit(attempt)), expectedVersion, orderId, orderItemId, schemaVersion: 1, scope: context.scope, to,
  });
}

export async function cancelOrderItemAction(
  orderId: string,
  orderItemId: string,
  expectedVersion: number,
  reason: string,
  eventId: string,
  idempotencyKey: string,
): Promise<OrderMutationRequestResult> {
  const context = await authorizedOrderContext();
  if (context === undefined) return { error: "denied", ok: false };
  if (!isUuid(orderId) || !isUuid(orderItemId) || reason.trim().length === 0) return { error: "invalid", ok: false };
  const attempt = parseAttemptIds(eventId, idempotencyKey);
  if (attempt === undefined) return { error: "invalid", ok: false };
  return postOrderMutation(context.accessToken, context.apiBaseUrl, "orders/items/cancel", {
    ...(await audit(attempt)), expectedVersion, orderId, orderItemId, reason: reason.trim(), schemaVersion: 1, scope: context.scope,
  });
}

async function authorizedOrderContext(): Promise<{ readonly accessToken: string; readonly apiBaseUrl: string; readonly scope: BranchScope } | undefined> {
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) return undefined;
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return undefined;
  const env = getServerEnv();
  if (await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) return undefined;
  return { accessToken: session.access_token, apiBaseUrl: env.apiBaseUrl, scope };
}

async function audit(
  attempt: { readonly eventId: string; readonly idempotencyKey: string },
): Promise<{ readonly deviceId: string; readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string }> {
  return {
    deviceId: await getOrCreateDeviceId(),
    eventId: attempt.eventId,
    idempotencyKey: attempt.idempotencyKey,
    occurredAt: new Date().toISOString(),
  };
}

async function getOrCreateDeviceId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(DEVICE_COOKIE)?.value;
  if (existing !== undefined && isUuid(existing)) return existing.toLowerCase();
  const deviceId = randomUUID();
  cookieStore.set(DEVICE_COOKIE, deviceId, { httpOnly: true, path: "/", sameSite: "lax", secure: getServerEnv().cookiesSecure });
  return deviceId;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
