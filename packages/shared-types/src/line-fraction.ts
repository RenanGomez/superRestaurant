/**
 * Half-and-half ("mitad y mitad") selection carried by a capture selection line or an add-item
 * command. It holds ids and labels only: the server prices it from the catalog (greater flavor
 * price plus halved extras) and freezes the result with the per-half breakdown.
 */
export const LINE_FRACTION_MAX_EXTRAS = 20 as const;
export const LINE_FRACTION_MAX_EXCLUSIONS = 40 as const;
export const LINE_FRACTION_HALVES = Object.freeze(["half-a", "half-b"] as const);

export type LineFractionHalfV1 = (typeof LINE_FRACTION_HALVES)[number];

export interface LineFractionSlotV1 {
  readonly excludedIngredientIds: readonly string[];
  readonly extraOptionIds: readonly string[];
  readonly flavorOptionId: string;
  readonly fraction: LineFractionHalfV1;
}

export interface LineFractionV1 {
  readonly geometry: "halves";
  /** Always exactly two slots, `half-a` first. */
  readonly slots: readonly LineFractionSlotV1[];
}

/** One frozen half of an order line, as shown on tickets and in the order detail. */
export interface OrderDetailFractionHalfV1 {
  readonly amountMinor: number;
  readonly exclusions: readonly string[];
  readonly extras: readonly string[];
  readonly flavorName: string;
  readonly fraction: LineFractionHalfV1;
}

/**
 * A priced half in a plan projection or line quote: the display half plus the ids of its flavor,
 * extras and exclusions. The ids are optional when parsing so projections stored before they were
 * emitted still parse; the API always emits them.
 */
export interface FractionHalfProjectionV1 extends OrderDetailFractionHalfV1 {
  readonly excludedIngredientIds?: readonly string[];
  readonly extraOptionIds?: readonly string[];
  readonly flavorOptionId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Parses the optional `fraction` property: `null`/absent mean a whole (not split) line. */
export function parseLineFractionV1(value: unknown): LineFractionV1 | undefined {
  const record = exactRecord(value, ["geometry", "slots"]);
  if (record === undefined || own(record, "geometry") !== "halves") return undefined;
  const rawSlots = denseArray(own(record, "slots"), 2);
  if (rawSlots === undefined || rawSlots.length !== 2) return undefined;
  const slots = rawSlots.map(parseSlot);
  if (slots.some((slot) => slot === undefined)) return undefined;
  const parsed = slots as LineFractionSlotV1[];
  const ordered = [...parsed].sort((left, right) => (left.fraction === "half-a" ? -1 : right.fraction === "half-a" ? 1 : 0));
  if (ordered[0]?.fraction !== "half-a" || ordered[1]?.fraction !== "half-b") return undefined;
  return Object.freeze({ geometry: "halves" as const, slots: Object.freeze(ordered) });
}

function parseSlot(value: unknown): LineFractionSlotV1 | undefined {
  const record = exactRecord(value, ["fraction", "flavorOptionId", "extraOptionIds", "excludedIngredientIds"]);
  if (record === undefined) return undefined;
  const fraction = own(record, "fraction");
  const flavorOptionId = uuid(own(record, "flavorOptionId"));
  const rawExtras = denseArray(own(record, "extraOptionIds"), LINE_FRACTION_MAX_EXTRAS);
  const rawExclusions = denseArray(own(record, "excludedIngredientIds"), LINE_FRACTION_MAX_EXCLUSIONS);
  if (
    (fraction !== "half-a" && fraction !== "half-b") || flavorOptionId === undefined
    || rawExtras === undefined || rawExclusions === undefined
  ) return undefined;
  const extraOptionIds = rawExtras.map(uuid);
  const excludedIngredientIds = rawExclusions.map(label);
  if (extraOptionIds.some((id) => id === undefined) || excludedIngredientIds.some((id) => id === undefined)) return undefined;
  if (new Set(extraOptionIds).size !== extraOptionIds.length) return undefined;
  if (new Set(excludedIngredientIds).size !== excludedIngredientIds.length) return undefined;
  return Object.freeze({
    excludedIngredientIds: Object.freeze(excludedIngredientIds as string[]),
    extraOptionIds: Object.freeze(extraOptionIds as string[]),
    flavorOptionId,
    fraction,
  });
}

export function parseOrderDetailFractionHalfV1(value: unknown): OrderDetailFractionHalfV1 | undefined {
  const record = exactRecord(value, ["fraction", "flavorName", "amountMinor", "extras", "exclusions"]);
  if (record === undefined) return undefined;
  const fraction = own(record, "fraction");
  const flavorName = display(own(record, "flavorName"), 200);
  const amountMinor = own(record, "amountMinor");
  const rawExtras = denseArray(own(record, "extras"), 100);
  const rawExclusions = denseArray(own(record, "exclusions"), 100);
  if (
    (fraction !== "half-a" && fraction !== "half-b") || flavorName === undefined
    || typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor < 0
    || rawExtras === undefined || rawExclusions === undefined
  ) return undefined;
  const extras = rawExtras.map((entry) => display(entry, 200));
  const exclusions = rawExclusions.map((entry) => display(entry, 200));
  if (extras.some((entry) => entry === undefined) || exclusions.some((entry) => entry === undefined)) return undefined;
  return Object.freeze({
    amountMinor,
    exclusions: Object.freeze(exclusions as string[]),
    extras: Object.freeze(extras as string[]),
    flavorName,
    fraction,
  });
}

/** Parses a projection half: the strict display half plus all-or-none ids (flavor, extras, exclusions). */
export function parseFractionHalfProjectionV1(value: unknown): FractionHalfProjectionV1 | undefined {
  const base = ["fraction", "flavorName", "amountMinor", "extras", "exclusions"];
  const withIds = exactRecord(value, [...base, "flavorOptionId", "extraOptionIds", "excludedIngredientIds"]);
  if (withIds === undefined) return parseOrderDetailFractionHalfV1(value);
  const half = parseOrderDetailFractionHalfV1(Object.fromEntries(base.map((key) => [key, own(withIds, key)])));
  const flavorOptionId = uuid(own(withIds, "flavorOptionId"));
  const rawExtras = denseArray(own(withIds, "extraOptionIds"), LINE_FRACTION_MAX_EXTRAS);
  const rawExclusions = denseArray(own(withIds, "excludedIngredientIds"), LINE_FRACTION_MAX_EXCLUSIONS);
  if (half === undefined || flavorOptionId === undefined || rawExtras === undefined || rawExclusions === undefined) return undefined;
  const extraOptionIds = rawExtras.map(uuid);
  const excludedIngredientIds = rawExclusions.map(label);
  if (extraOptionIds.some((id) => id === undefined) || excludedIngredientIds.some((id) => id === undefined)) return undefined;
  return Object.freeze({
    ...half,
    excludedIngredientIds: Object.freeze(excludedIngredientIds as string[]),
    extraOptionIds: Object.freeze(extraOptionIds as string[]),
    flavorOptionId,
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch { return undefined; }
}

function denseArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
  }
  return value;
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

/** An ingredient label: trimmed, 1-80 characters, no control characters. */
function label(value: unknown): string | undefined {
  return display(value, 80);
}

function display(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum && value === value.trim()
    && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined;
}
