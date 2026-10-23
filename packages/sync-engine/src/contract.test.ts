import assert from "node:assert/strict";
import test from "node:test";
import { parsePullResponse, parsePushResponse, parseSyncEnvelope, parseSyncScope, isRfc3339Utc } from "./contract.js";
import { ACTOR, DEVICE, id } from "./testkit.test.js";

function validEnvelope(): Record<string, unknown> {
  return {
    eventId: id(1), idempotencyKey: "order-1-create", deviceId: DEVICE, actorId: ACTOR,
    restaurantId: id(0xa0), branchId: id(0xa1), entityType: "Order", entityId: id(2), operation: "create",
    schemaVersion: "1", localSequence: 1, baseVersion: null, occurredAt: "2026-10-22T12:00:00.000Z",
    receivedAt: null, payload: { note: "x" }, retryCount: 0, localState: "pending",
  };
}

function codeFor(mutation: (envelope: Record<string, unknown>) => void): string {
  const envelope = validEnvelope();
  mutation(envelope);
  const result = parseSyncEnvelope(envelope);
  assert.equal(result.ok, false);
  return result.ok ? "ok" : result.code;
}

test("un envelope valido de 17 campos se acepta y queda congelado", () => {
  const result = parseSyncEnvelope(validEnvelope());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.keys(result.value).length, 17);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.payload), true);
});

test("entradas que no son objeto devuelven errores de dominio y nunca TypeError", () => {
  for (const value of [null, undefined, 42, "text", [], () => 1, Symbol("x")]) {
    const result = parseSyncEnvelope(value);
    assert.deepEqual(result, { ok: false, code: "ENVELOPE_INVALID", field: "envelope" });
  }
});

test("campos ausentes o sobrantes se rechazan nombrando el campo", () => {
  for (const key of Object.keys(validEnvelope())) {
    const envelope = validEnvelope();
    delete envelope[key];
    const result = parseSyncEnvelope(envelope);
    assert.deepEqual(result, { ok: false, code: "ENVELOPE_INVALID", field: key });
  }
  const extra = { ...validEnvelope(), serverTrusted: true };
  assert.deepEqual(parseSyncEnvelope(extra), { ok: false, code: "ENVELOPE_INVALID", field: "serverTrusted" });
});

test("tipos incorrectos se rechazan sin lanzar", () => {
  assert.equal(codeFor((e) => { e["eventId"] = 7; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["eventId"] = "not-a-uuid"; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["idempotencyKey"] = ""; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["entityType"] = "order"; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["operation"] = "upsert"; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["localSequence"] = "1"; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["localSequence"] = 1.5; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["retryCount"] = -1; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["localState"] = "done"; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["payload"] = "x"; }), "PAYLOAD_INVALID");
  assert.equal(codeFor((e) => { e["payload"] = [1]; }), "PAYLOAD_INVALID");
});

test("scope invalido se rechaza con SCOPE_INVALID", () => {
  assert.equal(codeFor((e) => { e["restaurantId"] = ""; }), "SCOPE_INVALID");
  assert.equal(codeFor((e) => { e["branchId"] = "branch-1"; }), "SCOPE_INVALID");
  assert.equal(codeFor((e) => { e["restaurantId"] = null; }), "SCOPE_INVALID");
  assert.equal(parseSyncScope({ restaurantId: id(1), branchId: id(2), extra: 1 }).ok, false);
  assert.equal(parseSyncScope(null).ok, false);
});

test("schemaVersion desconocida se rechaza con SCHEMA_UNSUPPORTED", () => {
  assert.equal(codeFor((e) => { e["schemaVersion"] = "99"; }), "SCHEMA_UNSUPPORTED");
  assert.equal(codeFor((e) => { e["schemaVersion"] = 1; }), "ENVELOPE_INVALID");
});

test("occurredAt exige RFC 3339 UTC real", () => {
  for (const bad of ["2026-10-22", "2026-10-22T12:00:00", "2026-10-22T12:00:00+02:00", "2026-02-30T12:00:00Z", "2026-10-22T24:00:00Z", "yesterday", 1760000000000]) {
    assert.equal(codeFor((e) => { e["occurredAt"] = bad; }), "ENVELOPE_INVALID", String(bad));
  }
  assert.equal(isRfc3339Utc("2026-10-22T12:00:00Z"), true);
  assert.equal(isRfc3339Utc("2026-10-22T12:00:00.123456Z"), true);
});

test("baseVersion negativo, fraccional o inconsistente con la operacion se rechaza", () => {
  assert.equal(codeFor((e) => { e["operation"] = "update"; e["baseVersion"] = -1; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["operation"] = "update"; e["baseVersion"] = 1.5; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["operation"] = "update"; e["baseVersion"] = null; }), "ENVELOPE_INVALID");
  assert.equal(codeFor((e) => { e["baseVersion"] = 3; }), "ENVELOPE_INVALID");
  const update = { ...validEnvelope(), operation: "update", baseVersion: 0 };
  assert.equal(parseSyncEnvelope(update).ok, true);
});

test("el payload sensible o con dinero invalido invalida el envelope", () => {
  assert.equal(codeFor((e) => { e["payload"] = { password: "x" }; }), "PAYLOAD_SENSITIVE_DATA");
  assert.equal(codeFor((e) => { e["payload"] = { total: 1.5 }; }), "PAYLOAD_MONEY_INVALID");
});

test("respuestas de push y pull se validan en runtime", () => {
  assert.equal(parsePushResponse(null).ok, false);
  assert.equal(parsePushResponse({ results: [{ eventId: "x" }] }).ok, false);
  assert.equal(parsePushResponse({ results: [{ eventId: id(1), idempotencyKey: "k", status: "applied" }] }).ok, false);
  const good = parsePushResponse({ results: [{ eventId: id(1), idempotencyKey: "k", status: "accepted", code: null, canonicalVersion: 2 }] });
  assert.equal(good.ok, true);
  assert.equal(parsePullResponse({ scope: { restaurantId: id(1), branchId: id(2) }, changes: "no", nextCursor: null, hasMore: false }).ok, false);
  assert.equal(parsePullResponse({ scope: { restaurantId: id(1), branchId: id(2) }, changes: [], nextCursor: 5, hasMore: false }).ok, false);
  assert.equal(parsePullResponse({ scope: { restaurantId: id(1), branchId: id(2) }, changes: [], nextCursor: "opaque", hasMore: false }).ok, true);
});
