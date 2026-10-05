import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizePostalCodes, formatDeliveryMatch, formatDeliveryQuote, parseDeliveryFeeMinor,
  quoteMatchesDeliverySnapshot, requestDelivery } from "./delivery-zones.js";
import type { DeliveryQuoteV1 } from "@super-restaurant/shared-types";

const scope = { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" };
const zoneId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const quote: DeliveryQuoteV1 = { schemaVersion: 1, quoteId: "b2f98c08-e0cd-4819-a2ac-361662b33575",
  ...scope, captureDraftId: "75178249-d01e-4462-8f75-7fe1b777acaf", addressSnapshotRef: "df0f904e-df39-4c4e-a619-924bc21e59cb",
  address: { postalCode: "85000", locality: "Navojoa" }, currency: "MXN", timeZone: "America/Hermosillo",
  quotedAt: "2026-09-26T12:00:00.000Z", scheduledFor: null, version: 1, coverageStatus: "covered", zoneId,
  feeMinor: 2500, promiseStart: "2026-09-26T12:00:00.000Z", promiseEnd: "2026-09-26T12:15:00.000Z",
  expiresAt: "2026-09-26T12:00:00.000Z", override: null };

test("postal codes canonicalize with code-unit order and reject invalid lists", () => {
  assert.deepEqual(canonicalizePostalCodes(" 85000, 83000\n85000, A1 "), ["83000", "85000", "A1"]);
  assert.deepEqual(canonicalizePostalCodes("  , \n"), []);
  assert.deepEqual(canonicalizePostalCodes(`85000,${"x".repeat(33)}`), []);
  assert.deepEqual(canonicalizePostalCodes("85000,\u0000"), []);
});

test("fee input converts to exact minor units", () => {
  assert.equal(parseDeliveryFeeMinor("0.01"), 1);
  assert.equal(parseDeliveryFeeMinor("123.45"), 12345);
  assert.equal(parseDeliveryFeeMinor("1.234"), undefined);
  assert.equal(parseDeliveryFeeMinor("9999999999999999"), undefined);
});

test("quote formatting uses server fee and promise with locale", () => {
  const formatted = formatDeliveryQuote(quote, "es-MX");
  assert.equal(formatted.status, "Con cobertura");
  assert.equal(formatted.fee, new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(25));
  assert.match(formatted.window, /5:00/);
  assert.equal(formatted.expiry, new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short",
    timeZone: quote.timeZone }).format(new Date(quote.expiresAt)));
  assert.equal(formatDeliveryQuote({ ...quote, coverageStatus: "not_covered", zoneId: null, feeMinor: 0 }, "es-MX").status, "Fuera de cobertura");
});

test("match formatting uses the server fee and coverage", () => {
  const match = { schemaVersion: 1 as const, coverageStatus: "covered" as const, zoneId, zoneName: "Centro",
    feeMinor: 3500, currency: "MXN", promiseMinutes: 15,
    promiseStart: "2026-09-26T12:00:00.000Z", promiseEnd: "2026-09-26T12:15:00.000Z",
    evaluatedAt: "2026-09-26T12:00:00.000Z" };
  assert.equal(formatDeliveryMatch(match, "es-MX"), `Zona Centro · Envío ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(35)} · 0-15 min`);
  assert.equal(formatDeliveryMatch({ ...match, coverageStatus: "not_covered", zoneId: null, zoneName: null, feeMinor: 0 }, "es-MX"), "Fuera de cobertura");
});

test("match request sends address and accepts only a valid result", async () => {
  const original = globalThis.fetch;
  const command = { schemaVersion: 1, ...scope, address: { postalCode: "85000", locality: "Navojoa" } };
  const result = { schemaVersion: 1, coverageStatus: "covered", zoneId, zoneName: "Centro", feeMinor: 3500,
    currency: "MXN", promiseMinutes: 15, promiseStart: "2026-09-26T12:00:00.000Z",
    promiseEnd: "2026-09-26T12:15:00.000Z", evaluatedAt: "2026-09-26T12:00:00.000Z" };
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.example/api/v1/delivery-zones/match");
      assert.deepEqual(JSON.parse(String(init?.body)), command);
      return new Response(JSON.stringify(result));
    };
    assert.deepEqual(await requestDelivery("token", "https://api.example", "match", command), { ok: true, value: result });
    globalThis.fetch = async () => new Response(JSON.stringify({ ...result, feeMinor: 12.5 }));
    assert.deepEqual(await requestDelivery("token", "https://api.example", "match", command), { ok: false, error: "unavailable" });
  } finally { globalThis.fetch = original; }
});

test("a delivery quote is accepted only for the current draft and address snapshot", () => {
  assert.equal(quoteMatchesDeliverySnapshot(quote, quote.captureDraftId, quote.addressSnapshotRef), true);
  assert.equal(quoteMatchesDeliverySnapshot(quote, quote.captureDraftId, zoneId), false);
  assert.equal(quoteMatchesDeliverySnapshot(quote, zoneId, quote.addressSnapshotRef), false);
  assert.equal(quoteMatchesDeliverySnapshot(quote, quote.captureDraftId, null), false);
});

test("delivery request uses exact quote route and rejects foreign scope", async () => {
  const original = globalThis.fetch; let sent: unknown;
  try {
    globalThis.fetch = async (url, init) => { assert.equal(String(url), "https://api.example/api/v1/delivery-zones/quote");
      sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify(quote)); };
    assert.equal((await requestDelivery("token", "https://api.example", "quote", { schemaVersion: 1, scope,
      captureDraftId: quote.captureDraftId, scheduledFor: null })).ok, true);
    assert.deepEqual(sent, { schemaVersion: 1, scope, captureDraftId: quote.captureDraftId, scheduledFor: null });
    globalThis.fetch = async () => new Response(JSON.stringify({ ...quote, branchId: zoneId }));
    assert.deepEqual(await requestDelivery("token", "https://api.example", "quote", { schemaVersion: 1, scope,
      captureDraftId: quote.captureDraftId, scheduledFor: null }), { ok: false, error: "unavailable" });
  } finally { globalThis.fetch = original; }
});

test("delivery request maps capture status errors and validates commands before fetch", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, error] of [[400, "invalid"], [401, "denied"], [403, "denied"], [404, "missing"],
      [409, "conflict"], [500, "unavailable"]] as const) {
      globalThis.fetch = async () => new Response("{}", { status });
      assert.deepEqual(await requestDelivery("token", "https://api.example", "list", { schemaVersion: 1,
        scope: { kind: "branch", ...scope } }), { ok: false, error });
    }
    globalThis.fetch = async () => { throw new Error("unexpected transport"); };
    assert.deepEqual(await requestDelivery("token", "https://api.example", "quote", { ...quote, feeMinor: 0 }),
      { ok: false, error: "invalid" });
  } finally { globalThis.fetch = original; }
});

test("zone list and CAS upsert validate exact scope and replay version", async () => {
  const original = globalThis.fetch;
  const zone = { schemaVersion: 1, zoneId, ...scope, name: "Centro", postalCodes: ["85000"], localities: [],
    feeMinor: 2500, currency: "MXN", active: true, version: 1, updatedAt: "2026-09-26T12:00:00.000Z" };
  const list = { schemaVersion: 1, scope: { kind: "branch", ...scope }, zones: [zone] };
  const command = { schemaVersion: 1, scope, zoneId, expectedVersion: 0, name: zone.name,
    postalCodes: zone.postalCodes, localities: zone.localities, feeMinor: zone.feeMinor, currency: zone.currency,
    active: true, eventId: "a409ec59-9f5e-496d-a45d-b83a46b49674", idempotencyKey: "9544c299-d25b-44ce-98ed-d30116610887",
    deviceId: "8cc7eb84-af2a-4e84-95de-967c39af86ab", occurredAt: "2026-09-26T12:00:00.000Z", reason: null };
  try {
    globalThis.fetch = async (url, init) => { assert.equal(String(url), "https://api.example/api/v1/delivery-zones/list");
      assert.deepEqual(JSON.parse(String(init?.body)), { schemaVersion: 1, scope: list.scope }); return new Response(JSON.stringify(list)); };
    assert.equal((await requestDelivery("token", "https://api.example", "list", { schemaVersion: 1, scope: list.scope })).ok, true);
    globalThis.fetch = async () => new Response(JSON.stringify({ ...list, scope: { kind: "branch", restaurantId: scope.restaurantId, branchId: zoneId }, zones: [] }));
    assert.deepEqual(await requestDelivery("token", "https://api.example", "list", { schemaVersion: 1, scope: list.scope }), { ok: false, error: "unavailable" });
    globalThis.fetch = async (url, init) => { assert.equal(String(url), "https://api.example/api/v1/delivery-zones/upsert");
      assert.deepEqual(JSON.parse(String(init?.body)), command); return new Response(JSON.stringify({ schemaVersion: 1, zone, replayed: true })); };
    assert.equal((await requestDelivery("token", "https://api.example", "upsert", command)).ok, true);
    globalThis.fetch = async () => new Response(JSON.stringify({ schemaVersion: 1, zone: { ...zone, version: 2 }, replayed: false }));
    assert.deepEqual(await requestDelivery("token", "https://api.example", "upsert", command), { ok: false, error: "unavailable" });
  } finally { globalThis.fetch = original; }
});
