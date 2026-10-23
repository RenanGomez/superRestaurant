export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type PlainRecord = Readonly<Record<string, unknown>>;

/** True only for objects created by literals, `Object.create(null)` or JSON.parse. */
export function asPlainRecord(value: unknown): PlainRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return value as PlainRecord;
}

export function hasExactKeys(record: PlainRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) return key;
  }
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) return key;
  }
  return undefined;
}

export function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
