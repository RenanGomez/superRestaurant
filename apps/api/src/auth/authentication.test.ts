import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { APP_GUARD, Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";

import type { ApiConfig, RateLimitPolicy } from "../config.js";
import { OperationalShiftsController } from "../operational-shifts.controller.js";
import {
  OperationalShiftApplicationError,
  OperationalShiftService,
} from "../operational-shifts.js";
import { PaymentsController } from "../payments.controller.js";
import { FinancialApplicationError, FinancialService } from "../payments.js";
import {
  AccessTokenRejectedError,
  AUTH_PRINCIPAL_VERIFIER,
  getAuthenticatedPrincipal,
  parseBearerAuthorization,
  RATE_LIMIT,
  RateLimitStore,
  resolveClientIp,
  SupabaseAuthGuard,
  SupabaseAuthPrincipalVerifier,
  tokenFingerprint,
} from "./authentication.js";

const config: ApiConfig = Object.freeze({
  port: 3000,
  supabasePublishableKey: "sb_publishable_test-key",
  supabaseUrl: "https://example.supabase.co",
});

test("derives actorId only from a remotely verified Supabase user", async () => {
  const calls: string[] = [];
  const verifier = new SupabaseAuthPrincipalVerifier(config, {
    auth: {
      getUser: async (token?: string) => {
        calls.push(token ?? "");
        return {
          data: { user: { id: "8CC7EB84-AF2A-4E84-95DE-967C39AF86AB" } },
          error: null,
        };
      },
    } as never,
  });

  const accessToken = "verified-access-token-value";
  assert.deepEqual(await verifier.verifyAccessToken(accessToken), {
    actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  });
  assert.deepEqual(calls, [accessToken]);
});

test("fails closed without exposing provider errors or token text", async () => {
  const accessToken = "sensitive-access-token-value";
  const verifier = new SupabaseAuthPrincipalVerifier(config, {
    auth: {
      getUser: async () => {
        throw new Error(`provider failed for ${accessToken}`);
      },
    } as never,
  });

  await assert.rejects(verifier.verifyAccessToken(accessToken), (error: unknown) => {
    assert.ok(error instanceof AccessTokenRejectedError);
    assert.equal(error.message, "ACCESS_TOKEN_REJECTED");
    assert.equal(error.message.includes(accessToken), false);
    return true;
  });
});

test("rejects missing, malformed and non-UUID users", async () => {
  const verifier = new SupabaseAuthPrincipalVerifier(config, {
    auth: {
      getUser: async () => ({ data: { user: { id: "caller-controlled-id" } }, error: null }),
    } as never,
  });

  await assert.rejects(verifier.verifyAccessToken("short"), AccessTokenRejectedError);
  await assert.rejects(verifier.verifyAccessToken("long-enough-token with-space"), AccessTokenRejectedError);
  await assert.rejects(verifier.verifyAccessToken("long-enough-token-without-space"), AccessTokenRejectedError);
});

test("accepts exactly one Bearer credential and rejects ambiguous headers", () => {
  const token = "long-enough-access-token";
  assert.equal(parseBearerAuthorization(`Bearer ${token}`), token);
  assert.equal(parseBearerAuthorization(`bearer ${token}`), token);

  for (const value of [undefined, "", token, `Bearer  ${token}`, `Bearer ${token} extra`, `Basic ${token}`]) {
    assert.equal(parseBearerAuthorization(value), undefined);
  }
});

test("guard attaches only the verifier-derived principal and never trusts request actor data", async () => {
  const request = {
    actorId: "caller-controlled-id",
    headers: { authorization: "Bearer long-enough-access-token" },
  };
  const guard = new SupabaseAuthGuard({
    verifyAccessToken: async () => Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" }),
  }, new Reflector());
  const context = {
    getClass: () => class TestController {},
    getHandler: () => function testHandler() {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;

  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(getAuthenticatedPrincipal(request), {
    actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  });
  assert.deepEqual(Object.keys(request), ["actorId", "headers"]);
});

test("guard maps malformed headers and verifier failures to one generic unauthorized response", async () => {
  for (const authorization of [undefined, "Basic credentials", "Bearer too-short"]) {
    const guard = new SupabaseAuthGuard({
      verifyAccessToken: async () => {
        throw new Error("provider detail must not escape");
      },
    }, new Reflector());
    const context = {
      getClass: () => class TestController {},
      getHandler: () => function testHandler() {},
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
    } as never;

    await assert.rejects(guard.canActivate(context), (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.equal((error as { getResponse?: () => unknown }).getResponse?.() instanceof Object, true);
      assert.deepEqual((error as { getResponse: () => unknown }).getResponse(), { code: "AUTHENTICATION_REQUIRED" });
      return true;
    });
  }
});

test("guard rejects malformed principals returned by a misconfigured verifier", async () => {
  const malformedPrincipals: unknown[] = [
    { actorId: "caller-controlled-id" },
    { actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab", extra: true },
    Object.create({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" }),
    Object.defineProperty({}, "actorId", { get: () => "8cc7eb84-af2a-4e84-95de-967c39af86ab" }),
    new Proxy({}, { ownKeys: () => { throw new Error("trap"); } }),
  ];

  for (const malformedPrincipal of malformedPrincipals) {
    const guard = new SupabaseAuthGuard({
      verifyAccessToken: async () => malformedPrincipal as never,
    }, new Reflector());
    const context = {
      getClass: () => class TestController {},
      getHandler: () => function testHandler() {},
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: "Bearer long-enough-access-token" } }) }),
    } as never;
    await assert.rejects(guard.canActivate(context), { status: 401 });
  }
});

test("financial mutations are limited per verified actor with a generic 429", async () => {
  let actorId = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
  let retryAfter = "";
  const guard = new SupabaseAuthGuard({ verifyAccessToken: async () => ({ actorId }) }, new Reflector());
  const context = () => ({
    getClass: () => PaymentsController,
    getHandler: () => PaymentsController.prototype.quote,
    switchToHttp: () => ({
      getRequest: () => ({ body: { scope: { branchId: randomUUID() } }, headers: { authorization: "Bearer sensitive-access-token-value" } }),
      getResponse: () => ({ setHeader: (name: string, value: string) => { if (name === "Retry-After") retryAfter = value; } }),
    }),
  }) as never;
  for (let i = 0; i < 60; i += 1) assert.equal(await guard.canActivate(context()), true);
  await assert.rejects(guard.canActivate(context()), (error: unknown) => {
    assert.deepEqual((error as { getResponse: () => unknown }).getResponse(), { code: "RATE_LIMITED" });
    assert.equal((error as { status: number }).status, 429);
    return true;
  });
  assert.ok(Number(retryAfter) > 0);
  actorId = "9cc7eb84-af2a-4e84-95de-967c39af86ab";
  assert.equal(await guard.canActivate(context()), true);
});

test("rate limit windows expire and capacity evicts the oldest key", () => {
  let now = 0;
  const store = new RateLimitStore(() => now, 2);
  assert.equal(store.consume("a", 1, 1000), 0);
  assert.equal(store.consume("a", 1, 1000), 1);
  assert.equal(store.consume("b", 1, 1000), 0);
  assert.equal(store.consume("c", 1, 1000), 0);
  assert.equal(store.consume("a", 1, 1000), 0);
  now = 1000;
  assert.equal(store.consume("a", 1, 1000), 0);
});

test("expired entries are swept incrementally", () => {
  let now = 0;
  const store = new RateLimitStore(() => now);
  store.consume("a", 1, 1000);
  store.consume("b", 1, 1000);
  now = 1000;
  store.consume("c", 1, 1000);
  store.consume("d", 1, 1000);
  store.consume("e", 1, 1000);
  store.consume("f", 1, 1000);
  const entries = (store as unknown as { entries: Map<string, unknown> }).entries;
  assert.equal(entries.has("a"), false);
  assert.equal(entries.has("b"), false);
});

test("successful requests to an undecorated handler do not consume the failure quota", async () => {
  const guard = new SupabaseAuthGuard({ verifyAccessToken: async () => ({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" }) }, new Reflector());
  const context = () => ({
    getClass: () => PaymentsController,
    getHandler: () => PaymentsController.prototype.report,
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: "Bearer long-enough-access-token" } }) }),
  }) as never;
  for (let i = 0; i < 301; i += 1) assert.equal(await guard.canActivate(context()), true);
});

function loginPolicy(overrides: Partial<RateLimitPolicy> = {}): RateLimitPolicy {
  return Object.freeze({
    loginMax: 3,
    loginWindowMs: 60_000,
    maxTrackedKeys: 10_000,
    trustForwardedFor: false,
    trustedProxyHops: 1,
    ...overrides,
  });
}

function unauthenticatedContext(options: {
  readonly authorization?: unknown;
  readonly omitAuthorization?: boolean;
  readonly token?: string;
  readonly ip?: string;
  readonly forwardedFor?: string;
  readonly retrySink?: (value: string) => void;
}): never {
  const headers: Record<string, unknown> = {
    ...(options.omitAuthorization === true ? {} : { authorization: options.authorization ?? `Bearer ${options.token ?? "sensitive-access-token-value"}` }),
    ...(options.forwardedFor === undefined ? {} : { "x-forwarded-for": options.forwardedFor }),
  };
  return {
    getClass: () => class TestController {},
    getHandler: () => function handler() {},
    switchToHttp: () => ({
      getRequest: () => ({ socket: { remoteAddress: options.ip ?? "127.0.0.1" }, headers }),
      getResponse: () => ({ setHeader: (_name: string, value: string) => options.retrySink?.(value) }),
    }),
  } as never;
}

const verifiedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });

test("invalid tokens are limited per client IP and 429 exposes only retry timing", async () => {
  let calls = 0;
  let retryAfter = "";
  const guard = new SupabaseAuthGuard(
    { verifyAccessToken: async () => { calls += 1; throw new Error("secret"); } },
    new Reflector(),
    loginPolicy(),
  );
  const context = () => unauthenticatedContext({ retrySink: (value) => { retryAfter = value; } });
  for (let i = 0; i < 3; i += 1) await assert.rejects(guard.canActivate(context()), { status: 401 });
  await assert.rejects(guard.canActivate(context()), (error: unknown) => {
    assert.equal((error as { status: number }).status, 429);
    const body = (error as { getResponse: () => unknown }).getResponse();
    assert.deepEqual(body, { code: "RATE_LIMITED" });
    assert.equal(JSON.stringify(body).includes("sensitive-access-token-value"), false);
    assert.equal(JSON.stringify(body).includes("127.0.0.1"), false);
    return true;
  });
  // The repeated token is short-circuited by its own failure fingerprint.
  assert.equal(calls, 3);
  assert.ok(Number(retryAfter) > 0);
});

test("the failure quota is per client address and does not leak between addresses", async () => {
  const guard = new SupabaseAuthGuard(
    { verifyAccessToken: async () => { throw new Error("secret"); } },
    new Reflector(),
    loginPolicy({ loginMax: 2 }),
  );
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(guard.canActivate(unauthenticatedContext({ ip: "10.0.0.1", token: `address-one-token-${i}` })), { status: 401 });
  }
  await assert.rejects(guard.canActivate(unauthenticatedContext({ ip: "10.0.0.1", token: "address-one-token-2" })), { status: 429 });
  await assert.rejects(guard.canActivate(unauthenticatedContext({ ip: "10.0.0.2", token: "address-two-token" })), { status: 401 });
});

test("a single credential sprayed from many addresses is limited by token fingerprint", async () => {
  let calls = 0;
  const guard = new SupabaseAuthGuard(
    { verifyAccessToken: async () => { calls += 1; throw new Error("secret"); } },
    new Reflector(),
    loginPolicy({ loginMax: 3 }),
  );
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(guard.canActivate(unauthenticatedContext({ ip: `10.0.0.${i + 1}` })), { status: 401 });
  }
  await assert.rejects(guard.canActivate(unauthenticatedContext({ ip: "10.0.0.99" })), { status: 429 });
  assert.equal(calls, 3);
});

test("a header-less flood never blocks a valid token", async () => {
  const validToken = "valid-access-token-value";
  const guard = new SupabaseAuthGuard(
    {
      verifyAccessToken: async (token) => {
        if (token === validToken) return verifiedPrincipal;
        throw new Error("secret");
      },
    },
    new Reflector(),
    loginPolicy({ loginMax: 2 }),
  );
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(guard.canActivate(unauthenticatedContext({ omitAuthorization: true, ip: "10.0.0.1" })), { status: 401 });
  }
  await assert.rejects(guard.canActivate(unauthenticatedContext({ omitAuthorization: true, ip: "10.0.0.1" })), { status: 429 });
  // Same client address, same minute: the valid token is in a different bucket.
  assert.equal(await guard.canActivate(unauthenticatedContext({ ip: "10.0.0.1", token: validToken })), true);
});

test("an invalid-token flood never blocks a valid token from the same address", async () => {
  const validToken = "valid-access-token-value";
  const guard = new SupabaseAuthGuard(
    {
      verifyAccessToken: async (token) => {
        if (token === validToken) return verifiedPrincipal;
        throw new Error("secret");
      },
    },
    new Reflector(),
    loginPolicy({ loginMax: 2 }),
  );
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(guard.canActivate(unauthenticatedContext({ ip: "10.0.0.1", token: `bad-token-${i}` })), i < 2 ? { status: 401 } : { status: 429 });
  }
  assert.equal(await guard.canActivate(unauthenticatedContext({ ip: "10.0.0.1", token: validToken })), true);
});

test("a valid token is verified repeatedly without consuming the failure quota", async () => {
  let calls = 0;
  const guard = new SupabaseAuthGuard(
    { verifyAccessToken: async () => { calls += 1; return verifiedPrincipal; } },
    new Reflector(),
    loginPolicy({ loginMax: 1 }),
  );
  for (let i = 0; i < 25; i += 1) assert.equal(await guard.canActivate(unauthenticatedContext({})), true);
  assert.equal(calls, 25);
});

test("the failure window resets after the configured interval", async () => {
  let now = 0;
  let calls = 0;
  const guard = new SupabaseAuthGuard(
    { verifyAccessToken: async () => { calls += 1; throw new Error("secret"); } },
    new Reflector(),
    loginPolicy({ loginMax: 1, loginWindowMs: 1_000 }),
    () => now,
  );
  await assert.rejects(guard.canActivate(unauthenticatedContext({})), { status: 401 });
  await assert.rejects(guard.canActivate(unauthenticatedContext({})), { status: 429 });
  now = 1_000;
  await assert.rejects(guard.canActivate(unauthenticatedContext({})), { status: 401 });
  assert.equal(calls, 2);
});

test("the missing-credential window resets after the configured interval", async () => {
  let now = 0;
  const guard = new SupabaseAuthGuard(
    { verifyAccessToken: async () => { throw new Error("secret"); } },
    new Reflector(),
    loginPolicy({ loginMax: 1, loginWindowMs: 1_000 }),
    () => now,
  );
  await assert.rejects(guard.canActivate(unauthenticatedContext({ omitAuthorization: true })), { status: 401 });
  await assert.rejects(guard.canActivate(unauthenticatedContext({ omitAuthorization: true })), { status: 429 });
  now = 1_000;
  await assert.rejects(guard.canActivate(unauthenticatedContext({ omitAuthorization: true })), { status: 401 });
});

test("forwarded addresses are only honoured when a trusted proxy is configured", async () => {
  const request = {
    headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.9" },
    socket: { remoteAddress: "10.0.0.5" },
  };
  assert.equal(resolveClientIp(request, false), "10.0.0.5");
  assert.equal(resolveClientIp(request, true), "198.51.100.9");
  assert.equal(resolveClientIp(request, true, 2), "203.0.113.7");
  assert.equal(resolveClientIp(request, true, 3), "10.0.0.5");
  assert.equal(resolveClientIp({ headers: { "x-forwarded-for": "not-an-ip" }, socket: { remoteAddress: "10.0.0.5" } }, true), "10.0.0.5");
  assert.equal(resolveClientIp({ headers: {}, socket: {} }, false), "unknown");

  const guard = new SupabaseAuthGuard(
    { verifyAccessToken: async () => { throw new Error("secret"); } },
    new Reflector(),
    loginPolicy({ loginMax: 1, trustForwardedFor: true }),
  );
  assert.notEqual(tokenFingerprint("a-token-that-is-long-enough"), "a-token-that-is-long-enough");
  await assert.rejects(guard.canActivate(unauthenticatedContext({ ip: "10.0.0.5", forwardedFor: "203.0.113.7", token: "forwarded-token-a" })), { status: 401 });
  await assert.rejects(guard.canActivate(unauthenticatedContext({ ip: "10.0.0.6", forwardedFor: "203.0.113.7", token: "forwarded-token-b" })), { status: 429 });
  await assert.rejects(guard.canActivate(unauthenticatedContext({ ip: "10.0.0.7", forwardedFor: "203.0.113.8", token: "forwarded-token-c" })), { status: 401 });
});

test("rate limiting never writes credentials or addresses to logs", async () => {
  const originalInfo = console.info;
  const originalError = console.error;
  const logged: unknown[] = [];
  console.info = (...args: unknown[]) => { logged.push(args); };
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const guard = new SupabaseAuthGuard(
      { verifyAccessToken: async () => { throw new Error("secret"); } },
      new Reflector(),
      loginPolicy({ loginMax: 1 }),
    );
    await assert.rejects(guard.canActivate(unauthenticatedContext({})), { status: 401 });
    await assert.rejects(guard.canActivate(unauthenticatedContext({})), { status: 429 });
    assert.deepEqual(logged, []);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});

test("payment and shift mutations advertise rate limits; reads do not", () => {
  const reflector = new Reflector();
  assert.deepEqual(reflector.get(RATE_LIMIT, PaymentsController.prototype.quote), { limit: 60, windowMs: 60_000 });
  assert.deepEqual(reflector.get(RATE_LIMIT, PaymentsController.prototype.collect), { limit: 60, windowMs: 60_000 });
  assert.deepEqual(reflector.get(RATE_LIMIT, OperationalShiftsController.prototype.open), { limit: 60, windowMs: 60_000 });
  assert.equal(reflector.get(RATE_LIMIT, PaymentsController.prototype.report), undefined);
  assert.equal(reflector.get(RATE_LIMIT, OperationalShiftsController.prototype.listActive), undefined);
});

test("HTTP integration: the 61st collect attempt returns a generic 429 before the service", async () => {
  let served = 0;
  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentsController],
    providers: [
      { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => ({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" }) } },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
      {
        provide: FinancialService,
        useValue: {
          collect: async () => {
            served += 1;
            throw new FinancialApplicationError("request");
          },
        },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, "127.0.0.1");
  try {
    const address = app.getHttpServer().address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/payments/collect`;
    const headers = { authorization: "Bearer a-long-enough-token-value", "content-type": "application/json" };
    let limited: Response | undefined;
    for (let i = 0; i < 61; i += 1) {
      const response = await fetch(url, { body: "{}", headers, method: "POST" });
      if (response.status === 429) { limited = response; break; }
      assert.equal(response.status, 400);
    }
    assert.ok(limited !== undefined);
    assert.equal(limited.headers.get("retry-after") !== null, true);
    const body = await limited.json() as unknown;
    assert.deepEqual(body, { code: "RATE_LIMITED" });
    assert.equal(JSON.stringify(body).includes("a-long-enough-token"), false);
    assert.equal(served, 60);
  } finally {
    await app.close();
  }
});

test("HTTP integration: shift opening is metered the same way", async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [OperationalShiftsController],
    providers: [
      { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => ({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" }) } },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
      {
        provide: OperationalShiftService,
        useValue: {
          open: async () => {
            throw new OperationalShiftApplicationError("request");
          },
        },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, "127.0.0.1");
  try {
    const address = app.getHttpServer().address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/shifts/open`;
    const headers = { authorization: "Bearer a-long-enough-token-value", "content-type": "application/json" };
    const statuses: number[] = [];
    for (let i = 0; i < 61; i += 1) {
      statuses.push((await fetch(url, { body: "{}", headers, method: "POST" })).status);
    }
    assert.deepEqual(statuses.slice(0, 2), [400, 400]);
    assert.equal(statuses[60], 429);
  } finally {
    await app.close();
  }
});
