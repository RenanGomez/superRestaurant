import assert from "node:assert/strict";
import test from "node:test";

import {
  CatalogImageStorageConfigurationError,
  CatalogImageStorageUnavailableError,
  buildCatalogImagePublicUrl,
  FetchCatalogImageStorageAdapter,
  readCatalogImageStorageConfig,
} from "./catalog-image-storage.js";

const validEnvironment = Object.freeze({
  SUPABASE_SECRET_KEY: "sb_secret_example-key",
  SUPABASE_URL: "https://example.supabase.co",
});

test("reads a valid Storage configuration", () => {
  assert.deepEqual(readCatalogImageStorageConfig(validEnvironment), {
    publicBaseUrl: "https://example.supabase.co",
    secretKey: "sb_secret_example-key",
    supabaseUrl: "https://example.supabase.co",
  });
});

test("rejects missing, malformed or non-secret keys", () => {
  for (const secretKey of [undefined, "", "sb_publishable_wrong-prefix", "sb_secret_", "sb_secret_has space"]) {
    assert.throws(
      () => readCatalogImageStorageConfig({ ...validEnvironment, SUPABASE_SECRET_KEY: secretKey }),
      CatalogImageStorageConfigurationError,
    );
  }
});

test("rejects a non-HTTPS or decorated Supabase URL", () => {
  for (const supabaseUrl of ["http://example.supabase.co", "https://example.supabase.co/x", "not-a-url", undefined]) {
    assert.throws(
      () => readCatalogImageStorageConfig({ ...validEnvironment, SUPABASE_URL: supabaseUrl }),
      CatalogImageStorageConfigurationError,
    );
  }
});

test("buildCatalogImagePublicUrl composes the public object URL", () => {
  const config = readCatalogImageStorageConfig(validEnvironment);
  assert.equal(
    buildCatalogImagePublicUrl(config, "r/products/p/abc.jpg"),
    "https://example.supabase.co/storage/v1/object/public/catalog-images/r/products/p/abc.jpg",
  );
});

test("the fetch adapter authorizes with the secret key and rejects a non-OK response", async () => {
  const config = readCatalogImageStorageConfig(validEnvironment);
  const calls: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  try {
    const adapter = new FetchCatalogImageStorageAdapter(config);
    await adapter.put("r/products/p/abc.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://example.supabase.co/storage/v1/object/catalog-images/r/products/p/abc.jpg");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer sb_secret_example-key");
    assert.equal(headers["x-upsert"], "false");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the fetch adapter maps a failed upload and a network failure to the same unavailable error", async () => {
  const config = readCatalogImageStorageConfig(validEnvironment);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(null, { status: 409 })) as typeof fetch;
    await assert.rejects(
      new FetchCatalogImageStorageAdapter(config).put("r/products/p/abc.jpg", new Uint8Array(), "image/jpeg"),
      CatalogImageStorageUnavailableError,
    );
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    await assert.rejects(
      new FetchCatalogImageStorageAdapter(config).put("r/products/p/abc.jpg", new Uint8Array(), "image/jpeg"),
      CatalogImageStorageUnavailableError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
