import { MENU_IMAGE_MAX_DECODED_BYTES, type MenuImageContentTypeV1 } from "@super-restaurant/shared-types";

const allowedTypes = new Set<string>(["image/jpeg", "image/png", "image/webp"]);

/** Largest original the browser will try to shrink; the server limit (2 MB) applies to what is uploaded. */
export const MENU_IMAGE_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** Longest side after the browser shrinks a photo. */
export const MENU_IMAGE_MAX_SIDE_PX = 1600;

export function validateMenuImageFile(file: Pick<File, "type" | "size">): string | null {
  if (!allowedTypes.has(file.type)) return "Elige una imagen JPG, PNG o WebP.";
  if (file.size === 0) return "La imagen está vacía.";
  if (file.size > MENU_IMAGE_MAX_SOURCE_BYTES) return "La imagen es demasiado grande (máximo 25 MB).";
  return null;
}

/** Photos above the server limit are shrunk in the browser instead of being rejected. */
export function shouldDownscaleMenuImage(size: number): boolean {
  return size > MENU_IMAGE_MAX_DECODED_BYTES;
}

/** Scales (width, height) down so the longest side is at most maxSide; never enlarges and never returns 0. */
export function fitMenuImageWithin(width: number, height: number, maxSide: number): { readonly height: number; readonly width: number } {
  const longest = Math.max(width, height);
  if (!(longest > maxSide)) return { height: Math.max(1, Math.round(height)), width: Math.max(1, Math.round(width)) };
  const ratio = maxSide / longest;
  return { height: Math.max(1, Math.round(height * ratio)), width: Math.max(1, Math.round(width * ratio)) };
}

/** Spanish message for a failed upload; the HTTP status is always included when the API gave no known code. */
export function menuUploadErrorMessage(status: number, code: unknown): string {
  switch (code) {
    case "MENU_IMAGES_UNCONFIGURED": return "El servidor no tiene almacenamiento de fotos configurado; avisa al administrador.";
    case "MENU_CATALOG_IMAGE_REQUEST_REJECTED": return "La imagen no es válida (formato o tamaño).";
    case "ACTION_NOT_AUTHORIZED": return "No tienes permiso para cambiar fotos del menú.";
    case "MENU_CATALOG_IMAGE_UNAVAILABLE": return "El almacenamiento de fotos no respondió; inténtalo de nuevo.";
    case "AUTHENTICATION_REQUIRED": return "Tu sesión expiró; vuelve a iniciar sesión e inténtalo de nuevo.";
    default: return typeof code === "string" && code.length > 0
      ? `No se pudo subir la foto (${code}, HTTP ${status}).`
      : `No se pudo subir la foto (HTTP ${status}).`;
  }
}

/** Next.js implements redirect() by throwing; those errors must propagate. */
export function isNextRedirectError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error
    && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}

export function isMenuImageContentType(value: string): value is MenuImageContentTypeV1 {
  return allowedTypes.has(value);
}

export function menuImagePublicUrl(supabaseUrl: string, imagePath: string | null): string | null {
  if (imagePath === null || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/u.test(imagePath) || imagePath.split("/").includes("..")) return null;
  return `${supabaseUrl.replace(/\/$/u, "")}/storage/v1/object/public/catalog-images/${imagePath}`;
}

export interface MenuImageAttempt {
  readonly contentType: MenuImageContentTypeV1;
  readonly dataBase64: string;
  readonly fileName: string;
  readonly lastModified: number;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

/** Selecting the same bytes preserves the upload identity, including after a lost response. */
export function menuImageAttempt(
  previous: MenuImageAttempt | null,
  file: { readonly contentType: MenuImageContentTypeV1; readonly dataBase64: string; readonly fileName: string; readonly lastModified: number },
  createId: () => string,
  now: () => string,
): MenuImageAttempt {
  if (previous?.contentType === file.contentType && previous.dataBase64 === file.dataBase64
    && previous.fileName === file.fileName && previous.lastModified === file.lastModified) return previous;
  return { ...file, eventId: createId(), idempotencyKey: createId(), occurredAt: now() };
}

export function publishDisabledReason(pendingUploads: number, saving: boolean): string | null {
  if (pendingUploads > 0) return pendingUploads === 1 ? "Esperando fotos…" : `Esperando fotos… (${pendingUploads})`;
  return saving ? "Publicando…" : null;
}
