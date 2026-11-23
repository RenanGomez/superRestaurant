import {
  type SyncClientTypeV1,
  type SyncConnectivityStateV1,
  type SyncEntityTypeV1,
  type SyncOperationV1,
} from "@super-restaurant/shared-types";
import { SyncEngineError } from "./errors.js";
import { asPlainRecord } from "./json.js";

/** Operational actions of OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §2.1. */
export const SYNC_CAPABILITY_ACTIONS = Object.freeze([
  "catalog.read_cached",
  "tables.read_cached",
  "order.create_local",
  "order.edit_local_origin",
  "order.edit_remote_origin",
  "table.assign_or_occupy",
  "discount.apply_standard",
  "discount.apply_supervisor_or_reopen",
  "kds.advance_received_ticket",
  "kds.receive_new_ticket",
  "kds.reassign_station",
  "kds.read_cached_tickets",
  "payment.cash_collect",
  "ticket.print_local",
  "payment.card_manual_record",
  "payment.gateway_or_terminal_integrated",
  "payment.refund_or_void",
  "cash_register.close_or_reopen",
  "fiscal.cfdi_stamp",
  "inventory.adjust_or_receive",
  "reports.consolidated_multi_branch",
  "entity.physical_delete",
] as const);

export type SyncCapabilityAction = (typeof SYNC_CAPABILITY_ACTIONS)[number];

export const CAPABILITY_BLOCK_CODES = Object.freeze([
  "CLIENT_NOT_SUPPORTED",
  "PHASE3_UNSUPPORTED",
  "OFFLINE_NOT_SUPPORTED",
  "SYNC_BLOCKED_ENTITY",
  "SESSION_REQUIRED",
  "SNAPSHOTS_REQUIRED",
  "REMOTE_ORIGIN_OFFLINE_BLOCKED",
  "SUPERVISOR_REQUIRED_ONLINE",
  "LOCAL_RULE_LIMIT_EXCEEDED",
  "CASH_REGISTER_REQUIRED",
  "OFFLINE_CASH_LIMIT_EXCEEDED",
  "EXTERNAL_TERMINAL_CONFIRMATION_REQUIRED",
  "CARD_MANUAL_CANNOT_CAPTURE_OFFLINE",
  "TICKET_NOT_RECEIVED_ON_STATION",
  "TEMPLATE_CACHE_REQUIRED",
  "PHYSICAL_DELETE_FORBIDDEN",
] as const);

export type CapabilityBlockCode = (typeof CAPABILITY_BLOCK_CODES)[number];

export type CapabilityPaymentMethod = "cash" | "card_manual" | "card_gateway" | "terminal_integrated" | "transfer";

export interface CapabilityPreconditions {
  readonly hasValidSession?: boolean;
  readonly hasCatalogSnapshots?: boolean;
  readonly originatedOnThisDevice?: boolean;
  readonly requiresSupervisorApproval?: boolean;
  readonly withinLocalRuleLimit?: boolean;
  readonly cashRegisterOpen?: boolean;
  readonly cashierShiftOpen?: boolean;
  readonly withinOfflineCashLimit?: boolean;
  readonly externalTerminalConfirmed?: boolean;
  readonly ticketReceivedOnStation?: boolean;
  readonly templateCached?: boolean;
  readonly entityBlocked?: boolean;
  readonly paymentMethod?: CapabilityPaymentMethod;
  /** When connectivity is `sync_blocked`, callers may indicate whether WAN is reachable for unaffected entities. */
  readonly underlyingConnectivity?: Exclude<SyncConnectivityStateV1, "sync_blocked">;
}

export interface CapabilityCheckInput {
  readonly clientType: SyncClientTypeV1;
  readonly connectivity: SyncConnectivityStateV1;
  readonly action: SyncCapabilityAction;
  readonly preconditions?: CapabilityPreconditions;
}

export interface EnvelopeCapabilityCheckInput {
  readonly clientType: SyncClientTypeV1;
  readonly connectivity: SyncConnectivityStateV1;
  readonly entityType: SyncEntityTypeV1;
  readonly operation: SyncOperationV1;
  readonly payload?: unknown;
  readonly preconditions?: CapabilityPreconditions;
}

export interface CapabilityDecision {
  readonly allowed: boolean;
  readonly mode: "allowed" | "conditional" | "blocked";
  readonly reasonCode: CapabilityBlockCode | null;
  readonly localOnlyWarning: boolean;
  readonly requiresServerRevalidation: boolean;
}

type CellPolicy = "allowed" | "conditional" | "blocked";

interface ActionMatrixRow {
  readonly clients: Readonly<Record<SyncClientTypeV1, CellPolicy>>;
  readonly online: CellPolicy;
  readonly offline: CellPolicy;
  readonly phase3Blocked?: boolean;
  readonly physicalDelete?: boolean;
}

const CAPABILITY_MATRIX: Readonly<Record<SyncCapabilityAction, ActionMatrixRow>> = Object.freeze({
  "catalog.read_cached": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "allowed",
    offline: "allowed",
  },
  "tables.read_cached": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "allowed",
    offline: "conditional",
  },
  "order.create_local": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "allowed",
    offline: "conditional",
  },
  "order.edit_local_origin": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "allowed",
    offline: "conditional",
  },
  "order.edit_remote_origin": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "allowed",
    offline: "blocked",
  },
  "table.assign_or_occupy": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "allowed",
    offline: "conditional",
  },
  "discount.apply_standard": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "allowed",
    offline: "conditional",
  },
  "discount.apply_supervisor_or_reopen": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "conditional",
    offline: "blocked",
  },
  "kds.advance_received_ticket": {
    clients: { web_pos: "blocked", mobile: "blocked", kds: "conditional" },
    online: "allowed",
    offline: "conditional",
  },
  "kds.receive_new_ticket": {
    clients: { web_pos: "blocked", mobile: "blocked", kds: "allowed" },
    online: "allowed",
    offline: "blocked",
  },
  "kds.reassign_station": {
    clients: { web_pos: "blocked", mobile: "blocked", kds: "conditional" },
    online: "allowed",
    offline: "blocked",
  },
  "kds.read_cached_tickets": {
    clients: { web_pos: "blocked", mobile: "blocked", kds: "allowed" },
    online: "allowed",
    offline: "allowed",
  },
  "payment.cash_collect": {
    clients: { web_pos: "allowed", mobile: "conditional", kds: "blocked" },
    online: "allowed",
    offline: "conditional",
  },
  "ticket.print_local": {
    clients: { web_pos: "allowed", mobile: "conditional", kds: "blocked" },
    online: "allowed",
    offline: "conditional",
  },
  "payment.card_manual_record": {
    clients: { web_pos: "conditional", mobile: "conditional", kds: "blocked" },
    online: "conditional",
    offline: "conditional",
  },
  "payment.gateway_or_terminal_integrated": {
    clients: { web_pos: "blocked", mobile: "blocked", kds: "blocked" },
    online: "blocked",
    offline: "blocked",
    phase3Blocked: true,
  },
  "payment.refund_or_void": {
    clients: { web_pos: "blocked", mobile: "blocked", kds: "blocked" },
    online: "blocked",
    offline: "blocked",
    phase3Blocked: true,
  },
  "cash_register.close_or_reopen": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "allowed",
    offline: "blocked",
  },
  "fiscal.cfdi_stamp": {
    clients: { web_pos: "blocked", mobile: "blocked", kds: "blocked" },
    online: "blocked",
    offline: "blocked",
    phase3Blocked: true,
  },
  "inventory.adjust_or_receive": {
    clients: { web_pos: "blocked", mobile: "blocked", kds: "blocked" },
    online: "blocked",
    offline: "blocked",
    phase3Blocked: true,
  },
  "reports.consolidated_multi_branch": {
    clients: { web_pos: "allowed", mobile: "allowed", kds: "blocked" },
    online: "allowed",
    offline: "blocked",
  },
  "entity.physical_delete": {
    clients: { web_pos: "blocked", mobile: "blocked", kds: "blocked" },
    online: "blocked",
    offline: "blocked",
    physicalDelete: true,
  },
});

function block(reasonCode: CapabilityBlockCode): CapabilityDecision {
  return Object.freeze({
    allowed: false,
    mode: "blocked",
    reasonCode,
    localOnlyWarning: false,
    requiresServerRevalidation: false,
  });
}

function allow(mode: "allowed" | "conditional", isOffline: boolean, requiresServerRevalidation: boolean): CapabilityDecision {
  return Object.freeze({
    allowed: true,
    mode,
    reasonCode: null,
    localOnlyWarning: isOffline,
    requiresServerRevalidation,
  });
}

function effectiveOffline(connectivity: SyncConnectivityStateV1, preconditions: CapabilityPreconditions): boolean {
  if (connectivity === "offline" || connectivity === "reconnecting") return true;
  if (connectivity === "sync_blocked") {
    const underlying = preconditions.underlyingConnectivity ?? "offline";
    return underlying === "offline" || underlying === "reconnecting";
  }
  return false;
}

/**
 * Pure, deterministic evaluator for OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §2.1 & §2.2.
 * Local precondition checks are operational guards only; the server always revalidates on sync.
 */
export function evaluateOfflineCapability(input: CapabilityCheckInput): CapabilityDecision {
  const row = CAPABILITY_MATRIX[input.action];
  const preconditions = input.preconditions ?? {};

  if (row.physicalDelete === true) return block("PHYSICAL_DELETE_FORBIDDEN");
  if (row.phase3Blocked === true) return block("PHASE3_UNSUPPORTED");

  const clientPolicy = row.clients[input.clientType];
  if (clientPolicy === "blocked") return block("CLIENT_NOT_SUPPORTED");

  if (input.connectivity === "sync_blocked" && preconditions.entityBlocked === true) {
    return block("SYNC_BLOCKED_ENTITY");
  }

  const offline = effectiveOffline(input.connectivity, preconditions);
  const netPolicy = offline ? row.offline : row.online;

  if (netPolicy === "blocked") {
    if (input.action === "order.edit_remote_origin") return block("REMOTE_ORIGIN_OFFLINE_BLOCKED");
    if (input.action === "discount.apply_supervisor_or_reopen") return block("SUPERVISOR_REQUIRED_ONLINE");
    return block("OFFLINE_NOT_SUPPORTED");
  }

  if (preconditions.hasValidSession === false) return block("SESSION_REQUIRED");
  if (offline && preconditions.requiresSupervisorApproval === true) return block("SUPERVISOR_REQUIRED_ONLINE");

  switch (input.action) {
    case "order.create_local":
      if (offline && preconditions.hasCatalogSnapshots === false) return block("SNAPSHOTS_REQUIRED");
      break;
    case "order.edit_local_origin":
      if (offline && preconditions.originatedOnThisDevice === false) return block("REMOTE_ORIGIN_OFFLINE_BLOCKED");
      if (offline && preconditions.hasCatalogSnapshots === false) return block("SNAPSHOTS_REQUIRED");
      break;
    case "discount.apply_standard":
      if (offline && preconditions.withinLocalRuleLimit === false) return block("LOCAL_RULE_LIMIT_EXCEEDED");
      break;
    case "kds.advance_received_ticket":
      if (offline && preconditions.ticketReceivedOnStation === false) return block("TICKET_NOT_RECEIVED_ON_STATION");
      break;
    case "payment.cash_collect":
      if ((offline || input.clientType === "mobile") && (preconditions.cashRegisterOpen === false || preconditions.cashierShiftOpen === false)) {
        return block("CASH_REGISTER_REQUIRED");
      }
      if (offline && preconditions.withinOfflineCashLimit === false) return block("OFFLINE_CASH_LIMIT_EXCEEDED");
      break;
    case "payment.card_manual_record":
      if (offline && preconditions.externalTerminalConfirmed !== true) {
        return block("EXTERNAL_TERMINAL_CONFIRMATION_REQUIRED");
      }
      break;
    case "ticket.print_local":
      if (offline && preconditions.templateCached === false) return block("TEMPLATE_CACHE_REQUIRED");
      break;
    default:
      break;
  }

  const mode: "allowed" | "conditional" = clientPolicy === "conditional" || netPolicy === "conditional"
    ? "conditional"
    : "allowed";
  const isReadOnly = input.action === "catalog.read_cached"
    || input.action === "tables.read_cached"
    || input.action === "kds.read_cached_tickets"
    || input.action === "reports.consolidated_multi_branch";

  return allow(mode, offline, !isReadOnly);
}

function readPaymentMethod(payload: unknown, preconditions: CapabilityPreconditions): CapabilityPaymentMethod {
  if (preconditions.paymentMethod !== undefined) return preconditions.paymentMethod;
  const record = asPlainRecord(payload);
  const raw = record?.["paymentMethod"] ?? record?.["method"];
  if (
    raw === "cash"
    || raw === "card_manual"
    || raw === "card_gateway"
    || raw === "terminal_integrated"
    || raw === "transfer"
  ) {
    return raw;
  }
  return "cash";
}

function isCardManualMarkedCaptured(payload: unknown): boolean {
  const record = asPlainRecord(payload);
  return record?.["status"] === "captured" || record?.["captured"] === true;
}

/**
 * Evaluates whether a sync mutation envelope `(entityType, operation)` is permitted for the given
 * client and connectivity state under OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §2.1 & §2.2.
 */
export function evaluateEnvelopeCapability(input: EnvelopeCapabilityCheckInput): CapabilityDecision {
  const preconditions = input.preconditions ?? {};
  const offline = effectiveOffline(input.connectivity, preconditions);

  if (input.connectivity === "sync_blocked" && preconditions.entityBlocked === true && input.operation !== "compensate") {
    return block("SYNC_BLOCKED_ENTITY");
  }

  switch (input.entityType) {
    case "Refund":
      return evaluateOfflineCapability({
        clientType: input.clientType,
        connectivity: input.connectivity,
        action: "payment.refund_or_void",
        preconditions,
      });

    case "CashRegisterSession":
      return evaluateOfflineCapability({
        clientType: input.clientType,
        connectivity: input.connectivity,
        action: "cash_register.close_or_reopen",
        preconditions,
      });

    case "KdsTicket": {
      if (input.operation === "create") {
        // Creating KDS tickets happens server-side on send-to-kitchen (web/mobile online), never offline from KDS.
        if (input.clientType === "kds") return block("CLIENT_NOT_SUPPORTED");
        if (offline) return block("OFFLINE_NOT_SUPPORTED");
        return allow("allowed", false, true);
      }
      const action: SyncCapabilityAction = input.operation === "compensate"
        ? "kds.reassign_station"
        : "kds.advance_received_ticket";
      return evaluateOfflineCapability({
        clientType: input.clientType,
        connectivity: input.connectivity,
        action,
        preconditions,
      });
    }

    case "Order":
    case "OrderItem": {
      if (input.operation === "create") {
        return evaluateOfflineCapability({
          clientType: input.clientType,
          connectivity: input.connectivity,
          action: "order.create_local",
          preconditions,
        });
      }
      if (preconditions.requiresSupervisorApproval === true) {
        return evaluateOfflineCapability({
          clientType: input.clientType,
          connectivity: input.connectivity,
          action: "discount.apply_supervisor_or_reopen",
          preconditions,
        });
      }
      const action: SyncCapabilityAction = preconditions.originatedOnThisDevice === false
        ? "order.edit_remote_origin"
        : "order.edit_local_origin";
      return evaluateOfflineCapability({
        clientType: input.clientType,
        connectivity: input.connectivity,
        action,
        preconditions,
      });
    }

    case "DiningTable":
      return evaluateOfflineCapability({
        clientType: input.clientType,
        connectivity: input.connectivity,
        action: "table.assign_or_occupy",
        preconditions,
      });

    case "OrderDiscount": {
      const action: SyncCapabilityAction = preconditions.requiresSupervisorApproval === true
        ? "discount.apply_supervisor_or_reopen"
        : "discount.apply_standard";
      return evaluateOfflineCapability({
        clientType: input.clientType,
        connectivity: input.connectivity,
        action,
        preconditions,
      });
    }

    case "Payment": {
      const method = readPaymentMethod(input.payload, preconditions);
      if (method === "card_gateway" || method === "terminal_integrated") {
        return evaluateOfflineCapability({
          clientType: input.clientType,
          connectivity: input.connectivity,
          action: "payment.gateway_or_terminal_integrated",
          preconditions,
        });
      }
      if (method === "card_manual") {
        if (offline && isCardManualMarkedCaptured(input.payload)) {
          return block("CARD_MANUAL_CANNOT_CAPTURE_OFFLINE");
        }
        return evaluateOfflineCapability({
          clientType: input.clientType,
          connectivity: input.connectivity,
          action: "payment.card_manual_record",
          preconditions,
        });
      }
      if (method === "transfer" && offline) {
        return block("OFFLINE_NOT_SUPPORTED");
      }
      return evaluateOfflineCapability({
        clientType: input.clientType,
        connectivity: input.connectivity,
        action: "payment.cash_collect",
        preconditions,
      });
    }

    case "CashMovement":
      return evaluateOfflineCapability({
        clientType: input.clientType,
        connectivity: input.connectivity,
        action: "payment.cash_collect",
        preconditions,
      });

    case "MenuCatalog": {
      if (input.clientType === "kds") return block("CLIENT_NOT_SUPPORTED");
      if (offline) return block("OFFLINE_NOT_SUPPORTED");
      return allow("allowed", false, true);
    }

    case "CaptureDraft":
    case "Customer": {
      if (input.clientType === "kds") return block("CLIENT_NOT_SUPPORTED");
      if (preconditions.hasValidSession === false) return block("SESSION_REQUIRED");
      if (offline && preconditions.originatedOnThisDevice === false && input.operation !== "create") {
        return block("REMOTE_ORIGIN_OFFLINE_BLOCKED");
      }
      return allow(offline ? "conditional" : "allowed", offline, true);
    }
  }
}

export function assertOfflineCapability(input: CapabilityCheckInput): CapabilityDecision {
  const decision = evaluateOfflineCapability(input);
  if (!decision.allowed) throw new SyncEngineError("CAPABILITY_BLOCKED", decision.reasonCode ?? input.action);
  return decision;
}

export function assertEnvelopeCapability(input: EnvelopeCapabilityCheckInput): CapabilityDecision {
  const decision = evaluateEnvelopeCapability(input);
  if (!decision.allowed) throw new SyncEngineError("CAPABILITY_BLOCKED", decision.reasonCode ?? `${input.entityType}.${input.operation}`);
  return decision;
}
