import type { BranchScope } from "./index.js";
import {
  parseLineFractionV1,
  parseOrderDetailFractionHalfV1,
  type LineFractionV1,
  type OrderDetailFractionHalfV1,
} from "./line-fraction.js";
import {
  COMMERCIAL_CAPTURE_V4_SCHEMA_VERSION,
  parseCaptureWorkspaceV3,
  type CaptureVersionedMutationInputV1,
  type CaptureWorkspaceV3,
} from "./commercial-capture.js";

export const CAPTURE_SELECTION_PLAN_SCHEMA_VERSION = 1 as const;

const MAX_MODIFIER_SELECTIONS = 50;
const MAX_MODIFIER_GROUPS = 50;
const MAX_LINES = 200;
/** Largest quantity a single selection line (and a line quote) may carry. */
export const CAPTURE_SELECTION_LINE_MAX_QUANTITY = 1_000;
const MAX_LINE_QUANTITY = CAPTURE_SELECTION_LINE_MAX_QUANTITY;
const MAX_MODIFIER_QUANTITY = 100;
const MAX_NOTE_LENGTH = 200;

/** A single chosen modifier option and how many units of it apply to the line. */
export interface CaptureSelectionModifierSelectionV1 {
  readonly optionId: string;
  readonly quantity: number;
}

/** A modifier group's selections for one capture line; `optionId` is unique within the group. */
export interface CaptureSelectionModifierGroupV1 {
  readonly groupId: string;
  readonly selections: readonly CaptureSelectionModifierSelectionV1[];
}

/**
 * One catalog-derived line inside a selection plan. Carries no prices: the
 * server derives money exclusively from the catalog at materialization time.
 */
export interface CaptureSelectionLineV1 {
  readonly lineId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly quantity: number;
  readonly modifierGroups: readonly CaptureSelectionModifierGroupV1[];
  readonly note: string | null;
  /** Optional half-and-half split; absent means a whole line. Requires `variantId`. */
  readonly fraction?: LineFractionV1;
}

/**
 * The full set of catalog-derived lines attached to a capture draft. An empty
 * `lines` array is a valid plan and means "clear the selection".
 */
export interface CaptureSelectionPlanV1 {
  readonly schemaVersion: typeof CAPTURE_SELECTION_PLAN_SCHEMA_VERSION;
  readonly catalogVersion: string;
  readonly lines: readonly CaptureSelectionLineV1[];
}

/**
 * Replaces the entire selection plan attached to a held capture draft. Like
 * every other Capture mutation this command carries only ids and quantities;
 * the server resolves current catalog prices when it materializes the Order.
 */
export interface ReplaceCaptureSelectionPlanCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly attentionLeaseId: string;
  readonly plan: CaptureSelectionPlanV1;
}

/** A single resolved modifier line inside the read-side selection projection. */
export interface CaptureSelectionPlanProjectionModifierV1 {
  readonly groupId: string;
  readonly optionId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

/** A single resolved line inside the read-side selection projection. */
export interface CaptureSelectionPlanProjectionLineV1 {
  readonly lineId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly note: string | null;
  readonly modifiers: readonly CaptureSelectionPlanProjectionModifierV1[];
  /** Half-and-half line only: the two priced halves (flavor, extras, exclusions); absent for whole lines. */
  readonly halves?: readonly OrderDetailFractionHalfV1[];
}

/**
 * Server-computed, read-only view of a selection plan for the capture
 * workspace: resolved names and prices in minor units, never floats.
 */
export interface CaptureSelectionPlanProjectionV1 {
  readonly schemaVersion: typeof CAPTURE_SELECTION_PLAN_SCHEMA_VERSION;
  readonly catalogVersion: string;
  readonly currency: string;
  readonly subtotalMinor: number;
  /**
   * Tax-inclusive total of every line (unit+modifiers, quantity, line discount, then line tax) --
   * the exact amount the confirmed Order will charge for these lines, unlike `subtotalMinor`
   * (tax-exclusive). Additive alongside `subtotalMinor`, never a replacement: existing readers of
   * `subtotalMinor` are unaffected.
   */
  readonly itemsTotalMinor: number;
  readonly lineCount: number;
  readonly lines: readonly CaptureSelectionPlanProjectionLineV1[];
}

/** Durable selection intent only, mirroring `CaptureRepeatOrderPlanSummaryV1`; no prices, no lines. */
export interface CaptureSelectionPlanSummaryV1 {
  readonly appliedCaptureVersion: number;
  readonly catalogVersion: string;
  readonly lineCount: number;
  readonly schemaVersion: typeof CAPTURE_SELECTION_PLAN_SCHEMA_VERSION;
}

/**
 * Widens `CaptureWorkspaceV3` with a nullable selection-plan summary (facts
 * from storage) and a nullable, server-computed selection projection
 * (resolved names/prices from the catalog, never stored). Exactly one of
 * `repeatOrderPlan`/`selectionPlan` is non-null per capture.
 */
export interface CaptureWorkspaceV4 extends Omit<CaptureWorkspaceV3, "schemaVersion"> {
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_V4_SCHEMA_VERSION;
  readonly selectionPlan: CaptureSelectionPlanSummaryV1 | null;
  readonly selectionProjection: CaptureSelectionPlanProjectionV1 | null;
}

export function parseCaptureSelectionPlanSummaryV1(value: unknown): CaptureSelectionPlanSummaryV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "catalogVersion", "appliedCaptureVersion", "lineCount"]);
  if (record === undefined || own(record, "schemaVersion") !== CAPTURE_SELECTION_PLAN_SCHEMA_VERSION) return undefined;
  const catalogVersion = uuid(own(record, "catalogVersion"));
  const appliedCaptureVersion = integer(own(record, "appliedCaptureVersion"), 2, Number.MAX_SAFE_INTEGER);
  const lineCount = integer(own(record, "lineCount"), 0, MAX_LINES);
  return catalogVersion === undefined || appliedCaptureVersion === undefined || lineCount === undefined
    ? undefined
    : Object.freeze({ appliedCaptureVersion, catalogVersion, lineCount, schemaVersion: CAPTURE_SELECTION_PLAN_SCHEMA_VERSION });
}

export function parseCaptureWorkspaceV4(value: unknown): CaptureWorkspaceV4 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "detail", "customerSnapshot", "fulfillmentSnapshot", "repeatOrderPlan",
    "selectionPlan", "selectionProjection",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_V4_SCHEMA_VERSION) return undefined;
  const v3 = parseCaptureWorkspaceV3({
    schemaVersion: 3,
    detail: own(record, "detail"),
    customerSnapshot: own(record, "customerSnapshot"),
    fulfillmentSnapshot: own(record, "fulfillmentSnapshot"),
    repeatOrderPlan: own(record, "repeatOrderPlan"),
  });
  const rawSelectionPlan = own(record, "selectionPlan");
  const selectionPlan = rawSelectionPlan === null ? null : parseCaptureSelectionPlanSummaryV1(rawSelectionPlan);
  const rawSelectionProjection = own(record, "selectionProjection");
  const selectionProjection = rawSelectionProjection === null
    ? null
    : parseCaptureSelectionPlanProjectionV1(rawSelectionProjection);
  if (v3 === undefined || selectionPlan === undefined || selectionProjection === undefined
    || (v3.repeatOrderPlan !== null && selectionPlan !== null)
    || (selectionProjection !== null && (selectionPlan === null
      || selectionProjection.catalogVersion !== selectionPlan.catalogVersion
      || selectionProjection.lineCount !== selectionPlan.lineCount))) return undefined;
  return Object.freeze({
    customerSnapshot: v3.customerSnapshot,
    detail: v3.detail,
    fulfillmentSnapshot: v3.fulfillmentSnapshot,
    repeatOrderPlan: v3.repeatOrderPlan,
    schemaVersion: COMMERCIAL_CAPTURE_V4_SCHEMA_VERSION,
    selectionPlan,
    selectionProjection,
  });
}

export function parseCaptureSelectionPlanV1(value: unknown): CaptureSelectionPlanV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "catalogVersion", "lines"]);
  if (record === undefined || own(record, "schemaVersion") !== CAPTURE_SELECTION_PLAN_SCHEMA_VERSION) return undefined;
  const catalogVersion = uuid(own(record, "catalogVersion"));
  const rawLines = exactArray(own(record, "lines"), MAX_LINES);
  if (catalogVersion === undefined || rawLines === undefined) return undefined;
  const lineIds = new Set<string>();
  const lines: CaptureSelectionLineV1[] = [];
  for (const rawLine of rawLines) {
    const line = parseSelectionLine(rawLine);
    if (line === undefined || lineIds.has(line.lineId)) return undefined;
    lineIds.add(line.lineId);
    lines.push(line);
  }
  return deepFreeze({
    catalogVersion,
    lines,
    schemaVersion: CAPTURE_SELECTION_PLAN_SCHEMA_VERSION,
  });
}

export function parseReplaceCaptureSelectionPlanCommandV1(
  value: unknown,
): ReplaceCaptureSelectionPlanCommandV1 | undefined {
  const record = exactRecord(value, [...VERSIONED_KEYS, "attentionLeaseId", "plan"]);
  if (record === undefined || own(record, "schemaVersion") !== CAPTURE_SELECTION_PLAN_SCHEMA_VERSION) return undefined;
  const common = parseMutationInput(record);
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const expectedVersion = integer(own(record, "expectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const attentionLeaseId = uuid(own(record, "attentionLeaseId"));
  const plan = parseCaptureSelectionPlanV1(own(record, "plan"));
  if (common === undefined || captureDraftId === undefined || expectedVersion === undefined
    || attentionLeaseId === undefined || plan === undefined) {
    return undefined;
  }
  return Object.freeze({
    ...common,
    attentionLeaseId,
    captureDraftId,
    expectedVersion,
    plan,
    schemaVersion: CAPTURE_SELECTION_PLAN_SCHEMA_VERSION,
  });
}

export function parseCaptureSelectionPlanProjectionV1(value: unknown): CaptureSelectionPlanProjectionV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "catalogVersion", "currency", "subtotalMinor", "itemsTotalMinor", "lineCount", "lines",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== CAPTURE_SELECTION_PLAN_SCHEMA_VERSION) return undefined;
  const catalogVersion = uuid(own(record, "catalogVersion"));
  const currency = boundedText(own(record, "currency"), 3, 3);
  const subtotalMinor = integer(own(record, "subtotalMinor"), 0, Number.MAX_SAFE_INTEGER);
  const itemsTotalMinor = integer(own(record, "itemsTotalMinor"), 0, Number.MAX_SAFE_INTEGER);
  const lineCount = integer(own(record, "lineCount"), 0, Number.MAX_SAFE_INTEGER);
  const rawLines = exactArray(own(record, "lines"), MAX_LINES);
  if (catalogVersion === undefined || currency === undefined || !/^[A-Z]{3}$/u.test(currency)
    || subtotalMinor === undefined || itemsTotalMinor === undefined || lineCount === undefined || rawLines === undefined
    || rawLines.length !== lineCount) {
    return undefined;
  }
  const lines: CaptureSelectionPlanProjectionLineV1[] = [];
  for (const rawLine of rawLines) {
    const line = parseProjectionLine(rawLine);
    if (line === undefined) return undefined;
    lines.push(line);
  }
  return deepFreeze({
    catalogVersion,
    currency,
    itemsTotalMinor,
    lineCount,
    lines,
    schemaVersion: CAPTURE_SELECTION_PLAN_SCHEMA_VERSION,
    subtotalMinor,
  });
}

function parseSelectionLine(value: unknown): CaptureSelectionLineV1 | undefined {
  const lineKeys = ["lineId", "productId", "variantId", "quantity", "modifierGroups", "note"];
  const record = exactRecord(value, lineKeys) ?? exactRecord(value, [...lineKeys, "fraction"]);
  if (record === undefined) return undefined;
  const rawFraction = Object.hasOwn(record, "fraction") ? own(record, "fraction") : undefined;
  const fraction = rawFraction === undefined ? undefined : parseLineFractionV1(rawFraction);
  if (rawFraction !== undefined && fraction === undefined) return undefined;
  const lineId = uuid(own(record, "lineId"));
  const productId = uuid(own(record, "productId"));
  const variantId = nullableUuid(own(record, "variantId"));
  const quantity = integer(own(record, "quantity"), 1, MAX_LINE_QUANTITY);
  const rawGroups = exactArray(own(record, "modifierGroups"), MAX_MODIFIER_GROUPS);
  const note = nullableBoundedText(own(record, "note"), 1, MAX_NOTE_LENGTH);
  if (lineId === undefined || productId === undefined || variantId === undefined || quantity === undefined
    || rawGroups === undefined || note === undefined) {
    return undefined;
  }
  const groupIds = new Set<string>();
  const modifierGroups: CaptureSelectionModifierGroupV1[] = [];
  for (const rawGroup of rawGroups) {
    const group = parseSelectionGroup(rawGroup);
    if (group === undefined || groupIds.has(group.groupId)) return undefined;
    groupIds.add(group.groupId);
    modifierGroups.push(group);
  }
  if (fraction !== undefined && variantId === null) return undefined;
  return deepFreeze({ ...(fraction === undefined ? {} : { fraction }), lineId, modifierGroups, note, productId, quantity, variantId });
}

function parseSelectionGroup(value: unknown): CaptureSelectionModifierGroupV1 | undefined {
  const record = exactRecord(value, ["groupId", "selections"]);
  if (record === undefined) return undefined;
  const groupId = uuid(own(record, "groupId"));
  const rawSelections = exactArray(own(record, "selections"), MAX_MODIFIER_SELECTIONS);
  if (groupId === undefined || rawSelections === undefined) return undefined;
  const optionIds = new Set<string>();
  const selections: CaptureSelectionModifierSelectionV1[] = [];
  for (const rawSelection of rawSelections) {
    const selection = parseModifierSelection(rawSelection);
    if (selection === undefined || optionIds.has(selection.optionId)) return undefined;
    optionIds.add(selection.optionId);
    selections.push(selection);
  }
  return deepFreeze({ groupId, selections });
}

function parseModifierSelection(value: unknown): CaptureSelectionModifierSelectionV1 | undefined {
  const record = exactRecord(value, ["optionId", "quantity"]);
  if (record === undefined) return undefined;
  const optionId = uuid(own(record, "optionId"));
  const quantity = integer(own(record, "quantity"), 1, MAX_MODIFIER_QUANTITY);
  return optionId === undefined || quantity === undefined ? undefined : deepFreeze({ optionId, quantity });
}

function parseProjectionLine(value: unknown): CaptureSelectionPlanProjectionLineV1 | undefined {
  const projectionKeys = [
    "lineId", "productId", "variantId", "productName", "quantity", "unitPriceMinor", "lineTotalMinor", "note", "modifiers",
  ];
  const record = exactRecord(value, projectionKeys) ?? exactRecord(value, [...projectionKeys, "halves"]);
  if (record === undefined) return undefined;
  const rawHalves = Object.hasOwn(record, "halves") ? exactArray(own(record, "halves"), 2) : undefined;
  const halves = rawHalves?.map(parseOrderDetailFractionHalfV1);
  if (Object.hasOwn(record, "halves") && (halves === undefined || halves.length !== 2 || halves.some((half) => half === undefined))) {
    return undefined;
  }
  const lineId = uuid(own(record, "lineId"));
  const productId = uuid(own(record, "productId"));
  const variantId = nullableUuid(own(record, "variantId"));
  const productName = boundedText(own(record, "productName"), 1, 200);
  const quantity = integer(own(record, "quantity"), 1, MAX_LINE_QUANTITY);
  const unitPriceMinor = integer(own(record, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
  const lineTotalMinor = integer(own(record, "lineTotalMinor"), 0, Number.MAX_SAFE_INTEGER);
  const note = nullableBoundedText(own(record, "note"), 1, MAX_NOTE_LENGTH);
  const rawModifiers = exactArray(own(record, "modifiers"), MAX_MODIFIER_GROUPS * MAX_MODIFIER_SELECTIONS);
  if (lineId === undefined || productId === undefined || variantId === undefined || productName === undefined
    || quantity === undefined || unitPriceMinor === undefined || lineTotalMinor === undefined || note === undefined
    || rawModifiers === undefined) {
    return undefined;
  }
  const modifiers: CaptureSelectionPlanProjectionModifierV1[] = [];
  for (const rawModifier of rawModifiers) {
    const modifier = parseProjectionModifier(rawModifier);
    if (modifier === undefined) return undefined;
    modifiers.push(modifier);
  }
  return deepFreeze({
    ...(halves === undefined ? {} : { halves: halves as OrderDetailFractionHalfV1[] }),
    lineId, lineTotalMinor, modifiers, note, productId, productName, quantity, unitPriceMinor, variantId,
  });
}

function parseProjectionModifier(value: unknown): CaptureSelectionPlanProjectionModifierV1 | undefined {
  const record = exactRecord(value, ["groupId", "optionId", "name", "quantity", "unitPriceMinor"]);
  if (record === undefined) return undefined;
  const groupId = uuid(own(record, "groupId"));
  const optionId = uuid(own(record, "optionId"));
  const name = boundedText(own(record, "name"), 1, 200);
  const quantity = integer(own(record, "quantity"), 1, MAX_MODIFIER_QUANTITY);
  const unitPriceMinor = integer(own(record, "unitPriceMinor"), 0, Number.MAX_SAFE_INTEGER);
  return groupId === undefined || optionId === undefined || name === undefined
    || quantity === undefined || unitPriceMinor === undefined
    ? undefined
    : deepFreeze({ groupId, name, optionId, quantity, unitPriceMinor });
}

function parseMutationInput(record: PlainRecord): Omit<CaptureVersionedMutationInputV1, "captureDraftId" | "expectedVersion"> | undefined {
  const scope = parseUuidScope(own(record, "scope"));
  const eventId = uuid(own(record, "eventId"));
  const idempotencyKey = uuid(own(record, "idempotencyKey"));
  const deviceId = uuid(own(record, "deviceId"));
  const occurredAt = timestamp(own(record, "occurredAt"));
  return scope === undefined || eventId === undefined || idempotencyKey === undefined
    || deviceId === undefined || occurredAt === undefined
    ? undefined
    : deepFreeze({ deviceId, eventId, idempotencyKey, occurredAt, scope });
}

function parseUuidScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined
    : deepFreeze({ restaurantId, branchId }) as BranchScope;
}

const VERSIONED_KEYS = [
  "schemaVersion", "scope", "captureDraftId", "expectedVersion",
  "eventId", "idempotencyKey", "deviceId", "occurredAt",
] as const;

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
    || length.value < 0 || length.value > maximum) {
    return undefined;
  }
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

function nullableUuid(value: unknown): string | null | undefined {
  return value === null ? null : uuid(value);
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function boundedText(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum
    && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value)
    ? value
    : undefined;
}

function nullableBoundedText(value: unknown, minimum: number, maximum: number): string | null | undefined {
  return value === null ? null : boundedText(value, minimum, maximum);
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try {
    return new Date(value).toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
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
