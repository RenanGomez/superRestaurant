import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";

import { collectPayment, getCashRegisterReport, getCheckoutOrder } from "./finance.js";

const scope = parseBranchScope({
  branchId: "22222222-2222-4222-8222-222222222222",
  restaurantId: "11111111-1111-4111-8111-111111111111",
});
if (scope === undefined) throw new Error("invalid test scope");
const sessionId = "33333333-3333-4333-8333-333333333333";
const registerId = "44444444-4444-4444-8444-444444444444";
const deviceId = "55555555-5555-4555-8555-555555555555";
const orderId = "66666666-6666-4666-8666-666666666666";
const query = Object.freeze({ cashRegisterSessionId: sessionId, deviceId, registerId, schemaVersion: 1, scope });
const register = Object.freeze({
  cashRegisterSessionId: sessionId, cashierId: "77777777-7777-4777-8777-777777777777",
  closedAt: null, countedClosingBalanceMinor: null, currency: "XTS", differenceMinor: null,
  expectedCashBalanceMinor: 12_000, openedAt: "2026-09-03T20:00:00.000Z", openingFloatMinor: 2_000,
  registerId, replayed: false, schemaVersion: 1, scope, shiftId: "88888888-8888-4888-8888-888888888888",
  status: "open", version: 3,
});

test("financial client reads exact scoped report and checkout endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token");
    return urls.length === 1
      ? new Response(JSON.stringify({
        cardManualCapturedMinor: 3_000, cashCapturedMinor: 10_000, nextLocalSequence: 4,
        paymentCount: 2, register, schemaVersion: 1, scope, totalCapturedMinor: 13_000,
      }))
      : new Response(JSON.stringify({
        capturedAmountMinor: 2_000, cashRegisterSessionId: sessionId, cashRegisterVersion: 3,
        currency: "XTS", nextLocalSequence: 4, orderId, orderStatus: "partially_paid",
        orderTotalMinor: 10_000, orderVersion: 5, remainingBalanceMinor: 8_000, schemaVersion: 1, scope,
      }));
  };
  try {
    assert.equal((await getCashRegisterReport("token", "https://api.test", query)).status, "ok");
    assert.equal((await getCheckoutOrder("token", "https://api.test", { ...query, orderId })).status, "ok");
    assert.match(urls[0] ?? "", /cash-registers\/report\?/u);
    assert.match(urls[1] ?? "", /payments\/checkout\?/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("financial client validates before sending and maps recoverable failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ code: "FINANCIAL_CONFLICT" }), { status: 409 });
  };
  try {
    assert.equal((await getCashRegisterReport("token", "https://api.test", { ...query, deviceId: "bad" })).status, "invalid");
    assert.equal(calls, 0);
    assert.equal((await collectPayment("token", "https://api.test", {
      amountMinor: 1_000, cardManualEvidence: null, cashRegisterExpectedVersion: 3,
      cashRegisterSessionId: sessionId, deviceId, eventId: "99999999-9999-4999-8999-999999999999",
      idempotencyKey: "pay-1", localSequence: 4, method: "cash", occurredAt: "2026-09-03T20:01:00.000Z",
      orderExpectedVersion: 5, orderId, paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      schemaVersion: 1, scope,
    })).status, "conflict");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
