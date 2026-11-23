import assert from "node:assert/strict";
import test from "node:test";

import { SyncTransportError, parseSyncScope, type SyncPullRequest, type SyncPushRequest } from "@super-restaurant/sync-engine";

import {
  WEB_SYNC_PATHS,
  classifySyncHttpStatus,
  createWebSyncTransport,
} from "./sync-transport.js";

const BASE = "https://api.superrestaurant.test";
const TOKEN = "session-token-abc";

const parsedScope = parseSyncScope({
  branchId: "00000000-0000-4000-8000-00000000a1a1",
  restaurantId: "00000000-0000-4000-8000-00000000a0a0",
});
if (!parsedScope.ok) throw new Error("fixture scope invalid");
const SCOPE = parsedScope.value;

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(status: number, body: unknown): { readonly calls: Call[]; readonly fetcher: typeof fetch } {
  const calls: Call[] = [];
  const fetcher = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ init: init ?? {}, url: String(input) });
    return Promise.resolve(new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    }));
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

const pushRequest: SyncPushRequest = {
  deviceId: "00000000-0000-4000-8000-00000000d1d1",
  events: [],
  protocolVersion: 1,
  scope: SCOPE,
};

const pullRequest: SyncPullRequest = {
  cursor: null,
  limit: 100,
  protocolVersion: 1,
  scope: pushRequest.scope,
};

test("push and pull travel as authenticated POSTs to /sync and /sync/pull", async () => {
  const { calls, fetcher } = fakeFetch(200, { protocolVersion: 1 });
  const transport = createWebSyncTransport({ accessToken: () => Promise.resolve(TOKEN), apiBaseUrl: BASE, fetcher });

  await transport.push(pushRequest);
  await transport.pull(pullRequest);

  assert.deepEqual(calls.map((call) => call.url), [`${BASE}${WEB_SYNC_PATHS.push}`, `${BASE}${WEB_SYNC_PATHS.pull}`]);
  assert.deepEqual(calls.map((call) => call.init.method), ["POST", "POST"]);
  for (const call of calls) {
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["authorization"], `Bearer ${TOKEN}`);
    assert.equal(headers["content-type"], "application/json");
  }
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), pushRequest);
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), pullRequest);
});

test("the token is read per request, so a renewed session is picked up", async () => {
  const { calls, fetcher } = fakeFetch(200, {});
  let token = "first";
  const transport = createWebSyncTransport({
    accessToken: () => Promise.resolve(token),
    apiBaseUrl: BASE,
    fetcher,
  });
  await transport.push(pushRequest);
  token = "second";
  await transport.push(pushRequest);
  assert.deepEqual(
    calls.map((call) => (call.init.headers as Record<string, string>)["authorization"]),
    ["Bearer first", "Bearer second"],
  );
});

test("no session means AUTH_REQUIRED and no network traffic", async () => {
  const { calls, fetcher } = fakeFetch(200, {});
  const transport = createWebSyncTransport({ accessToken: () => Promise.resolve(undefined), apiBaseUrl: BASE, fetcher });
  await assert.rejects(
    transport.push(pushRequest),
    (error: unknown) => error instanceof SyncTransportError && error.code === "AUTH_REQUIRED" && !error.retryable,
  );
  assert.equal(calls.length, 0);
});

test("a closed revocation gate blocks push and pull before the fetch", async () => {
  const { calls, fetcher } = fakeFetch(200, {});
  let open = false;
  const transport = createWebSyncTransport({
    accessToken: () => Promise.resolve(TOKEN),
    apiBaseUrl: BASE,
    canSend: () => open,
    fetcher,
  });
  for (const attempt of [transport.push(pushRequest), transport.pull(pullRequest)]) {
    await assert.rejects(
      attempt,
      (error: unknown) => error instanceof SyncTransportError && error.code === "AUTH_REVOKED" && !error.retryable,
    );
  }
  assert.equal(calls.length, 0);

  open = true;
  await transport.push(pushRequest);
  assert.equal(calls.length, 1);
});

test("HTTP failures keep an explicit retryability class", async () => {
  const cases: readonly { status: number; code: string; retryable: boolean; body?: unknown }[] = [
    { code: "AUTH_EXPIRED", retryable: true, status: 401 },
    { code: "AUTH_REVOKED", retryable: false, status: 403 },
    { code: "HTTP_400", retryable: false, status: 400 },
    { code: "HTTP_409", retryable: false, status: 409 },
    { code: "HTTP_429", retryable: true, status: 429 },
    { code: "HTTP_503", retryable: true, status: 503 },
  ];
  for (const item of cases) {
    const { fetcher } = fakeFetch(item.status, item.body ?? { code: "ERROR" });
    const transport = createWebSyncTransport({ accessToken: () => Promise.resolve(TOKEN), apiBaseUrl: BASE, fetcher });
    await assert.rejects(
      transport.pull(pullRequest),
      (error: unknown) => error instanceof SyncTransportError && error.code === item.code && error.retryable === item.retryable,
      String(item.status),
    );
  }
  assert.deepEqual(classifySyncHttpStatus(500), { code: "HTTP_500", retryable: true });
});

test("a 401 refreshes the token once and retries with the renewed credential", async () => {
  const calls: Call[] = [];
  let refreshes = 0;
  const fetcher = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ init: init ?? {}, url: String(input) });
    const first = calls.length === 1;
    return Promise.resolve(new Response(
      JSON.stringify(first ? { code: "AUTH_EXPIRED" } : { protocolVersion: 1 }),
      { headers: { "content-type": "application/json" }, status: first ? 401 : 200 },
    ));
  };
  const transport = createWebSyncTransport({
    accessToken: () => Promise.resolve("expired-token"),
    apiBaseUrl: BASE,
    fetcher: fetcher as typeof fetch,
    refreshAccessToken: () => {
      refreshes += 1;
      return Promise.resolve("renewed-token");
    },
  });

  assert.deepEqual(await transport.pull(pullRequest), { protocolVersion: 1 });
  assert.equal(refreshes, 1);
  assert.equal(calls.length, 2);
  assert.equal((calls[0]?.init.headers as Record<string, string>)["authorization"], "Bearer expired-token");
  assert.equal((calls[1]?.init.headers as Record<string, string>)["authorization"], "Bearer renewed-token");
});

test("a 401 without a refresh hook stays retryable as AUTH_EXPIRED", async () => {
  const { fetcher } = fakeFetch(401, { message: "expired" });
  const transport = createWebSyncTransport({ accessToken: () => Promise.resolve(TOKEN), apiBaseUrl: BASE, fetcher });
  await assert.rejects(
    transport.pull(pullRequest),
    (error: unknown) => error instanceof SyncTransportError && error.code === "AUTH_EXPIRED" && error.retryable,
  );
});

test("a server-declared revocation in the body wins over the retryable 401 default", async () => {
  const { fetcher } = fakeFetch(401, { code: "AUTH_REVOKED" });
  const transport = createWebSyncTransport({ accessToken: () => Promise.resolve(TOKEN), apiBaseUrl: BASE, fetcher });
  await assert.rejects(
    transport.pull(pullRequest),
    (error: unknown) => error instanceof SyncTransportError && error.code === "AUTH_REVOKED" && !error.retryable,
  );
  assert.deepEqual(classifySyncHttpStatus(401, "AUTH_REVOKED"), { code: "AUTH_REVOKED", retryable: false });
  assert.deepEqual(classifySyncHttpStatus(401, "DEVICE_REVOKED"), { code: "DEVICE_REVOKED", retryable: false });
  assert.deepEqual(classifySyncHttpStatus(401, "SOMETHING_ELSE"), { code: "AUTH_EXPIRED", retryable: true });
});

test("a network failure or an unreadable body is retryable, and never leaks the token", async () => {
  const offline: typeof fetch = () => Promise.reject(new Error("ECONNRESET"));
  const transport = createWebSyncTransport({ accessToken: () => Promise.resolve(TOKEN), apiBaseUrl: BASE, fetcher: offline });
  await assert.rejects(
    transport.push(pushRequest),
    (error: unknown) => error instanceof SyncTransportError && error.code === "TRANSPORT_ERROR"
      && error.retryable && !error.message.includes(TOKEN),
  );

  const htmlFetch = (): Promise<Response> => Promise.resolve(new Response("<html>", { status: 200 }));
  const htmlTransport = createWebSyncTransport({ accessToken: () => Promise.resolve(TOKEN), apiBaseUrl: BASE, fetcher: htmlFetch as typeof fetch });
  await assert.rejects(
    htmlTransport.pull(pullRequest),
    (error: unknown) => error instanceof SyncTransportError && error.code === "RESPONSE_INVALID" && error.retryable,
  );
});

test("the full-snapshot endpoint is exposed for resync, through the same gate", async () => {
  const { calls, fetcher } = fakeFetch(200, { protocolVersion: 1 });
  const transport = createWebSyncTransport({ accessToken: () => Promise.resolve(TOKEN), apiBaseUrl: BASE, fetcher });
  assert.ok(transport.pullSnapshot !== undefined);
  await transport.pullSnapshot?.({ protocolVersion: 1, scope: pushRequest.scope });
  assert.deepEqual(calls.map((call) => call.url), [`${BASE}${WEB_SYNC_PATHS.snapshot}`]);
});

test("a plaintext remote origin or a path with a scheme is refused at construction", () => {
  assert.throws(
    () => createWebSyncTransport({ accessToken: () => Promise.resolve(TOKEN), apiBaseUrl: "http://api.example.test" }),
    (error: unknown) => error instanceof SyncTransportError && error.code === "CONFIG_INVALID",
  );
  assert.throws(
    () => createWebSyncTransport({
      accessToken: () => Promise.resolve(TOKEN),
      apiBaseUrl: BASE,
      paths: { push: "https://evil.example/sync" },
    }),
    (error: unknown) => error instanceof SyncTransportError && error.code === "CONFIG_INVALID",
  );
  // Loopback development over http stays allowed, matching `src/config.ts`.
  assert.doesNotThrow(() => createWebSyncTransport({
    accessToken: () => Promise.resolve(TOKEN),
    apiBaseUrl: "http://127.0.0.1:3013",
  }));
});


test("declared revocation never refreshes or retries", async () => {
  let refreshes = 0;
  const { calls, fetcher } = fakeFetch(401, { code: "DEVICE_REVOKED" });
  const transport = createWebSyncTransport({
    accessToken: () => Promise.resolve(TOKEN), apiBaseUrl: BASE, fetcher,
    refreshAccessToken: () => { refreshes += 1; return Promise.resolve("new-token"); },
  });
  await assert.rejects(transport.push(pushRequest), (error: unknown) =>
    error instanceof SyncTransportError && error.code === "DEVICE_REVOKED" && !error.retryable);
  assert.equal(refreshes, 0);
  assert.equal(calls.length, 1);
});
