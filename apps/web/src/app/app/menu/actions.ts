"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { saveMenuCatalog } from "../../../lib/menu-catalog";
import {
  BRANCH_PREFERENCE_COOKIE,
  findMembership,
  listMemberships,
  parseBranchPreference,
} from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";

const DEVICE_COOKIE = "sr-device-id";
const MAXIMUM_DRAFT_LENGTH = 2_000_000;

export async function saveMenuCatalogAction(formData: FormData): Promise<void> {
  const context = await getAuthorizedContext();
  const rawDraft = formData.get("draft");
  if (typeof rawDraft !== "string" || rawDraft.length === 0 || rawDraft.length > MAXIMUM_DRAFT_LENGTH) {
    redirect("/app/menu?menuError=invalid_draft");
  }

  let draft: unknown;
  try {
    draft = JSON.parse(rawDraft);
  } catch {
    redirect("/app/menu?menuError=invalid_draft");
  }
  if (!isDraftRecord(draft)) redirect("/app/menu?menuError=invalid_draft");

  const saved = await saveMenuCatalog(context.accessToken, context.apiBaseUrl, {
    catalogVersion: randomUUID(),
    categories: draft.categories,
    currency: draft.currency,
    deviceId: await getOrCreateDeviceId(),
    eventId: randomUUID(),
    expectedVersion: draft.expectedVersion,
    idempotencyKey: randomUUID(),
    modifierGroups: draft.modifierGroups,
    occurredAt: new Date().toISOString(),
    products: draft.products,
    schemaVersion: 1,
    scope: context.scope,
  });
  if (saved === undefined) redirect("/app/menu?menuError=save_failed");
  revalidatePath("/app/menu");
  redirect("/app/menu?menuStatus=published");
}

async function getAuthorizedContext(): Promise<{
  readonly accessToken: string;
  readonly apiBaseUrl: string;
  readonly scope: NonNullable<ReturnType<typeof parseBranchPreference>>;
}> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) redirect("/login");
  const cookieStore = await cookies();
  const scope = parseBranchPreference(cookieStore.get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) redirect("/app?branchError=invalid_selection");
  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  if (
    memberships === undefined
    || findMembership(memberships.memberships, scope) === undefined
    || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined
  ) redirect("/app?branchError=not_authorized");
  return { accessToken: session.access_token, apiBaseUrl: env.apiBaseUrl, scope };
}

async function getOrCreateDeviceId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(DEVICE_COOKIE)?.value;
  if (existing !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(existing)) {
    return existing.toLowerCase();
  }
  const deviceId = randomUUID();
  cookieStore.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: getServerEnv().cookiesSecure,
  });
  return deviceId;
}

function isDraftRecord(value: unknown): value is Readonly<Record<
  "categories" | "currency" | "expectedVersion" | "modifierGroups" | "products",
  unknown
>> {
  if (typeof value !== "object" || value === null) return false;
  try {
    const keys = Reflect.ownKeys(value);
    return Object.getPrototypeOf(value) === Object.prototype
      && keys.length === 5
      && ["categories", "currency", "expectedVersion", "modifierGroups", "products"]
        .every((key) => keys.includes(key));
  } catch {
    return false;
  }
}
