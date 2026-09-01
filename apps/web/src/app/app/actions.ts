"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getServerEnv } from "../../env";
import { authorizeBranch } from "../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, encodeBranchPreference, findMembership, listMemberships, parseBranchPreference, parseEncodedScope } from "../../lib/memberships";
import { createServerSupabaseClient } from "../../lib/supabase-server";
import { createDiningTable, updateDiningTableLayout } from "../../lib/dining-layout";

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

export async function createDiningTableAction(formData: FormData): Promise<void> {
  const context = await getAuthorizedContext();
  const command = {
    capacity: numericField(formData, "capacity"),
    deviceId: await getOrCreateDeviceId(),
    eventId: randomUUID(),
    idempotencyKey: randomUUID(),
    layout: geometryFrom(formData),
    name: textField(formData, "name"),
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
    scope: context.scope,
    shape: textField(formData, "shape"),
    tableId: randomUUID(),
    zoneId: textField(formData, "zoneId"),
  };
  const created = await createDiningTable(context.accessToken, context.apiBaseUrl, command);
  if (created === undefined) redirect("/app?layoutError=create_failed");
  revalidatePath("/app");
  redirect("/app?layoutStatus=table_created");
}

export async function updateDiningTableLayoutAction(formData: FormData): Promise<void> {
  const context = await getAuthorizedContext();
  const updated = await updateDiningTableLayout(context.accessToken, context.apiBaseUrl, {
    deviceId: await getOrCreateDeviceId(),
    eventId: randomUUID(),
    expectedVersion: numericField(formData, "expectedVersion"),
    idempotencyKey: randomUUID(),
    layout: geometryFrom(formData),
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
    scope: context.scope,
    tableId: textField(formData, "tableId"),
  });
  if (updated === undefined) redirect("/app?layoutError=update_failed");
  revalidatePath("/app");
  redirect("/app?layoutStatus=layout_saved");
}

async function getAuthorizedContext(): Promise<{ readonly accessToken: string; readonly apiBaseUrl: string; readonly scope: NonNullable<ReturnType<typeof parseEncodedScope>> }> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) redirect("/login");
  const cookieStore = await cookies();
  const scope = parseBranchPreference(cookieStore.get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app?branchError=invalid_selection");
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  if (memberships === undefined || findMembership(memberships.memberships, scope) === undefined || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) {
    redirect("/app?branchError=not_authorized");
  }
  return { accessToken: session.access_token, apiBaseUrl: env.apiBaseUrl, scope };
}

async function getOrCreateDeviceId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(DEVICE_COOKIE)?.value;
  if (existing !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(existing)) return existing.toLowerCase();
  const deviceId = randomUUID();
  cookieStore.set(DEVICE_COOKIE, deviceId, { httpOnly: true, path: "/", sameSite: "lax", secure: getServerEnv().cookiesSecure });
  return deviceId;
}

function textField(formData: FormData, name: string): unknown {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function numericField(formData: FormData, name: string): unknown {
  const value = textField(formData, name);
  return typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value) ? Number(value) : undefined;
}

function geometryFrom(formData: FormData): Readonly<Record<"height" | "width" | "x" | "y", unknown>> {
  return { height: numericField(formData, "height"), width: numericField(formData, "width"), x: numericField(formData, "x"), y: numericField(formData, "y") };
}
