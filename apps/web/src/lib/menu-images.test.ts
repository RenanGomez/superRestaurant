import assert from "node:assert/strict";
import test from "node:test";
import { MENU_IMAGE_MAX_DECODED_BYTES } from "@super-restaurant/shared-types";
import { menuImagePublicUrl, validateMenuImageFile } from "./menu-images.js";

test("menu image validation accepts supported images up to 2 MB", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(validateMenuImageFile({ type, size: MENU_IMAGE_MAX_DECODED_BYTES }), null);
  }
  assert.match(validateMenuImageFile({ type: "image/gif", size: 100 }) ?? "", /JPG/);
  assert.match(validateMenuImageFile({ type: "image/png", size: MENU_IMAGE_MAX_DECODED_BYTES + 1 }) ?? "", /2 MB/);
  assert.match(validateMenuImageFile({ type: "image/png", size: 0 }) ?? "", /vacía/);
});

test("menu image URL uses the public catalog bucket and rejects unsafe paths", () => {
  assert.equal(menuImagePublicUrl("https://example.supabase.co/", "restaurant/product/photo.webp"),
    "https://example.supabase.co/storage/v1/object/public/catalog-images/restaurant/product/photo.webp");
  assert.equal(menuImagePublicUrl("https://example.supabase.co", null), null);
  assert.equal(menuImagePublicUrl("https://example.supabase.co", "../outside"), null);
});
