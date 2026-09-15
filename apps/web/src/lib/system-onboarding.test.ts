import assert from "node:assert/strict";
import test from "node:test";

import { canAccessSystemAdministration, listSystemRestaurants } from "./system-onboarding.js";

const API_BASE_URL = "https://api.example.com";

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("system administration access is visible only when the authoritative endpoint returns 200", async () => {
  let restore = stubFetch(async (input, init) => {
    assert.equal(String(input), `${API_BASE_URL}/api/v1/system/onboarding/restaurants`);
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.authorization, "Bearer global-admin-token");
    return new Response("[]", { status: 200 });
  });
  try {
    assert.equal(await canAccessSystemAdministration("global-admin-token", API_BASE_URL), true);
  } finally {
    restore();
  }

  restore = stubFetch(async () => new Response(JSON.stringify({ code: "SYSTEM_ADMIN_REQUIRED" }), { status: 403 }));
  try {
    assert.equal(await canAccessSystemAdministration("manager-token", API_BASE_URL), false);
  } finally {
    restore();
  }
});

test("system administration access fails closed on a network error or hostile success body", async () => {
  let restore = stubFetch(async () => {
    throw new Error("network down");
  });
  try {
    assert.equal(await canAccessSystemAdministration("token", API_BASE_URL), false);
  } finally {
    restore();
  }

  restore = stubFetch(async () => new Response(JSON.stringify({ restaurants: [] }), { status: 200 }));
  try {
    assert.equal(await canAccessSystemAdministration("token", API_BASE_URL), false);
  } finally {
    restore();
  }
});

test("system administration access cannot hold app rendering indefinitely", async () => {
  const restore = stubFetch(async (_input, init) => await new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal instanceof AbortSignal);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  try {
    const result = canAccessSystemAdministration("manager-token", API_BASE_URL, 10);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(await result, false);
  } finally {
    restore();
  }
});

test("restaurant summaries reject malformed rows", async () => {
  const restore = stubFetch(async () => new Response(JSON.stringify([
    { disabledAt: null, id: "restaurant-id", name: "Vittorinos Pizza", timeZone: "America/Hermosillo" },
    { disabledAt: null, id: "bad-row", name: "Missing time zone" },
  ]), { status: 200 }));
  try {
    const restaurants = await listSystemRestaurants("token", API_BASE_URL);
    assert.deepEqual(restaurants, [
      { disabledAt: null, id: "restaurant-id", name: "Vittorinos Pizza", timeZone: "America/Hermosillo" },
    ]);
  } finally {
    restore();
  }
});
