"use server";

import { cookies } from "next/headers";
import {
  parseAssignOrderWaiterResultV1, parseBranchOperationalContextV1, parseOpenOperationalShiftResultV1, parseOperationalShiftListV1, parseOrderMutationSummaryV1,
  parseTableBoardV1, type BranchMemberV1, type DiningLayoutV1, type OperationalShiftSummaryV1,
  type TableBoardV1,
} from "@super-restaurant/shared-types";
import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { getCaptureConfirmationContext } from "../../../lib/capture-confirmation-context";
import { listBranchMembers } from "../../../lib/deliveries";
import { getDiningLayout } from "../../../lib/dining-layout";
import { BRANCH_PREFERENCE_COOKIE, parseBranchPreference } from "../../../lib/memberships";
import { parseAttemptIds, parseOccurredAt, requestOrderDetail } from "../../../lib/order-detail";
import { createServerSupabaseClient } from "../../../lib/supabase-server";

type ErrorCode = "invalid" | "denied" | "conflict" | "no_shift" | "unavailable";
type Failure = { readonly ok: false; readonly error: ErrorCode };
type Attempt = { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string; readonly deviceId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function context() {
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) return undefined;
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return undefined;
  const base = getServerEnv().apiBaseUrl;
  const authorized = await authorizeBranch(session.access_token, base, scope);
  return authorized === undefined ? undefined : { token: session.access_token, base, scope, actorId: session.user.id, roles: authorized.roles };
}

function validAttempt(value: Attempt): boolean {
  return parseAttemptIds(value.eventId, value.idempotencyKey) !== undefined
    && parseOccurredAt(value.occurredAt) !== undefined && uuid.test(value.deviceId);
}

async function request(token: string, base: string, path: string, body: unknown): Promise<Response | undefined> {
  try { return await fetch(`${base}/api/v1/${path}`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch { return undefined; }
}

function failure(response: Response | undefined): Failure {
  return { ok: false, error: response === undefined ? "unavailable" : response.status === 409 ? "conflict"
    : response.status === 400 ? "invalid" : response.status === 401 || response.status === 403 ? "denied" : "unavailable" };
}

export async function readTablesBoardAction(): Promise<{ readonly ok: true; readonly board: TableBoardV1; readonly layout: DiningLayoutV1; readonly shift: OperationalShiftSummaryV1 | null; readonly timeZone: string } | Failure> {
  const ctx = await context();
  if (ctx === undefined) return { ok: false, error: "denied" };
  const query = new URLSearchParams({ branchId: ctx.scope.branchId, restaurantId: ctx.scope.restaurantId });
  const [boardResponse, layout, shiftResponse, branchResponse] = await Promise.all([
    request(ctx.token, ctx.base, "tables/board", ctx.scope),
    getDiningLayout(ctx.token, ctx.base, ctx.scope),
    fetch(`${ctx.base}/api/v1/shifts/active?${query}`, { cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${ctx.token}` } }).catch(() => undefined),
    request(ctx.token, ctx.base, "access/branch/context", ctx.scope),
  ]);
  if (boardResponse === undefined || !boardResponse.ok || layout === undefined || shiftResponse === undefined || !shiftResponse.ok
    || branchResponse === undefined || !branchResponse.ok) return failure(boardResponse);
  try {
    const board = parseTableBoardV1(await boardResponse.json());
    const shifts = parseOperationalShiftListV1(await shiftResponse.json());
    const branch = parseBranchOperationalContextV1(await branchResponse.json());
    if (board === undefined || shifts === undefined || branch === undefined || board.scope.restaurantId !== ctx.scope.restaurantId || board.scope.branchId !== ctx.scope.branchId
      || layout.scope.restaurantId !== ctx.scope.restaurantId || layout.scope.branchId !== ctx.scope.branchId
      || shifts.scope.restaurantId !== ctx.scope.restaurantId || shifts.scope.branchId !== ctx.scope.branchId
      || branch.scope.restaurantId !== ctx.scope.restaurantId || branch.scope.branchId !== ctx.scope.branchId) return { ok: false, error: "unavailable" };
    return { ok: true, board, layout, shift: shifts.shifts[0] ?? null, timeZone: branch.timeZone };
  } catch { return { ok: false, error: "unavailable" }; }
}

export async function tableOrderDetailAction(orderId: string) {
  const ctx = await context();
  if (ctx === undefined) return { ok: false, error: "denied" } as const;
  if (!uuid.test(orderId)) return { ok: false, error: "invalid" } as const;
  return requestOrderDetail(ctx.token, ctx.base, ctx.scope, orderId);
}

export async function createTableOrderAction(tableId: string, orderId: string, attempt: Attempt, waiterUserId: string | null): Promise<{ readonly ok: true; readonly orderId: string; readonly waiterAssigned: boolean } | Failure> {
  const ctx = await context();
  if (ctx === undefined) return { ok: false, error: "denied" };
  if (!uuid.test(tableId) || !uuid.test(orderId) || !validAttempt(attempt) || (waiterUserId !== null && !uuid.test(waiterUserId))) return { ok: false, error: "invalid" };
  const facts = await getCaptureConfirmationContext(ctx.token, ctx.base, ctx.scope);
  if (facts === undefined || facts.tables === null) return { ok: false, error: "unavailable" };
  if (!facts.tables.some((table) => table.tableId === tableId)) return { ok: false, error: "invalid" };
  if (facts.shifts.length === 0) return { ok: false, error: "no_shift" };
  const response = await request(ctx.token, ctx.base, "orders", { ...attempt, schemaVersion: 2, scope: ctx.scope,
    orderId, shiftId: null, channel: "table", tableId, currency: facts.currency, timeZone: facts.timeZone });
  if (response === undefined || !response.ok) return failure(response);
  try {
    const created = parseOrderMutationSummaryV1(await response.json());
    if (created === undefined || created.orderId !== orderId || created.scope.restaurantId !== ctx.scope.restaurantId || created.scope.branchId !== ctx.scope.branchId) return { ok: false, error: "unavailable" };
    if (waiterUserId === null) return { ok: true, orderId, waiterAssigned: false };
    const assigned = await request(ctx.token, ctx.base, "orders/assign-waiter", { ...attempt, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
      schemaVersion: 1, scope: ctx.scope, orderId, expectedVersion: created.version, waiterUserId });
    const value = assigned?.ok ? parseAssignOrderWaiterResultV1(await assigned.json().catch(() => undefined)) : undefined;
    return { ok: true, orderId, waiterAssigned: value?.waiterUserId === waiterUserId };
  } catch { return { ok: false, error: "unavailable" }; }
}

export async function assignWaiterAction(orderId: string, expectedVersion: number, attempt: Attempt, waiterUserId: string): Promise<{ readonly ok: true } | Failure> {
  const ctx = await context();
  if (ctx === undefined) return { ok: false, error: "denied" };
  if (!uuid.test(orderId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !validAttempt(attempt) || !uuid.test(waiterUserId)) return { ok: false, error: "invalid" };
  const response = await request(ctx.token, ctx.base, "orders/assign-waiter", { ...attempt, schemaVersion: 1, scope: ctx.scope,
    orderId, expectedVersion, waiterUserId });
  if (response === undefined || !response.ok) return failure(response);
  const value = parseAssignOrderWaiterResultV1(await response.json().catch(() => undefined));
  return value?.orderId === orderId && value.waiterUserId === waiterUserId && value.scope.restaurantId === ctx.scope.restaurantId && value.scope.branchId === ctx.scope.branchId
    ? { ok: true } : { ok: false, error: "unavailable" };
}

export async function openShiftAction(shiftId: string, attempt: Attempt): Promise<{ readonly ok: true } | Failure> {
  const ctx = await context();
  if (ctx === undefined) return { ok: false, error: "denied" };
  if (!uuid.test(shiftId) || !validAttempt(attempt)) return { ok: false, error: "invalid" };
  const response = await request(ctx.token, ctx.base, "shifts/open", { ...attempt, schemaVersion: 1, scope: ctx.scope, shiftId, name: "Turno operativo" });
  if (response === undefined || !response.ok) return failure(response);
  const value = parseOpenOperationalShiftResultV1(await response.json().catch(() => undefined));
  return value?.shiftId === shiftId && value.scope.restaurantId === ctx.scope.restaurantId && value.scope.branchId === ctx.scope.branchId
    ? { ok: true } : { ok: false, error: "unavailable" };
}

export async function listWaitersAction(): Promise<{ readonly ok: true; readonly members: readonly BranchMemberV1[] } | Failure> {
  const ctx = await context();
  if (ctx === undefined) return { ok: false, error: "denied" };
  const result = await listBranchMembers(ctx.token, ctx.base, ctx.scope, "waiter");
  return result.status === "ok" ? { ok: true, members: result.value }
    : { ok: false, error: result.status === "unauthorized" ? "denied" : "unavailable" };
}
