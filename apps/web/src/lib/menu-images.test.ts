import assert from "node:assert/strict";
import test from "node:test";
import { MENU_IMAGE_MAX_DECODED_BYTES } from "@super-restaurant/shared-types";
import {
  fitMenuImageWithin, isNextRedirectError, menuImageAttempt, menuImagePublicUrl, menuUploadErrorMessage, publishDisabledReason,
  shouldDownscaleMenuImage, validateMenuImageFile,
} from "./menu-images.js";

test("only photos above the 2 MB server limit are shrunk", () => {
  assert.equal(shouldDownscaleMenuImage(MENU_IMAGE_MAX_DECODED_BYTES), false);
  assert.equal(shouldDownscaleMenuImage(MENU_IMAGE_MAX_DECODED_BYTES + 1), true);
});

test("fitMenuImageWithin caps the longest side, keeps ratio and never enlarges", () => {
  assert.deepEqual(fitMenuImageWithin(4000, 3000, 1600), { height: 1200, width: 1600 });
  assert.deepEqual(fitMenuImageWithin(3000, 4000, 1600), { height: 1600, width: 1200 });
  assert.deepEqual(fitMenuImageWithin(800, 600, 1600), { height: 600, width: 800 });
  assert.deepEqual(fitMenuImageWithin(10000, 1, 1600), { height: 1, width: 1600 });
});

test("upload errors map known API codes to Spanish and always expose the HTTP status otherwise", () => {
  assert.match(menuUploadErrorMessage(400, "MENU_CATALOG_IMAGE_REQUEST_REJECTED"), /no es válida/);
  assert.match(menuUploadErrorMessage(403, "ACTION_NOT_AUTHORIZED"), /permiso/);
  assert.match(menuUploadErrorMessage(503, "MENU_CATALOG_IMAGE_UNAVAILABLE"), /no respondió/);
  assert.match(menuUploadErrorMessage(503, "MENU_IMAGES_UNCONFIGURED"), /administrador/);
  assert.equal(menuUploadErrorMessage(413, undefined), "No se pudo subir la foto (HTTP 413).");
  assert.equal(menuUploadErrorMessage(500, { nested: true }), "No se pudo subir la foto (HTTP 500).");
  assert.equal(menuUploadErrorMessage(502, "SOMETHING_NEW"), "No se pudo subir la foto (SOMETHING_NEW, HTTP 502).");
});

test("only Next.js redirect errors are treated as redirects", () => {
  assert.equal(isNextRedirectError(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" })), true);
  assert.equal(isNextRedirectError(new Error("boom")), false);
  assert.equal(isNextRedirectError(null), false);
});

test("menu image validation accepts supported images and leaves big ones to the browser shrink step", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(validateMenuImageFile({ type, size: MENU_IMAGE_MAX_DECODED_BYTES }), null);
  }
  assert.equal(validateMenuImageFile({ type: "image/png", size: MENU_IMAGE_MAX_DECODED_BYTES + 1 }), null);
  assert.match(validateMenuImageFile({ type: "image/gif", size: 100 }) ?? "", /JPG/);
  assert.match(validateMenuImageFile({ type: "image/png", size: 26 * 1024 * 1024 }) ?? "", /25 MB/);
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
