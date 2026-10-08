import { MENU_IMAGE_MAX_DECODED_BYTES } from "@super-restaurant/shared-types";

import { fitMenuImageWithin, MENU_IMAGE_MAX_SIDE_PX } from "./menu-images";

export interface ShrunkMenuImage {
  readonly blob: Blob;
  readonly contentType: "image/jpeg";
}

/** Progressively smaller JPEG attempts: [longest side, quality]. The first one is the 1600 px / 0.85 target. */
const ATTEMPTS: readonly (readonly [number, number])[] = [
  [MENU_IMAGE_MAX_SIDE_PX, 0.85],
  [1280, 0.75],
  [1024, 0.7],
  [800, 0.6],
];

/**
 * Browser-only: redraws a photo on a canvas as JPEG until it fits the server limit.
 * Returns null when the browser cannot decode it or no attempt fits.
 */
export async function shrinkMenuImage(file: File): Promise<ShrunkMenuImage | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    for (const [side, quality] of ATTEMPTS) {
      const { height, width } = fitMenuImageWithin(bitmap.width, bitmap.height, side);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (context === null) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob !== null && blob.size > 0 && blob.size <= MENU_IMAGE_MAX_DECODED_BYTES) return { blob, contentType: "image/jpeg" };
    }
    return null;
  } finally {
    bitmap.close();
  }
}
