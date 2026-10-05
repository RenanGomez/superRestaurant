import type { BranchScope } from "./index.js";
import { type LineFractionV1, type OrderDetailFractionHalfV1, parseOrderDetailFractionHalfV1 } from "./line-fraction.js";
import {
  parseCaptureSelectionPlanV1,
  type CaptureSelectionModifierGroupV1,
} from "./capture-selection-plan.js";

export const CAPTURE_LINE_QUOTE_SCHEMA_VERSION = 1 as const;

const MAX_QUOTE_QUANTITY = 99;
const MAX_MODIFIERS = 2_500;
/** Fixed placeholder id so the request can reuse the selection-line validator verbatim. */
const QUOTE_LINE_ID = "00000000-0000-4000-8000-000000000001";

/**
 * A line being assembled (product, size, modifiers, halves, quantity) to price against the live
 * catalog. Carries no prices and persists nothing; the answer is only an estimate until the line
 * is added to a selection plan, which prices it again with the same domain function.
 */
export interface CaptureLineQuoteRequestV1 {
  readonly schemaVersion: typeof CAPTURE_LINE_QUOTE_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly catalogVersion: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly modifierGroups: readonly CaptureSelectionModifierGroupV1[];
  readonly fraction: LineFractionV1 | null;
  readonly quantity: number;
}

export interface CaptureLineQuoteModifierV1 {
  readonly groupId: string;
  readonly optionId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export interface CaptureLineQuoteResultV1 {
  readonly schemaVersion: typeof CAPTURE_LINE_QUOTE_SCHEMA_VERSION;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly unitPriceMinor: number;
  /** Pre-tax line total, the same figure the selection projection reports as `lineTotalMinor`. */
  readonly lineTotalMinor: number;
  readonly modifiers: readonly CaptureLineQuoteModifierV1[];
  readonly geometry: "whole" | "halves";
  /** Two priced halves for a half-and-half line; empty for a whole line. */
  readonly fractionBreakdown: readonly OrderDetailFractionHalfV1[];
}

export function parseCaptureLineQuoteRequestV1(value: unknown): CaptureLineQuoteRequestV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "catalogVersion", "productId", "variantId", "modifierGroups", "fraction", "quantity",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== CAPTURE_LINE_QUOTE_SCHEMA_VERSION) return undefined;
  const scopeRecord = exactRecord(own(record, "scope"), ["restaurantId", "branchId"]);
  const restaurantId = scopeRecord === undefined ? undefined : uuid(own(scopeRecord, "restaurantId"));
  const branchId = scopeRecord === undefined ? undefined : uuid(own(scopeRecord, "branchId"));
  const quantity = own(record, "quantity");
  if (restaurantId === undefined || branchId === undefined
    || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUOTE_QUANTITY) {
    return undefined;
  }
  const rawFraction = own(record, "fraction");
  // Delegate the line shape (uuids, modifier groups, halves, variant required for halves) to the plan parser.
  const plan = parseCaptureSelectionPlanV1({
    schemaVersion: 1,
    catalogVersion: own(record, "catalogVersion"),
    lines: [{
      lineId: QUOTE_LINE_ID,
      productId: own(record, "productId"),
      variantId: own(record, "variantId"),
      quantity,
      modifierGroups: own(record, "modifierGroups"),
      note: null,
      ...(rawFraction === null ? {} : { fraction: rawFraction }),
    }],
  });
  const line = plan?.lines[0];
  if (plan === undefined || line === undefined) return undefined;
  const modifierCount = line.modifierGroups.reduce((total, group) => total + group.selections.length, 0);
  if (modifierCount > MAX_MODIFIERS) return undefined;
  return deepFreeze({
    catalogVersion: plan.catalogVersion,
    fraction: line.fraction ?? null,
    modifierGroups: line.modifierGroups,
    productId: line.productId,
    quantity: line.quantity,
    schemaVersion: CAPTURE_LINE_QUOTE_SCHEMA_VERSION,
    scope: { branchId, restaurantId } as BranchScope,
    variantId: line.variantId,
  });
}

export function parseCaptureLineQuoteResultV1(value: unknown): CaptureLineQuoteResultV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "catalogVersion", "currency", "unitPriceMinor", "lineTotalMinor", "modifiers", "geometry",
    "fractionBreakdown",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== CAPTURE_LINE_QUOTE_SCHEMA_VERSION) return undefined;
  const catalogVersion = uuid(own(record, "catalogVersion"));
  const currency = own(record, "currency");
  const unitPriceMinor = integer(own(record, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
  const lineTotalMinor = integer(own(record, "lineTotalMinor"), 0, Number.MAX_SAFE_INTEGER);
  const geometry = own(record, "geometry");
  const rawModifiers = exactArray(own(record, "modifiers"), MAX_MODIFIERS);
  const rawHalves = exactArray(own(record, "fractionBreakdown"), 2);
  if (catalogVersion === undefined || typeof currency !== "string" || !/^[A-Z]{3}$/u.test(currency)
    || unitPriceMinor === undefined || lineTotalMinor === undefined
    || (geometry !== "whole" && geometry !== "halves") || rawModifiers === undefined || rawHalves === undefined) {
    return undefined;
  }
  const modifiers: CaptureLineQuoteModifierV1[] = [];
  for (const rawModifier of rawModifiers) {
    const modifier = exactRecord(rawModifier, ["groupId", "optionId", "name", "quantity", "unitPriceMinor"]);
    if (modifier === undefined) return undefined;
    const groupId = uuid(own(modifier, "groupId"));
    const optionId = uuid(own(modifier, "optionId"));
    const name = own(modifier, "name");
    const modifierQuantity = integer(own(modifier, "quantity"), 1, 100);
    const modifierPrice = integer(own(modifier, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
    if (groupId === undefined || optionId === undefined || typeof name !== "string" || name.length < 1
      || name.length > 200 || modifierQuantity === undefined || modifierPrice === undefined) return undefined;
    modifiers.push({ groupId, name, optionId, quantity: modifierQuantity, unitPriceMinor: modifierPrice });
  }
  const halves = rawHalves.map(parseOrderDetailFractionHalfV1);
  if (halves.some((half) => half === undefined)
    || (geometry === "halves" ? halves.length !== 2 : halves.length !== 0)) return undefined;
  return deepFreeze({
    catalogVersion,
    currency,
    fractionBreakdown: halves as OrderDetailFractionHalfV1[],
    geometry,
    lineTotalMinor,
    modifiers,
    schemaVersion: CAPTURE_LINE_QUOTE_SCHEMA_VERSION,
    unitPriceMinor,
  });
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function own(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function exactArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value)
    || length.value < 0 || length.value > maximum) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) return undefined;
  const items: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    items.push(descriptor.value);
  }
  return items;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

type PlainRecord = Readonly<Record<string, unknown>>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
