"use server";

import { randomUUID } from "node:crypto";
import type { DiningTableV1 } from "@super-restaurant/shared-types";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";


import { getServerEnv } from "../../env";
import { authorizeBranch } from "../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, encodeBranchPreference, findMembership, listMemberships, parseBranchPreference, parseEncodedScope } from "../../lib/memberships";
import { createServerSupabaseClient } from "../../lib/supabase-server";
import { createDiningTableResult, updateDiningTableDetails, updateDiningTableLayoutResult } from "../../lib/dining-layout";
import { validateTableDetails } from "../../lib/dining-editor";
import { parseAttemptIds, parseOccurredAt } from "../../lib/order-detail";

const DEVICE_COOKIE = "sr-device-id";

/** Local, immediate logout — reversible via re-login, so no confirmation dialog. */
export async function logoutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/**
 * Selects one Restaurant/Branch pair (frontend.md FE-0.1 task 2). Redirect
 * destinations are the two fixed constants below plus an allowlisted query
 * error code — never a caller-supplied path.
 *
 * Three independent checks gate a selection before the non-authoritative
 * preference cookie is written, so neither a tampered form value nor a
 * membership list that has gone stale since the page rendered can smuggle
 * an unauthorized pair through:
 *  1. the submitted value must parse as two UUIDs (`parseEncodedScope`);
 *  2. that pair must still appear in a *freshly fetched* membership list;
 *  3. `POST /api/v1/access/branch` must itself authorize it in Nest.
 */
export async function selectBranchAction(formData: FormData): Promise<void> {
  const raw = formData.get("scope");
  const scope = typeof raw === "string" ? parseEncodedScope(raw) : undefined;
  if (scope === undefined) {
    redirect("/app?branchError=invalid_selection");
  }

  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) {
    redirect("/login");
  }

  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  if (memberships === undefined || findMembership(memberships.memberships, scope) === undefined) {
    redirect("/app?branchError=not_authorized");
  }

  const authorized = await authorizeBranch(session.access_token, env.apiBaseUrl, scope);
  if (authorized === undefined) {
    redirect("/app?branchError=not_authorized");
  }

  const cookieStore = await cookies();
  cookieStore.set(
    BRANCH_PREFERENCE_COOKIE,
    encodeBranchPreference({ branchId: authorized.branchId, restaurantId: authorized.restaurantId }),
    {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: env.cookiesSecure,
    },
  );

  redirect("/app");
}

export type DiningActionError = "conflict" | "denied" | "invalid" | "unavailable";
export type DiningActionResult = { readonly ok: true; readonly table: DiningTableV1 } | { readonly ok: false; readonly error: DiningActionError };

/**
 * The three table actions below return a result instead of redirecting, so the editor can save one
 * table at a time without leaving the page. Each call carries one attempt (eventId + idempotencyKey +
 * occurredAt) made by the client; a retry after a network error reuses it, so the server replays
 * instead of applying twice. Only owner/admin/manager may manage the plan; the API decides again.
 */
async function manageContext(): Promise<Awaited<ReturnType<typeof getAuthorizedContext>> | undefined> {
  const context = await getAuthorizedContext();
  return context.roles.some((role) => role === "owner" || role === "admin" || role === "manager") ? context : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function attemptFrom(value: unknown): { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string } | undefined {
  const input = record(value);
  if (input === undefined) return undefined;
  const ids = parseAttemptIds(input.eventId, input.idempotencyKey);
  const occurredAt = parseOccurredAt(input.occurredAt);
  return ids === undefined || occurredAt === undefined ? undefined : { ...ids, occurredAt };
}

function geometryFrom(value: unknown): Readonly<Record<"height" | "width" | "x" | "y", unknown>> | undefined {
  const input = record(value);
  return input === undefined ? undefined : { height: input.height, width: input.width, x: input.x, y: input.y };
}

export async function createDiningTableAction(rawInput: unknown): Promise<DiningActionResult> {
  const input = record(rawInput);
  const attempt = attemptFrom(input?.attempt);
  const layout = geometryFrom(input?.layout);
  if (input === undefined || attempt === undefined || layout === undefined) return { ok: false, error: "invalid" };
  const context = await manageContext();
  if (context === undefined) return { ok: false, error: "denied" };
  const result = await createDiningTableResult(context.accessToken, context.apiBaseUrl, {
    capacity: input.capacity,
    deviceId: await getOrCreateDeviceId(),
    eventId: attempt.eventId,
    idempotencyKey: attempt.idempotencyKey,
    layout,
    name: typeof input.name === "string" ? input.name.trim() : input.name,
    occurredAt: attempt.occurredAt,
    schemaVersion: 1,
    scope: context.scope,
    shape: input.shape,
    tableId: input.tableId,
    zoneId: input.zoneId,
  });
  return result.ok ? { ok: true, table: result.value } : result;
}

export async function saveDiningTableLayoutAction(rawInput: unknown): Promise<DiningActionResult> {
  const input = record(rawInput);
  const attempt = attemptFrom(input?.attempt);
  const layout = geometryFrom(input?.layout);
  if (input === undefined || attempt === undefined || layout === undefined) return { ok: false, error: "invalid" };
  const context = await manageContext();
  if (context === undefined) return { ok: false, error: "denied" };
  const result = await updateDiningTableLayoutResult(context.accessToken, context.apiBaseUrl, {
    deviceId: await getOrCreateDeviceId(),
    eventId: attempt.eventId,
    expectedVersion: input.expectedVersion,
    idempotencyKey: attempt.idempotencyKey,
    layout,
    occurredAt: attempt.occurredAt,
    schemaVersion: 1,
    scope: context.scope,
    tableId: input.tableId,
  });
  return result.ok ? { ok: true, table: result.value } : result;
}

export async function updateDiningTableDetailsAction(rawInput: unknown): Promise<DiningActionResult> {
  const input = record(rawInput);
  const attempt = attemptFrom(input?.attempt);
  if (input === undefined || attempt === undefined) return { ok: false, error: "invalid" };
  const details = validateTableDetails({ name: typeof input.name === "string" ? input.name : "", capacity: String(input.capacity), shape: String(input.shape) });
  const expectedVersion = input.expectedVersion;
  if (!details.ok || typeof input.tableId !== "string" || typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return { ok: false, error: "invalid" };
  const context = await manageContext();
  if (context === undefined) return { ok: false, error: "denied" };
  const result = await updateDiningTableDetails(context.accessToken, context.apiBaseUrl, {
    capacity: details.capacity,
    deviceId: await getOrCreateDeviceId(),
    eventId: attempt.eventId,
    expectedVersion,
    idempotencyKey: attempt.idempotencyKey,
    name: details.name,
    occurredAt: attempt.occurredAt,
    schemaVersion: 1,
    scope: context.scope,
    shape: details.shape,
    tableId: input.tableId,
  });
  return result.ok ? { ok: true, table: result.value } : result;
}

async function getAuthorizedContext(): Promise<{ readonly accessToken: string; readonly apiBaseUrl: string; readonly roles: readonly string[]; readonly scope: NonNullable<ReturnType<typeof parseEncodedScope>> }> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) redirect("/login");
  const cookieStore = await cookies();
  const scope = parseBranchPreference(cookieStore.get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app?branchError=invalid_selection");
  const env = getServerEnv();
  const [memberships, authorized] = await Promise.all([
    listMemberships(session.access_token, env.apiBaseUrl),
    authorizeBranch(session.access_token, env.apiBaseUrl, scope),
  ]);
  if (memberships === undefined || findMembership(memberships.memberships, scope) === undefined || authorized === undefined) {
    redirect("/app?branchError=not_authorized");
  }
  return { accessToken: session.access_token, apiBaseUrl: env.apiBaseUrl, roles: authorized.roles, scope };
}

async function getOrCreateDeviceId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(DEVICE_COOKIE)?.value;
  if (existing !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(existing)) return existing.toLowerCase();
  const deviceId = randomUUID();
  cookieStore.set(DEVICE_COOKIE, deviceId, { httpOnly: true, path: "/", sameSite: "lax", secure: getServerEnv().cookiesSecure });
  return deviceId;
}
