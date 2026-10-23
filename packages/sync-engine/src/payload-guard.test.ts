import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PAYLOAD_BYTES, checkPayload, passesLuhn, assertSafePayload } from "./payload-guard.js";
import { SyncEngineError } from "./errors.js";

function codeOf(value: unknown): string {
  const result = checkPayload(value);
  return result.ok ? "ok" : result.code;
}

function nested(levels: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let level = 1; level < levels; level += 1) value = { child: value };
  return value;
}

test("Luhn distingue un PAN de prueba valido de uno alterado", () => {
  assert.equal(passesLuhn("4111111111111111"), true);
  assert.equal(passesLuhn("4111111111111112"), false);
});

test("un PAN que pasa Luhn se rechaza, con o sin separadores y en cualquier valor", () => {
  assert.equal(codeOf({ note: "4111111111111111" }), "PAYLOAD_SENSITIVE_DATA");
  assert.equal(codeOf({ note: "card 4111 1111 1111 1111 end" }), "PAYLOAD_SENSITIVE_DATA");
  assert.equal(codeOf({ list: ["4111-1111-1111-1111"] }), "PAYLOAD_SENSITIVE_DATA");
  assert.equal(codeOf({ cardNumber: "x" }), "PAYLOAD_SENSITIVE_DATA");
});

test("digitos que no son PAN ni identificadores normales no producen falsos positivos", () => {
  assert.equal(codeOf({ note: "4111111111111112" }), "ok");
  assert.equal(codeOf({ ref: "550e8400-e29b-41d4-a716-446655440000" }), "ok");
  assert.equal(codeOf({ epochMs: 1760000000000 }), "ok");
});

test("claves cvv, cvc, password, secret y token se rechazan", () => {
  for (const key of ["cvv", "CVC", "password", "clientSecret", "accessToken"]) {
    assert.equal(codeOf({ [key]: "x" }), "PAYLOAD_SENSITIVE_DATA", key);
  }
});

test("profundidad 8 se acepta y 9 se rechaza", () => {
  assert.equal(codeOf(nested(8)), "ok");
  assert.equal(codeOf(nested(9)), "PAYLOAD_TOO_DEEP");
  assert.equal(codeOf({ items: [[[[[[[1]]]]]]] }), "ok");
  assert.equal(codeOf({ items: [[[[[[[[1]]]]]]]] }), "PAYLOAD_TOO_DEEP");
});

test("el limite de 64 KiB se aplica en bytes UTF-8", () => {
  assert.equal(codeOf({ blob: "a".repeat(MAX_PAYLOAD_BYTES - 20) }), "ok");
  assert.equal(codeOf({ blob: "a".repeat(65 * 1024) }), "PAYLOAD_TOO_LARGE");
  assert.equal(codeOf({ blob: "é".repeat(MAX_PAYLOAD_BYTES / 2) }), "PAYLOAD_TOO_LARGE");
});

test("dinero: amount 10.5 se rechaza y amountMinor con moneda ISO se acepta", () => {
  assert.equal(codeOf({ amount: 10.5 }), "PAYLOAD_MONEY_INVALID");
  assert.equal(codeOf({ totalDue: 0.1 }), "PAYLOAD_MONEY_INVALID");
  assert.equal(codeOf({ price: { amountMinor: 10.5, currency: "MXN" } }), "PAYLOAD_MONEY_INVALID");
  assert.equal(codeOf({ price: { amountMinor: 1050 } }), "PAYLOAD_MONEY_INVALID");
  assert.equal(codeOf({ price: { amountMinor: 1050, currency: "mxn" } }), "PAYLOAD_MONEY_INVALID");
  assert.equal(codeOf({ amountMinor: 1050, currency: "MXN" }), "ok");
  assert.equal(codeOf({ lines: [{ sku: "a", price: { amountMinor: 500, currency: "MXN" } }] }), "ok");
});

test("tipos no serializables y claves peligrosas se rechazan", () => {
  assert.equal(codeOf(null), "PAYLOAD_INVALID");
  assert.equal(codeOf([]), "PAYLOAD_INVALID");
  assert.equal(codeOf({ when: new Date() }), "PAYLOAD_INVALID");
  assert.equal(codeOf({ run: () => 1 }), "PAYLOAD_INVALID");
  assert.equal(codeOf({ missing: undefined }), "PAYLOAD_INVALID");
  assert.equal(codeOf({ big: Infinity }), "PAYLOAD_INVALID");
  assert.equal(codeOf(JSON.parse('{"__proto__": {"x": 1}}')), "PAYLOAD_INVALID");
});

test("el resultado es una copia profundamente congelada", () => {
  const source = { lines: [{ qty: 1 }] };
  const safe = assertSafePayload(source);
  source.lines[0] = { qty: 99 };
  assert.deepEqual(safe, { lines: [{ qty: 1 }] });
  assert.equal(Object.isFrozen(safe), true);
  assert.equal(Object.isFrozen(safe["lines"]), true);
  assert.throws(() => assertSafePayload({ cvv: "1" }), (error: unknown) => error instanceof SyncEngineError && error.code === "PAYLOAD_SENSITIVE_DATA");
});
