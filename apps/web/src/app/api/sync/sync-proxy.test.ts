import assert from "node:assert/strict";
import test from "node:test";

import { parseSyncScopeV1, type BranchScope } from "@super-restaurant/shared-types";

import { handleSyncProxyRequest, SYNC_PROXY_MAX_BODY_BYTES, type SyncProxyDependencies } from "./sync-proxy.js";

const restaurant = "22222222-2222-4222-8222-222222222222";
const branchA = "11111111-1111-4111-8111-111111111111";
const branchB = "33333333-3333-4333-8333-333333333333";
const scopeA: BranchScope = parseSyncScopeV1({ branchId: branchA, restaurantId: restaurant })!;
const scopeB: BranchScope = parseSyncScopeV1({ branchId: branchB, restaurantId: restaurant })!;

function jsonBody(scope: BranchScope): string {
  return JSON.stringify({ protocolVersion: 1, scope });
}

function request(
  body: string,
  overrides: { readonly headers?: Record<string, string> } = {},
): Request {
  return new Request("https://pos.example.test/api/sync/push", {
    body,
    headers: { "content-type": "application/json", ...(overrides.headers ?? {}) },
    method: "POST",
  });
}

function deps(overrides: Partial<SyncProxyDependencies> = {}): SyncProxyDependencies {
  return {
    authorize: () => Promise.resolve(true),
    forward: () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    getCookieScope: () => Promise.resolve(scopeA),
    getSession: () => Promise.resolve({ accessToken: "server-token" }),
    ...overrides,
  };
}

test("404 para una acción que no es push/pull/snapshot", async () => {
  let touched = false;
  const response = await handleSyncProxyRequest(
    request(jsonBody(scopeA)),
    "delete",
    deps({
      getCookieScope: () => {
        touched = true;
        return Promise.resolve(scopeA);
      },
    }),
  );
  assert.equal(response.status, 404);
  assert.equal(touched, false);
});

test("403 cuando Sec-Fetch-Site declara cross-site", async () => {
  const response = await handleSyncProxyRequest(
    request(jsonBody(scopeA), { headers: { "sec-fetch-site": "cross-site" } }),
    "push",
    deps(),
  );
  assert.equal(response.status, 403);
});

test("413 por Content-Length declarado y por Buffer.byteLength real", async () => {
  const declared = await handleSyncProxyRequest(
    request(jsonBody(scopeA), { headers: { "content-length": String(SYNC_PROXY_MAX_BODY_BYTES + 1) } }),
    "push",
    deps(),
  );
  assert.equal(declared.status, 413);

  // Header absent or lying: the real byte length is what matters, not `.length`.
  const real = await handleSyncProxyRequest(
    request("x".repeat(64), { headers: { "content-length": "1" } }),
    "push",
    deps(),
    16,
  );
  assert.equal(real.status, 413);
});

test("415 cuando el cuerpo no es application/json", async () => {
  const response = await handleSyncProxyRequest(
    new Request("https://pos.example.test/api/sync/push", {
      body: jsonBody(scopeA),
      headers: { "content-type": "text/plain" },
      method: "POST",
    }),
    "push",
    deps(),
  );
  assert.equal(response.status, 415);
});

test("403 si el scope del cuerpo difiere del scope de la cookie", async () => {
  let sessionRead = false;
  const response = await handleSyncProxyRequest(
    request(jsonBody(scopeB)),
    "push",
    deps({
      getSession: () => {
        sessionRead = true;
        return Promise.resolve({ accessToken: "server-token" });
      },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(sessionRead, false);
});

test("401 sin sesión autenticada", async () => {
  const response = await handleSyncProxyRequest(
    request(jsonBody(scopeA)),
    "push",
    deps({ getSession: () => Promise.resolve(null) }),
  );
  assert.equal(response.status, 401);
});

test("403 cuando la API no autoriza la sucursal", async () => {
  const response = await handleSyncProxyRequest(
    request(jsonBody(scopeA)),
    "push",
    deps({ authorize: () => Promise.resolve(false) }),
  );
  assert.equal(response.status, 403);
});

test("reenvía el cuerpo validado con el token del servidor", async () => {
  let received: { action: string; accessToken: string; body: string } | undefined;
  const body = jsonBody(scopeA);
  const response = await handleSyncProxyRequest(
    request(body),
    "pull",
    deps({
      forward: (input) => {
        received = input;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(received?.action, "pull");
  assert.equal(received?.accessToken, "server-token");
  assert.equal(received?.body, body);
});
