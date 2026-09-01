import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest, NextResponse } from "next/server.js";

import { proxy, redirectPreservingCookies } from "./proxy.js";
import {
  setSupabaseSsrTestState,
  type SupabaseSsrTestState,
} from "./test-doubles/supabase-ssr.js";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const APP_ORIGIN = "https://web.example.com";

Object.assign(process.env, {
  API_BASE_URL: "https://api.example.com",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_proxy_test_key",
  SUPABASE_URL: "https://project-ref.supabase.co",
  WEB_ORIGIN: APP_ORIGIN,
});

test("redirectPreservingCookies copies cleared cookies to a fixed no-store redirect", () => {
  const request = new NextRequest(`${APP_ORIGIN}/app/orders`);
  const source = NextResponse.next({ request });
  source.cookies.set("sb-auth-token", "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
  });

  const redirected = redirectPreservingCookies("/login", request, source, {
    cacheControl: true,
  });

  assert.equal(redirected.status, 307);
  assert.equal(redirected.headers.get("location"), `${APP_ORIGIN}/login`);
  assert.equal(redirected.headers.get("cache-control"), "private, no-store");
  assert.match(redirected.headers.get("set-cookie") ?? "", /sb-auth-token=;/u);
  assert.match(redirected.headers.get("set-cookie") ?? "", /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu);
});

test("a Nest rejection signs out once, clears cookies and redirects without caching", async () => {
  const state = createState({
    session: { access_token: "rejected-token" },
    signOutCookies: [{
      name: "sb-auth-token",
      options: { expires: new Date(0), httpOnly: true, path: "/" },
      value: "",
    }],
    user: { id: ACTOR_ID },
  });
  const restoreFetch = stubFetch(async () => new Response(null, { status: 401 }));
  setSupabaseSsrTestState(state);

  try {
    const response = await proxy(new NextRequest(`${APP_ORIGIN}/app/orders`));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `${APP_ORIGIN}/login`);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("set-cookie") ?? "", /sb-auth-token=;/u);
    assert.deepEqual(state.calls, { getSession: 1, getUser: 1, signOut: 1 });
  } finally {
    restoreFetch();
    setSupabaseSsrTestState(undefined);
  }
});

test("a rejected protected Server Action continues with a cleared local session", async () => {
  const state = createState({
    session: { access_token: "rejected-action-token" },
    signOutCookies: [{
      name: "sb-auth-token",
      options: { expires: new Date(0), httpOnly: true, path: "/" },
      value: "",
    }],
    user: { id: ACTOR_ID },
  });
  const restoreFetch = stubFetch(async () => new Response(null, { status: 401 }));
  setSupabaseSsrTestState(state);

  try {
    const response = await proxy(new NextRequest(`${APP_ORIGIN}/app`, {
      headers: { "next-action": "logout-action" },
      method: "POST",
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("set-cookie") ?? "", /sb-auth-token=;/u);
    assert.deepEqual(state.calls, { getSession: 1, getUser: 1, signOut: 1 });
  } finally {
    restoreFetch();
    setSupabaseSsrTestState(undefined);
  }
});

test("a valid protected request calls Nest exactly once and remains private", async () => {
  const state = createState({
    session: { access_token: "valid-token" },
    user: { id: ACTOR_ID },
  });
  let fetchCalls = 0;
  const restoreFetch = stubFetch(async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.example.com/api/v1/session");
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(init?.headers, { authorization: "Bearer valid-token" });
    return Response.json({ actorId: ACTOR_ID });
  });
  setSupabaseSsrTestState(state);

  try {
    const response = await proxy(new NextRequest(`${APP_ORIGIN}/app`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(fetchCalls, 1);
    assert.deepEqual(state.calls, { getSession: 1, getUser: 1, signOut: 0 });
  } finally {
    restoreFetch();
    setSupabaseSsrTestState(undefined);
  }
});

test("an authenticated login request redirects only to app without calling Nest", async () => {
  const state = createState({ user: { id: ACTOR_ID } });
  const restoreFetch = stubFetch(async () => {
    throw new Error("NEST_MUST_NOT_BE_CALLED");
  });
  setSupabaseSsrTestState(state);

  try {
    const response = await proxy(new NextRequest(`${APP_ORIGIN}/login`));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `${APP_ORIGIN}/app`);
    assert.equal(response.headers.get("cache-control"), null);
    assert.deepEqual(state.calls, { getSession: 0, getUser: 1, signOut: 0 });
  } finally {
    restoreFetch();
    setSupabaseSsrTestState(undefined);
  }
});

test("a cleared session can render login and cannot enter a redirect cycle", async () => {
  const state = createState({ user: null });
  const restoreFetch = stubFetch(async () => {
    throw new Error("NEST_MUST_NOT_BE_CALLED");
  });
  setSupabaseSsrTestState(state);

  try {
    const response = await proxy(new NextRequest(`${APP_ORIGIN}/login`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.deepEqual(state.calls, { getSession: 0, getUser: 1, signOut: 0 });
  } finally {
    restoreFetch();
    setSupabaseSsrTestState(undefined);
  }
});

function createState(
  overrides: Partial<Omit<SupabaseSsrTestState, "calls">> = {},
): SupabaseSsrTestState {
  return {
    calls: { getSession: 0, getUser: 0, signOut: 0 },
    session: null,
    user: null,
    ...overrides,
  };
}

function stubFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
