import type { BranchScope } from "./index.js";

export const COMMERCIAL_CAPTURE_SCHEMA_VERSION = 1 as const;

export const CAPTURE_SOURCE_CHANNELS = Object.freeze([
  "phone",
  "whatsapp_manual",
  "counter",
  "table",
  "self_service",
  "integration",
] as const);

export const CAPTURE_FULFILLMENT_CHANNELS = Object.freeze([
  "dine_in",
  "counter",
  "pickup",
  "delivery",
] as const);

export const CAPTURE_DRAFT_STATUSES = Object.freeze(["draft", "confirmed", "no_sale"] as const);
export const CAPTURE_ATTENTION_STATUSES = Object.freeze(["unclaimed", "claimed", "held"] as const);

export type CaptureSourceChannelV1 = (typeof CAPTURE_SOURCE_CHANNELS)[number];
export type CaptureFulfillmentChannelV1 = (typeof CAPTURE_FULFILLMENT_CHANNELS)[number];
export type CaptureDraftStatusV1 = (typeof CAPTURE_DRAFT_STATUSES)[number];
export type CaptureAttentionStatusV1 = (typeof CAPTURE_ATTENTION_STATUSES)[number];

export interface CaptureMutationInputV1 {
  readonly deviceId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly scope: BranchScope;
}

export interface CaptureVersionedMutationInputV1 extends CaptureMutationInputV1 {
  readonly captureDraftId: string;
  readonly expectedVersion: number;
}

export interface CreateCaptureDraftCommandV1 extends CaptureMutationInputV1 {
  readonly captureDraftId: string;
  readonly expectedVersion: 0;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1 | null;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly sourceChannel: CaptureSourceChannelV1;
}

export interface AutosaveCaptureDraftCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly attentionLeaseId: string;
  readonly customerSnapshotRef: string | null;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1 | null;
  readonly fulfillmentSnapshotRef: string | null;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly sourceChannel: CaptureSourceChannelV1;
}

export interface HoldCaptureDraftCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly attentionLeaseId: string;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

/** Server computes deadlines; the client supplies only its explicit preference. */
export interface SetCaptureRecoveryPreferenceCommandV1 extends HoldCaptureDraftCommandV1 {
  readonly autoRenewSelected: boolean;
}

export interface CaptureRecoveryPolicyV1 {
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly autoRenewSelected: boolean;
  readonly recoveryExpiresAt: string;
}

export interface ClaimCaptureDraftCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

export interface ResumeCaptureDraftCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

export interface TransferCaptureDraftCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly attentionLeaseId: string;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly targetMembershipId: string;
}

export interface ConfirmCaptureDraftCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly attentionLeaseId: string;
  readonly orderId: string;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

export interface CloseCaptureNoSaleCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly attentionLeaseId: string;
  readonly reason: string;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

export interface CaptureDraftSummaryV1 {
  readonly attentionStatus: CaptureAttentionStatusV1;
  readonly captureDraftId: string;
  readonly folio: string;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1 | null;
  readonly ownerMembershipId: string | null;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly sourceChannel: CaptureSourceChannelV1;
  readonly status: CaptureDraftStatusV1;
  readonly updatedAt: string;
  readonly version: number;
}

export interface CaptureDraftDetailV1 extends CaptureDraftSummaryV1 {
  readonly attentionLeaseId: string | null;
  readonly attentionLeaseExpiresAt: string | null;
  readonly confirmedOrderId: string | null;
  readonly customerSnapshotRef: string | null;
  readonly fulfillmentSnapshotRef: string | null;
}

export interface CaptureMutationResultV1 {
  readonly detail: CaptureDraftDetailV1;
  readonly replayed: boolean;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

const CREATE_KEYS = [
  "schemaVersion", "scope", "captureDraftId", "expectedVersion", "sourceChannel", "fulfillmentChannel",
  "eventId", "idempotencyKey", "deviceId", "occurredAt",
] as const;
const VERSIONED_KEYS = [
  "schemaVersion", "scope", "captureDraftId", "expectedVersion",
  "eventId", "idempotencyKey", "deviceId", "occurredAt",
] as const;
const SUMMARY_KEYS = [
  "schemaVersion", "scope", "captureDraftId", "folio", "sourceChannel", "fulfillmentChannel",
  "status", "attentionStatus", "ownerMembershipId", "version", "updatedAt",
] as const;

export function parseCreateCaptureDraftCommandV1(value: unknown): CreateCaptureDraftCommandV1 | undefined {
  const record = exactRecord(value, CREATE_KEYS);
  const common = record === undefined ? undefined : parseMutationInput(record);
  const captureDraftId = record === undefined ? undefined : uuid(own(record, "captureDraftId"));
  const sourceChannel = record === undefined ? undefined : source(own(record, "sourceChannel"));
  const fulfillmentChannel = record === undefined ? undefined : nullableFulfillment(own(record, "fulfillmentChannel"));
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION
    || common === undefined || captureDraftId === undefined || own(record, "expectedVersion") !== 0 || sourceChannel === undefined
    || fulfillmentChannel === undefined) return undefined;
  return Object.freeze({
    ...common,
    captureDraftId,
    expectedVersion: 0 as const,
    fulfillmentChannel,
    schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION,
    sourceChannel,
  });
}

export function parseAutosaveCaptureDraftCommandV1(value: unknown): AutosaveCaptureDraftCommandV1 | undefined {
  const record = exactRecord(value, [
    ...VERSIONED_KEYS, "attentionLeaseId", "sourceChannel", "fulfillmentChannel",
    "customerSnapshotRef", "fulfillmentSnapshotRef",
  ]);
  const common = record === undefined ? undefined : parseVersionedMutationInput(record);
  const attentionLeaseId = record === undefined ? undefined : uuid(own(record, "attentionLeaseId"));
  const sourceChannel = record === undefined ? undefined : source(own(record, "sourceChannel"));
  const fulfillmentChannel = record === undefined ? undefined : nullableFulfillment(own(record, "fulfillmentChannel"));
  const customerSnapshotRef = record === undefined ? undefined : nullableUuid(own(record, "customerSnapshotRef"));
  const fulfillmentSnapshotRef = record === undefined ? undefined : nullableUuid(own(record, "fulfillmentSnapshotRef"));
  if (common === undefined || attentionLeaseId === undefined || sourceChannel === undefined
    || fulfillmentChannel === undefined || customerSnapshotRef === undefined
    || fulfillmentSnapshotRef === undefined) return undefined;
  return Object.freeze({
    ...common,
    attentionLeaseId,
    customerSnapshotRef,
    fulfillmentChannel,
    fulfillmentSnapshotRef,
    schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION,
    sourceChannel,
  });
}

export function parseHoldCaptureDraftCommandV1(value: unknown): HoldCaptureDraftCommandV1 | undefined {
  return parseLeasedCommand(value);
}

export function parseSetCaptureRecoveryPreferenceCommandV1(value: unknown): SetCaptureRecoveryPreferenceCommandV1 | undefined {
  const record = exactRecord(value, [...VERSIONED_KEYS, "attentionLeaseId", "autoRenewSelected"]);
  if (record === undefined) return undefined;
  const common = parseVersionedMutationInput(record);
  const attentionLeaseId = uuid(own(record, "attentionLeaseId"));
  const autoRenewSelected = own(record, "autoRenewSelected");
  if (common === undefined || attentionLeaseId === undefined || typeof autoRenewSelected !== "boolean") return undefined;
  return Object.freeze({ ...common, attentionLeaseId, autoRenewSelected, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

export function parseCaptureRecoveryPolicyV1(value: unknown): CaptureRecoveryPolicyV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "autoRenewSelected", "recoveryExpiresAt"]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION) return undefined;
  const autoRenewSelected = own(record, "autoRenewSelected");
  const recoveryExpiresAt = timestamp(own(record, "recoveryExpiresAt"));
  if (typeof autoRenewSelected !== "boolean" || recoveryExpiresAt === undefined) return undefined;
  return Object.freeze({ autoRenewSelected, recoveryExpiresAt, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

export function parseClaimCaptureDraftCommandV1(value: unknown): ClaimCaptureDraftCommandV1 | undefined {
  return parseVersionOnlyCommand(value);
}

export function parseResumeCaptureDraftCommandV1(value: unknown): ResumeCaptureDraftCommandV1 | undefined {
  return parseVersionOnlyCommand(value);
}

export function parseTransferCaptureDraftCommandV1(value: unknown): TransferCaptureDraftCommandV1 | undefined {
  const record = exactRecord(value, [...VERSIONED_KEYS, "attentionLeaseId", "targetMembershipId"]);
  const common = record === undefined ? undefined : parseVersionedMutationInput(record);
  const attentionLeaseId = record === undefined ? undefined : uuid(own(record, "attentionLeaseId"));
  const targetMembershipId = record === undefined ? undefined : uuid(own(record, "targetMembershipId"));
  return common === undefined || attentionLeaseId === undefined || targetMembershipId === undefined
    ? undefined
    : Object.freeze({
      ...common,
      attentionLeaseId,
      schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION,
      targetMembershipId,
    });
}

export function parseConfirmCaptureDraftCommandV1(value: unknown): ConfirmCaptureDraftCommandV1 | undefined {
  const record = exactRecord(value, [...VERSIONED_KEYS, "attentionLeaseId", "orderId"]);
  const common = record === undefined ? undefined : parseVersionedMutationInput(record);
  const attentionLeaseId = record === undefined ? undefined : uuid(own(record, "attentionLeaseId"));
  const orderId = record === undefined ? undefined : uuid(own(record, "orderId"));
  return common === undefined || attentionLeaseId === undefined || orderId === undefined
    ? undefined
    : Object.freeze({ ...common, attentionLeaseId, orderId, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

export function parseCloseCaptureNoSaleCommandV1(value: unknown): CloseCaptureNoSaleCommandV1 | undefined {
  const record = exactRecord(value, [...VERSIONED_KEYS, "attentionLeaseId", "reason"]);
  const common = record === undefined ? undefined : parseVersionedMutationInput(record);
  const attentionLeaseId = record === undefined ? undefined : uuid(own(record, "attentionLeaseId"));
  const reason = record === undefined ? undefined : boundedText(own(record, "reason"), 1, 500);
  return common === undefined || attentionLeaseId === undefined || reason === undefined
    ? undefined
    : Object.freeze({ ...common, attentionLeaseId, reason, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

export function parseCaptureDraftSummaryV1(value: unknown): CaptureDraftSummaryV1 | undefined {
  const record = exactRecord(value, SUMMARY_KEYS);
  return record === undefined ? undefined : parseSummaryRecord(record);
}

export function parseCaptureDraftDetailV1(value: unknown): CaptureDraftDetailV1 | undefined {
  const record = exactRecord(value, [
    ...SUMMARY_KEYS, "attentionLeaseId", "attentionLeaseExpiresAt", "customerSnapshotRef", "fulfillmentSnapshotRef", "confirmedOrderId",
  ]);
  if (record === undefined) return undefined;
  const summary = parseSummaryRecord(record);
  const attentionLeaseId = nullableUuid(own(record, "attentionLeaseId"));
  const attentionLeaseExpiresAt = nullableTimestamp(own(record, "attentionLeaseExpiresAt"));
  const customerSnapshotRef = nullableUuid(own(record, "customerSnapshotRef"));
  const fulfillmentSnapshotRef = nullableUuid(own(record, "fulfillmentSnapshotRef"));
  const confirmedOrderId = nullableUuid(own(record, "confirmedOrderId"));
  if (summary === undefined || attentionLeaseId === undefined || attentionLeaseExpiresAt === undefined || customerSnapshotRef === undefined
    || fulfillmentSnapshotRef === undefined || confirmedOrderId === undefined
    || (summary.attentionStatus === "claimed") !== (attentionLeaseId !== null)
    || (summary.attentionStatus === "claimed") !== (attentionLeaseExpiresAt !== null)
    || (summary.attentionStatus !== "claimed" && summary.ownerMembershipId !== null)
    || (summary.status === "confirmed") !== (confirmedOrderId !== null)) return undefined;
  return Object.freeze({
    ...summary,
    attentionLeaseId,
    attentionLeaseExpiresAt,
    confirmedOrderId,
    customerSnapshotRef,
    fulfillmentSnapshotRef,
  });
}

export function parseCaptureMutationResultV1(value: unknown): CaptureMutationResultV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "replayed", "detail"]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION
    || typeof own(record, "replayed") !== "boolean") return undefined;
  const detail = parseCaptureDraftDetailV1(own(record, "detail"));
  return detail === undefined
    ? undefined
    : Object.freeze({ detail, replayed: own(record, "replayed") as boolean, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

function parseMutationInput(record: PlainRecord): CaptureMutationInputV1 | undefined {
  const scope = parseUuidScope(own(record, "scope"));
  const eventId = uuid(own(record, "eventId"));
  const idempotencyKey = uuid(own(record, "idempotencyKey"));
  const deviceId = uuid(own(record, "deviceId"));
  const occurredAt = timestamp(own(record, "occurredAt"));
  return scope === undefined || eventId === undefined || idempotencyKey === undefined
    || deviceId === undefined || occurredAt === undefined
    ? undefined
    : Object.freeze({ deviceId, eventId, idempotencyKey, occurredAt, scope });
}

function parseVersionedMutationInput(record: PlainRecord): CaptureVersionedMutationInputV1 | undefined {
  if (own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION) return undefined;
  const common = parseMutationInput(record);
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const expectedVersion = integer(own(record, "expectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  return common === undefined || captureDraftId === undefined || expectedVersion === undefined
    ? undefined
    : Object.freeze({ ...common, captureDraftId, expectedVersion });
}

function parseVersionOnlyCommand(
  value: unknown,
): ClaimCaptureDraftCommandV1 | ResumeCaptureDraftCommandV1 | undefined {
  const record = exactRecord(value, VERSIONED_KEYS);
  const common = record === undefined ? undefined : parseVersionedMutationInput(record);
  return common === undefined
    ? undefined
    : Object.freeze({ ...common, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

function parseLeasedCommand(value: unknown): HoldCaptureDraftCommandV1 | undefined {
  const record = exactRecord(value, [...VERSIONED_KEYS, "attentionLeaseId"]);
  const common = record === undefined ? undefined : parseVersionedMutationInput(record);
  const attentionLeaseId = record === undefined ? undefined : uuid(own(record, "attentionLeaseId"));
  return common === undefined || attentionLeaseId === undefined
    ? undefined
    : Object.freeze({ ...common, attentionLeaseId, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

function parseSummaryRecord(record: PlainRecord): CaptureDraftSummaryV1 | undefined {
  if (own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION) return undefined;
  const scope = parseUuidScope(own(record, "scope"));
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const folio = boundedText(own(record, "folio"), 1, 40);
  const sourceChannel = source(own(record, "sourceChannel"));
  const fulfillmentChannel = nullableFulfillment(own(record, "fulfillmentChannel"));
  const status = member(own(record, "status"), CAPTURE_DRAFT_STATUSES);
  const attentionStatus = member(own(record, "attentionStatus"), CAPTURE_ATTENTION_STATUSES);
  const ownerMembershipId = nullableUuid(own(record, "ownerMembershipId"));
  const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
  const updatedAt = timestamp(own(record, "updatedAt"));
  if (scope === undefined || captureDraftId === undefined || folio === undefined || sourceChannel === undefined
    || fulfillmentChannel === undefined || status === undefined || attentionStatus === undefined
    || ownerMembershipId === undefined || version === undefined || updatedAt === undefined
    || (status !== "draft" && attentionStatus !== "unclaimed")
    || (status === "confirmed" && fulfillmentChannel === null)
    || (attentionStatus === "unclaimed" || attentionStatus === "held") !== (ownerMembershipId === null)) return undefined;
  return Object.freeze({
    attentionStatus,
    captureDraftId,
    folio,
    fulfillmentChannel,
    ownerMembershipId,
    schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION,
    scope,
    sourceChannel,
    status,
    updatedAt,
    version,
  });
}

function parseUuidScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined
    : Object.freeze({ restaurantId, branchId }) as BranchScope;
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

function source(value: unknown): CaptureSourceChannelV1 | undefined {
  return member(value, CAPTURE_SOURCE_CHANNELS);
}

function fulfillment(value: unknown): CaptureFulfillmentChannelV1 | undefined {
  return member(value, CAPTURE_FULFILLMENT_CHANNELS);
}

function nullableFulfillment(value: unknown): CaptureFulfillmentChannelV1 | null | undefined {
  return value === null ? null : fulfillment(value);
}

function member<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] | undefined {
  return typeof value === "string" && values.includes(value) ? value as Values[number] : undefined;
}

function nullableUuid(value: unknown): string | null | undefined {
  return value === null ? null : uuid(value);
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
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

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try {
    return new Date(value).toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function nullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : timestamp(value);
}

type PlainRecord = Readonly<Record<string, unknown>>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
