import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMenuPhotoPan, clampMenuPhotoZoom, MENU_PHOTO_CARD_ASPECT, MENU_PHOTO_MAX_ZOOM, MENU_PHOTO_MIN_ZOOM, menuPhotoCropRect,
} from "./menu-photo-crop.js";

function closeTo(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`);
}

test("zoom is clamped to the allowed range and falls back to the minimum", () => {
  assert.equal(clampMenuPhotoZoom(0), MENU_PHOTO_MIN_ZOOM);
  assert.equal(clampMenuPhotoZoom(-3), MENU_PHOTO_MIN_ZOOM);
  assert.equal(clampMenuPhotoZoom(9), MENU_PHOTO_MAX_ZOOM);
  assert.equal(clampMenuPhotoZoom(2.5), 2.5);
  assert.equal(clampMenuPhotoZoom(Number.NaN), MENU_PHOTO_MIN_ZOOM);
});

test("pan is clamped to -1..1 and invalid input goes back to the center", () => {
  assert.equal(clampMenuPhotoPan(-9), -1);
  assert.equal(clampMenuPhotoPan(9), 1);
  assert.equal(clampMenuPhotoPan(0.4), 0.4);
  assert.equal(clampMenuPhotoPan(Number.NaN), 0);
});

test("zoom 1 uses the largest frame with the card aspect inside the image", () => {
  const wide = menuPhotoCropRect({ panX: 0, panY: 0, sourceHeight: 900, sourceWidth: 1600, zoom: 1 });
  closeTo(wide.height, 900);
  closeTo(wide.width, 1600);
  assert.equal(wide.x, 0);
  assert.equal(wide.y, 0);
  closeTo(wide.width / wide.height, MENU_PHOTO_CARD_ASPECT);

  const square = menuPhotoCropRect({ panX: 0, panY: 0, sourceHeight: 1000, sourceWidth: 1000, zoom: 1 });
  closeTo(square.height, 1000 / MENU_PHOTO_CARD_ASPECT);
  closeTo(square.width, 1000);
  assert.equal(square.x, 0);
  closeTo(square.y, (1000 - square.height) / 2);

  const portrait = menuPhotoCropRect({ panX: 0, panY: 0, sourceHeight: 1600, sourceWidth: 900, zoom: 1 });
  closeTo(portrait.width, 900);
  closeTo(portrait.height, 900 / MENU_PHOTO_CARD_ASPECT);
  closeTo(portrait.x, 0);
  closeTo(portrait.y, (1600 - portrait.height) / 2);
});

test("zoom below the minimum behaves like the minimum", () => {
  const min = menuPhotoCropRect({ panX: 0.7, panY: -0.2, sourceHeight: 1000, sourceWidth: 1000, zoom: 1 });
  const invalid = menuPhotoCropRect({ panX: 0.7, panY: -0.2, sourceHeight: 1000, sourceWidth: 1000, zoom: 0 });
  assert.deepEqual(invalid, min);
});

test("zooming in halves the frame when the zoom doubles", () => {
  const base = menuPhotoCropRect({ panX: 0, panY: 0, sourceHeight: 900, sourceWidth: 1600, zoom: 1 });
  const zoomed = menuPhotoCropRect({ panX: 0, panY: 0, sourceHeight: 900, sourceWidth: 1600, zoom: 2 });
  closeTo(zoomed.width, base.width / 2);
  closeTo(zoomed.height, base.height / 2);
  closeTo(zoomed.x, (1600 - zoomed.width) / 2);
  closeTo(zoomed.y, (900 - zoomed.height) / 2);
});

test("extreme pans stay clamped and never leave empty borders", () => {
  const sourceWidth = 1600;
  const sourceHeight = 900;
  const zoom = 1.5;
  const topLeft = menuPhotoCropRect({ panX: -50, panY: -50, sourceHeight, sourceWidth, zoom });
  const bottomRight = menuPhotoCropRect({ panX: 50, panY: 50, sourceHeight, sourceWidth, zoom });
  assert.equal(topLeft.x, 0);
  assert.equal(topLeft.y, 0);
  closeTo(bottomRight.x + bottomRight.width, sourceWidth);
  closeTo(bottomRight.y + bottomRight.height, sourceHeight);
  for (const rect of [topLeft, bottomRight]) {
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= sourceWidth + 1e-9);
    assert.ok(rect.y + rect.height <= sourceHeight + 1e-9);
  }
});

test("the aspect can be overridden per frame", () => {
  const rect = menuPhotoCropRect({ aspect: 4 / 3, panX: 0, panY: 0, sourceHeight: 900, sourceWidth: 1600, zoom: 1 });
  closeTo(rect.height, 900);
  closeTo(rect.width, 1200);
  closeTo(rect.x, 200);
  assert.equal(rect.y, 0);
  closeTo(rect.width / rect.height, 4 / 3);
});

test("invalid source sizes and aspects fall back to a safe one-pixel frame", () => {
  const rect = menuPhotoCropRect({ aspect: -1, panX: 0, panY: 0, sourceHeight: 0, sourceWidth: 0, zoom: 1 });
  closeTo(rect.width, 1);
  closeTo(rect.height, 1 / MENU_PHOTO_CARD_ASPECT);
  assert.equal(rect.x, 0);
  closeTo(rect.y, (1 - rect.height) / 2);
});
