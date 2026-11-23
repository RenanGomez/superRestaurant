/**
 * The capture card shows the photo as a full-width 96 px strip, so a 16:9 landscape frame
 * loses the least when it is cropped again by `object-cover`.
 */
export const MENU_PHOTO_CARD_ASPECT = 16 / 9;
export const MENU_PHOTO_MIN_ZOOM = 1;
export const MENU_PHOTO_MAX_ZOOM = 4;
export const MENU_PHOTO_ZOOM_STEP = 0.1;
export const MENU_PHOTO_PAN_STEP = 0.1;

export interface MenuPhotoCropRect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface MenuPhotoCropInput {
  readonly aspect?: number;
  /** -1 is the left/top edge of the image, 1 the right/bottom edge, 0 the center. */
  readonly panX: number;
  readonly panY: number;
  readonly sourceHeight: number;
  readonly sourceWidth: number;
  /** 1 fills the frame with the image; larger values zoom in. */
  readonly zoom: number;
}

export function clampMenuPhotoZoom(value: number): number {
  if (!Number.isFinite(value)) return MENU_PHOTO_MIN_ZOOM;
  return Math.min(MENU_PHOTO_MAX_ZOOM, Math.max(MENU_PHOTO_MIN_ZOOM, value));
}

export function clampMenuPhotoPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/**
 * Source-pixel rectangle that the frame shows. Zoom 1 is the largest rectangle with the
 * requested aspect that fits inside the image, so panning can never expose an empty edge.
 */
export function menuPhotoCropRect({ aspect, panX, panY, sourceHeight, sourceWidth, zoom }: MenuPhotoCropInput): MenuPhotoCropRect {
  const sourceW = Number.isFinite(sourceWidth) ? Math.max(1, sourceWidth) : 1;
  const sourceH = Number.isFinite(sourceHeight) ? Math.max(1, sourceHeight) : 1;
  const frameAspect = aspect !== undefined && Number.isFinite(aspect) && aspect > 0 ? aspect : MENU_PHOTO_CARD_ASPECT;
  const safeZoom = clampMenuPhotoZoom(zoom);
  const baseHeight = Math.min(sourceH, sourceW / frameAspect);
  const baseWidth = baseHeight * frameAspect;
  const width = baseWidth / safeZoom;
  const height = baseHeight / safeZoom;
  const slackX = (sourceW - width) / 2;
  const slackY = (sourceH - height) / 2;
  return {
    height,
    width,
    x: slackX * (1 + clampMenuPhotoPan(panX)),
    y: slackY * (1 + clampMenuPhotoPan(panY)),
  };
}
