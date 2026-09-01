import assert from "node:assert/strict";
import test from "node:test";

import "./dining-layout.test.js";

import {
  encodeBranchPreference,
  encodeScope,
  findMembership,
  listMemberships,
  parseBranchPreference,
  parseEncodedScope,
} from "./memberships.js";

const API_BASE_URL = "https://api.example.com";
const RESTAURANT_A = "11111111-1111-4111-8111-111111111111";
const BRANCH_A = "22222222-2222-4222-8222-222222222222";
const BRANCH_B = "33333333-3333-4333-8333-333333333333";

const VALID_LIST_BODY = {
  memberships: [
    {
      branchName: "Centro",
      restaurantName: "La Cocina",
      roles: ["owner"],
      scope: { branchId: BRANCH_A, restaurantId: RESTAURANT_A },
    },
  ],
  schemaVersion: 1,
};

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("listMemberships returns the parsed list on a 200 with the exact contract", async () => {
  const restore = stubFetch(async (input, init) => {
    assert.equal(String(input), "https://api.example.com/api/v1/access/memberships");
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.authorization, "Bearer good-token");
    return new Response(JSON.stringify(VALID_LIST_BODY), { status: 200 });
  });
  try {
    const result = await listMemberships("good-token", API_BASE_URL);
    assert.equal(result?.memberships.length, 1);
    assert.equal(result?.memberships[0]?.scope.branchId, BRANCH_A);
  } finally {
    restore();
  }
});

test("listMemberships fails closed on a non-200, network error, or hostile body", async () => {
  let restore = stubFetch(async () => new Response(JSON.stringify(VALID_LIST_BODY), { status: 503 }));
  try {
    assert.equal(await listMemberships("any-token", API_BASE_URL), undefined);
  } finally {
    restore();
  }

  restore = stubFetch(async () => {
    throw new Error("network down");
  });
  try {
    assert.equal(await listMemberships("any-token", API_BASE_URL), undefined);
  } finally {
    restore();
  }

  restore = stubFetch(async () => new Response(JSON.stringify({ ...VALID_LIST_BODY, extra: true }), { status: 200 }));
  try {
    assert.equal(await listMemberships("any-token", API_BASE_URL), undefined);
  } finally {
    restore();
  }
});

test("findMembership matches only the exact Restaurant/Branch pair", () => {
  const list = VALID_LIST_BODY.memberships as unknown as Parameters<typeof findMembership>[0];
  assert.equal(findMembership(list, { branchId: BRANCH_A, restaurantId: RESTAURANT_A })?.branchName, "Centro");
  assert.equal(findMembership(list, { branchId: BRANCH_B, restaurantId: RESTAURANT_A }), undefined);
});

test("parseBranchPreference round-trips a value encoded by encodeBranchPreference", () => {
  const scope = { branchId: BRANCH_A, restaurantId: RESTAURANT_A };
  assert.deepEqual(parseBranchPreference(encodeBranchPreference(scope)), scope);
});

test("parseBranchPreference rejects malformed, non-UUID, or absent cookie values", () => {
  assert.equal(parseBranchPreference(undefined), undefined);
  assert.equal(parseBranchPreference("not json"), undefined);
  assert.equal(parseBranchPreference(JSON.stringify({ branchId: "x", restaurantId: RESTAURANT_A })), undefined);
  assert.equal(parseBranchPreference(JSON.stringify({ restaurantId: RESTAURANT_A })), undefined);
  assert.equal(
    parseBranchPreference(JSON.stringify({ branchId: BRANCH_A, restaurantId: RESTAURANT_A, extra: true })),
    undefined,
  );
});

test("parseEncodedScope round-trips a value encoded by encodeScope", () => {
  const scope = { branchId: BRANCH_A, restaurantId: RESTAURANT_A };
  assert.deepEqual(parseEncodedScope(encodeScope(scope)), scope);
});

test("parseEncodedScope rejects hostile or malformed radio values", () => {
  assert.equal(parseEncodedScope("no-separator"), undefined);
  assert.equal(parseEncodedScope("not-a-uuid:also-not"), undefined);
  assert.equal(parseEncodedScope(`${RESTAURANT_A}:not-a-uuid`), undefined);
  assert.equal(parseEncodedScope(""), undefined);
});
