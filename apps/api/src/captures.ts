import { types as nodeTypes } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import {
  parseCreateCaptureDraftCommandV1,
  parseAutosaveCaptureDraftCommandV1,
  parseCaptureMutationResultV1,
  parseHoldCaptureDraftCommandV1,
  parseClaimCaptureDraftCommandV1,
  parseResumeCaptureDraftCommandV1,
  parseSetCaptureRecoveryPreferenceCommandV1,
  parseCaptureRecoveryPreferenceResultV1,
  parseCaptureWorkTrayRequestV1,
  parseCaptureWorkTrayResultV1,
  parseCaptureWorkspaceRequestV1,
  parseSetCaptureCustomerCommandV1,
  parseSetCaptureFulfillmentCommandV1,
  type SetCaptureCustomerCommandV1,
  type SetCaptureFulfillmentCommandV1,
  type SetCaptureRecoveryPreferenceCommandV1,
  type CaptureRecoveryPreferenceResultV1,
  type BranchScope,
  type HoldCaptureDraftCommandV1,
  type ClaimCaptureDraftCommandV1,
  type ResumeCaptureDraftCommandV1,
  type CreateCaptureDraftCommandV1,
  type AutosaveCaptureDraftCommandV1,
  type CaptureMutationResultV1,
  type CaptureWorkTrayRequestV1,
  type CaptureWorkTrayResultV1,
  type CaptureWorkspaceRequestV1,
  type CaptureWorkspaceV1,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { decodeCaptureRecord, decodeCaptureWorkspace } from "./persistence/capture-persistence-codec.js";

export type CaptureApplicationErrorCode = "request" | "authorization" | "conflict" | "missing" | "unavailable";
export class CaptureApplicationError extends Error {
  public constructor(public readonly code: CaptureApplicationErrorCode) {
    super(`CAPTURE_${code.toUpperCase()}`);
    this.name = "CaptureApplicationError";
  }
}
export interface CaptureCreationPort {
  createDraft(actorId: string, command: CreateCaptureDraftCommandV1): Promise<unknown>;
  autosaveDraft?(actorId: string, command: AutosaveCaptureDraftCommandV1): Promise<unknown>;
  readWorkspace?(actorId: string, request: CaptureWorkspaceRequestV1): Promise<unknown>;
}
export const CAPTURE_CREATION_PORT = Symbol("CAPTURE_CREATION_PORT");
export type CaptureAttentionOperation = "capture.held" | "capture.claimed" | "capture.resumed";
export type CaptureEditOperation = CaptureAttentionOperation | "capture.recovery_preference_changed";
export type CaptureAttentionCommand = HoldCaptureDraftCommandV1 | ClaimCaptureDraftCommandV1 | ResumeCaptureDraftCommandV1 | SetCaptureRecoveryPreferenceCommandV1;
export interface CaptureAttentionPort {
  mutateAttention(actorId: string, operation: CaptureEditOperation, command: CaptureAttentionCommand): Promise<unknown>;
}
export const CAPTURE_ATTENTION_PORT = Symbol("CAPTURE_ATTENTION_PORT");
export interface CaptureCustomerPort {
  setCustomer(actorId: string, command: SetCaptureCustomerCommandV1): Promise<unknown>;
}
export const CAPTURE_CUSTOMER_PORT = Symbol("CAPTURE_CUSTOMER_PORT");
export interface CaptureFulfillmentPort {
  setFulfillment(actorId: string, command: SetCaptureFulfillmentCommandV1): Promise<unknown>;
}
export const CAPTURE_FULFILLMENT_PORT = Symbol("CAPTURE_FULFILLMENT_PORT");
export interface CaptureTrayPort { list(actorId: string, request: CaptureWorkTrayRequestV1): Promise<unknown>; }
export const CAPTURE_TRAY_PORT = Symbol("CAPTURE_TRAY_PORT");
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

@Injectable()
export class PostgresCaptureCreator implements CaptureCreationPort, CaptureAttentionPort, CaptureCustomerPort, CaptureFulfillmentPort, CaptureTrayPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async createDraft(actorId: string, input: CreateCaptureDraftCommandV1): Promise<unknown> {
    const command = parseStorageCommand(input);
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.create_capture_draft($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async autosaveDraft(actorId: string, input: AutosaveCaptureDraftCommandV1): Promise<unknown> {
    const command = parseAutosaveCommand(input);
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.autosave_capture_draft($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async readWorkspace(actorId: string, input: CaptureWorkspaceRequestV1): Promise<unknown> {
    const request = parseCaptureWorkspaceRequestV1(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.read_capture_workspace($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async mutateAttention(actorId: string, operation: CaptureEditOperation, input: CaptureAttentionCommand): Promise<unknown> {
    const command = parseAttentionCommand(operation, input);
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.mutate_capture_attention($1::uuid, $2::text, $3::jsonb) as result",
      [actorId, operation, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async setCustomer(actorId: string, input: SetCaptureCustomerCommandV1): Promise<unknown> {
    const command = parseCustomerCommand(input);
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.set_capture_customer($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async setFulfillment(actorId: string, input: SetCaptureFulfillmentCommandV1): Promise<unknown> {
    const command = parseFulfillmentCommand(input);
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.set_capture_fulfillment($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async list(actorId: string, input: CaptureWorkTrayRequestV1): Promise<unknown> {
    const request = parseCaptureWorkTrayRequestV1(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.list_capture_work_tray($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }
}

@Injectable()
export class CaptureTrayService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_TRAY_PORT) private readonly tray: CaptureTrayPort,
  ) {}
  public async list(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureWorkTrayResultV1> {
    const request = parseCaptureWorkTrayRequestV1(input);
    if (request === undefined) throw new CaptureApplicationError("request");
    let actorId: string;
    try { actorId = (await this.authorization.authorizeBranch(principal, request.scope, "captures.read")).principal.actorId; }
    catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.tray.list(actorId, request); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
    if (statusOnly !== undefined) throw statusOnly.status === "rejected" ? new CaptureApplicationError("request") : unavailable();
    const result = parseCaptureWorkTrayResultV1(raw);
    if (result === undefined || result.items.length > request.limit || result.items.some((item) => item.status !== "draft"
      || item.scope.restaurantId !== request.scope.restaurantId || item.scope.branchId !== request.scope.branchId)) throw unavailable();
    return result;
  }
}

@Injectable()
export class CaptureFulfillmentService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_FULFILLMENT_PORT) private readonly persistence: CaptureFulfillmentPort,
  ) {}
  public async setFulfillment(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureMutationResultV1> {
    const command = parseFulfillmentCommand(input);
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, command.scope, "captures.update");
      if (command.addressId !== null) await this.authorization.authorizeBranch(principal, command.scope, "customers.read");
      actorId = authorized.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.persistence.setFulfillment(actorId, command); } catch { throw unavailable(); }
    const { record, replayed } = parseOutcome(raw, command.scope);
    if (record.detail.captureDraftId !== command.captureDraftId || record.detail.version !== command.expectedVersion + 1
      || record.detail.status !== "draft" || record.detail.attentionStatus !== "claimed"
      || record.detail.attentionLeaseId !== command.attentionLeaseId
      || record.detail.customerSnapshotRef !== command.customerSnapshotRef
      || (record.detail.fulfillmentSnapshotRef === null) !== (command.addressId === null)) throw unavailable();
    const result = parseCaptureMutationResultV1({ schemaVersion: 1, detail: record.detail, replayed });
    if (result === undefined) throw unavailable();
    return result;
  }
}

@Injectable()
export class CaptureCustomerService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_CUSTOMER_PORT) private readonly persistence: CaptureCustomerPort,
  ) {}

  public async setCustomer(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureMutationResultV1> {
    const command = parseCustomerCommand(input);
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, command.scope, "captures.update");
      if (command.customerId !== null) await this.authorization.authorizeBranch(principal, command.scope, "customers.read");
      actorId = authorized.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.persistence.setCustomer(actorId, command); }
    catch { throw unavailable(); }
    const { record, replayed } = parseOutcome(raw, command.scope);
    if (record.detail.captureDraftId !== command.captureDraftId || record.detail.version !== command.expectedVersion + 1
      || record.detail.status !== "draft" || record.detail.attentionStatus !== "claimed"
      || record.detail.attentionLeaseId !== command.attentionLeaseId
      || (record.detail.customerSnapshotRef === null) !== (command.customerId === null)
      || record.detail.fulfillmentSnapshotRef !== null) throw unavailable();
    const result = parseCaptureMutationResultV1({ schemaVersion: 1, detail: record.detail, replayed });
    if (result === undefined) throw unavailable();
    return result;
  }
}

@Injectable()
export class CaptureService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_CREATION_PORT) private readonly creator: CaptureCreationPort,
  ) {}

  public async createDraft(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureMutationResultV1> {
    const command = parseStorageCommand(input);
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, command.scope, "captures.create");
      actorId = authorized.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.creator.createDraft(actorId, command); }
    catch { throw unavailable(); }
    const { record, replayed } = parseOutcome(raw, command.scope);
    try {
      // Replay returns the original creation, never an arbitrary current/terminal snapshot.
      if (record.detail.captureDraftId !== command.captureDraftId || record.detail.version !== 1
        || record.detail.status !== "draft" || record.detail.attentionStatus !== "claimed"
        || record.detail.sourceChannel !== command.sourceChannel
        || record.detail.fulfillmentChannel !== command.fulfillmentChannel
        || record.detail.confirmedOrderId !== null || record.detail.customerSnapshotRef !== null
        || record.detail.fulfillmentSnapshotRef !== null || record.recoveryPolicy.autoRenewSelected) throw unavailable();
      const result = parseCaptureMutationResultV1({ schemaVersion: 1, detail: record.detail, replayed });
      if (result === undefined) throw unavailable();
      return result;
    } catch { throw unavailable(); }
  }

  public async autosaveDraft(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureMutationResultV1> {
    const command = parseAutosaveCommand(input);
    let actorId: string;
    try { actorId = (await this.authorization.authorizeBranch(principal, command.scope, "captures.update")).principal.actorId; }
    catch { throw new CaptureApplicationError("authorization"); }
    if (this.creator.autosaveDraft === undefined) throw unavailable();
    let raw: unknown;
    try { raw = await this.creator.autosaveDraft(actorId, command); } catch { throw unavailable(); }
    const { record, replayed } = parseOutcome(raw, command.scope);
    if (record.detail.captureDraftId !== command.captureDraftId || record.detail.version !== command.expectedVersion + 1
      || record.detail.status !== "draft" || record.detail.attentionStatus !== "claimed"
      || record.detail.attentionLeaseId !== command.attentionLeaseId
      || record.detail.sourceChannel !== command.sourceChannel
      || record.detail.fulfillmentChannel !== command.fulfillmentChannel
      || record.detail.customerSnapshotRef !== command.customerSnapshotRef
      || record.detail.fulfillmentSnapshotRef !== command.fulfillmentSnapshotRef) throw unavailable();
    const result = parseCaptureMutationResultV1({ schemaVersion: 1, detail: record.detail, replayed });
    if (result === undefined) throw unavailable();
    return result;
  }

  public async readWorkspace(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureWorkspaceV1> {
    const request = parseCaptureWorkspaceRequestV1(input);
    if (request === undefined) throw new CaptureApplicationError("request");
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, request.scope, "captures.read");
      await this.authorization.authorizeBranch(principal, request.scope, "customers.read");
      actorId = authorized.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    if (this.creator.readWorkspace === undefined) throw unavailable();
    let raw: unknown;
    try { raw = await this.creator.readWorkspace(actorId, request); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
    if (statusOnly?.status === "missing") throw new CaptureApplicationError("missing");
    if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
    if (statusOnly !== undefined) throw unavailable();
    try {
      const workspace = decodeCaptureWorkspace(raw, request.scope);
      if (workspace.detail.captureDraftId !== request.captureDraftId) throw unavailable();
      return workspace;
    } catch { throw unavailable(); }
  }
}

@Injectable()
export class CaptureAttentionService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_ATTENTION_PORT) private readonly persistence: CaptureAttentionPort,
  ) {}

  public async mutateAttention(principal: AuthenticatedPrincipal, operation: CaptureAttentionOperation, input: unknown): Promise<CaptureMutationResultV1> {
    const { record, replayed } = await this.execute(principal, operation, input);
    const result = parseCaptureMutationResultV1({ schemaVersion: 1, detail: record.detail, replayed });
    if (result === undefined) throw unavailable();
    return result;
  }

  public async setRecoveryPreference(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureRecoveryPreferenceResultV1> {
    const command = parseSetCaptureRecoveryPreferenceCommandV1(input);
    if (command === undefined) throw new CaptureApplicationError("request");
    const { record, replayed } = await this.execute(principal, "capture.recovery_preference_changed", command);
    if (record.recoveryPolicy.autoRenewSelected !== command.autoRenewSelected
      || record.detail.attentionLeaseId !== command.attentionLeaseId) throw unavailable();
    const result = parseCaptureRecoveryPreferenceResultV1({ schemaVersion: 1, detail: record.detail, replayed,
      recoveryPolicy: record.recoveryPolicy });
    if (result === undefined) throw unavailable();
    return result;
  }

  private async execute(principal: AuthenticatedPrincipal, operation: CaptureEditOperation, input: unknown) {
    const command = parseAttentionCommand(operation, input);
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, command.scope,
        operation === "capture.held" || operation === "capture.recovery_preference_changed" ? "captures.update" : "captures.claim");
      actorId = authorized.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.persistence.mutateAttention(actorId, operation, command); }
    catch { throw unavailable(); }
    const { record, replayed } = parseOutcome(raw, command.scope);
    if (record.detail.captureDraftId !== command.captureDraftId || record.detail.version !== command.expectedVersion + 1
      || record.detail.status !== "draft" || record.detail.attentionStatus !== (operation === "capture.held" ? "held" : "claimed")) throw unavailable();
    return { record, replayed };
  }
}

function parseAttentionCommand(operation: CaptureEditOperation, input: unknown): CaptureAttentionCommand {
  const command = operation === "capture.held" ? parseHoldCaptureDraftCommandV1(input)
    : operation === "capture.claimed" ? parseClaimCaptureDraftCommandV1(input)
      : operation === "capture.resumed" ? parseResumeCaptureDraftCommandV1(input)
        : operation === "capture.recovery_preference_changed" ? parseSetCaptureRecoveryPreferenceCommandV1(input) : undefined;
  if (command === undefined || command.expectedVersion >= Number.MAX_SAFE_INTEGER) throw new CaptureApplicationError("request");
  return command;
}
function parseOutcome(raw: unknown, scope: BranchScope) {
  const statusOnly = exactRecord(raw, ["status"]);
  if (statusOnly !== undefined) {
    if (statusOnly.status === "denied") throw new CaptureApplicationError("authorization");
    if (statusOnly.status === "conflict") throw new CaptureApplicationError("conflict");
    if (statusOnly.status === "rejected") throw new CaptureApplicationError("request");
    throw unavailable();
  }
  const response = exactRecord(raw, ["status", "record"]);
  if (response === undefined || (response.status !== "applied" && response.status !== "replayed")) throw unavailable();
  try { return { record: decodeCaptureRecord(response.record, scope), replayed: response.status === "replayed" }; }
  catch { throw unavailable(); }
}

function parseStorageCommand(input: unknown): CreateCaptureDraftCommandV1 {
  const command = parseCreateCaptureDraftCommandV1(input);
  if (command === undefined) throw new CaptureApplicationError("request");
  return command;
}
function parseAutosaveCommand(input: unknown): AutosaveCaptureDraftCommandV1 {
  const command = parseAutosaveCaptureDraftCommandV1(input);
  if (command === undefined || command.expectedVersion >= Number.MAX_SAFE_INTEGER
    || (command.fulfillmentSnapshotRef !== null && command.fulfillmentChannel !== "delivery")) {
    throw new CaptureApplicationError("request");
  }
  return command;
}
function parseCustomerCommand(input: unknown): SetCaptureCustomerCommandV1 {
  const command = parseSetCaptureCustomerCommandV1(input);
  if (command === undefined || command.expectedVersion >= Number.MAX_SAFE_INTEGER) throw new CaptureApplicationError("request");
  return command;
}
function parseFulfillmentCommand(input: unknown): SetCaptureFulfillmentCommandV1 {
  const command = parseSetCaptureFulfillmentCommandV1(input);
  if (command === undefined || command.expectedVersion >= Number.MAX_SAFE_INTEGER) throw new CaptureApplicationError("request");
  return command;
}
function unavailable(): CaptureApplicationError { return new CaptureApplicationError("unavailable"); }
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || nodeTypes.isProxy(value) || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    const detached: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      detached[key] = descriptor.value;
    }
    return detached;
  } catch { return undefined; }
}
