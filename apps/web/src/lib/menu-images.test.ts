import assert from "node:assert/strict";
import test from "node:test";
import { MENU_IMAGE_MAX_DECODED_BYTES } from "@super-restaurant/shared-types";
import { menuImageAttempt, menuImagePublicUrl, publishDisabledReason, validateMenuImageFile } from "./menu-images.js";

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

test("a retry of the same selected bytes reuses all mutation identifiers", () => {
  let nextId = 0;
  const createId = () => String(++nextId);
  const now = () => "2026-10-03T12:00:00.000Z";
  const file = { contentType: "image/png" as const, dataBase64: "YWJj", fileName: "a.png", lastModified: 1 };
  const first = menuImageAttempt(null, file, createId, now);
  assert.strictEqual(menuImageAttempt(first, file, createId, now), first);
  assert.equal(nextId, 2);
  const second = menuImageAttempt(first, { ...file, dataBase64: "ZGVm" }, createId, now);
  assert.notEqual(second.idempotencyKey, first.idempotencyKey);
  assert.notEqual(second.eventId, first.eventId);
  assert.equal(nextId, 4);
  const third = menuImageAttempt(second, { ...file, fileName: "b.png" }, createId, now);
  assert.notEqual(third.idempotencyKey, second.idempotencyKey);
});

test("publishing waits for every upload and resumes after success or failure", () => {
  assert.equal(publishDisabledReason(0, false), null);
  assert.equal(publishDisabledReason(1, false), "Esperando fotos…");
  assert.equal(publishDisabledReason(2, false), "Esperando fotos… (2)");
  assert.equal(publishDisabledReason(0, true), "Publicando…");
  assert.equal(publishDisabledReason(2, true), "Esperando fotos… (2)");
});
