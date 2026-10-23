import { fail, ok, unwrap, type ParseResult } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { asPlainRecord, type JsonObject, type JsonValue } from "./json.js";

/** OFFLINE_SYNC_CONTRACT section 12 limits. */
export const MAX_PAYLOAD_DEPTH = 8;
export const MAX_PAYLOAD_BYTES = 64 * 1024;

const SENSITIVE_KEY = /(cvv|cvc|password|passwd|secret|token)/iu;
const PAN_KEY = /^(pan|card_?number)$/iu;
const MONEY_KEY = /^(amount|total|price)/iu;
const CURRENCY = /^[A-Z]{3}$/u;
// A whole 13-19 digit run (optional single space/hyphen separators) not glued to other alphanumerics.
const PAN_CANDIDATE = /(?<![0-9A-Za-z])\d(?:[ -]?\d){12,18}(?![0-9A-Za-z])/gu;

export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/u.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function looksLikePan(text: string): boolean {
  for (const match of text.matchAll(PAN_CANDIDATE)) {
    const digits = match[0].replace(/[ -]/gu, "");
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return true;
  }
  return false;
}

/** UTF-8 size without TextEncoder, which is not in the ES2024 lib this package compiles against. */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const symbol of text) {
    const code = symbol.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

type Walk =ParseResult<JsonValue>;

function walk(value: unknown, depth: number, key: string): Walk {
  if (value === null || typeof value === "boolean") return ok(value);
  if (typeof value === "string") {
    return looksLikePan(value) ? fail("PAYLOAD_SENSITIVE_DATA", key) : ok(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fail("PAYLOAD_INVALID", key);
    return ok(value);
  }
  if (Array.isArray(value)) {
    if (depth + 1 > MAX_PAYLOAD_DEPTH) return fail("PAYLOAD_TOO_DEEP", key);
    const items: JsonValue[] = [];
    for (const item of value as readonly unknown[]) {
      const child = walk(item, depth + 1, key);
      if (!child.ok) return child;
      items.push(child.value);
    }
    return ok(items);
  }
  const record = asPlainRecord(value);
  if (record === undefined) return fail("PAYLOAD_INVALID", key);
  if (depth + 1 > MAX_PAYLOAD_DEPTH) return fail("PAYLOAD_TOO_DEEP", key);
  return walkRecord(record, depth + 1, key);
}

function walkRecord(record: Readonly<Record<string, unknown>>, depth: number, path: string): Walk {
  const copy: Record<string, JsonValue> = {};
  for (const name of Object.keys(record)) {
    const fieldPath = path === "" ? name : `${path}.${name}`;
    if (name === "__proto__") return fail("PAYLOAD_INVALID", fieldPath);
    if (SENSITIVE_KEY.test(name) || PAN_KEY.test(name)) return fail("PAYLOAD_SENSITIVE_DATA", fieldPath);
    const raw = record[name];
    if (MONEY_KEY.test(name)) {
      if (typeof raw === "number" && !Number.isSafeInteger(raw)) return fail("PAYLOAD_MONEY_INVALID", fieldPath);
      if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && !isMoney(raw)) {
        return fail("PAYLOAD_MONEY_INVALID", fieldPath);
      }
    }
    const child = walk(raw, depth, fieldPath);
    if (!child.ok) return child;
    copy[name] = child.value;
  }
  if (Object.hasOwn(copy, "amountMinor") && !isMoney(copy)) return fail("PAYLOAD_MONEY_INVALID", path);
  return ok(copy);
}

function isMoney(value: unknown): boolean {
  const record = asPlainRecord(value);
  if (record === undefined) return false;
  return typeof record["amountMinor"] === "number"
    && Number.isSafeInteger(record["amountMinor"])
    && typeof record["currency"] === "string"
    && CURRENCY.test(record["currency"]);
}

/**
 * Validates a payload against section 12 and returns a deep-frozen clone, so callers
 * can keep mutating their own object without touching durable state.
 */
export function checkPayload(value: unknown): ParseResult<JsonObject> {
  const record = asPlainRecord(value);
  if (record === undefined) return fail("PAYLOAD_INVALID", "payload");
  const walked = walkRecord(record, 1, "");
  if (!walked.ok) return walked;
  if (utf8ByteLength(JSON.stringify(walked.value)) > MAX_PAYLOAD_BYTES) {
    return fail("PAYLOAD_TOO_LARGE", "payload");
  }
  return ok(deepFreeze(walked.value as JsonObject));
}

export function assertSafePayload(value: unknown): JsonObject {
  return unwrap(checkPayload(value));
}
