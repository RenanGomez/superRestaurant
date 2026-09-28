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
  parseCloseCaptureNoSaleCommandV1,
  parseSetCaptureCustomerCommandV1,
  parseSetCaptureFulfillmentCommandV1,
  type CloseCaptureNoSaleCommandV1,
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
  parseCaptureWorkspaceRequestV4,
  parseCaptureSelectionPlanV1,
  parseCaptureSelectionPlanProjectionV1,
  parseReplaceCaptureSelectionPlanCommandV1,
  type CaptureWorkspaceRequestV4,
  type CaptureWorkspaceV4,
  type CaptureSelectionPlanProjectionModifierV1,
  type CaptureSelectionPlanProjectionLineV1,
  type CaptureSelectionPlanProjectionV1,
  type CaptureSelectionPlanV1,
  type CaptureSelectionLineV1,
  type ReplaceCaptureSelectionPlanCommandV1,
  parseCaptureWorkspaceRequestV5,
  parseRequestCaptureDeliveryQuoteCommandV1,
  parseSetCapturePaymentIntentCommandV1,
  parseCapturePaymentIntentProjectionV1,
  type CaptureWorkspaceRequestV5,
  type CaptureWorkspaceV5,
  type CapturePaymentIntentProjectionV1,
  type DeliveryQuoteV1,
} from "@super-restaurant/shared-types";
import {
  buildCapturePaymentIntentProjection,
  calculateOrderItemTotals,
  createMenuProductPriceSnapshot,
} from "@super-restaurant/domain";
import { createHash } from "node:crypto";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import {
  materializeCaptureOrder,
  materializeCaptureSelectionOrder,
  parseCaptureRepeatSelectionPlan,
  type CaptureOrderMaterialization,
  type CaptureRepeatSelectionLine,
  type CaptureRepeatSelectionPlan,
} from "./capture-repeat-order-plan.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { MENU_CATALOG_PORT, type MenuCatalogPort } from "./menu-catalog.js";
import { toDomainMenuCatalog } from "./menu-catalog-domain.js";
import {
  decodeCaptureRecord, decodeCaptureWorkspace, decodeCaptureWorkspaceV2, decodeCaptureWorkspaceV3,
  decodeCaptureWorkspaceV4, decodeCaptureWorkspaceV5, withCaptureSelectionProjection,
  withCapturePaymentProjection, type PersistedCaptureRecordV1,
} from "./persistence/capture-persistence-codec.js";
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
  readWorkspaceV4?(actorId: string, request: CaptureWorkspaceRequestV4): Promise<unknown>;
  readWorkspaceV5?(actorId: string, request: CaptureWorkspaceRequestV5): Promise<unknown>;
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
  readSelectionPlan(actorId: string, request: CaptureWorkspaceRequestV3): Promise<unknown>;
  confirmDraft(
    actorId: string,
    command: ConfirmCaptureDraftCommandV2,
    materialization: CaptureOrderMaterialization,
  ): Promise<unknown>;
}
export const CAPTURE_CONFIRMATION_PORT = Symbol("CAPTURE_CONFIRMATION_PORT");
export interface CaptureNoSalePort {
  closeNoSale(actorId: string, command: CloseCaptureNoSaleCommandV1): Promise<unknown>;
}
export const CAPTURE_NO_SALE_PORT = Symbol("CAPTURE_NO_SALE_PORT");
export interface CaptureSelectionPlanPort {
  replaceSelectionPlan(actorId: string, command: ReplaceCaptureSelectionPlanCommandV1): Promise<unknown>;
  probeReplaceSelectionPlan(actorId: string, command: ReplaceCaptureSelectionPlanCommandV1): Promise<unknown>;
}
export const CAPTURE_SELECTION_PLAN_PORT = Symbol("CAPTURE_SELECTION_PLAN_PORT");
export interface CaptureDeliveryQuoteEnvelopeV1 {
  readonly attentionLeaseId: string;
  readonly captureDraftId: string;
  readonly deviceId: string;
  readonly eventId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly schemaVersion: 1;
  readonly scheduledFor: string | null;
  readonly scope: BranchScope;
}
export interface CaptureDeliveryQuotePort {
  setCaptureDeliveryQuote(actorId: string, envelope: CaptureDeliveryQuoteEnvelopeV1, quote: DeliveryQuoteV1): Promise<unknown>;
  probeSetDeliveryQuote(actorId: string, envelope: CaptureDeliveryQuoteEnvelopeV1): Promise<unknown>;
}
export const CAPTURE_DELIVERY_QUOTE_PORT = Symbol("CAPTURE_DELIVERY_QUOTE_PORT");
export interface CapturePaymentIntentPort {
  setCapturePaymentIntent(actorId: string, envelope: Record<string, unknown>, basisFingerprint: string): Promise<unknown>;
  probeSetPaymentIntent(actorId: string, envelope: Record<string, unknown>): Promise<unknown>;
}
export const CAPTURE_PAYMENT_INTENT_PORT = Symbol("CAPTURE_PAYMENT_INTENT_PORT");
/**
 * Deliberately duck-typed against `DeliveryZoneService.quoteForCapture`, never importing that
 * class here: `delivery-zones.ts` already imports `CAPTURE_CREATION_PORT` from this module, so a
 * direct class import in the other direction would create an ESM circular import (the decorator
 * on `CaptureDeliveryQuoteService` would run before `DeliveryZoneService` finished initializing).
 */
export interface CaptureDeliveryQuoteComputationPort {
  quoteForCapture(principal: AuthenticatedPrincipal, input: unknown): Promise<DeliveryQuoteV1>;
}
export const CAPTURE_DELIVERY_QUOTE_COMPUTATION_PORT = Symbol("CAPTURE_DELIVERY_QUOTE_COMPUTATION_PORT");
export interface CaptureTrayPort { list(actorId: string, request: CaptureWorkTrayRequestV1): Promise<unknown>; }
export const CAPTURE_TRAY_PORT = Symbol("CAPTURE_TRAY_PORT");
export interface CaptureAssignmentDirectoryPort {
  listAssignmentCandidates(actorId: string, request: CaptureAssignmentDirectoryRequestV1): Promise<unknown>;
}
export const CAPTURE_ASSIGNMENT_DIRECTORY_PORT = Symbol("CAPTURE_ASSIGNMENT_DIRECTORY_PORT");
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

@Injectable()
export class PostgresCaptureCreator implements CaptureCreationPort, CaptureAttentionPort, CaptureCustomerPort, CaptureFulfillmentPort, CaptureDeliveryInstructionsPort, CaptureConfirmationPort, CaptureTrayPort, CaptureAssignmentDirectoryPort, CaptureSelectionPlanPort, CaptureNoSalePort, CaptureDeliveryQuotePort, CapturePaymentIntentPort {
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

  public async readWorkspaceV4(actorId: string, input: CaptureWorkspaceRequestV4): Promise<unknown> {
    const request = parseCaptureWorkspaceRequestV4(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.read_capture_workspace_v4($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async readWorkspaceV5(actorId: string, input: CaptureWorkspaceRequestV5): Promise<unknown> {
    const request = parseCaptureWorkspaceRequestV5(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.read_capture_workspace_v5($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(request)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async setCaptureDeliveryQuote(
    actorId: string,
    envelope: CaptureDeliveryQuoteEnvelopeV1,
    quote: DeliveryQuoteV1,
  ): Promise<unknown> {
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.set_capture_delivery_quote($1::uuid, $2::jsonb, $3::jsonb) as result",
      [actorId, JSON.stringify(envelope), JSON.stringify(quote)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async probeSetDeliveryQuote(actorId: string, envelope: CaptureDeliveryQuoteEnvelopeV1): Promise<unknown> {
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.probe_capture_delivery_quote_set($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(envelope)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async setCapturePaymentIntent(
    actorId: string,
    envelope: Record<string, unknown>,
    basisFingerprint: string,
  ): Promise<unknown> {
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.set_capture_payment_intent($1::uuid, $2::jsonb, $3::text) as result",
      [actorId, JSON.stringify(envelope), basisFingerprint],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async probeSetPaymentIntent(actorId: string, envelope: Record<string, unknown>): Promise<unknown> {
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.probe_capture_payment_intent_set($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(envelope)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async replaceSelectionPlan(actorId: string, input: ReplaceCaptureSelectionPlanCommandV1): Promise<unknown> {
    const command = parseReplaceCaptureSelectionPlanCommandV1(input);
    if (!canonicalUuid.test(actorId) || command === undefined) throw new CaptureApplicationError("request");
    const { plan, ...envelope } = command;
    const response = await this.database.query(
      "select app_private.replace_capture_selection_plan($1::uuid, $2::jsonb, $3::jsonb) as result",
      [actorId, JSON.stringify(envelope), JSON.stringify(plan)],
    );
    if (response.rows.length !== 1) throw unavailable();
    const row = exactRecord(response.rows[0], ["result"]);
    if (row === undefined) throw unavailable();
    return row.result;
  }

  public async probeReplaceSelectionPlan(actorId: string, input: ReplaceCaptureSelectionPlanCommandV1): Promise<unknown> {
    const command = parseReplaceCaptureSelectionPlanCommandV1(input);
    if (!canonicalUuid.test(actorId) || command === undefined) throw new CaptureApplicationError("request");
    const { plan, ...envelope } = command;
    const response = await this.database.query(
      "select app_private.probe_capture_selection_plan_replace($1::uuid, $2::jsonb, $3::jsonb) as result",
      [actorId, JSON.stringify(envelope), JSON.stringify(plan)],
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

  public async closeNoSale(actorId: string, input: CloseCaptureNoSaleCommandV1): Promise<unknown> {
    const command = parseNoSaleCommand(input);
    if (!canonicalUuid.test(actorId)) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.close_capture_no_sale($1::uuid, $2::jsonb) as result",
      [actorId, JSON.stringify(command)],
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

  public async readSelectionPlan(actorId: string, input: CaptureWorkspaceRequestV3): Promise<unknown> {
    const request = parseCaptureWorkspaceRequestV3(input);
    if (!canonicalUuid.test(actorId) || request === undefined) throw new CaptureApplicationError("request");
    const response = await this.database.query(
      "select app_private.read_capture_selection_plan($1::uuid, $2::jsonb) as result",
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

    if (this.captures.readWorkspaceV4 === undefined) throw unavailable();
    const workspaceRequest = {
      schemaVersion: 3 as const, scope: command.scope, captureDraftId: command.captureDraftId,
    };
    const workspaceRequestV4 = { schemaVersion: 4 as const, scope: command.scope, captureDraftId: command.captureDraftId };
    let rawWorkspace: unknown;
    try {
      rawWorkspace = await this.captures.readWorkspaceV4(actorId, workspaceRequestV4);
    } catch { throw unavailable(); }
    const statusOnly = exactRecord(rawWorkspace, ["status"]);
    if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
    if (statusOnly?.status === "missing") throw new CaptureApplicationError("missing");
    if (statusOnly !== undefined) throw unavailable();
    let workspace: CaptureWorkspaceV4;
    try { workspace = decodeCaptureWorkspaceV4(rawWorkspace, command.scope); } catch { throw unavailable(); }
    const detail = workspace.detail;
    if (detail.captureDraftId !== command.captureDraftId || detail.version !== command.expectedVersion
      || detail.status !== "draft" || detail.attentionStatus !== "claimed"
      || detail.attentionLeaseId !== command.attentionLeaseId || detail.fulfillmentChannel === null
      || (detail.fulfillmentChannel === "dine_in") !== (command.tableId !== null)
      || (detail.fulfillmentChannel === "delivery" && (workspace.customerSnapshot === null
        || workspace.fulfillmentSnapshot === null))) throw new CaptureApplicationError("conflict");

    // SQL already refuses (CAS on applied_capture_version) a stale intent at the moment of
    // confirmation; this is the same guard given a clear, typed message before ever calling it.
    const v5 = await readCaptureWorkspaceV5WithProjections(
      actorId, command.scope, command.captureDraftId, this.captures, this.persistence, this.catalogs,
    ).catch(() => null);
    if (v5 !== null && v5.paymentIntent !== null
      && (v5.paymentProjection?.status === "stale" || v5.paymentProjection?.status === "insufficient")) {
      throw new CapturePaymentIntentStaleError();
    }

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
    let selectionPlan: CaptureSelectionPlanV1 | null = null;
    if (workspace.selectionPlan !== null) {
      try {
        const authorized = await this.authorization.authorizeBranch(principal, command.scope, "catalog.read");
        if (authorized.principal.actorId !== actorId) throw new Error("actor mismatch");
      } catch { throw new CaptureApplicationError("authorization"); }
      let rawSelectionPlan: unknown;
      try { rawSelectionPlan = await this.persistence.readSelectionPlan(actorId, workspaceRequest); } catch { throw unavailable(); }
      const planEnvelope = exactRecord(rawSelectionPlan, ["status", "plan", "appliedCaptureVersion"]);
      if (planEnvelope?.status !== "ok") {
        const planStatus = exactRecord(rawSelectionPlan, ["status"]);
        if (planStatus?.status === "denied") throw new CaptureApplicationError("authorization");
        if (planStatus?.status === "missing") throw new CaptureApplicationError("conflict");
        throw unavailable();
      }
      selectionPlan = parseCaptureSelectionPlanV1(planEnvelope.plan) ?? null;
      if (selectionPlan === null || selectionPlan.catalogVersion !== workspace.selectionPlan.catalogVersion
        || selectionPlan.lines.length !== workspace.selectionPlan.lineCount) throw unavailable();
      let catalogState;
      try { catalogState = await this.catalogs.read(actorId, command.scope); } catch { throw unavailable(); }
      if (catalogState === "forbidden") throw new CaptureApplicationError("authorization");
      if (catalogState.catalog === null || catalogState.scope.restaurantId !== command.scope.restaurantId
        || catalogState.scope.branchId !== command.scope.branchId) throw new CaptureApplicationError("conflict");
      catalog = catalogState.catalog;
    }
    let materialization: CaptureOrderMaterialization;
    try {
      materialization = selectionPlan !== null
        ? materializeCaptureSelectionOrder(command, actorId, channel, selectionPlan, catalog)
        : materializeCaptureOrder(command, actorId, channel, plan, catalog);
    } catch { throw new CaptureApplicationError((plan === null && selectionPlan === null) ? "request" : "conflict"); }
    let raw: unknown;
    try { raw = await this.persistence.confirmDraft(actorId, command, materialization); } catch { throw unavailable(); }
    return confirmationResult(raw, command);
  }
}

@Injectable()
export class CaptureSelectionPlanService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_SELECTION_PLAN_PORT) private readonly persistence: CaptureSelectionPlanPort,
    @Inject(CAPTURE_CREATION_PORT) private readonly captures: CaptureCreationPort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
    @Inject(CAPTURE_CONFIRMATION_PORT) private readonly confirmation: CaptureConfirmationPort,
  ) {}

  public async replace(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureWorkspaceV5> {
    const command = parseReplaceCaptureSelectionPlanCommandV1(input);
    if (command === undefined) throw new CaptureApplicationError("request");
    let actorId: string;
    try {
      const captureAuthorization = await this.authorization.authorizeBranch(principal, command.scope, "captures.update");
      const catalogAuthorization = await this.authorization.authorizeBranch(principal, command.scope, "catalog.read");
      if (captureAuthorization.principal.actorId !== catalogAuthorization.principal.actorId) throw new Error("actor mismatch");
      actorId = captureAuthorization.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }

    // Idempotency is decided purely by actor+scope+idempotencyKey+fingerprint, entirely
    // independent of catalog/pricing state. Probing it first -- before any catalog read or
    // pricing attempt -- means a catalog change (or a later, different write) since the
    // original apply can never turn a legitimate replay into a spurious rejection, and the
    // replayed response is never derived from comparing against this echoed command.
    let rawProbe: unknown;
    try { rawProbe = await this.persistence.probeReplaceSelectionPlan(actorId, command); } catch { throw unavailable(); }
    const probe = exactRecord(rawProbe, ["status", "record"]);
    if (probe?.status === "replayed") return this.replayedWorkspace(actorId, command);
    const probeStatus = exactRecord(rawProbe, ["status"]);
    if (probeStatus?.status === "denied") throw new CaptureApplicationError("authorization");
    if (probeStatus?.status === "conflict") throw new CaptureApplicationError("conflict");
    if (probeStatus?.status === "rejected") throw new CaptureApplicationError("request");
    if (probeStatus?.status !== "pending") throw unavailable();

    let catalogState;
    try { catalogState = await this.catalogs.read(actorId, command.scope); } catch { throw unavailable(); }
    if (catalogState === "forbidden") throw new CaptureApplicationError("authorization");
    if (catalogState.catalog === null || catalogState.scope.restaurantId !== command.scope.restaurantId
      || catalogState.scope.branchId !== command.scope.branchId) throw new CaptureApplicationError("conflict");
    const catalog = catalogState.catalog;
    if (catalog.catalogVersion !== command.plan.catalogVersion) throw new CaptureApplicationError("conflict");

    // Validate and price every line against the live, published catalog before persisting anything: an
    // inactive product/option or a group outside its configured limits fails closed with 409, never a
    // silent reprice or a partially-applied plan. This result is validation-only: the response's
    // `selectionProjection` is always re-derived below from whatever the write actually produced,
    // never reused from here, since another write can race in between the persist and the re-read.
    if (command.plan.lines.length > 0) priceSelectionPlan(command.plan, catalog, command.scope.restaurantId);

    let raw: unknown;
    try { raw = await this.persistence.replaceSelectionPlan(actorId, command); } catch { throw unavailable(); }
    const envelope = exactRecord(raw, ["status", "record"]);
    // A genuine race between the probe and the write (another replica applied it in between)
    // still resolves correctly: fall back to the same replay path rather than mistrusting it.
    if (envelope?.status === "replayed") return this.replayedWorkspace(actorId, command);
    if (envelope?.status !== "applied") {
      const statusOnly = exactRecord(raw, ["status"]);
      if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
      if (statusOnly?.status === "conflict") throw new CaptureApplicationError("conflict");
      if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
      throw unavailable();
    }

    // The write's own result is the ground truth for the version it produced; the record was
    // written inside the same transaction that bumped the draft, so its version is exact.
    let appliedRecord: PersistedCaptureRecordV1;
    try { appliedRecord = decodeCaptureRecord(envelope.record, command.scope); } catch { throw unavailable(); }
    if (appliedRecord.detail.captureDraftId !== command.captureDraftId
      || appliedRecord.detail.version !== command.expectedVersion + 1) throw unavailable();

    if (this.captures.readWorkspaceV5 === undefined) throw unavailable();
    const workspaceRequest = { schemaVersion: 5 as const, scope: command.scope, captureDraftId: command.captureDraftId };
    let rawWorkspace: unknown;
    try { rawWorkspace = await this.captures.readWorkspaceV5(actorId, workspaceRequest); } catch { throw unavailable(); }
    const statusOnly = exactRecord(rawWorkspace, ["status"]);
    if (statusOnly !== undefined) throw unavailable();
    let decoded;
    try { decoded = decodeCaptureWorkspaceV5(rawWorkspace, command.scope); } catch { throw unavailable(); }
    const workspace = decoded.workspace;
    // This write's own result already proved the draft reached expectedVersion+1. The separate
    // read that follows it is a different round trip: another connection may have advanced the
    // draft further in between (an unrelated mutation, or another selection-plan write), so the
    // read is only required to reflect a version at least that fresh, never exactly that one.
    // The stored plan itself is never compared against command.plan either, for the same reason:
    // if another selection-plan write raced in and won, the response projects THAT plan, not a
    // stale echo of this one -- see projectStoredSelectionPlan.
    if (workspace.detail.captureDraftId !== command.captureDraftId
      || workspace.detail.version < appliedRecord.detail.version) throw unavailable();
    const selectionProjection = await projectStoredSelectionPlan(
      actorId, command.scope, command.captureDraftId, workspace.selectionPlan, this.confirmation, this.catalogs,
    );
    const withSelection: CaptureWorkspaceV5 = Object.freeze({ ...workspace, selectionProjection });
    const paymentProjection = await buildCapturePaymentProjectionForWorkspace(
      actorId, command.scope, command.captureDraftId, withSelection, decoded.paymentIntentBasisFingerprint,
      this.confirmation, this.catalogs,
    );
    return withCapturePaymentProjection(withSelection, paymentProjection);
  }

  /**
   * The replayed response for `replace`: the current workspace with a best-effort projection of
   * whatever is actually stored, never the replayed command and never validated against the live
   * catalog as a precondition -- a catalog change, or an unrelated mutation that advanced the
   * draft, must never turn an already-applied replay into 409/503. If pricing the stored plan
   * fails for any reason, `selectionProjection` is simply `null`, matching the same fallback
   * `CaptureService.readWorkspaceV4` already uses for a stale catalog on a plain read. Always
   * `CaptureWorkspaceV5` (with `paymentProjection` recomputed against whatever is stored), matching
   * every other capture mutation's response shape, so a stale payment intent is surfaced here too.
   */
  private async replayedWorkspace(
    actorId: string,
    command: ReplaceCaptureSelectionPlanCommandV1,
  ): Promise<CaptureWorkspaceV5> {
    return readCaptureWorkspaceV5WithProjections(
      actorId, command.scope, command.captureDraftId, this.captures, this.confirmation, this.catalogs,
    );
  }
}

/**
 * The one place `selectionProjection` is computed for ANY response (a fresh apply, a replay, or
 * a plain workspace read): always from the plan actually stored and read alongside this exact
 * workspace, never from a client-supplied command -- if a different write raced in between,
 * this projects THAT one, never a stale echo. Fully best-effort: any failure (no stored plan, an
 * inactive product, or the published catalog having moved to a different catalogVersion since
 * the plan was stored) yields `null`, never a rejection of the read/write it is attached to.
 */
async function projectStoredSelectionPlan(
  actorId: string,
  scope: BranchScope,
  captureDraftId: string,
  selectionPlan: CaptureWorkspaceV4["selectionPlan"],
  confirmation: CaptureConfirmationPort,
  catalogs: MenuCatalogPort,
): Promise<CaptureSelectionPlanProjectionV1 | null> {
  if (selectionPlan === null) return null;
  try {
    const rawStoredPlan = await confirmation.readSelectionPlan(actorId, { schemaVersion: 3, scope, captureDraftId });
    const storedPlanEnvelope = exactRecord(rawStoredPlan, ["status", "plan", "appliedCaptureVersion"]);
    if (storedPlanEnvelope?.status !== "ok") return null;
    // catalogVersion and lineCount matching the workspace summary is not enough on its own: a
    // second write can replace the plan with another one that happens to share both, in the gap
    // between readWorkspaceV4 and this read. appliedCaptureVersion is bumped by every write
    // (repeat or selection), so an exact match here proves it is the SAME row the summary read.
    if (typeof storedPlanEnvelope.appliedCaptureVersion !== "number"
      || !Number.isInteger(storedPlanEnvelope.appliedCaptureVersion)
      || storedPlanEnvelope.appliedCaptureVersion !== selectionPlan.appliedCaptureVersion) return null;
    const storedPlan = parseCaptureSelectionPlanV1(storedPlanEnvelope.plan);
    if (storedPlan === undefined || storedPlan.lines.length === 0
      || storedPlan.catalogVersion !== selectionPlan.catalogVersion
      || storedPlan.lines.length !== selectionPlan.lineCount) return null;
    const catalogState = await catalogs.read(actorId, scope);
    // The catalogVersion must match the STORED plan's exactly: pricing the same product ids
    // against a different, later-published catalog can silently return the wrong prices, not
    // merely a stale-but-consistent one.
    if (catalogState === "forbidden" || catalogState.catalog === null
      || catalogState.scope.restaurantId !== scope.restaurantId || catalogState.scope.branchId !== scope.branchId
      || catalogState.catalog.catalogVersion !== storedPlan.catalogVersion) return null;
    return priceSelectionPlan(storedPlan, catalogState.catalog, scope.restaurantId);
  } catch { return null; }
}

/** Prices every line of a validated selection plan against the live catalog; throws a typed 409 on any mismatch. */
function priceSelectionPlan(
  plan: CaptureSelectionPlanV1,
  catalog: MenuCatalogV1,
  restaurantId: string,
): CaptureSelectionPlanProjectionV1 {
  if (plan.lines.some((line) => line.variantId !== null)) throw new CaptureApplicationError("conflict");
  const domainCatalog = toDomainMenuCatalog(catalog, restaurantId);
  let subtotalMinor = 0;
  let itemsTotalMinor = 0;
  const lines: CaptureSelectionPlanProjectionLineV1[] = [];
  for (const line of plan.lines) {
    let snapshot;
    try {
      snapshot = createMenuProductPriceSnapshot(domainCatalog, {
        currency: catalog.currency, productId: line.productId, restaurantId,
      }, line.modifierGroups);
    } catch { throw new CaptureApplicationError("conflict"); }
    const totals = calculateOrderItemTotals({
      orderItemId: line.lineId, quantity: line.quantity, snapshot, note: line.note,
    });
    subtotalMinor += totals.subtotalBeforeTax.amountMinor;
    // Tax-inclusive: the exact amount the confirmed Order charges for this line, unlike
    // subtotalBeforeTax above (kept only for the existing read-side contract).
    itemsTotalMinor += totals.total.amountMinor;
    const modifiers: CaptureSelectionPlanProjectionModifierV1[] = [];
    for (const modifier of snapshot.modifiers) {
      if (modifier.groupId === undefined) throw unavailable();
      modifiers.push({
        groupId: modifier.groupId,
        name: modifier.name,
        optionId: modifier.modifierId,
        quantity: modifier.quantity,
        unitPriceMinor: modifier.unitPrice.amountMinor,
      });
    }
    lines.push({
      lineId: line.lineId,
      lineTotalMinor: totals.subtotalBeforeTax.amountMinor,
      modifiers,
      note: line.note,
      productId: line.productId,
      productName: snapshot.name,
      quantity: line.quantity,
      unitPriceMinor: snapshot.unitPrice.amountMinor,
      variantId: line.variantId,
    });
  }
  const projection = parseCaptureSelectionPlanProjectionV1({
    catalogVersion: plan.catalogVersion,
    currency: catalog.currency,
    itemsTotalMinor,
    lineCount: lines.length,
    lines,
    schemaVersion: 1,
    subtotalMinor,
  });
  if (projection === undefined) throw unavailable();
  return projection;
}

/**
 * Tax-inclusive total of a repeat-order plan's lines, priced against the live catalog exactly
 * like `materializeCaptureOrder` prices them at confirm time (same `createMenuProductPriceSnapshot`
 * + `calculateOrderItemTotals` pair) -- the only reliable payment-intent basis for a capture whose
 * lines come from a repeat plan rather than a selection plan (whose `selectionProjection` is
 * always `null` for a repeat-order capture).
 */
function priceCaptureRepeatSelectionPlan(
  plan: CaptureRepeatSelectionPlan,
  catalog: MenuCatalogV1,
  restaurantId: string,
): number {
  const domainCatalog = toDomainMenuCatalog(catalog, restaurantId);
  let itemsTotalMinor = 0;
  for (const line of plan.lines) {
    const snapshot = createMenuProductPriceSnapshot(domainCatalog, {
      currency: catalog.currency, productId: line.productId, restaurantId,
    }, line.modifierGroups);
    const totals = calculateOrderItemTotals({
      orderItemId: line.sourceOrderItemId, quantity: line.quantity, snapshot, note: null,
    });
    itemsTotalMinor += totals.total.amountMinor;
  }
  return itemsTotalMinor;
}

/** Best-effort raw stored plan (no prices), for the payment-intent basis fingerprint only. */
async function readStoredCaptureSelectionPlanLines(
  actorId: string,
  scope: BranchScope,
  captureDraftId: string,
  confirmation: CaptureConfirmationPort,
): Promise<CaptureSelectionPlanV1 | null> {
  try {
    const raw = await confirmation.readSelectionPlan(actorId, { schemaVersion: 3, scope, captureDraftId });
    const envelope = exactRecord(raw, ["status", "plan", "appliedCaptureVersion"]);
    if (envelope?.status !== "ok") return null;
    return parseCaptureSelectionPlanV1(envelope.plan) ?? null;
  } catch { return null; }
}

/**
 * The payment-intent basis when the capture's lines come from a repeat-order plan rather than a
 * selection plan: reads the raw stored plan, revalidates it against the workspace summary exactly
 * like `readRepeatOrderPlan` does at confirm time (customerId/sourceOrderId/catalogVersion/
 * lineCount), then prices it against the live catalog. `null` (never a throw) for any mismatch or
 * pricing failure, matching `projectStoredSelectionPlan`'s best-effort philosophy for reads; the
 * write path (`CapturePaymentIntentService.setPaymentIntent`) treats a `null` result as a conflict.
 */
async function readStoredCaptureRepeatOrderPlanBasis(
  actorId: string,
  scope: BranchScope,
  captureDraftId: string,
  repeatOrderPlan: CaptureWorkspaceV5["repeatOrderPlan"],
  confirmation: CaptureConfirmationPort,
  catalogs: MenuCatalogPort,
): Promise<{
  readonly currency: string; readonly itemsTotalMinor: number; readonly lines: readonly CaptureRepeatSelectionLine[];
} | null> {
  if (repeatOrderPlan === null) return null;
  try {
    const raw = await confirmation.readRepeatOrderPlan(actorId, { schemaVersion: 3, scope, captureDraftId });
    const envelope = exactRecord(raw, ["status", "plan"]);
    if (envelope?.status !== "ok") return null;
    const plan = parseCaptureRepeatSelectionPlan(envelope.plan);
    if (plan === undefined || plan.customerId !== repeatOrderPlan.customerId
      || plan.sourceOrderId !== repeatOrderPlan.sourceOrderId
      || plan.catalogVersion !== repeatOrderPlan.catalogVersion
      || plan.lines.length !== repeatOrderPlan.lineCount || plan.lines.length === 0) return null;
    const catalogState = await catalogs.read(actorId, scope);
    if (catalogState === "forbidden" || catalogState.catalog === null
      || catalogState.scope.restaurantId !== scope.restaurantId || catalogState.scope.branchId !== scope.branchId
      || catalogState.catalog.catalogVersion !== plan.catalogVersion) {
      return null;
    }
    const itemsTotalMinor = priceCaptureRepeatSelectionPlan(plan, catalogState.catalog, scope.restaurantId);
    return { currency: catalogState.catalog.currency, itemsTotalMinor, lines: plan.lines };
  } catch { return null; }
}

/**
 * Canonical, order-independent fingerprint of every fact the authoritative total is derived
 * from: catalogVersion, the priced lines (id-sorted, never the client's submission order) and
 * the frozen delivery fee/currency. Any change to any of them changes the fingerprint; comparing
 * it against a payment intent's stored basis is how staleness is detected, both at read time and
 * before confirm.
 */
/** A selection line and a repeat-order line, normalized to the one shape the fingerprint needs. */
interface CapturePaymentIntentBasisLine {
  readonly id: string;
  readonly modifierGroups: readonly Readonly<{
    groupId: string;
    selections: readonly Readonly<{ optionId: string; quantity: number }>[];
  }>[];
  readonly note: string | null;
  readonly productId: string;
  readonly quantity: number;
}

function selectionLinesToBasis(lines: readonly CaptureSelectionLineV1[]): CapturePaymentIntentBasisLine[] {
  return lines.map((line) => ({
    id: line.lineId, modifierGroups: line.modifierGroups, note: line.note, productId: line.productId,
    quantity: line.quantity,
  }));
}

function repeatLinesToBasis(lines: readonly CaptureRepeatSelectionLine[]): CapturePaymentIntentBasisLine[] {
  // A repeated order never carries forward a prior line's kitchen note (materializeCaptureOrder).
  return lines.map((line) => ({
    id: line.sourceOrderItemId, modifierGroups: line.modifierGroups, note: null, productId: line.productId,
    quantity: line.quantity,
  }));
}

function computeCapturePaymentIntentBasisFingerprint(input: {
  readonly catalogVersion: string;
  readonly currency: string;
  readonly deliveryFeeMinor: number;
  readonly lines: readonly CapturePaymentIntentBasisLine[];
  /**
   * The frozen delivery quote's own identity (`null` outside delivery, or before one is frozen).
   * `deliveryFeeMinor` alone is not enough: a re-quote for the same address/zone can land on an
   * identical fee while `set_capture_delivery_quote`'s own CAS on `applied_capture_version`
   * already treats it as a distinct quote -- without quoteId in the basis, a read here would
   * report "ready" for a fee that SQL's own version check would reject as stale at confirm time.
   */
  readonly quoteId: string | null;
}): string {
  const canonicalLines = [...input.lines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((line) => ({
      id: line.id,
      modifierGroups: [...line.modifierGroups]
        .sort((a, b) => (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0))
        .map((group) => ({
          groupId: group.groupId,
          selections: [...group.selections]
            .sort((a, b) => (a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0))
            .map((selection) => ({ optionId: selection.optionId, quantity: selection.quantity })),
        })),
      note: line.note,
      productId: line.productId,
      quantity: line.quantity,
    }));
  const canonical = JSON.stringify({
    catalogVersion: input.catalogVersion,
    currency: input.currency,
    deliveryFeeMinor: input.deliveryFeeMinor,
    lines: canonicalLines,
    quoteId: input.quoteId,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The one place `paymentProjection` is computed for ANY V5 response (a fresh apply of the
 * delivery quote or the payment intent, or a plain workspace read): always from the intent, the
 * priced selection projection and the frozen delivery quote actually stored and read alongside
 * this exact workspace. `null` when there is no payment intent at all, or best-effort `null` if
 * the fulfillment channel is not yet chosen (timing cannot be derived) or the currency cannot be
 * established -- mirroring `projectStoredSelectionPlan`'s best-effort philosophy.
 */
async function buildCapturePaymentProjectionForWorkspace(
  actorId: string,
  scope: BranchScope,
  captureDraftId: string,
  workspace: CaptureWorkspaceV5,
  paymentIntentBasisFingerprint: string | null,
  confirmation: CaptureConfirmationPort,
  catalogs: MenuCatalogPort,
): Promise<CapturePaymentIntentProjectionV1 | null> {
  if (workspace.paymentIntent === null) return null;
  const fulfillmentChannel = workspace.detail.fulfillmentChannel;
  if (fulfillmentChannel === null) return null;

  // Tax-inclusive, and derived from whichever plan actually carries the capture's lines: a
  // selection plan's own priced projection, or a freshly priced repeat-order plan (whose
  // `selectionProjection` is always null, and whose currency the delivery quote may not supply
  // either -- a repeat-order capture is not necessarily delivery). Neither present means no lines
  // at all: `0`/`null`, matching the historical read-side fallback (the write path in
  // setPaymentIntent refuses this case instead).
  //
  // H8: a selection plan that exists but currently cannot be priced (selectionProjection null --
  // an inactive product, or the catalog having moved to a different catalogVersion) must never
  // silently read as `itemsSubtotalMinor: 0`: the basis fingerprint alone might still match (the
  // stored plan's identity/catalogVersion is unaffected by a pricing failure), so this can NOT be
  // relied on to force "stale" the way an actual line change is. Track it explicitly and force
  // "stale" below, mirroring the write-side guard in `CapturePaymentIntentService.setPaymentIntent`
  // (`CapturePaymentIntentUnpricedError`) -- confirm's own re-check of `paymentProjection.status`
  // then refuses it too, exactly as it already refuses any other stale intent.
  const selectionUnpriced = workspace.selectionPlan !== null && workspace.selectionProjection === null;
  let itemsSubtotalMinor = workspace.selectionProjection?.itemsTotalMinor ?? 0;
  let basisCatalogVersion = "";
  let basisLines: CapturePaymentIntentBasisLine[] = [];
  let repeatCurrency: string | undefined;
  if (workspace.selectionPlan !== null) {
    const storedPlan = await readStoredCaptureSelectionPlanLines(actorId, scope, captureDraftId, confirmation);
    basisCatalogVersion = storedPlan?.catalogVersion ?? "";
    basisLines = selectionLinesToBasis(storedPlan?.lines ?? []);
  } else if (workspace.repeatOrderPlan !== null) {
    const repeatBasis = await readStoredCaptureRepeatOrderPlanBasis(
      actorId, scope, captureDraftId, workspace.repeatOrderPlan, confirmation, catalogs,
    );
    itemsSubtotalMinor = repeatBasis?.itemsTotalMinor ?? 0;
    repeatCurrency = repeatBasis?.currency;
    basisCatalogVersion = repeatBasis === null ? "" : workspace.repeatOrderPlan.catalogVersion;
    basisLines = repeatLinesToBasis(repeatBasis?.lines ?? []);
  }
  const currency = workspace.selectionProjection?.currency ?? repeatCurrency ?? workspace.deliveryQuote?.currency;
  if (currency === undefined) return null;
  const deliveryFeeMinor = fulfillmentChannel === "delivery" ? (workspace.deliveryQuote?.feeMinor ?? 0) : 0;
  const quoteId = fulfillmentChannel === "delivery" ? (workspace.deliveryQuote?.quoteId ?? null) : null;

  let domainProjection;
  try {
    domainProjection = buildCapturePaymentIntentProjection({
      currency,
      deliveryFeeMinor,
      fulfillmentChannel,
      itemsSubtotalMinor,
      method: workspace.paymentIntent.method,
      tenderedAmountMinor: workspace.paymentIntent.tenderedAmountMinor,
      tipMinor: workspace.paymentIntent.tipMinor,
    });
  } catch { return null; }

  const currentFingerprint = computeCapturePaymentIntentBasisFingerprint({
    catalogVersion: basisCatalogVersion,
    currency,
    deliveryFeeMinor,
    lines: basisLines,
    quoteId,
  });
  const status = selectionUnpriced || paymentIntentBasisFingerprint !== currentFingerprint
    ? "stale" : domainProjection.status;
  const changeDueMinor = status === "ready" ? (domainProjection.changeDueMinor?.amountMinor ?? null) : null;

  return parseCapturePaymentIntentProjectionV1({
    changeDueMinor,
    currency,
    deliveryFeeMinor,
    itemsSubtotalMinor,
    method: workspace.paymentIntent.method,
    orderTotalMinor: domainProjection.orderTotalMinor,
    status,
    tenderedAmountMinor: workspace.paymentIntent.tenderedAmountMinor,
    timing: domainProjection.timing,
    tipMinor: workspace.paymentIntent.tipMinor,
  }) ?? null;
}

/**
 * The one place `CaptureWorkspaceV5` is fully assembled for ANY response (a fresh apply of the
 * delivery quote or payment intent, a replay, or a plain workspace read): reads the raw V5 row,
 * then computes both `selectionProjection` (exactly like V4) and `paymentProjection` from
 * whatever is actually stored, never from a client-supplied command.
 */
async function readCaptureWorkspaceV5WithProjections(
  actorId: string,
  scope: BranchScope,
  captureDraftId: string,
  captures: CaptureCreationPort,
  confirmation: CaptureConfirmationPort,
  catalogs: MenuCatalogPort,
): Promise<CaptureWorkspaceV5> {
  if (captures.readWorkspaceV5 === undefined) throw unavailable();
  const workspaceRequest = { schemaVersion: 5 as const, scope, captureDraftId };
  let rawWorkspace: unknown;
  try { rawWorkspace = await captures.readWorkspaceV5(actorId, workspaceRequest); } catch { throw unavailable(); }
  const statusOnly = exactRecord(rawWorkspace, ["status"]);
  if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
  if (statusOnly?.status === "missing") throw new CaptureApplicationError("missing");
  if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
  if (statusOnly !== undefined) throw unavailable();
  let decoded;
  try { decoded = decodeCaptureWorkspaceV5(rawWorkspace, scope); } catch { throw unavailable(); }
  if (decoded.workspace.detail.captureDraftId !== captureDraftId) throw unavailable();

  const selectionProjection = await projectStoredSelectionPlan(
    actorId, scope, captureDraftId, decoded.workspace.selectionPlan, confirmation, catalogs,
  );
  const withSelection: CaptureWorkspaceV5 = Object.freeze({ ...decoded.workspace, selectionProjection });
  const paymentProjection = await buildCapturePaymentProjectionForWorkspace(
    actorId, scope, captureDraftId, withSelection, decoded.paymentIntentBasisFingerprint, confirmation, catalogs,
  );
  return withCapturePaymentProjection(withSelection, paymentProjection);
}

@Injectable()
export class CaptureDeliveryQuoteService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_DELIVERY_QUOTE_PORT) private readonly persistence: CaptureDeliveryQuotePort,
    @Inject(CAPTURE_CREATION_PORT) private readonly captures: CaptureCreationPort,
    @Inject(CAPTURE_CONFIRMATION_PORT) private readonly confirmation: CaptureConfirmationPort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
    @Inject(CAPTURE_DELIVERY_QUOTE_COMPUTATION_PORT) private readonly deliveryZones: CaptureDeliveryQuoteComputationPort,
  ) {}

  public async requestQuote(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureWorkspaceV5> {
    const command = parseRequestCaptureDeliveryQuoteCommandV1(input);
    if (command === undefined) throw new CaptureApplicationError("request");
    let actorId: string;
    try { actorId = (await this.authorization.authorizeBranch(principal, command.scope, "captures.update")).principal.actorId; }
    catch { throw new CaptureApplicationError("authorization"); }

    const envelope: CaptureDeliveryQuoteEnvelopeV1 = {
      attentionLeaseId: command.attentionLeaseId,
      captureDraftId: command.captureDraftId,
      deviceId: command.deviceId,
      eventId: command.eventId,
      expectedVersion: command.expectedVersion,
      idempotencyKey: command.idempotencyKey,
      occurredAt: command.occurredAt,
      schemaVersion: 1,
      scheduledFor: command.scheduledFor,
      scope: command.scope,
    };

    // Idempotency is decided purely by actor+scope+idempotencyKey+fingerprint over the command,
    // entirely independent of the (server-recomputed, always-fresh) quote jsonb. Probing it first
    // -- before ever calling zones.quoteForCapture -- means a retry with the same idempotencyKey
    // after a lost response is recognized as the original apply, never recomputes a new
    // quotedAt/quoteId, and is never turned into a spurious conflict by that recomputation.
    let rawProbe: unknown;
    try { rawProbe = await this.persistence.probeSetDeliveryQuote(actorId, envelope); } catch { throw unavailable(); }
    const probe = exactRecord(rawProbe, ["status", "record"]);
    if (probe?.status === "replayed") {
      return readCaptureWorkspaceV5WithProjections(
        actorId, command.scope, command.captureDraftId, this.captures, this.confirmation, this.catalogs,
      );
    }
    const probeStatus = exactRecord(rawProbe, ["status"]);
    if (probeStatus?.status === "denied") throw new CaptureApplicationError("authorization");
    if (probeStatus?.status === "conflict") throw new CaptureApplicationError("conflict");
    if (probeStatus?.status === "rejected") throw new CaptureApplicationError("request");
    if (probeStatus?.status !== "pending") throw unavailable();

    // Recomputed from the live address/zones every time, exactly like a plain
    // `/delivery-zones/quote` call; never trusted from the client.
    let quote: DeliveryQuoteV1;
    try {
      quote = await this.deliveryZones.quoteForCapture(principal, {
        schemaVersion: 1, scope: command.scope, captureDraftId: command.captureDraftId, scheduledFor: command.scheduledFor,
      });
    } catch (error: unknown) {
      throw mapDeliveryZoneError(error);
    }

    let raw: unknown;
    try { raw = await this.persistence.setCaptureDeliveryQuote(actorId, envelope, quote); } catch { throw unavailable(); }
    const envelopeResult = exactRecord(raw, ["status", "record"]);
    if (envelopeResult?.status !== "applied" && envelopeResult?.status !== "replayed") {
      const statusOnly = exactRecord(raw, ["status"]);
      if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
      if (statusOnly?.status === "conflict") throw new CaptureApplicationError("conflict");
      if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
      throw unavailable();
    }
    return readCaptureWorkspaceV5WithProjections(
      actorId, command.scope, command.captureDraftId, this.captures, this.confirmation, this.catalogs,
    );
  }
}

function mapDeliveryZoneError(error: unknown): CaptureApplicationError {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
  if (code === "authorization") return new CaptureApplicationError("authorization");
  if (code === "conflict") return new CaptureApplicationError("conflict");
  if (code === "request") return new CaptureApplicationError("request");
  if (code === "missing") return new CaptureApplicationError("missing");
  return unavailable();
}

/** Typed 409: a stated cash tender does not cover the authoritative total. Never a generic conflict. */
export class CapturePaymentIntentInsufficientError extends Error {
  public constructor() {
    super("CAPTURE_PAYMENT_INTENT_INSUFFICIENT");
    this.name = "CapturePaymentIntentInsufficientError";
  }
}

/** Typed 409: an existing payment intent is stale (lines/fulfillment/quote moved) or insufficient. */
export class CapturePaymentIntentStaleError extends Error {
  public constructor() {
    super("CAPTURE_PAYMENT_INTENT_STALE");
    this.name = "CapturePaymentIntentStaleError";
  }
}

/** Typed 409: setting a payment intent against a capture with no selection or repeat plan at all. */
export class CapturePaymentIntentNoLinesError extends Error {
  public constructor() {
    super("CAPTURE_PAYMENT_INTENT_NO_LINES");
    this.name = "CapturePaymentIntentNoLinesError";
  }
}

/**
 * Typed 409: a selection plan exists but could not be priced against the live catalog right now
 * (an inactive product, or the catalog having moved to a different catalogVersion). Never falls
 * back to a 0 subtotal -- that would silently accept a tender that only covers the delivery fee,
 * or the wrong currency, as if the order had no items at all.
 */
export class CapturePaymentIntentUnpricedError extends Error {
  public constructor() {
    super("CAPTURE_PAYMENT_INTENT_UNPRICED");
    this.name = "CapturePaymentIntentUnpricedError";
  }
}

@Injectable()
export class CapturePaymentIntentService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_PAYMENT_INTENT_PORT) private readonly persistence: CapturePaymentIntentPort,
    @Inject(CAPTURE_CREATION_PORT) private readonly captures: CaptureCreationPort,
    @Inject(CAPTURE_CONFIRMATION_PORT) private readonly confirmation: CaptureConfirmationPort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
  ) {}

  public async setPaymentIntent(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureWorkspaceV5> {
    const command = parseSetCapturePaymentIntentCommandV1(input);
    if (command === undefined) throw new CaptureApplicationError("request");
    let actorId: string;
    try { actorId = (await this.authorization.authorizeBranch(principal, command.scope, "captures.update")).principal.actorId; }
    catch { throw new CaptureApplicationError("authorization"); }

    // The envelope never carries basisFingerprint: it is hashed for idempotency exactly like
    // this, both here and in the SQL probe/write, so a retry with the same idempotencyKey is
    // recognized as the original apply regardless of whether repricing produces a different basis.
    const envelope = {
      attentionLeaseId: command.attentionLeaseId,
      captureDraftId: command.captureDraftId,
      deviceId: command.deviceId,
      eventId: command.eventId,
      expectedVersion: command.expectedVersion,
      idempotencyKey: command.idempotencyKey,
      method: command.method,
      occurredAt: command.occurredAt,
      schemaVersion: 1,
      scope: command.scope,
      tenderedAmountMinor: command.tenderedAmountMinor,
      tipMinor: command.tipMinor,
    };

    // Idempotency is decided purely by actor+scope+idempotencyKey+fingerprint over the client's
    // own envelope, entirely independent of the (freshly re-read and repriced) basis fingerprint.
    // Probing it first -- before ever re-reading the workspace or repricing -- means a retry after
    // a lost response, or after the lines/quote changed since the original apply, is always
    // recognized as the original apply, never turned into a spurious insufficient/conflict by a
    // freshly recomputed basis that no longer matches what was actually stored.
    let rawProbe: unknown;
    try { rawProbe = await this.persistence.probeSetPaymentIntent(actorId, envelope); } catch { throw unavailable(); }
    const probe = exactRecord(rawProbe, ["status", "record"]);
    if (probe?.status === "replayed") {
      return readCaptureWorkspaceV5WithProjections(
        actorId, command.scope, command.captureDraftId, this.captures, this.confirmation, this.catalogs,
      );
    }
    const probeStatus = exactRecord(rawProbe, ["status"]);
    if (probeStatus?.status === "denied") throw new CaptureApplicationError("authorization");
    if (probeStatus?.status === "conflict") throw new CaptureApplicationError("conflict");
    if (probeStatus?.status === "rejected") throw new CaptureApplicationError("request");
    if (probeStatus?.status !== "pending") throw unavailable();

    const before = await readCaptureWorkspaceV5WithProjections(
      actorId, command.scope, command.captureDraftId, this.captures, this.confirmation, this.catalogs,
    );
    // A payment intent priced against zero lines (no selection plan and no repeat plan at all) is
    // never a legitimate "ready" or "insufficient" intent -- it would silently accept any tender
    // as covering an order with no items. Refuse it outright, before any other conflict check, and
    // never fall back to a 0 basis.
    if (before.selectionPlan === null && before.repeatOrderPlan === null) throw new CapturePaymentIntentNoLinesError();

    const fulfillmentChannel = before.detail.fulfillmentChannel;
    if (fulfillmentChannel === null) throw new CaptureApplicationError("conflict");

    let itemsSubtotalMinor: number;
    let basisCatalogVersion: string;
    let basisLines: CapturePaymentIntentBasisLine[];
    let repeatCurrency: string | undefined;
    if (before.selectionPlan !== null) {
      // selectionProjection is best-effort (see projectStoredSelectionPlan): null whenever the
      // live catalog cannot presently price the stored plan. Falling back to a 0 subtotal here
      // would let a tender that only covers the delivery fee (or borrows the quote's currency)
      // look "ready" for an order that in fact has priced items; fail closed instead.
      if (before.selectionProjection === null) throw new CapturePaymentIntentUnpricedError();
      itemsSubtotalMinor = before.selectionProjection.itemsTotalMinor;
      const storedPlan = await readStoredCaptureSelectionPlanLines(
        actorId, command.scope, command.captureDraftId, this.confirmation,
      );
      basisCatalogVersion = storedPlan?.catalogVersion ?? "";
      basisLines = selectionLinesToBasis(storedPlan?.lines ?? []);
    } else if (before.repeatOrderPlan !== null) {
      const repeatBasis = await readStoredCaptureRepeatOrderPlanBasis(
        actorId, command.scope, command.captureDraftId, before.repeatOrderPlan, this.confirmation, this.catalogs,
      );
      if (repeatBasis === null) throw new CaptureApplicationError("conflict");
      itemsSubtotalMinor = repeatBasis.itemsTotalMinor;
      repeatCurrency = repeatBasis.currency;
      basisCatalogVersion = before.repeatOrderPlan.catalogVersion;
      basisLines = repeatLinesToBasis(repeatBasis.lines);
    } else {
      throw new CapturePaymentIntentNoLinesError();
    }
    // A repeat-order capture is not necessarily delivery, so its currency comes from the priced
    // repeat plan's own catalog when there is no selection projection or delivery quote to supply it.
    const currency = before.selectionProjection?.currency ?? repeatCurrency ?? before.deliveryQuote?.currency;
    if (currency === undefined) throw new CaptureApplicationError("conflict");
    const deliveryFeeMinor = fulfillmentChannel === "delivery" ? (before.deliveryQuote?.feeMinor ?? 0) : 0;
    const quoteId = fulfillmentChannel === "delivery" ? (before.deliveryQuote?.quoteId ?? null) : null;

    let domainProjection;
    try {
      domainProjection = buildCapturePaymentIntentProjection({
        currency, deliveryFeeMinor, fulfillmentChannel, itemsSubtotalMinor,
        method: command.method, tenderedAmountMinor: command.tenderedAmountMinor, tipMinor: command.tipMinor,
      });
    } catch { throw new CaptureApplicationError("request"); }
    if (domainProjection.status === "insufficient") throw new CapturePaymentIntentInsufficientError();

    const basisFingerprint = computeCapturePaymentIntentBasisFingerprint({
      catalogVersion: basisCatalogVersion, currency, deliveryFeeMinor, lines: basisLines, quoteId,
    });

    let raw: unknown;
    try { raw = await this.persistence.setCapturePaymentIntent(actorId, envelope, basisFingerprint); } catch { throw unavailable(); }
    const envelopeResult = exactRecord(raw, ["status", "record"]);
    if (envelopeResult?.status !== "applied" && envelopeResult?.status !== "replayed") {
      const statusOnly = exactRecord(raw, ["status"]);
      if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
      if (statusOnly?.status === "conflict") throw new CaptureApplicationError("conflict");
      if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
      throw unavailable();
    }
    return readCaptureWorkspaceV5WithProjections(
      actorId, command.scope, command.captureDraftId, this.captures, this.confirmation, this.catalogs,
    );
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
    @Inject(CAPTURE_CONFIRMATION_PORT) private readonly confirmation: CaptureConfirmationPort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
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

  public async readWorkspace(
    principal: AuthenticatedPrincipal,
    input: unknown,
  ): Promise<CaptureWorkspaceV1 | CaptureWorkspaceV2 | CaptureWorkspaceV3 | CaptureWorkspaceV4 | CaptureWorkspaceV5> {
    const requestV5 = parseCaptureWorkspaceRequestV5(input);
    const requestV4 = requestV5 === undefined ? parseCaptureWorkspaceRequestV4(input) : undefined;
    const requestV3 = requestV5 === undefined && requestV4 === undefined ? parseCaptureWorkspaceRequestV3(input) : undefined;
    const requestV2 = requestV5 === undefined && requestV4 === undefined && requestV3 === undefined
      ? parseCaptureWorkspaceRequestV2(input) : undefined;
    const request = requestV5 ?? requestV4 ?? requestV3 ?? requestV2 ?? parseCaptureWorkspaceRequestV1(input);
    if (request === undefined) throw new CaptureApplicationError("request");
    let actorId: string;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, request.scope, "captures.read");
      await this.authorization.authorizeBranch(principal, request.scope, "customers.read");
      if (requestV4 !== undefined || requestV5 !== undefined) {
        await this.authorization.authorizeBranch(principal, request.scope, "catalog.read");
      }
      actorId = authorized.principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    if (requestV5 !== undefined) {
      return readCaptureWorkspaceV5WithProjections(
        actorId, requestV5.scope, requestV5.captureDraftId, this.creator, this.confirmation, this.catalogs,
      );
    }
    if (requestV4 !== undefined) return this.readWorkspaceV4(actorId, requestV4);
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

  private async readWorkspaceV4(actorId: string, request: CaptureWorkspaceRequestV4): Promise<CaptureWorkspaceV4> {
    if (this.creator.readWorkspaceV4 === undefined) throw unavailable();
    let raw: unknown;
    try { raw = await this.creator.readWorkspaceV4(actorId, request); } catch { throw unavailable(); }
    const statusOnly = exactRecord(raw, ["status"]);
    if (statusOnly?.status === "denied") throw new CaptureApplicationError("authorization");
    if (statusOnly?.status === "missing") throw new CaptureApplicationError("missing");
    if (statusOnly?.status === "rejected") throw new CaptureApplicationError("request");
    if (statusOnly !== undefined) throw unavailable();
    let workspace: CaptureWorkspaceV4;
    try {
      workspace = decodeCaptureWorkspaceV4(raw, request.scope);
      if (workspace.detail.captureDraftId !== request.captureDraftId) throw unavailable();
    } catch { throw unavailable(); }
    // Best-effort, exactly like replace()'s projection: a stale catalog (republished under a
    // different catalogVersion, a retired product, a changed group limit) must never block
    // reading the workspace itself, only leave the priced projection null for this read.
    const projection = await projectStoredSelectionPlan(
      actorId, request.scope, request.captureDraftId, workspace.selectionPlan, this.confirmation, this.catalogs,
    );
    return withCaptureSelectionProjection(workspace, projection);
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

@Injectable()
export class CaptureNoSaleService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CAPTURE_NO_SALE_PORT) private readonly persistence: CaptureNoSalePort,
  ) {}

  public async closeNoSale(principal: AuthenticatedPrincipal, input: unknown): Promise<CaptureMutationResultV1> {
    const command = parseNoSaleCommand(input);
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, command.scope, "captures.update")).principal.actorId;
    } catch { throw new CaptureApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.persistence.closeNoSale(actorId, command); }
    catch { throw unavailable(); }
    const { record, replayed } = parseOutcome(raw, command.scope);
    if (record.detail.captureDraftId !== command.captureDraftId || record.detail.version !== command.expectedVersion + 1
      || record.detail.status !== "no_sale" || record.detail.attentionStatus !== "unclaimed") throw unavailable();
    const result = parseCaptureMutationResultV1({ schemaVersion: 1, detail: record.detail, replayed });
    if (result === undefined) throw unavailable();
    return result;
  }
}

function parseNoSaleCommand(input: unknown): CloseCaptureNoSaleCommandV1 {
  const command = parseCloseCaptureNoSaleCommandV1(input);
  if (command === undefined || command.expectedVersion >= Number.MAX_SAFE_INTEGER) throw new CaptureApplicationError("request");
  return command;
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
/**
 * confirm_capture_draft_v3's conflict reasons ('payment_intent_stale', 'delivery_quote_stale')
 * carry a `reason` alongside `status`, a shape parseOutcome's exact-key checks never recognize
 * (they only know plain {status} and {status,record}) -- without this, a genuine stale write that
 * slipped past CaptureConfirmationService's own basisFingerprint pre-check would fall through to
 * a generic 503 instead of the same typed 409 the pre-check throws. This keeps both guards
 * -- the API's own fingerprint check and SQL's fact-based CAS -- agreeing on the same outcome.
 */
function confirmationResult(raw: unknown, command: ConfirmCaptureDraftCommandV2): CaptureMutationResultV1 {
  const reasoned = exactRecord(raw, ["status", "reason"]);
  if (reasoned?.status === "conflict") {
    if (reasoned.reason === "payment_intent_stale") throw new CapturePaymentIntentStaleError();
    throw new CaptureApplicationError("conflict");
  }
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
