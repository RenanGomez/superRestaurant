import assert from "node:assert/strict";
import test from "node:test";

import { parseSessionResponse, verifyRemoteSession } from "./session.js";

const API_BASE_URL = "https://api.example.com";
const VALID_ACTOR_ID = "11111111-1111-4111-8111-111111111111";

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("parseSessionResponse accepts only the exact {actorId: uuid} contract", () => {
  assert.deepEqual(parseSessionResponse({ actorId: VALID_ACTOR_ID }), { actorId: VALID_ACTOR_ID });
  assert.deepEqual(parseSessionResponse({ actorId: VALID_ACTOR_ID.toUpperCase() }), { actorId: VALID_ACTOR_ID });
});

test("parseSessionResponse rejects hostile or malformed shapes", () => {
  assert.equal(parseSessionResponse(null), undefined);
  assert.equal(parseSessionResponse("not-an-object"), undefined);
  assert.equal(parseSessionResponse({}), undefined);
  assert.equal(parseSessionResponse({ actorId: "not-a-uuid" }), undefined);
  assert.equal(parseSessionResponse({ actorId: VALID_ACTOR_ID, role: "admin" }), undefined);
  assert.equal(parseSessionResponse({ actorId: 123 }), undefined);
  assert.equal(parseSessionResponse(Object.create({ actorId: VALID_ACTOR_ID }) as unknown), undefined);

  const getterHostile: Record<string, unknown> = {};
  Object.defineProperty(getterHostile, "actorId", {
    enumerable: true,
    get(): string {
      return VALID_ACTOR_ID;
    },
  });
  assert.equal(parseSessionResponse(getterHostile), undefined);
});

test("verifyRemoteSession returns the actorId on a 200 with the exact contract", async () => {
  const restore = stubFetch(async (input, init) => {
    assert.equal(String(input), "https://api.example.com/api/v1/session");
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.authorization, "Bearer good-token");
    return new Response(JSON.stringify({ actorId: VALID_ACTOR_ID }), { status: 200 });
  });
  try {
    assert.deepEqual(await verifyRemoteSession("good-token", API_BASE_URL), { actorId: VALID_ACTOR_ID });
  } finally {
    restore();
  }
});

test("verifyRemoteSession fails closed on a non-200 (rejected/expired token)", async () => {
  const restore = stubFetch(async () => new Response(JSON.stringify({ actorId: VALID_ACTOR_ID }), { status: 401 }));
  try {
    assert.equal(await verifyRemoteSession("rejected-token", API_BASE_URL), undefined);
  } finally {
    restore();
  }
});

test("verifyRemoteSession fails closed when apps/api is unreachable", async () => {
  const restore = stubFetch(async () => {
    throw new Error("network down");
  });
  try {
    assert.equal(await verifyRemoteSession("any-token", API_BASE_URL), undefined);
  } finally {
    restore();
  }
});

test("verifyRemoteSession fails closed on a hostile 200 body (extra keys)", async () => {
  const restore = stubFetch(
    async () => new Response(JSON.stringify({ actorId: VALID_ACTOR_ID, role: "admin" }), { status: 200 }),
  );
  try {
    assert.equal(await verifyRemoteSession("any-token", API_BASE_URL), undefined);
  } finally {
    restore();
  }
});

test("verifyRemoteSession fails closed on a non-JSON 200 body", async () => {
  const restore = stubFetch(async () => new Response("not json", { status: 200 }));
  try {
    assert.equal(await verifyRemoteSession("any-token", API_BASE_URL), undefined);
  } finally {
    restore();
  }
});
