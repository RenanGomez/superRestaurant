import type { BranchScope, MembershipRoleCode } from "./index.js";

export const COMMERCIAL_CAPTURE_SCHEMA_VERSION = 1 as const;
export const COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION = 2 as const;
export const COMMERCIAL_CAPTURE_V3_SCHEMA_VERSION = 3 as const;

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
const CAPTURE_ASSIGNMENT_ROLE_CODES = Object.freeze([
  "owner", "admin", "manager", "supervisor", "cashier", "waiter",
] as const);

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

/** Select current server-owned customer facts, or remove them with three nulls. */
export interface SetCaptureCustomerCommandV1 extends HoldCaptureDraftCommandV1 {
  readonly customerId: string | null;
  readonly contactId: string | null;
  readonly expectedCustomerVersion: number | null;
}

/** Freeze a branch-validated address for the currently selected party, or remove it. */
export interface SetCaptureFulfillmentCommandV1 extends HoldCaptureDraftCommandV1 {
  readonly customerSnapshotRef: string;
  readonly addressId: string | null;
  readonly expectedAddressVersion: number | null;
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

/** Privileged forced reassignment to the acting operator; normal claim remains the non-forced path. */
export interface TakeoverCaptureDraftCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly reason: string;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

export interface ConfirmCaptureDraftCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly attentionLeaseId: string;
  readonly orderId: string;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

/**
 * Atomic Capture-to-Order confirmation. Channel is derived from Capture by the
 * server; the client supplies only operational Order facts that Capture does
 * not own.
 */
export interface ConfirmCaptureDraftCommandV2 extends Omit<ConfirmCaptureDraftCommandV1, "schemaVersion"> {
  readonly currency: string;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION;
  readonly shiftId: string;
  readonly tableId: string | null;
  readonly timeZone: string;
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

/** Additive D4 detail; V1 remains the stable journal payload. */
export interface CaptureDraftDetailV2 extends Omit<CaptureDraftDetailV1, "schemaVersion"> {
  readonly deliveryInstructions: string | null;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION;
}

export interface CaptureWorkTrayRequestV1 {
  readonly limit: number;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface CaptureWorkTrayResultV1 {
  readonly items: readonly CaptureDraftSummaryV1[];
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

export interface CaptureAssignmentDirectoryRequestV1 {
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface CaptureAssignmentCandidateV1 {
  readonly displayLabel: string;
  readonly membershipId: string;
  readonly roles: readonly MembershipRoleCode[];
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

export interface CaptureAssignmentDirectoryV1 {
  readonly candidates: readonly CaptureAssignmentCandidateV1[];
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface CaptureWorkspaceRequestV1 {
  readonly captureDraftId: string;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface CaptureWorkspaceRequestV2 extends Omit<CaptureWorkspaceRequestV1, "schemaVersion"> {
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION;
}

export interface CaptureWorkspaceRequestV3 extends Omit<CaptureWorkspaceRequestV1, "schemaVersion"> {
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_V3_SCHEMA_VERSION;
}

export interface CaptureCustomerSnapshotV1 {
  readonly contactId: string;
  readonly customerId: string;
  readonly displayName: string;
  readonly phoneDisplayValue: string;
  readonly phoneNormalizedValue: string;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly snapshotRef: string;
}

export interface CaptureFulfillmentSnapshotV1 {
  readonly addressId: string;
  readonly countryCode: string;
  readonly customerId: string;
  readonly customerSnapshotRef: string;
  /** Historical Address value only; never an active Capture/Order delivery instruction. */
  readonly legacyAddressInstructions: string | null;
  readonly label: string;
  readonly latitudeE6: number | null;
  readonly locality: string;
  readonly longitudeE6: number | null;
  readonly neighborhood: string | null;
  readonly postalCode: string | null;
  readonly referencesText: string | null;
  readonly region: string | null;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly snapshotRef: string;
  readonly streetLine: string;
  readonly unit: string | null;
  readonly validatedAt: string;
}

export interface CaptureWorkspaceV1 {
  readonly customerSnapshot: CaptureCustomerSnapshotV1 | null;
  readonly detail: CaptureDraftDetailV1;
  readonly fulfillmentSnapshot: CaptureFulfillmentSnapshotV1 | null;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

export interface CaptureWorkspaceV2 extends Omit<CaptureWorkspaceV1, "detail" | "schemaVersion"> {
  readonly detail: CaptureDraftDetailV2;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION;
}

/** Durable repeat intent only; authoritative selections remain server-owned. */
export interface CaptureRepeatOrderPlanSummaryV1 {
  readonly appliedCaptureVersion: number;
  readonly catalogVersion: string;
  readonly customerId: string;
  readonly lineCount: number;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
  readonly sourceOrderId: string;
}

export interface CaptureWorkspaceV3 extends Omit<CaptureWorkspaceV2, "schemaVersion"> {
  readonly repeatOrderPlan: CaptureRepeatOrderPlanSummaryV1 | null;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_V3_SCHEMA_VERSION;
}

export interface CaptureMutationResultV1 {
  readonly detail: CaptureDraftDetailV1;
  readonly replayed: boolean;
  readonly schemaVersion: typeof COMMERCIAL_CAPTURE_SCHEMA_VERSION;
}

export interface CaptureRecoveryPreferenceResultV1 extends CaptureMutationResultV1 {
  readonly recoveryPolicy: CaptureRecoveryPolicyV1;
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
    || fulfillmentSnapshotRef === undefined
    || (fulfillmentSnapshotRef !== null && (customerSnapshotRef === null || fulfillmentChannel !== "delivery"))) return undefined;
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

export function parseSetCaptureCustomerCommandV1(value: unknown): SetCaptureCustomerCommandV1 | undefined {
  const record = exactRecord(value, [...VERSIONED_KEYS, "attentionLeaseId", "customerId", "contactId", "expectedCustomerVersion"]);
  if (record === undefined) return undefined;
  const common = parseVersionedMutationInput(record);
  const attentionLeaseId = uuid(own(record, "attentionLeaseId"));
  const customerId = nullableUuid(own(record, "customerId"));
  const contactId = nullableUuid(own(record, "contactId"));
  const expectedCustomerVersion = own(record, "expectedCustomerVersion") === null ? null
    : integer(own(record, "expectedCustomerVersion"), 1, Number.MAX_SAFE_INTEGER);
  if (common === undefined || attentionLeaseId === undefined || customerId === undefined || contactId === undefined
    || expectedCustomerVersion === undefined || (customerId === null) !== (contactId === null)
    || (customerId === null) !== (expectedCustomerVersion === null)) return undefined;
  return Object.freeze({ ...common, attentionLeaseId, customerId, contactId, expectedCustomerVersion,
    schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

export function parseSetCaptureFulfillmentCommandV1(value: unknown): SetCaptureFulfillmentCommandV1 | undefined {
  const record = exactRecord(value, [...VERSIONED_KEYS, "attentionLeaseId", "customerSnapshotRef", "addressId", "expectedAddressVersion"]);
  if (record === undefined) return undefined;
  const common = parseVersionedMutationInput(record);
  const attentionLeaseId = uuid(own(record, "attentionLeaseId"));
  const customerSnapshotRef = uuid(own(record, "customerSnapshotRef"));
  const addressId = nullableUuid(own(record, "addressId"));
  const expectedAddressVersion = own(record, "expectedAddressVersion") === null ? null
    : integer(own(record, "expectedAddressVersion"), 1, Number.MAX_SAFE_INTEGER);
  if (common === undefined || attentionLeaseId === undefined || customerSnapshotRef === undefined
    || addressId === undefined || expectedAddressVersion === undefined
    || (addressId === null) !== (expectedAddressVersion === null)) return undefined;
  return Object.freeze({ ...common, attentionLeaseId, customerSnapshotRef, addressId, expectedAddressVersion,
    schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
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

export function parseTakeoverCaptureDraftCommandV1(value: unknown): TakeoverCaptureDraftCommandV1 | undefined {
  const record = exactRecord(value, [...VERSIONED_KEYS, "reason"]);
  const common = record === undefined ? undefined : parseVersionedMutationInput(record);
  const reason = record === undefined ? undefined : boundedText(own(record, "reason"), 1, 500);
  return common === undefined || reason === undefined
    ? undefined
    : Object.freeze({ ...common, reason, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
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

export function parseConfirmCaptureDraftCommandV2(value: unknown): ConfirmCaptureDraftCommandV2 | undefined {
  const record = exactRecord(value, [
    ...VERSIONED_KEYS, "attentionLeaseId", "orderId", "shiftId", "tableId", "currency", "timeZone",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION) return undefined;
  const common = parseMutationInput(record);
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const expectedVersion = integer(own(record, "expectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const attentionLeaseId = uuid(own(record, "attentionLeaseId"));
  const orderId = uuid(own(record, "orderId"));
  const shiftId = uuid(own(record, "shiftId"));
  const tableId = nullableUuid(own(record, "tableId"));
  const currency = boundedText(own(record, "currency"), 3, 3);
  const timeZone = boundedText(own(record, "timeZone"), 1, 100);
  if (common === undefined || captureDraftId === undefined || expectedVersion === undefined
    || attentionLeaseId === undefined || orderId === undefined || shiftId === undefined || tableId === undefined
    || currency === undefined || !/^[A-Z]{3}$/u.test(currency) || timeZone === undefined || !validTimeZone(timeZone)) {
    return undefined;
  }
  return Object.freeze({
    ...common,
    attentionLeaseId,
    captureDraftId,
    currency,
    expectedVersion,
    orderId,
    schemaVersion: COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION,
    shiftId,
    tableId,
    timeZone,
  });
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

export function parseCaptureWorkTrayRequestV1(value: unknown): CaptureWorkTrayRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "limit"]);
  const scope = record === undefined ? undefined : parseUuidScope(own(record, "scope"));
  const limit = record === undefined ? undefined : integer(own(record, "limit"), 1, 50);
  return record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION
    || scope === undefined || limit === undefined ? undefined
      : Object.freeze({ limit, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION, scope });
}

export function parseCaptureWorkTrayResultV1(value: unknown): CaptureWorkTrayResultV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "items"]);
  const rawItems = record === undefined ? undefined : own(record, "items");
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION
    || !Array.isArray(rawItems) || rawItems.length > 50) return undefined;
  const items = rawItems.map(parseCaptureDraftSummaryV1);
  return items.some((item) => item === undefined) ? undefined
    : Object.freeze({ items: Object.freeze(items as CaptureDraftSummaryV1[]), schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

export function parseCaptureAssignmentDirectoryRequestV1(
  value: unknown,
): CaptureAssignmentDirectoryRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope"]);
  const scope = record === undefined ? undefined : parseUuidScope(own(record, "scope"));
  return record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION
    || scope === undefined ? undefined
      : Object.freeze({ schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION, scope });
}

export function parseCaptureAssignmentCandidateV1(value: unknown): CaptureAssignmentCandidateV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "membershipId", "displayLabel", "roles"]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION) return undefined;
  const membershipId = uuid(own(record, "membershipId"));
  const displayLabel = boundedText(own(record, "displayLabel"), 1, 320);
  const rawRoles = own(record, "roles");
  if (membershipId === undefined || displayLabel === undefined || !Array.isArray(rawRoles)
    || rawRoles.length === 0 || rawRoles.length > CAPTURE_ASSIGNMENT_ROLE_CODES.length) return undefined;
  const roles: MembershipRoleCode[] = [];
  let previousIndex = -1;
  for (const rawRole of rawRoles) {
    const roleIndex = CAPTURE_ASSIGNMENT_ROLE_CODES.indexOf(rawRole as never);
    if (typeof rawRole !== "string" || roleIndex <= previousIndex) return undefined;
    previousIndex = roleIndex;
    roles.push(rawRole as MembershipRoleCode);
  }
  return Object.freeze({
    displayLabel,
    membershipId,
    roles: Object.freeze(roles),
    schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION,
  });
}

export function parseCaptureAssignmentDirectoryV1(value: unknown): CaptureAssignmentDirectoryV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "candidates"]);
  const scope = record === undefined ? undefined : parseUuidScope(own(record, "scope"));
  const rawCandidates = record === undefined ? undefined : own(record, "candidates");
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION
    || scope === undefined || !Array.isArray(rawCandidates) || rawCandidates.length > 200) return undefined;
  const candidates: CaptureAssignmentCandidateV1[] = [];
  const membershipIds = new Set<string>();
  for (const rawCandidate of rawCandidates) {
    const candidate = parseCaptureAssignmentCandidateV1(rawCandidate);
    if (candidate === undefined || membershipIds.has(candidate.membershipId)) return undefined;
    membershipIds.add(candidate.membershipId);
    candidates.push(candidate);
  }
  return Object.freeze({ candidates: Object.freeze(candidates), schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION, scope });
}

export function parseCaptureWorkspaceRequestV1(value: unknown): CaptureWorkspaceRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "captureDraftId"]);
  const scope = record === undefined ? undefined : parseUuidScope(own(record, "scope"));
  const captureDraftId = record === undefined ? undefined : uuid(own(record, "captureDraftId"));
  return record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION
    || scope === undefined || captureDraftId === undefined ? undefined
      : Object.freeze({ captureDraftId, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION, scope });
}

export function parseCaptureWorkspaceRequestV2(value: unknown): CaptureWorkspaceRequestV2 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "captureDraftId"]);
  const scope = record === undefined ? undefined : parseUuidScope(own(record, "scope"));
  const captureDraftId = record === undefined ? undefined : uuid(own(record, "captureDraftId"));
  return record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION
    || scope === undefined || captureDraftId === undefined ? undefined
      : Object.freeze({ captureDraftId, schemaVersion: COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION, scope });
}

export function parseCaptureWorkspaceRequestV3(value: unknown): CaptureWorkspaceRequestV3 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "captureDraftId"]);
  const scope = record === undefined ? undefined : parseUuidScope(own(record, "scope"));
  const captureDraftId = record === undefined ? undefined : uuid(own(record, "captureDraftId"));
  return record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_V3_SCHEMA_VERSION
    || scope === undefined || captureDraftId === undefined ? undefined
      : Object.freeze({ captureDraftId, schemaVersion: COMMERCIAL_CAPTURE_V3_SCHEMA_VERSION, scope });
}

export function parseCaptureCustomerSnapshotV1(value: unknown): CaptureCustomerSnapshotV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "snapshotRef", "customerId", "contactId", "displayName",
    "phoneDisplayValue", "phoneNormalizedValue"]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION) return undefined;
  const snapshotRef = uuid(own(record, "snapshotRef"));
  const customerId = uuid(own(record, "customerId"));
  const contactId = uuid(own(record, "contactId"));
  const displayName = boundedText(own(record, "displayName"), 1, 120);
  const phoneDisplayValue = boundedText(own(record, "phoneDisplayValue"), 1, 80);
  const phoneNormalizedValue = own(record, "phoneNormalizedValue");
  if (snapshotRef === undefined || customerId === undefined || contactId === undefined || displayName === undefined
    || phoneDisplayValue === undefined || typeof phoneNormalizedValue !== "string"
    || !/^\+?[0-9]{1,20}$/u.test(phoneNormalizedValue)) return undefined;
  return Object.freeze({ contactId, customerId, displayName, phoneDisplayValue, phoneNormalizedValue,
    schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION, snapshotRef });
}

export function parseCaptureFulfillmentSnapshotV1(value: unknown): CaptureFulfillmentSnapshotV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "snapshotRef", "customerSnapshotRef", "customerId", "addressId",
    "label", "streetLine", "unit", "neighborhood", "locality", "region", "countryCode", "postalCode", "referencesText",
    "legacyAddressInstructions", "latitudeE6", "longitudeE6", "validatedAt"]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION) return undefined;
  const snapshotRef = uuid(own(record, "snapshotRef"));
  const customerSnapshotRef = uuid(own(record, "customerSnapshotRef"));
  const customerId = uuid(own(record, "customerId"));
  const addressId = uuid(own(record, "addressId"));
  const label = boundedText(own(record, "label"), 1, 40);
  const streetLine = boundedText(own(record, "streetLine"), 1, 200);
  const unit = nullableBoundedText(own(record, "unit"), 1, 200);
  const neighborhood = nullableBoundedText(own(record, "neighborhood"), 1, 200);
  const locality = boundedText(own(record, "locality"), 1, 200);
  const region = nullableBoundedText(own(record, "region"), 1, 200);
  const countryCode = own(record, "countryCode");
  const postalCode = nullableBoundedText(own(record, "postalCode"), 1, 200);
  const referencesText = nullableBoundedText(own(record, "referencesText"), 1, 500);
  const legacyAddressInstructions = nullableBoundedText(own(record, "legacyAddressInstructions"), 1, 500);
  const latitudeE6 = nullableInteger(own(record, "latitudeE6"), -90_000_000, 90_000_000);
  const longitudeE6 = nullableInteger(own(record, "longitudeE6"), -180_000_000, 180_000_000);
  const validatedAt = timestamp(own(record, "validatedAt"));
  if (snapshotRef === undefined || customerSnapshotRef === undefined || customerId === undefined || addressId === undefined
    || label === undefined || streetLine === undefined || unit === undefined || neighborhood === undefined
    || locality === undefined || region === undefined || typeof countryCode !== "string" || !/^[A-Z]{2}$/u.test(countryCode)
    || postalCode === undefined || referencesText === undefined || legacyAddressInstructions === undefined || latitudeE6 === undefined
    || longitudeE6 === undefined || (latitudeE6 === null) !== (longitudeE6 === null) || validatedAt === undefined) return undefined;
  return Object.freeze({ addressId, countryCode, customerId, customerSnapshotRef, legacyAddressInstructions, label, latitudeE6, locality,
    longitudeE6, neighborhood, postalCode, referencesText, region, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION,
    snapshotRef, streetLine, unit, validatedAt });
}

export function parseCaptureWorkspaceV1(value: unknown): CaptureWorkspaceV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "detail", "customerSnapshot", "fulfillmentSnapshot"]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION) return undefined;
  const detail = parseCaptureDraftDetailV1(own(record, "detail"));
  const rawCustomer = own(record, "customerSnapshot");
  const rawFulfillment = own(record, "fulfillmentSnapshot");
  const customerSnapshot = rawCustomer === null ? null : parseCaptureCustomerSnapshotV1(rawCustomer);
  const fulfillmentSnapshot = rawFulfillment === null ? null : parseCaptureFulfillmentSnapshotV1(rawFulfillment);
  if (detail === undefined || customerSnapshot === undefined || fulfillmentSnapshot === undefined
    || (detail.customerSnapshotRef === null) !== (customerSnapshot === null)
    || (detail.fulfillmentSnapshotRef === null) !== (fulfillmentSnapshot === null)
    || (customerSnapshot !== null && customerSnapshot.snapshotRef !== detail.customerSnapshotRef)
    || (fulfillmentSnapshot !== null && (fulfillmentSnapshot.snapshotRef !== detail.fulfillmentSnapshotRef
      || fulfillmentSnapshot.customerSnapshotRef !== detail.customerSnapshotRef
      || fulfillmentSnapshot.customerId !== customerSnapshot?.customerId))) return undefined;
  return Object.freeze({ customerSnapshot, detail, fulfillmentSnapshot, schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION });
}

export function parseCaptureWorkspaceV2(value: unknown): CaptureWorkspaceV2 | undefined {
  const record = exactRecord(value, ["schemaVersion", "detail", "customerSnapshot", "fulfillmentSnapshot"]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION) return undefined;
  const detail = parseCaptureDraftDetailV2(own(record, "detail"));
  const rawCustomer = own(record, "customerSnapshot");
  const rawFulfillment = own(record, "fulfillmentSnapshot");
  const customerSnapshot = rawCustomer === null ? null : parseCaptureCustomerSnapshotV1(rawCustomer);
  const fulfillmentSnapshot = rawFulfillment === null ? null : parseCaptureFulfillmentSnapshotV1(rawFulfillment);
  if (detail === undefined || customerSnapshot === undefined || fulfillmentSnapshot === undefined
    || (detail.customerSnapshotRef === null) !== (customerSnapshot === null)
    || (detail.fulfillmentSnapshotRef === null) !== (fulfillmentSnapshot === null)
    || (customerSnapshot !== null && customerSnapshot.snapshotRef !== detail.customerSnapshotRef)
    || (fulfillmentSnapshot !== null && (fulfillmentSnapshot.snapshotRef !== detail.fulfillmentSnapshotRef
      || fulfillmentSnapshot.customerSnapshotRef !== detail.customerSnapshotRef
      || fulfillmentSnapshot.customerId !== customerSnapshot?.customerId))) return undefined;
  return Object.freeze({
    customerSnapshot,
    detail,
    fulfillmentSnapshot,
    schemaVersion: COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION,
  });
}

export function parseCaptureRepeatOrderPlanSummaryV1(value: unknown): CaptureRepeatOrderPlanSummaryV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "customerId", "sourceOrderId", "catalogVersion", "appliedCaptureVersion", "lineCount",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_SCHEMA_VERSION) return undefined;
  const customerId = uuid(own(record, "customerId"));
  const sourceOrderId = uuid(own(record, "sourceOrderId"));
  const catalogVersion = uuid(own(record, "catalogVersion"));
  const appliedCaptureVersion = integer(own(record, "appliedCaptureVersion"), 2, Number.MAX_SAFE_INTEGER);
  const lineCount = integer(own(record, "lineCount"), 1, 200);
  return customerId === undefined || sourceOrderId === undefined || catalogVersion === undefined
    || appliedCaptureVersion === undefined || lineCount === undefined ? undefined
      : Object.freeze({ appliedCaptureVersion, catalogVersion, customerId, lineCount,
        schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION, sourceOrderId });
}

export function parseCaptureWorkspaceV3(value: unknown): CaptureWorkspaceV3 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "detail", "customerSnapshot", "fulfillmentSnapshot", "repeatOrderPlan",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_V3_SCHEMA_VERSION) return undefined;
  const v2 = parseCaptureWorkspaceV2({
    schemaVersion: COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION,
    detail: own(record, "detail"),
    customerSnapshot: own(record, "customerSnapshot"),
    fulfillmentSnapshot: own(record, "fulfillmentSnapshot"),
  });
  const rawPlan = own(record, "repeatOrderPlan");
  const repeatOrderPlan = rawPlan === null ? null : parseCaptureRepeatOrderPlanSummaryV1(rawPlan);
  if (v2 === undefined || repeatOrderPlan === undefined
    || (repeatOrderPlan !== null && repeatOrderPlan.customerId !== v2.customerSnapshot?.customerId)) return undefined;
  return Object.freeze({
    customerSnapshot: v2.customerSnapshot,
    detail: v2.detail,
    fulfillmentSnapshot: v2.fulfillmentSnapshot,
    repeatOrderPlan,
    schemaVersion: COMMERCIAL_CAPTURE_V3_SCHEMA_VERSION,
  });
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

export function parseCaptureDraftDetailV2(value: unknown): CaptureDraftDetailV2 | undefined {
  const record = exactRecord(value, [
    ...SUMMARY_KEYS, "attentionLeaseId", "attentionLeaseExpiresAt", "customerSnapshotRef", "fulfillmentSnapshotRef", "confirmedOrderId",
    "deliveryInstructions",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION) return undefined;
  const detail = parseCaptureDraftDetailV1({
    attentionLeaseExpiresAt: own(record, "attentionLeaseExpiresAt"),
    attentionLeaseId: own(record, "attentionLeaseId"),
    attentionStatus: own(record, "attentionStatus"),
    captureDraftId: own(record, "captureDraftId"),
    confirmedOrderId: own(record, "confirmedOrderId"),
    customerSnapshotRef: own(record, "customerSnapshotRef"),
    folio: own(record, "folio"),
    fulfillmentChannel: own(record, "fulfillmentChannel"),
    fulfillmentSnapshotRef: own(record, "fulfillmentSnapshotRef"),
    ownerMembershipId: own(record, "ownerMembershipId"),
    schemaVersion: COMMERCIAL_CAPTURE_SCHEMA_VERSION,
    scope: own(record, "scope"),
    sourceChannel: own(record, "sourceChannel"),
    status: own(record, "status"),
    updatedAt: own(record, "updatedAt"),
    version: own(record, "version"),
  });
  const deliveryInstructions = nullableBoundedText(own(record, "deliveryInstructions"), 1, 500);
  return detail === undefined || deliveryInstructions === undefined
    ? undefined
    : Object.freeze({
      ...detail,
      deliveryInstructions,
      schemaVersion: COMMERCIAL_CAPTURE_V2_SCHEMA_VERSION,
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

export function parseCaptureRecoveryPreferenceResultV1(value: unknown): CaptureRecoveryPreferenceResultV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "replayed", "detail", "recoveryPolicy"]);
  if (record === undefined) return undefined;
  const result = parseCaptureMutationResultV1({ schemaVersion: own(record, "schemaVersion"),
    replayed: own(record, "replayed"), detail: own(record, "detail") });
  const recoveryPolicy = parseCaptureRecoveryPolicyV1(own(record, "recoveryPolicy"));
  return result === undefined || recoveryPolicy === undefined ? undefined : Object.freeze({ ...result, recoveryPolicy });
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

function nullableInteger(value: unknown, minimum: number, maximum: number): number | null | undefined {
  return value === null ? null : integer(value, minimum, maximum);
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

function nullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : timestamp(value);
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

type PlainRecord = Readonly<Record<string, unknown>>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
