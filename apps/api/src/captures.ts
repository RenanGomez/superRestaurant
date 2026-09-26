import { types as nodeTypes } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import {
  parseCreateCaptureDraftCommandV1,
  parseAutosaveCaptureDraftCommandV1,
  parseCaptureMutationResultV1,
  parseCaptureAssignmentDirectoryRequestV1,
  parseCaptureAssignmentDirectoryV1,
  parseHoldCaptureDraftCommandV1,
  parseClaimCaptureDraftCommandV1,
  parseResumeCaptureDraftCommandV1,
  parseTakeoverCaptureDraftCommandV1,
  parseTransferCaptureDraftCommandV1,
  parseSetCaptureRecoveryPreferenceCommandV1,
  parseCaptureRecoveryPreferenceResultV1,
  parseCaptureWorkTrayRequestV1,
  parseCaptureWorkTrayResultV1,
  parseCaptureWorkspaceRequestV1,
  parseCaptureWorkspaceRequestV2,
  parseCaptureWorkspaceRequestV3,
  parseCaptureDeliveryInstructionSuggestionsRequestV1,
  parseCaptureDeliveryInstructionSuggestionsV1,
  parseSetCaptureDeliveryInstructionsCommandV1,
  parseSetCaptureDeliveryInstructionsResultV1,
  parseConfirmCaptureDraftCommandV2,
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
  type TakeoverCaptureDraftCommandV1,
  type TransferCaptureDraftCommandV1,
  type CreateCaptureDraftCommandV1,
  type AutosaveCaptureDraftCommandV1,
  type CaptureMutationResultV1,
  type CaptureAssignmentDirectoryRequestV1,
  type CaptureAssignmentDirectoryV1,
  type CaptureWorkTrayRequestV1,
  type CaptureWorkTrayResultV1,
  type CaptureWorkspaceRequestV1,
  type CaptureWorkspaceRequestV2,
  type CaptureWorkspaceRequestV3,
  type CaptureWorkspaceV1,
  type CaptureWorkspaceV2,
  type CaptureWorkspaceV3,
  type CaptureDeliveryInstructionSuggestionsRequestV1,
  type CaptureDeliveryInstructionSuggestionsV1,
  type MenuCatalogV1,
  type SetCaptureDeliveryInstructionsCommandV1,
  type SetCaptureDeliveryInstructionsResultV1,
  type ConfirmCaptureDraftCommandV2,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import {
  materializeCaptureOrder,
  parseCaptureRepeatSelectionPlan,
  type CaptureOrderMaterialization,
  type CaptureRepeatSelectionPlan,
} from "./capture-repeat-order-plan.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { MENU_CATALOG_PORT, type MenuCatalogPort } from "./menu-catalog.js";
import { decodeCaptureRecord, decodeCaptureWorkspace, decodeCaptureWorkspaceV2, decodeCaptureWorkspaceV3 } from "./persistence/capture-persistence-codec.js";
import { encodeOrderAuditEventRecord, encodeOrderRecord } from "./persistence/order-persistence-codec.js";

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
  readWorkspaceV2?(actorId: string, request: CaptureWorkspaceRequestV2): Promise<unknown>;
  readWorkspaceV3?(actorId: string, request: CaptureWorkspaceRequestV3): Promise<unknown>;
}
export const CAPTURE_CREATION_PORT = Symbol("CAPTURE_CREATION_PORT");
export type CaptureAttentionOperation = "capture.held" | "capture.claimed" | "capture.resumed"
  | "capture.transferred" | "capture.taken_over";
export type CaptureEditOperation = CaptureAttentionOperation | "capture.recovery_preference_changed";
export type CaptureAttentionCommand = HoldCaptureDraftCommandV1 | ClaimCaptureDraftCommandV1
  | ResumeCaptureDraftCommandV1 | SetCaptureRecoveryPreferenceCommandV1 | TransferCaptureDraftCommandV1
  | TakeoverCaptureDraftCommandV1;
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
export interface CaptureDeliveryInstructionsPort {
  setDeliveryInstructions(actorId: string, command: SetCaptureDeliveryInstructionsCommandV1): Promise<unknown>;
  listDeliveryInstructionSuggestions(
    actorId: string,
    request: CaptureDeliveryInstructionSuggestionsRequestV1,
  ): Promise<unknown>;
}
export const CAPTURE_DELIVERY_INSTRUCTIONS_PORT = Symbol("CAPTURE_DELIVERY_INSTRUCTIONS_PORT");
export interface CaptureConfirmationPort {
  probeConfirmation(actorId: string, command: ConfirmCaptureDraftCommandV2): Promise<unknown>;
  readRepeatOrderPlan(actorId: string, request: CaptureWorkspaceRequestV3): Promise<unknown>;
  confirmDraft(
    actorId: string,
    command: ConfirmCaptureDraftCommandV2,
    materialization: CaptureOrderMaterialization,
  ): Promise<unknown>;
}
export const CAPTURE_CONFIRMATION_PORT = Symbol("CAPTURE_CONFIRMATION_PORT");
export interface CaptureTrayPort { list(actorId: string, request: CaptureWorkTrayRequestV1): Promise<unknown>; }
export const CAPTURE_TRAY_PORT = Symbol("CAPTURE_TRAY_PORT");
export interface CaptureAssignmentDirectoryPort {
  listAssignmentCandidates(actorId: string, request: CaptureAssignmentDirectoryRequestV1): Promise<unknown>;
}
export const CAPTURE_ASSIGNMENT_DIRECTORY_PORT = Symbol("CAPTURE_ASSIGNMENT_DIRECTORY_PORT");
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

@Injectable()
export class PostgresCaptureCreator implements CaptureCreationPort, CaptureAttentionPort, CaptureCustomerPort, CaptureFulfillmentPort, CaptureDeliveryInstructionsPort, CaptureConfirmationPort, CaptureTrayPort, CaptureAssignmentDirectoryPort {
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

  public async readWorkspaceV2(actorId: string, input: CaptureWorkspaceRequestV2): Promise<unknown> {
    const request = parseCaptureWorkspaceRequestV2(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.read_capture_workspace_v2($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async readWorkspaceV3(actorId: string, input: CaptureWorkspaceRequestV3): Promise<unknown> {
    const request = parseCaptureWorkspaceRequestV3(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.read_capture_workspace_v3($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async listAssignmentCandidates(actorId: string, input: CaptureAssignmentDirectoryRequestV1): Promise<unknown> {
    const request = parseCaptureAssignmentDirectoryRequestV1(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.list_capture_assignment_candidates($1::uuid, $2::jsonb) as result",
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
    const statement = operation === "capture.transferred" || operation === "capture.taken_over"
      ? "select app_private.mutate_capture_assignment($1::uuid, $2::text, $3::jsonb) as result"
      : "select app_private.mutate_capture_attention($1::uuid, $2::text, $3::jsonb) as result";
    const response = await this.database.query(
      statement,
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

  public async setDeliveryInstructions(actorId: string, input: SetCaptureDeliveryInstructionsCommandV1): Promise<unknown> {
    const command = parseDeliveryInstructionsCommand(input);
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.set_capture_delivery_instructions($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async listDeliveryInstructionSuggestions(
    actorId: string,
    input: CaptureDeliveryInstructionSuggestionsRequestV1,
  ): Promise<unknown> {
    const request = parseCaptureDeliveryInstructionSuggestionsRequestV1(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.list_capture_delivery_instruction_suggestions($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async probeConfirmation(actorId: string, input: ConfirmCaptureDraftCommandV2): Promise<unknown> {
    const command = parseConfirmCommand(input);
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.confirm_capture_draft_v3($1::uuid, $2::jsonb, null::jsonb, null::jsonb) as result",
      [actorId, JSON.stringify(command)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async readRepeatOrderPlan(actorId: string, input: CaptureWorkspaceRequestV3): Promise<unknown> {
    const request = parseCaptureWorkspaceRequestV3(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.read_capture_repeat_order_plan($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async confirmDraft(
    actorId: string,
    input: ConfirmCaptureDraftCommandV2,
    materialization: CaptureOrderMaterialization,
  ): Promise<unknown> {
    const command = parseConfirmCommand(input);
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.confirm_capture_draft_v3($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb) as result",
      [actorId, JSON.stringify(command), JSON.stringify(encodeOrderRecord(materialization.order)),
        JSON.stringify(materialization.auditEvents.map(encodeOrderAuditEventRecord))],
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
export class CaptureAssignmentDirectoryService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_ASSIGNMENT_DIRECTORY_PORT) private readonly directory: CaptureAssignmentDirectoryPort,
  ) {}

  public async list(
    principal: AuthenticatedPrincipal,
    input: unknown,
  ): Promise<CaptureAssignmentDirectoryV1> {
    const request = parseCaptureAssignmentDirectoryRequestV1(input);
    if (request === undefined) throw new CaptureApplicationError("request");
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, request.scope, "captures.transfer")).principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.directory.listAssignmentCandidates(actorId, request); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
    if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
    if (statusOnly !== undefined) throw unavailable();
    const result = parseCaptureAssignmentDirectoryV1(raw);
    if (result === undefined || result.scope.restaurantId !== request.scope.restaurantId
      || result.scope.branchId !== request.scope.branchId) throw unavailable();
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
export class CaptureDeliveryInstructionsService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_DELIVERY_INSTRUCTIONS_PORT) private readonly persistence: CaptureDeliveryInstructionsPort,
  ) {}

  public async setDeliveryInstructions(
    principal: AuthenticatedPrincipal,
    input: unknown,
  ): Promise<SetCaptureDeliveryInstructionsResultV1> {
    const command = parseDeliveryInstructionsCommand(input);
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, command.scope, "captures.update")).principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.persistence.setDeliveryInstructions(actorId, command); } catch { throw unavailable(); }
    const response = exactRecord(raw, ["status", "record", "deliveryInstructions"]);
    if (response === undefined) {
      const statusOnly = exactRecord(raw, ["status"]);
      if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
      if (statusOnly?.status === "conflict") throw new CaptureApplicationError("conflict");
      if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
      throw unavailable();
    }
    if (response.status !== "applied" && response.status !== "replayed") throw unavailable();
    const persisted = decodeCaptureRecord(response.record, command.scope);
    const result = parseSetCaptureDeliveryInstructionsResultV1({
      schemaVersion: 1,
      replayed: response.status === "replayed",
      detail: persisted.detail,
      deliveryInstructions: response.deliveryInstructions,
    });
    if (result === undefined || result.detail.captureDraftId !== command.captureDraftId
      || result.detail.version !== command.expectedVersion + 1
      || result.detail.status !== "draft" || result.detail.attentionStatus !== "claimed"
      || result.detail.attentionLeaseId !== command.attentionLeaseId
      || result.deliveryInstructions !== command.deliveryInstructions) throw unavailable();
    return result;
  }

  public async listSuggestions(
    principal: AuthenticatedPrincipal,
    input: unknown,
  ): Promise<CaptureDeliveryInstructionSuggestionsV1> {
    const request = parseCaptureDeliveryInstructionSuggestionsRequestV1(input);
    if (request === undefined) throw new CaptureApplicationError("request");
    let actorId: string;
    try {
      const captureAuthorization = await this.authorization.authorizeBranch(principal, request.scope, "captures.read");
      const customerAuthorization = await this.authorization.authorizeBranch(principal, request.scope, "customers.read");
      if (captureAuthorization.principal.actorId !== customerAuthorization.principal.actorId) throw new Error("actor mismatch");
      actorId = captureAuthorization.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.persistence.listDeliveryInstructionSuggestions(actorId, request); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
    if (statusOnly?.status === "missing") throw new CaptureApplicationError("missing");
    if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
    if (statusOnly !== undefined) throw unavailable();
    const result = parseCaptureDeliveryInstructionSuggestionsV1(raw);
    if (result === undefined || result.captureDraftId !== request.captureDraftId) throw unavailable();
    return result;
  }
}

@Injectable()
export class CaptureConfirmationService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_CREATION_PORT) private readonly captures: CaptureCreationPort,
    @Inject(CAPTURE_CONFIRMATION_PORT) private readonly persistence: CaptureConfirmationPort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
  ) {}

  public async confirm(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureMutationResultV1> {
    const command = parseConfirmCommand(input);
    let actorId: string;
    try {
      const captureAuthorization = await this.authorization.authorizeBranch(principal, command.scope, "captures.update");
      const orderAuthorization = await this.authorization.authorizeBranch(principal, command.scope, "orders.create");
      if (captureAuthorization.principal.actorId !== orderAuthorization.principal.actorId) throw new Error("actor mismatch");
      actorId = captureAuthorization.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let rawProbe: unknown;
    try { rawProbe = await this.persistence.probeConfirmation(actorId, command); } catch { throw unavailable(); }
    const replay = exactRecord(rawProbe, ["status", "record"]);
    if (replay?.status === "replayed") return confirmationResult(replay, command);
    const probeStatus = exactRecord(rawProbe, ["status"]);
    if (probeStatus?.status === "denied") throw new CaptureApplicationError("authorization");
    if (probeStatus?.status === "rejected") throw new CaptureApplicationError("request");
    if (probeStatus?.status !== "pending") throw unavailable();

    if (this.captures.readWorkspaceV3 === undefined) throw unavailable();
    const workspaceRequest = {
      schemaVersion: 3 as const, scope: command.scope, captureDraftId: command.captureDraftId,
    };
    let rawWorkspace: unknown;
    try {
      rawWorkspace = await this.captures.readWorkspaceV3(actorId, workspaceRequest);
    } catch { throw unavailable(); }
    const statusOnly = exactRecord(rawWorkspace, ["status"]);
    if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
    if (statusOnly?.status === "missing") throw new CaptureApplicationError("missing");
    if (statusOnly !== undefined) throw unavailable();
    let workspace: CaptureWorkspaceV3;
    try { workspace = decodeCaptureWorkspaceV3(rawWorkspace, command.scope); } catch { throw unavailable(); }
    const detail = workspace.detail;
    if (detail.captureDraftId !== command.captureDraftId || detail.version !== command.expectedVersion
      || detail.status !== "draft" || detail.attentionStatus !== "claimed"
      || detail.attentionLeaseId !== command.attentionLeaseId || detail.fulfillmentChannel === null
      || (detail.fulfillmentChannel === "dine_in") !== (command.tableId !== null)
      || (detail.fulfillmentChannel === "delivery" && (workspace.customerSnapshot === null
        || workspace.fulfillmentSnapshot === null))) throw new CaptureApplicationError("conflict");
    const channel = detail.fulfillmentChannel === "dine_in" ? "table"
      : detail.fulfillmentChannel === "pickup" ? "takeout" : detail.fulfillmentChannel;
    let plan: CaptureRepeatSelectionPlan | null = null;
    let catalog: MenuCatalogV1 | null = null;
    if (workspace.repeatOrderPlan !== null) {
      try {
        const permissions = await Promise.all(["catalog.read", "customers.read", "orders.read"].map((permission) =>
          this.authorization.authorizeBranch(principal, command.scope, permission as "catalog.read" | "customers.read" | "orders.read")));
        if (permissions.some(({ principal: decisionPrincipal }) => decisionPrincipal.actorId !== actorId)) {
          throw new Error("actor mismatch");
        }
      } catch { throw new CaptureApplicationError("authorization"); }
      let rawPlan: unknown;
      try { rawPlan = await this.persistence.readRepeatOrderPlan(actorId, workspaceRequest); } catch { throw unavailable(); }
      const planEnvelope = exactRecord(rawPlan, ["status", "plan"]);
      if (planEnvelope?.status !== "ok") {
        const planStatus = exactRecord(rawPlan, ["status"]);
        if (planStatus?.status === "denied") throw new CaptureApplicationError("authorization");
        if (planStatus?.status === "missing") throw new CaptureApplicationError("conflict");
        throw unavailable();
      }
      plan = parseCaptureRepeatSelectionPlan(planEnvelope.plan) ?? null;
      if (plan === null || plan.customerId !== workspace.repeatOrderPlan.customerId
        || plan.sourceOrderId !== workspace.repeatOrderPlan.sourceOrderId
        || plan.catalogVersion !== workspace.repeatOrderPlan.catalogVersion
        || plan.lines.length !== workspace.repeatOrderPlan.lineCount) throw unavailable();
      let catalogState;
      try { catalogState = await this.catalogs.read(actorId, command.scope); } catch { throw unavailable(); }
      if (catalogState === "forbidden") throw new CaptureApplicationError("authorization");
      if (catalogState.catalog === null || catalogState.scope.restaurantId !== command.scope.restaurantId
        || catalogState.scope.branchId !== command.scope.branchId) throw new CaptureApplicationError("conflict");
      catalog = catalogState.catalog;
    }
    let materialization: CaptureOrderMaterialization;
    try {
      materialization = materializeCaptureOrder(command, actorId, channel, plan, catalog);
    } catch { throw new CaptureApplicationError(plan === null ? "request" : "conflict"); }
    let raw: unknown;
    try { raw = await this.persistence.confirmDraft(actorId, command, materialization); } catch { throw unavailable(); }
    return confirmationResult(raw, command);
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

  public async readWorkspace(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureWorkspaceV1 | CaptureWorkspaceV2 | CaptureWorkspaceV3> {
    const requestV3 = parseCaptureWorkspaceRequestV3(input);
    const requestV2 = requestV3 === undefined ? parseCaptureWorkspaceRequestV2(input) : undefined;
    const request = requestV3 ?? requestV2 ?? parseCaptureWorkspaceRequestV1(input);
    if (request === undefined) throw new CaptureApplicationError("request");
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, request.scope, "captures.read");
      await this.authorization.authorizeBranch(principal, request.scope, "customers.read");
      actorId = authorized.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    const reader = requestV3 !== undefined ? this.creator.readWorkspaceV3
      : requestV2 !== undefined ? this.creator.readWorkspaceV2 : this.creator.readWorkspace;
    if (reader === undefined) throw unavailable();
    let raw: unknown;
    try {
      raw = requestV3 !== undefined
        ? await this.creator.readWorkspaceV3!(actorId, requestV3)
        : requestV2 !== undefined
          ? await this.creator.readWorkspaceV2!(actorId, requestV2)
          : await this.creator.readWorkspace!(actorId, request as CaptureWorkspaceRequestV1);
    } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
    if (statusOnly?.status === "missing") throw new CaptureApplicationError("missing");
    if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
    if (statusOnly !== undefined) throw unavailable();
    try {
      const workspace = requestV3 !== undefined
        ? decodeCaptureWorkspaceV3(raw, request.scope)
        : requestV2 !== undefined
          ? decodeCaptureWorkspaceV2(raw, request.scope)
          : decodeCaptureWorkspace(raw, request.scope);
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
        captureAttentionPermission(operation));
      actorId = authorized.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.persistence.mutateAttention(actorId, operation, command); }
    catch { throw unavailable(); }
    const { record, replayed } = parseOutcome(raw, command.scope);
    if (record.detail.captureDraftId !== command.captureDraftId || record.detail.version !== command.expectedVersion + 1
      || record.detail.status !== "draft" || record.detail.attentionStatus !== (operation === "capture.held" ? "held" : "claimed")) throw unavailable();
    if (operation === "capture.transferred"
      && (!("targetMembershipId" in command) || record.detail.ownerMembershipId !== command.targetMembershipId)) throw unavailable();
    return { record, replayed };
  }
}

function captureAttentionPermission(operation: CaptureEditOperation) {
  if (operation === "capture.held" || operation === "capture.recovery_preference_changed") return "captures.update" as const;
  if (operation === "capture.transferred") return "captures.transfer" as const;
  if (operation === "capture.taken_over") return "captures.takeover" as const;
  return "captures.claim" as const;
}

function parseAttentionCommand(operation: CaptureEditOperation, input: unknown): CaptureAttentionCommand {
  const command = operation === "capture.held" ? parseHoldCaptureDraftCommandV1(input)
    : operation === "capture.claimed" ? parseClaimCaptureDraftCommandV1(input)
      : operation === "capture.resumed" ? parseResumeCaptureDraftCommandV1(input)
        : operation === "capture.transferred" ? parseTransferCaptureDraftCommandV1(input)
          : operation === "capture.taken_over" ? parseTakeoverCaptureDraftCommandV1(input)
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
function parseDeliveryInstructionsCommand(input: unknown): SetCaptureDeliveryInstructionsCommandV1 {
  const command = parseSetCaptureDeliveryInstructionsCommandV1(input);
  if (command === undefined || command.expectedVersion >= Number.MAX_SAFE_INTEGER) {
    throw new CaptureApplicationError("request");
  }
  return command;
}
function parseConfirmCommand(input: unknown): ConfirmCaptureDraftCommandV2 {
  const command = parseConfirmCaptureDraftCommandV2(input);
  if (command === undefined || command.expectedVersion >= Number.MAX_SAFE_INTEGER) {
    throw new CaptureApplicationError("request");
  }
  return command;
}
function confirmationResult(raw: unknown, command: ConfirmCaptureDraftCommandV2): CaptureMutationResultV1 {
  const { record, replayed } = parseOutcome(raw, command.scope);
  if (record.detail.captureDraftId !== command.captureDraftId
    || record.detail.version !== command.expectedVersion + 1 || record.detail.status !== "confirmed"
    || record.detail.confirmedOrderId !== command.orderId || record.detail.attentionStatus !== "unclaimed") {
    throw unavailable();
  }
  const result = parseCaptureMutationResultV1({ schemaVersion: 1, detail: record.detail, replayed });
  if (result === undefined) throw unavailable();
  return result;
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
