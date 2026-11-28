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

function pushBody(scope: BranchScope, events: unknown): string {
  return JSON.stringify({ events, protocolVersion: 1, scope });
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
    request(pushBody(scopeA, [])),
    "push",
    deps({ getSession: () => Promise.resolve(null) }),
  );
  assert.equal(response.status, 401);
});

test("403 cuando la API no autoriza la sucursal", async () => {
  const response = await handleSyncProxyRequest(
    request(pushBody(scopeA, [])),
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

test("acepta el registro de dispositivos y lo reenvía al API", async () => {
  let received: { action: string; accessToken: string; body: string } | undefined;
  const body = JSON.stringify({ deviceId: "44444444-4444-4444-8444-444444444444", scope: scopeA });
  const response = await handleSyncProxyRequest(
    request(body),
    "devices",
    deps({
      forward: (input) => {
        received = input;
        return Promise.resolve(new Response(JSON.stringify({ status: "active" }), { status: 200 }));
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(received?.action, "devices");
  assert.equal(received?.body, body);
});

test("200 en push cuando todos los eventos pertenecen al scope de la cookie", async () => {
  let forwardCalls = 0;
  let forwardedBody: string | undefined;
  const body = pushBody(scopeA, [
    { branchId: scopeA.branchId, eventId: "e1", restaurantId: scopeA.restaurantId },
    { branchId: scopeA.branchId, eventId: "e2", restaurantId: scopeA.restaurantId },
  ]);
  const response = await handleSyncProxyRequest(
    request(body),
    "push",
    deps({
      forward: (input) => {
        forwardCalls += 1;
        forwardedBody = input.body;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(forwardCalls, 1);
  assert.equal(forwardedBody, body);
});

test("403 en push cuando un evento pertenece a otro scope sin llamar a forward", async () => {
  let forwardCalls = 0;
  const response = await handleSyncProxyRequest(
    request(pushBody(scopeA, [{ branchId: scopeB.branchId, restaurantId: scopeB.restaurantId }])),
    "push",
    deps({
      forward: () => {
        forwardCalls += 1;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(forwardCalls, 0);
});

test("403 en push cuando el segundo evento pertenece a otra rama", async () => {
  let forwardCalls = 0;
  const response = await handleSyncProxyRequest(
    request(
      pushBody(scopeA, [
        { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId },
        { branchId: scopeB.branchId, restaurantId: scopeB.restaurantId },
      ]),
    ),
    "push",
    deps({
      forward: () => {
        forwardCalls += 1;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(forwardCalls, 0);
});

test("400 en push cuando events no es un array", async () => {
  const response = await handleSyncProxyRequest(
    request(JSON.stringify({ events: "x", scope: scopeA })),
    "push",
    deps(),
  );
  assert.equal(response.status, 400);
});

test("403 en push cuando un evento no es un objeto", async () => {
  for (const malformedEvents of [[null], ["x"]]) {
    let forwardCalls = 0;
    const response = await handleSyncProxyRequest(
      request(pushBody(scopeA, malformedEvents)),
      "push",
      deps({
        forward: () => {
          forwardCalls += 1;
          return Promise.resolve(new Response(null, { status: 200 }));
        },
      }),
    );
    assert.equal(response.status, 403);
    assert.equal(forwardCalls, 0);
  }
});

test("200 en snapshot con el cuerpo sin events", async () => {
  let receivedAction: string | undefined;
  const response = await handleSyncProxyRequest(
    request(jsonBody(scopeA)),
    "snapshot",
    deps({
      forward: (input) => {
        receivedAction = input.action;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(receivedAction, "snapshot");
});
