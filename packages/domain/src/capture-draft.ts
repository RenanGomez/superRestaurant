import { DomainError } from "./errors.js";
import {
  ORDER_FULFILLMENT_CHANNELS,
  ORDER_SOURCE_CHANNELS,
  type OrderAttentionState,
  type OrderFulfillmentChannel,
  type OrderSourceChannel,
} from "./commercial-order-state.js";

export type CaptureDraftState = "draft" | "confirmed" | "no_sale";
export const CAPTURE_AUDIT_SCHEMA_VERSION = 1 as const;

/** A recoverable commercial capture. Persistence owns optimistic versions and leases. */
export interface CaptureDraft {
  readonly captureDraftId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly folio: string;
  readonly state: CaptureDraftState;
  readonly attention: OrderAttentionState;
  readonly ownerActorId?: string;
  readonly sourceChannel?: OrderSourceChannel;
  readonly fulfillmentChannel?: OrderFulfillmentChannel;
  readonly confirmedOrderId?: string;
}

export interface CreateCaptureDraftInput {
  readonly captureDraftId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly folio: string;
  readonly sourceChannel?: OrderSourceChannel;
  readonly fulfillmentChannel?: OrderFulfillmentChannel;
}

export interface AutosaveCaptureDraftInput {
  readonly sourceChannel?: OrderSourceChannel | null;
  readonly fulfillmentChannel?: OrderFulfillmentChannel | null;
}

export interface CaptureAuditContext {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
}

export type CaptureAuditEventType =
  | "capture.created"
  | "capture.autosaved"
  | "capture.held"
  | "capture.claimed"
  | "capture.resumed"
  | "capture.transferred"
  | "capture.confirmed"
  | "capture.no_sale";

export interface CaptureAuditEvent {
  readonly schemaVersion: typeof CAPTURE_AUDIT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly type: CaptureAuditEventType;
  readonly captureDraftId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly fromState: CaptureDraftState | null;
  readonly toState: CaptureDraftState;
  readonly fromAttention: OrderAttentionState | null;
  readonly toAttention: OrderAttentionState;
  readonly previousOwnerActorId?: string;
  readonly ownerActorId?: string;
  readonly sourceChannel?: OrderSourceChannel;
  readonly fulfillmentChannel?: OrderFulfillmentChannel;
  readonly confirmedOrderId?: string;
  readonly reason?: string;
}

export interface CaptureDraftMutation {
  readonly captureDraft: CaptureDraft;
  readonly auditEvent: CaptureAuditEvent;
}

export class InvalidCaptureDraftError extends DomainError {
  public readonly code = "INVALID_CAPTURE_DRAFT";

  public constructor(public readonly field: string) {
    super(`The capture draft has invalid ${field}.`);
  }
}

export class InvalidCaptureDraftOperationError extends DomainError {
  public readonly code = "INVALID_CAPTURE_DRAFT_OPERATION";

  public constructor(public readonly operation: CaptureAuditEventType) {
    super("The capture draft operation is not allowed in its current state.");
  }
}

export class CaptureDraftOwnershipError extends DomainError {
  public readonly code = "CAPTURE_DRAFT_OWNERSHIP_ERROR";

  public constructor() {
    super("The capture draft is not claimed by the acting operator.");
  }
}

export class CaptureDraftConfirmationFactsRequiredError extends DomainError {
  public readonly code = "CAPTURE_DRAFT_CONFIRMATION_FACTS_REQUIRED";

  public constructor() {
    super("A claimed capture draft requires source and fulfillment channels before confirmation.");
  }
}

/** Creates a claimed draft so its creator can autosave without an ownership race. */
export function createCaptureDraft(
  input: CreateCaptureDraftInput,
  auditContext: CaptureAuditContext,
): CaptureDraftMutation {
  const stableInput = readInput(input, "input", [
    "captureDraftId", "restaurantId", "branchId", "folio", "sourceChannel", "fulfillmentChannel",
  ]);
  const audit = snapshotAuditContext(auditContext);
  assertText(stableInput.captureDraftId, "captureDraftId");
  assertText(stableInput.restaurantId, "restaurantId");
  assertText(stableInput.branchId, "branchId");
  assertText(stableInput.folio, "folio");
  assertOptionalSourceChannel(stableInput.sourceChannel);
  assertOptionalFulfillmentChannel(stableInput.fulfillmentChannel);

  const captureDraft = freezeDraft({
    captureDraftId: stableInput.captureDraftId as string,
    restaurantId: stableInput.restaurantId as string,
    branchId: stableInput.branchId as string,
    folio: stableInput.folio as string,
    state: "draft",
    attention: "claimed",
    ownerActorId: audit.actorId,
    ...(stableInput.sourceChannel === undefined ? {} : { sourceChannel: stableInput.sourceChannel as OrderSourceChannel }),
    ...(stableInput.fulfillmentChannel === undefined ? {} : { fulfillmentChannel: stableInput.fulfillmentChannel as OrderFulfillmentChannel }),
  });
  return mutation(captureDraft, auditEvent(null, captureDraft, audit, "capture.created"));
}

/** Replaces only the explicitly supplied capture facts; null deliberately clears a fact. */
export function autosaveCaptureDraft(
  captureDraft: CaptureDraft,
  input: AutosaveCaptureDraftInput,
  auditContext: CaptureAuditContext,
): CaptureDraftMutation {
  assertValidDraft(captureDraft);
  const stableInput = readInput(input, "autosave input", ["sourceChannel", "fulfillmentChannel"]);
  const audit = snapshotAuditContext(auditContext);
  assertOwnedDraft(captureDraft, audit.actorId, "capture.autosaved");
  assertOptionalSourceChannel(stableInput.sourceChannel, true);
  assertOptionalFulfillmentChannel(stableInput.fulfillmentChannel, true);
  const next = freezeDraft({
    ...captureDraft,
    ...(stableInput.sourceChannel === undefined ? {} : stableInput.sourceChannel === null
      ? { sourceChannel: undefined } : { sourceChannel: stableInput.sourceChannel as OrderSourceChannel }),
    ...(stableInput.fulfillmentChannel === undefined ? {} : stableInput.fulfillmentChannel === null
      ? { fulfillmentChannel: undefined } : { fulfillmentChannel: stableInput.fulfillmentChannel as OrderFulfillmentChannel }),
  });
  return mutation(next, auditEvent(captureDraft, next, audit, "capture.autosaved"));
}

/** Releases ownership while retaining the recoverable draft. */
export function holdCaptureDraft(
  captureDraft: CaptureDraft,
  auditContext: CaptureAuditContext,
): CaptureDraftMutation {
  assertValidDraft(captureDraft);
  const audit = snapshotAuditContext(auditContext);
  assertOwnedDraft(captureDraft, audit.actorId, "capture.held");
  const next = freezeDraft({ ...captureDraft, attention: "held", ownerActorId: undefined });
  return mutation(next, auditEvent(captureDraft, next, audit, "capture.held"));
}

/** Claims an unowned draft. Atomic compare-and-swap remains a persistence responsibility. */
export function claimCaptureDraft(
  captureDraft: CaptureDraft,
  auditContext: CaptureAuditContext,
): CaptureDraftMutation {
  assertValidDraft(captureDraft);
  const audit = snapshotAuditContext(auditContext);
  if (captureDraft.state !== "draft" || (captureDraft.attention !== "unclaimed" && captureDraft.attention !== "held")) {
    throw new InvalidCaptureDraftOperationError("capture.claimed");
  }
  return claimMutation(captureDraft, audit, "capture.claimed");
}

/** Resumes a held draft and assigns it to the acting operator. */
export function resumeCaptureDraft(
  captureDraft: CaptureDraft,
  auditContext: CaptureAuditContext,
): CaptureDraftMutation {
  assertValidDraft(captureDraft);
  const audit = snapshotAuditContext(auditContext);
  if (captureDraft.state !== "draft" || captureDraft.attention !== "held") {
    throw new InvalidCaptureDraftOperationError("capture.resumed");
  }
  return claimMutation(captureDraft, audit, "capture.resumed");
}

export function transferCaptureDraft(
  captureDraft: CaptureDraft,
  newOwnerActorId: string,
  auditContext: CaptureAuditContext,
): CaptureDraftMutation {
  assertValidDraft(captureDraft);
  const audit = snapshotAuditContext(auditContext);
  assertOwnedDraft(captureDraft, audit.actorId, "capture.transferred");
  assertText(newOwnerActorId, "newOwnerActorId");
  if (newOwnerActorId === captureDraft.ownerActorId) {
    throw new InvalidCaptureDraftOperationError("capture.transferred");
  }
  const next = freezeDraft({ ...captureDraft, ownerActorId: newOwnerActorId });
  return mutation(next, auditEvent(captureDraft, next, audit, "capture.transferred"));
}

export function confirmCaptureDraft(
  captureDraft: CaptureDraft,
  confirmedOrderId: string,
  auditContext: CaptureAuditContext,
): CaptureDraftMutation {
  assertValidDraft(captureDraft);
  const audit = snapshotAuditContext(auditContext);
  assertOwnedDraft(captureDraft, audit.actorId, "capture.confirmed");
  if (captureDraft.sourceChannel === undefined || captureDraft.fulfillmentChannel === undefined) {
    throw new CaptureDraftConfirmationFactsRequiredError();
  }
  assertText(confirmedOrderId, "confirmedOrderId");
  const next = freezeDraft({
    ...captureDraft,
    state: "confirmed",
    attention: "unclaimed",
    ownerActorId: undefined,
    confirmedOrderId,
  });
  return mutation(next, auditEvent(captureDraft, next, audit, "capture.confirmed"));
}

export function closeCaptureNoSale(
  captureDraft: CaptureDraft,
  reason: string,
  auditContext: CaptureAuditContext,
): CaptureDraftMutation {
  assertValidDraft(captureDraft);
  const audit = snapshotAuditContext(auditContext);
  assertOwnedDraft(captureDraft, audit.actorId, "capture.no_sale");
  assertText(reason, "reason");
  const next = freezeDraft({ ...captureDraft, state: "no_sale", attention: "unclaimed", ownerActorId: undefined });
  return mutation(next, auditEvent(captureDraft, next, audit, "capture.no_sale", { reason }));
}

function claimMutation(
  captureDraft: CaptureDraft,
  audit: CaptureAuditContext,
  type: "capture.claimed" | "capture.resumed",
): CaptureDraftMutation {
  const next = freezeDraft({ ...captureDraft, attention: "claimed", ownerActorId: audit.actorId });
  return mutation(next, auditEvent(captureDraft, next, audit, type));
}

function assertOwnedDraft(
  captureDraft: CaptureDraft,
  actorId: string,
  operation: CaptureAuditEventType,
): void {
  if (captureDraft.state !== "draft" || captureDraft.attention !== "claimed") {
    throw new InvalidCaptureDraftOperationError(operation);
  }
  if (captureDraft.ownerActorId !== actorId) throw new CaptureDraftOwnershipError();
}

function assertValidDraft(captureDraft: CaptureDraft): void {
  const value = readInput(captureDraft, "aggregate", [
    "captureDraftId", "restaurantId", "branchId", "folio", "state", "attention", "ownerActorId",
    "sourceChannel", "fulfillmentChannel", "confirmedOrderId",
  ], true);
  assertText(value.captureDraftId, "captureDraftId");
  assertText(value.restaurantId, "restaurantId");
  assertText(value.branchId, "branchId");
  assertText(value.folio, "folio");
  if (value.state !== "draft" && value.state !== "confirmed" && value.state !== "no_sale") {
    throw new InvalidCaptureDraftError("state");
  }
  if (value.attention !== "unclaimed" && value.attention !== "claimed" && value.attention !== "held") {
    throw new InvalidCaptureDraftError("attention");
  }
  if (value.attention === "claimed") assertText(value.ownerActorId, "ownerActorId");
  else if (value.ownerActorId !== undefined) throw new InvalidCaptureDraftError("ownerActorId");
  if (value.state !== "draft" && value.attention !== "unclaimed") throw new InvalidCaptureDraftError("attention");
  assertOptionalSourceChannel(value.sourceChannel);
  assertOptionalFulfillmentChannel(value.fulfillmentChannel);
  if (value.state === "confirmed") assertText(value.confirmedOrderId, "confirmedOrderId");
  else if (value.confirmedOrderId !== undefined) throw new InvalidCaptureDraftError("confirmedOrderId");
}

function auditEvent(
  previous: CaptureDraft | null,
  next: CaptureDraft,
  audit: CaptureAuditContext,
  type: CaptureAuditEventType,
  details: { readonly reason?: string } = {},
): CaptureAuditEvent {
  return Object.freeze({
    schemaVersion: CAPTURE_AUDIT_SCHEMA_VERSION,
    ...audit,
    type,
    captureDraftId: next.captureDraftId,
    restaurantId: next.restaurantId,
    branchId: next.branchId,
    fromState: previous?.state ?? null,
    toState: next.state,
    fromAttention: previous?.attention ?? null,
    toAttention: next.attention,
    ...(previous?.ownerActorId === undefined ? {} : { previousOwnerActorId: previous.ownerActorId }),
    ...(next.ownerActorId === undefined ? {} : { ownerActorId: next.ownerActorId }),
    ...(next.sourceChannel === undefined ? {} : { sourceChannel: next.sourceChannel }),
    ...(next.fulfillmentChannel === undefined ? {} : { fulfillmentChannel: next.fulfillmentChannel }),
    ...(next.confirmedOrderId === undefined ? {} : { confirmedOrderId: next.confirmedOrderId }),
    ...(details.reason === undefined ? {} : { reason: details.reason }),
  });
}

function mutation(captureDraft: CaptureDraft, auditEventValue: CaptureAuditEvent): CaptureDraftMutation {
  return Object.freeze({ captureDraft, auditEvent: auditEventValue });
}

function snapshotAuditContext(value: CaptureAuditContext): CaptureAuditContext {
  const audit = readInput(value, "audit context", ["eventId", "idempotencyKey", "actorId", "deviceId", "occurredAt"]);
  assertText(audit.eventId, "eventId");
  assertText(audit.idempotencyKey, "idempotencyKey");
  assertText(audit.actorId, "actorId");
  assertText(audit.deviceId, "deviceId");
  assertText(audit.occurredAt, "occurredAt");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(audit.occurredAt as string)
    || Number.isNaN(Date.parse(audit.occurredAt as string))) {
    throw new InvalidCaptureDraftError("occurredAt");
  }
  return Object.freeze({
    eventId: audit.eventId as string,
    idempotencyKey: audit.idempotencyKey as string,
    actorId: audit.actorId as string,
    deviceId: audit.deviceId as string,
    occurredAt: audit.occurredAt as string,
  });
}

function freezeDraft(value: {
  readonly captureDraftId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly folio: string;
  readonly state: CaptureDraftState;
  readonly attention: OrderAttentionState;
  readonly ownerActorId?: string | undefined;
  readonly sourceChannel?: OrderSourceChannel | undefined;
  readonly fulfillmentChannel?: OrderFulfillmentChannel | undefined;
  readonly confirmedOrderId?: string | undefined;
}): CaptureDraft {
  const { ownerActorId, sourceChannel, fulfillmentChannel } = value;
  return Object.freeze({
    captureDraftId: value.captureDraftId,
    restaurantId: value.restaurantId,
    branchId: value.branchId,
    folio: value.folio,
    state: value.state,
    attention: value.attention,
    ...(ownerActorId === undefined ? {} : { ownerActorId }),
    ...(sourceChannel === undefined ? {} : { sourceChannel }),
    ...(fulfillmentChannel === undefined ? {} : { fulfillmentChannel }),
    ...(value.confirmedOrderId === undefined ? {} : { confirmedOrderId: value.confirmedOrderId }),
  });
}

function assertText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new InvalidCaptureDraftError(field);
}

function assertOptionalSourceChannel(value: unknown, allowNull = false): void {
  if (value === undefined || (allowNull && value === null)) return;
  if (typeof value !== "string" || !(ORDER_SOURCE_CHANNELS as readonly string[]).includes(value)) {
    throw new InvalidCaptureDraftError("sourceChannel");
  }
}

function assertOptionalFulfillmentChannel(value: unknown, allowNull = false): void {
  if (value === undefined || (allowNull && value === null)) return;
  if (typeof value !== "string" || !(ORDER_FULFILLMENT_CHANNELS as readonly string[]).includes(value)) {
    throw new InvalidCaptureDraftError("fulfillmentChannel");
  }
}

function readInput(
  value: unknown,
  field: string,
  allowedKeys: readonly string[],
  frozen = false,
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype
      || (frozen && !Object.isFrozen(value))) {
      throw new InvalidCaptureDraftError(field);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowedKeys.includes(key)
      || !("value" in descriptors[key as string]!))) {
      throw new InvalidCaptureDraftError(field);
    }
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  } catch (error) {
    if (error instanceof InvalidCaptureDraftError) throw error;
    throw new InvalidCaptureDraftError(field);
  }
}
