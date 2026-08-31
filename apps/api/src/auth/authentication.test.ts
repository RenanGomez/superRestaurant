import assert from "node:assert/strict";
import test from "node:test";

import { Reflector } from "@nestjs/core";

import type { ApiConfig } from "../config.js";
import {
  AccessTokenRejectedError,
  getAuthenticatedPrincipal,
  parseBearerAuthorization,
  SupabaseAuthGuard,
  SupabaseAuthPrincipalVerifier,
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
