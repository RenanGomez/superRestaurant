import assert from "node:assert/strict";
import test from "node:test";

import { authorizeBranch } from "./branch-selection.js";

const API_BASE_URL = "https://api.example.com";
const RESTAURANT_A = "11111111-1111-4111-8111-111111111111";
const BRANCH_A = "22222222-2222-4222-8222-222222222222";

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("authorizeBranch returns the authorized scope+roles on a 200 with the exact contract", async () => {
  const restore = stubFetch(async (input, init) => {
    assert.equal(String(input), "https://api.example.com/api/v1/access/branch");
    assert.equal(init?.method, "POST");
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.authorization, "Bearer good-token");
    assert.equal(headers?.["content-type"], "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), { branchId: BRANCH_A, restaurantId: RESTAURANT_A });
    return new Response(
      JSON.stringify({ branchId: BRANCH_A, restaurantId: RESTAURANT_A, roles: ["owner"] }),
      { status: 200 },
    );
  });
  try {
    const result = await authorizeBranch("good-token", API_BASE_URL, { branchId: BRANCH_A, restaurantId: RESTAURANT_A });
    assert.deepEqual(result, { branchId: BRANCH_A, restaurantId: RESTAURANT_A, roles: ["owner"] });
  } finally {
    restore();
  }
});

test("authorizeBranch rejects a false pair or a revocation with a still-live token (Nest 403)", async () => {
  const restore = stubFetch(
    async () => new Response(JSON.stringify({ code: "SCOPE_AUTHORIZATION_REJECTED" }), { status: 403 }),
  );
  try {
    const result = await authorizeBranch("live-token", API_BASE_URL, { branchId: BRANCH_A, restaurantId: RESTAURANT_A });
    assert.equal(result, undefined);
  } finally {
    restore();
  }
});

test("authorizeBranch fails closed when apps/api is unreachable", async () => {
  const restore = stubFetch(async () => {
    throw new Error("network down");
  });
  try {
    assert.equal(
      await authorizeBranch("any-token", API_BASE_URL, { branchId: BRANCH_A, restaurantId: RESTAURANT_A }),
      undefined,
    );
  } finally {
    restore();
  }
});

test("authorizeBranch rejects a hostile 200 body: extra keys, non-UUID ids, or unknown roles", async () => {
  const hostileBodies = [
    { branchId: BRANCH_A, restaurantId: RESTAURANT_A, roles: ["owner"], extra: true },
    { branchId: "not-a-uuid", restaurantId: RESTAURANT_A, roles: ["owner"] },
    { branchId: BRANCH_A, restaurantId: RESTAURANT_A, roles: ["overlord"] },
    { branchId: BRANCH_A, restaurantId: RESTAURANT_A, roles: ["owner", "owner"] },
    { branchId: BRANCH_A, restaurantId: RESTAURANT_A, roles: [] },
    { branchId: BRANCH_A, restaurantId: RESTAURANT_A },
  ];

  for (const body of hostileBodies) {
    const restore = stubFetch(async () => new Response(JSON.stringify(body), { status: 200 }));
    try {
      const result = await authorizeBranch("any-token", API_BASE_URL, { branchId: BRANCH_A, restaurantId: RESTAURANT_A });
      assert.equal(result, undefined, `expected rejection for body ${JSON.stringify(body)}`);
    } finally {
      restore();
    }
  }
});

test("authorizeBranch rejects a successful response bound to a different scope", async () => {
  const otherBranch = "33333333-3333-4333-8333-333333333333";
  const restore = stubFetch(async () => new Response(
    JSON.stringify({ branchId: otherBranch, restaurantId: RESTAURANT_A, roles: ["owner"] }),
    { status: 200 },
  ));
  try {
    assert.equal(
      await authorizeBranch("good-token", API_BASE_URL, {
        branchId: BRANCH_A,
        restaurantId: RESTAURANT_A,
      }),
      undefined,
    );
  } finally {
    restore();
  }
});

test("authorizeBranch fails closed on a non-JSON 200 body", async () => {
  const restore = stubFetch(async () => new Response("not json", { status: 200 }));
  try {
    assert.equal(
      await authorizeBranch("any-token", API_BASE_URL, { branchId: BRANCH_A, restaurantId: RESTAURANT_A }),
      undefined,
    );
  } finally {
    restore();
  }
});
