"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  MENU_IMAGE_PATH_PATTERN,
  parseCopyMenuImageCommandV1,
  parseUploadMenuImageCommandV1,
  type MenuImageUploadResultV1,
} from "@super-restaurant/shared-types";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import { DEFAULT_PESO_CURRENCY } from "../../../lib/capture-payment";
import { getMenuCatalog, saveMenuCatalog } from "../../../lib/menu-catalog";
import { isMenuImageContentType, isNextRedirectError, menuUploadErrorMessage, type MenuImageAttempt } from "../../../lib/menu-images";
import {
  BRANCH_PREFERENCE_COOKIE,
  findMembership,
  listMemberships,
  parseBranchPreference,
} from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";

const DEVICE_COOKIE = "sr-device-id";
const MAXIMUM_DRAFT_LENGTH = 2_000_000;

export async function uploadMenuImageAction(
  target: "category" | "option" | "product",
  targetId: string,
  file: MenuImageAttempt,
): Promise<{ readonly imagePath?: string; readonly error?: string }> {
  try {
    return await uploadMenuImage(target, targetId, file);
  } catch (error: unknown) {
    // redirect() (login, branch selection) is implemented by throwing and must keep working.
    if (isNextRedirectError(error)) throw error;
    console.error("menu image upload failed unexpectedly", error instanceof Error ? error.name : typeof error);
    return { error: "No se pudo subir la foto por un error inesperado del servidor. Inténtalo de nuevo." };
  }
}

export async function copyMenuImageAction(
  target: "category" | "option" | "product",
  targetId: string,
  sourceImagePath: string,
): Promise<{ readonly imagePath?: string; readonly error?: string }> {
  try {
    const context = await getAuthorizedContext();
    const command = parseCopyMenuImageCommandV1({
      deviceId: await getOrCreateDeviceId(),
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      occurredAt: new Date().toISOString(),
      schemaVersion: 1,
      scope: context.scope,
      sourceImagePath,
      target,
      targetId,
    });
    if (command === undefined) return { error: "La foto elegida no pertenece a este restaurante." };
    let response: Response;
    try {
      response = await fetch(`${context.apiBaseUrl}/api/v1/menu/images/copy`, {
        method: "POST",
        cache: "no-store",
        headers: { authorization: `Bearer ${context.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(command),
      });
    } catch {
      console.error("menu image copy: API unreachable");
      return { error: "No se pudo copiar la foto: el servidor no responde. Revisa la conexión e inténtalo de nuevo." };
    }
    let result: unknown;
    try { result = await response.json(); } catch {
      console.error(`menu image copy: non-JSON response status=${response.status}`);
      return { error: `El servidor devolvió una respuesta inválida (HTTP ${response.status}).` };
    }
    if (!response.ok) {
      const code = typeof result === "object" && result !== null && "code" in result ? result.code : undefined;
      console.error(`menu image copy rejected status=${response.status} code=${typeof code === "string" ? code : "none"}`);
      return { error: menuUploadErrorMessage(response.status, code) };
    }
    const copy = result as Partial<MenuImageUploadResultV1>;
    const segment = target === "product" ? "products" : target === "category" ? "categories" : "options";
    if (
      copy.schemaVersion !== 1
      || typeof copy.imagePath !== "string"
      || !MENU_IMAGE_PATH_PATTERN.test(copy.imagePath)
      || !copy.imagePath.startsWith(`${context.scope.restaurantId}/${segment}/${targetId}/`)
    ) return { error: "El servidor devolvió una ruta de foto inválida." };
    return { imagePath: copy.imagePath };
  } catch (error: unknown) {
    if (isNextRedirectError(error)) throw error;
    console.error("menu image copy failed unexpectedly", error instanceof Error ? error.name : typeof error);
    return { error: "No se pudo copiar la foto por un error inesperado del servidor. Inténtalo de nuevo." };
  }
}

async function uploadMenuImage(
  target: "category" | "option" | "product",
  targetId: string,
  file: MenuImageAttempt,
): Promise<{ readonly imagePath?: string; readonly error?: string }> {
  if (!isMenuImageContentType(file.contentType)) return { error: "Elige una imagen JPG, PNG o WebP." };
  const context = await getAuthorizedContext();
  const command = parseUploadMenuImageCommandV1({
    contentType: file.contentType,
    dataBase64: file.dataBase64,
    deviceId: await getOrCreateDeviceId(),
    eventId: file.eventId,
    idempotencyKey: file.idempotencyKey,
    occurredAt: file.occurredAt,
    schemaVersion: 1,
    scope: context.scope,
    target,
    targetId,
  });
  if (command === undefined) return { error: "La imagen no es válida o supera 2 MB." };
  let response: Response;
  try {
    response = await fetch(`${context.apiBaseUrl}/api/v1/menu/images`, {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${context.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(command),
    });
  } catch {
    console.error("menu image upload: API unreachable");
    return { error: "No se pudo subir la foto: el servidor no responde. Revisa la conexión e inténtalo de nuevo." };
  }
  let result: unknown;
  try { result = await response.json(); } catch {
    console.error(`menu image upload: non-JSON response status=${response.status}`);
    return { error: `El servidor devolvió una respuesta inválida (HTTP ${response.status}).` };
  }
  if (!response.ok) {
    const code = typeof result === "object" && result !== null && "code" in result ? result.code : undefined;
    console.error(`menu image upload rejected status=${response.status} code=${typeof code === "string" ? code : "none"}`);
    return { error: menuUploadErrorMessage(response.status, code) };
  }
  const upload = result as Partial<MenuImageUploadResultV1>;
  if (upload.schemaVersion !== 1 || typeof upload.imagePath !== "string" || upload.imagePath.length === 0) {
    return { error: "El servidor devolvió una ruta de foto inválida." };
  }
  return { imagePath: upload.imagePath };
}

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

  const current = await getMenuCatalog(context.accessToken, context.apiBaseUrl, context.scope);
  if (current === undefined) redirect("/app/menu?menuError=save_failed");

  const saved = await saveMenuCatalog(context.accessToken, context.apiBaseUrl, {
    catalogVersion: randomUUID(),
    categories: draft.categories,
    currency: current.catalog?.currency ?? DEFAULT_PESO_CURRENCY,
    deviceId: await getOrCreateDeviceId(),
    eventId: randomUUID(),
    expectedVersion: draft.expectedVersion,
    idempotencyKey: randomUUID(),
    modifierGroups: draft.modifierGroups,
    occurredAt: new Date().toISOString(),
    products: draft.products,
    sizePresets: draft.sizePresets,
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
  "categories" | "currency" | "expectedVersion" | "modifierGroups" | "products" | "sizePresets",
  unknown
>> {
  if (typeof value !== "object" || value === null) return false;
  try {
    const keys = Reflect.ownKeys(value);
    return Object.getPrototypeOf(value) === Object.prototype
      && keys.length === 6
      && ["categories", "currency", "expectedVersion", "modifierGroups", "products", "sizePresets"]
        .every((key) => keys.includes(key));
  } catch {
    return false;
  }
}
