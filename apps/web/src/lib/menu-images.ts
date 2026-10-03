import { MENU_IMAGE_MAX_DECODED_BYTES, type MenuImageContentTypeV1 } from "@super-restaurant/shared-types";

const allowedTypes = new Set<string>(["image/jpeg", "image/png", "image/webp"]);

export function validateMenuImageFile(file: Pick<File, "type" | "size">): string | null {
  if (!allowedTypes.has(file.type)) return "Elige una imagen JPG, PNG o WebP.";
  if (file.size === 0) return "La imagen está vacía.";
  if (file.size > MENU_IMAGE_MAX_DECODED_BYTES) return "La imagen debe pesar 2 MB o menos.";
  return null;
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
