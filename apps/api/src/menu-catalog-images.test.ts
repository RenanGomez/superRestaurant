import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import {
  CatalogImageStorageConfigurationError,
  type CatalogImageStorageConfig,
  type CatalogImageStoragePort,
} from "./catalog-image-storage.js";
import { MenuCatalogImageApplicationError, MenuCatalogImageService } from "./menu-catalog-images.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const scope = parseBranchScope({
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
});
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;

const targetId = "9544c299-d25b-44ce-98ed-d30116610887";
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function command(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    scope,
    target: "product",
    targetId,
    contentType: "image/jpeg",
    dataBase64: JPEG_MAGIC.toString("base64"),
    eventId: "9e113c0b-9f7f-4e8d-8d1e-9b6a7c1b0001",
    idempotencyKey: "9e113c0b-9f7f-4e8d-8d1e-9b6a7c1b0002",
    deviceId: "9e113c0b-9f7f-4e8d-8d1e-9b6a7c1b0003",
    occurredAt: "2026-10-04T00:00:00.000Z",
    ...overrides,
  };
}

function copyCommand(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    scope,
    target: "product",
    targetId,
    sourceImagePath: `${validScope.restaurantId}/options/c483b6e7-e102-4cc5-a887-d30712c85e52/00000000000000000000000000000000.jpg`,
    eventId: "9e113c0b-9f7f-4e8d-8d1e-9b6a7c1b0001",
    idempotencyKey: "9e113c0b-9f7f-4e8d-8d1e-9b6a7c1b0002",
    deviceId: "9e113c0b-9f7f-4e8d-8d1e-9b6a7c1b0003",
    occurredAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function serviceFor(
  roles: readonly ("manager" | "owner" | "viewer")[],
  storage: CatalogImageStoragePort,
  config: () => CatalogImageStorageConfig = () => ({ publicBaseUrl: "https://example.supabase.co", secretKey: "sb_secret_x", supabaseUrl: "https://example.supabase.co" }),
): MenuCatalogImageService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles, scope: validScope }) };
  return new MenuCatalogImageService(new MembershipAuthorizationService(memberships), storage, { get: config });
}

function code(expected: MenuCatalogImageApplicationError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof MenuCatalogImageApplicationError && error.code === expected;
}

test("uploads a well-formed JPEG for an authorized manager and returns a scoped path and public URL", async () => {
  const puts: { path: string; contentType: string }[] = [];
  const storage: CatalogImageStoragePort = {
    get: async () => undefined,
    put: async (path, _bytes, contentType) => { puts.push({ path, contentType }); return "created"; },
  };
  const service = serviceFor(["manager"], storage);
  const result = await service.upload(principal, command());
  assert.equal(result.schemaVersion, 1);
  assert.match(result.imagePath, new RegExp(`^${scope.restaurantId}/products/${targetId}/[0-9a-f]{32}\\.jpg$`));
  assert.equal(result.publicUrl, `https://example.supabase.co/storage/v1/object/public/catalog-images/${result.imagePath}`);
  assert.equal(puts.length, 1);
  assert.equal(puts[0]?.contentType, "image/jpeg");
});

test("uploads a well-formed PNG for an option target", async () => {
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async () => "created" };
  const service = serviceFor(["manager"], storage);
  const result = await service.upload(principal, command({
    target: "option", contentType: "image/png", dataBase64: PNG_MAGIC.toString("base64"),
  }));
  assert.match(result.imagePath, new RegExp(`^${scope.restaurantId}/options/${targetId}/[0-9a-f]{32}\\.png$`));
});

test("uploads a category image under the categories segment and replays the same path", async () => {
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async () => "created" };
  const service = serviceFor(["manager"], storage);
  const input = command({ target: "category", contentType: "image/png", dataBase64: PNG_MAGIC.toString("base64") });
  const first = await service.upload(principal, input);
  assert.match(first.imagePath, new RegExp(`^${scope.restaurantId}/categories/${targetId}/[0-9a-f]{32}\\.png$`));
  assert.deepEqual(await service.upload(principal, input), first);
});

test("rejects an insufficiently privileged role before ever touching storage", async () => {
  let called = false;
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async () => { called = true; return "created"; } };
  const service = serviceFor(["viewer"], storage);
  await assert.rejects(service.upload(principal, command()), code("authorization"));
  assert.equal(called, false);
});

test("rejects a malformed command before authorization", async () => {
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async () => "created" };
  const service = serviceFor(["manager"], storage);
  await assert.rejects(service.upload(principal, { ...command(), unexpected: true }), code("request"));
});

test("rejects a payload whose magic bytes do not match the declared content type", async () => {
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async () => "created" };
  const service = serviceFor(["manager"], storage);
  await assert.rejects(
    service.upload(principal, command({ dataBase64: Buffer.from("not an image").toString("base64") })),
    code("request"),
  );
});

test("rejects a declared PNG whose bytes are actually a JPEG", async () => {
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async () => "created" };
  const service = serviceFor(["manager"], storage);
  await assert.rejects(
    service.upload(principal, command({ contentType: "image/png", dataBase64: JPEG_MAGIC.toString("base64") })),
    code("request"),
  );
});

test("rejects an oversized decoded payload", async () => {
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async () => "created" };
  const service = serviceFor(["manager"], storage);
  const oversized = Buffer.concat([JPEG_MAGIC, Buffer.alloc(2_097_152)]);
  await assert.rejects(
    service.upload(principal, command({ dataBase64: oversized.toString("base64") })),
    code("request"),
  );
});

test("maps a storage adapter failure to an unavailable application error", async () => {
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async () => { throw new Error("object storage down"); } };
  const service = serviceFor(["manager"], storage);
  await assert.rejects(service.upload(principal, command()), code("unavailable"));
});

test("a retry of the identical command replays the same path even when Storage reports it exists", async () => {
  const seen = new Set<string>();
  const storage: CatalogImageStoragePort = {
    get: async () => undefined,
    put: async (path) => { const had = seen.has(path); seen.add(path); return had ? "exists" : "created"; },
  };
  const service = serviceFor(["manager"], storage);
  const first = await service.upload(principal, command());
  const retry = await service.upload(principal, command());
  assert.equal(retry.imagePath, first.imagePath);
  assert.equal(retry.publicUrl, first.publicUrl);
  assert.equal(seen.size, 1);
});

test("the same key with a different target or bytes derives a different object, never overwriting the first", async () => {
  const paths: string[] = [];
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async (path) => { paths.push(path); return "created"; } };
  const service = serviceFor(["manager"], storage);
  const first = await service.upload(principal, command());
  const otherTarget = await service.upload(principal, command({ targetId: "c483b6e7-e102-4cc5-a887-d30712c85e52" }));
  const otherBytes = await service.upload(principal, command({ dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0x01]).toString("base64") }));
  assert.equal(new Set([first.imagePath, otherTarget.imagePath, otherBytes.imagePath]).size, 3);
});

test("without Storage configuration the service reports unconfigured instead of failing", async () => {
  const storage: CatalogImageStoragePort = { get: async () => undefined, put: async () => "created" };
  const service = serviceFor(["manager"], storage, () => { throw new CatalogImageStorageConfigurationError(); });
  await assert.rejects(service.upload(principal, command()), code("unconfigured"));
});

test("copies an existing image into the target-owned path and preserves its extension", async () => {
  const puts: { bytes: Uint8Array; contentType: string; path: string }[] = [];
  const storage: CatalogImageStoragePort = {
    get: async () => JPEG_MAGIC,
    put: async (path, bytes, contentType) => { puts.push({ bytes, contentType, path }); return "created"; },
  };
  const result = await serviceFor(["manager"], storage).copy(principal, copyCommand());
  assert.match(result.imagePath, new RegExp(`^${scope.restaurantId}/products/${targetId}/[0-9a-f]{32}\\.jpg$`));
  assert.equal(puts[0]?.path, result.imagePath);
  assert.equal(puts[0]?.contentType, "image/jpeg");
  assert.deepEqual(puts[0]?.bytes, JPEG_MAGIC);
});

test("copy is idempotent for the same key and content", async () => {
  const paths: string[] = [];
  const storage: CatalogImageStoragePort = {
    get: async () => PNG_MAGIC,
    put: async (path) => { paths.push(path); return paths.length === 1 ? "created" : "exists"; },
  };
  const service = serviceFor(["manager"], storage);
  const input = copyCommand({ sourceImagePath: `${scope.restaurantId}/categories/c483b6e7-e102-4cc5-a887-d30712c85e52/00000000000000000000000000000000.png` });
  const first = await service.copy(principal, input);
  const retry = await service.copy(principal, input);
  assert.deepEqual(retry, first);
  assert.equal(new Set(paths).size, 1);
});

test("copy rejects cross-restaurant sources before reading Storage", async () => {
  let read = false;
  const storage: CatalogImageStoragePort = {
    get: async () => { read = true; return JPEG_MAGIC; },
    put: async () => "created",
  };
  await assert.rejects(
    serviceFor(["manager"], storage).copy(principal, copyCommand({
      sourceImagePath: `2e37ae13-8507-484c-969f-2176f77b7000/products/${targetId}/00000000000000000000000000000000.jpg`,
    })),
    code("authorization"),
  );
  assert.equal(read, false);
});

test("copy reports a missing source and rejects corrupt source bytes", async () => {
  const missing: CatalogImageStoragePort = { get: async () => undefined, put: async () => "created" };
  await assert.rejects(serviceFor(["manager"], missing).copy(principal, copyCommand()), code("not_found"));
  const corrupt: CatalogImageStoragePort = {
    get: async () => Buffer.from("not a jpeg"),
    put: async () => "created",
  };
  await assert.rejects(serviceFor(["manager"], corrupt).copy(principal, copyCommand()), code("request"));
});

test("copy applies catalog.manage before reading the source", async () => {
  let read = false;
  const storage: CatalogImageStoragePort = {
    get: async () => { read = true; return JPEG_MAGIC; },
    put: async () => "created",
  };
  await assert.rejects(serviceFor(["viewer"], storage).copy(principal, copyCommand()), code("authorization"));
  assert.equal(read, false);
});
