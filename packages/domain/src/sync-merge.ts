import { DomainError } from "./errors.js";
import { Money } from "./money.js";
import {
  calculateOrderItemTotals,
  calculateOrderTotals,
  type CalculatedOrderItemTotals,
  type CalculatedOrderTotals,
  type OrderDiscountSnapshot,
  type OrderItemPricingInput,
} from "./order-totals.js";
import {
  orderAcceptsNewLines,
  transitionOrder,
  transitionOrderItem,
  type CancellationAuthorization,
  type OrderItemCancellationAudit,
  type OrderItemState,
  type OrderRefundObligation,
  type OrderState,
} from "./order-state.js";
import type { DeliveryChargeSnapshot, OrderChannel, OrderItem } from "./order.js";
import { cashChange, type PaymentMethod, type PaymentState } from "./payment.js";
import { derivePaymentObligation } from "./payment-obligation.js";
import type {
  CashMovementDirection,
  CashMovementSource,
  CashMovementType,
  CashRegisterState,
} from "./cash-register.js";

export const SYNC_MERGE_ENTITY_TYPES = Object.freeze([
  "Order",
  "OrderItem",
  "DiningTable",
  "KdsTicket",
  "Payment",
  "CashMovement",
] as const);
export type SyncMergeEntityType = (typeof SYNC_MERGE_ENTITY_TYPES)[number];

export const SYNC_MERGE_STATUSES = Object.freeze([
  "accepted",
  "duplicate",
  "rejected",
  "conflict",
  "manual_review",
] as const);
export type SyncMergeStatus = (typeof SYNC_MERGE_STATUSES)[number];

export const SYNC_MERGE_OPERATIONS = Object.freeze([
  "create",
  "update",
  "transition",
  "delete",
  "compensate",
] as const);
export type SyncMergeOperation = (typeof SYNC_MERGE_OPERATIONS)[number];

export const DINING_TABLE_SYNC_STATES = Object.freeze([
  "free",
  "occupied",
  "reserved",
  "disabled",
] as const);
export type DiningTableSyncStatus = (typeof DINING_TABLE_SYNC_STATES)[number];

export const KDS_TICKET_SYNC_STATES = Object.freeze([
  "sent",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
] as const);
export type KdsTicketSyncStatus = (typeof KDS_TICKET_SYNC_STATES)[number];

export type PaymentSyncRecordState = PaymentState | "ambiguous";

export type SyncMergeCode =
  | "ACCEPTED"
  | "ADDITIVE_LINES_MERGED"
  | "ALREADY_ACKNOWLEDGED"
  | "ALREADY_IN_TARGET_STATE"
  | "ARBITRARY_PRICE_OVERRIDE_BLOCKED"
  | "CANCEL_AFTER_DELIVERY_CONFLICT"
  | "CANCEL_VS_PROGRESS_CONFLICT"
  | "CASH_BALANCE_IMPOSSIBLE"
  | "CASH_MOVEMENT_ID_CONFLICT"
  | "CASH_MOVEMENT_IMMUTABLE"
  | "CASH_REGISTER_ALREADY_CLOSED"
  | "CASH_REGISTER_CLOSED_OFFLINE_PAYMENT"
  | "CASH_REGISTER_REOPEN_CONFLICT"
  | "CASH_SEQUENCE_DUPLICATE"
  | "CASH_SEQUENCE_GAP"
  | "CASH_SEQUENCE_INVALID"
  | "COMPENSATION_INVALID"
  | "CONCURRENT_CASH_REGISTER_CLOSE"
  | "CONCURRENT_DISCOUNT_CONFLICT"
  | "CONCURRENT_ORDER_ITEM_MODIFICATION"
  | "CONCURRENT_ORDER_UPDATE"
  | "CURRENCY_MISMATCH"
  | "DISCOUNT_EXCEEDS_AMOUNT"
  | "DUPLICATE_EVENT"
  | "DUPLICATE_IDEMPOTENCY_KEY"
  | "DUPLICATE_OBLIGATION_PAYMENT_DIFFERENT_KEY"
  | "DUPLICATE_ORDER_ITEM_ID"
  | "ENTITY_NOT_FOUND"
  | "EVENT_ID_REUSE_CONFLICT"
  | "EXTERNAL_TERMINAL_CONFIRMATION_REQUIRED"
  | "HISTORICAL_ORDER_IMMUTABLE"
  | "IDEMPOTENCY_KEY_REUSE"
  | "INSUFFICIENT_TENDERED_AMOUNT"
  | "INVALID_BACKWARD_TRANSITION"
  | "INVALID_BASE_VERSION"
  | "INVALID_CASH_MOVEMENT_AMOUNT"
  | "INVALID_CASH_MOVEMENT_SHAPE"
  | "INVALID_PAYMENT_AMOUNT"
  | "INVALID_STATE_TRANSITION"
  | "KDS_CANCELLED_TICKET_CONFLICT"
  | "KDS_DOUBLE_STATION_CONFLICT"
  | "KDS_INCOMPATIBLE_STATE_TRANSITION"
  | "KDS_TICKET_ALREADY_EXISTS"
  | "KDS_TICKET_LINK_MISMATCH"
  | "KDS_TICKET_NOT_FOUND"
  | "MONEY_OVERFLOW"
  | "OFFLINE_CASH_LIMIT_EXCEEDED"
  | "OFFLINE_CASH_REGISTER_CLOSE_FORBIDDEN"
  | "OFFLINE_COMPENSATION_FORBIDDEN"
  | "OFFLINE_PAYMENT_METHOD_NOT_ALLOWED"
  | "OFFLINE_REFUND_FORBIDDEN"
  | "ORDER_ALREADY_CLOSED"
  | "ORDER_ALREADY_EXISTS"
  | "ORDER_CANCELLATION_CONFLICT"
  | "ORDER_CANCELLATION_DELIVERED_ITEMS"
  | "ORDER_CLOSURE_REQUIRES_ITEM_COMPLETION"
  | "ORDER_DOES_NOT_ACCEPT_NEW_LINES"
  | "ORDER_ITEM_NOT_FOUND"
  | "ORDER_NOT_PAYABLE"
  | "ORDER_REOPEN_CONFLICT"
  | "ORDER_TERMINAL_STATE_CONFLICT"
  | "PAYMENT_EXCEEDS_OBLIGATION"
  | "PAYMENT_ID_CONFLICT"
  | "PAYMENT_IMMUTABLE_USE_COMPENSATE"
  | "PAYMENT_ON_DRAFT_ORDER"
  | "PAYMENT_ON_TERMINAL_ORDER"
  | "PAYMENT_PROVIDER_UNCERTAIN"
  | "PAYMENT_UNRESOLVED_EXPOSURE"
  | "POST_SEND_CANCELLATION_CONFLICT"
  | "POST_SEND_DELETE_FORBIDDEN"
  | "POST_SEND_LINE_MODIFICATION_CONFLICT"
  | "REASON_REQUIRED"
  | "REFUND_OBLIGATION_REQUIRED"
  | "SCOPE_MISMATCH"
  | "SHARED_EXCLUSIVE_RESERVATION_CONFLICT"
  | "SHIFT_REQUIRED"
  | "STALE_BASE_VERSION"
  | "STATE_ALREADY_SURPASSED"
  | "SUPERVISOR_AUTHORIZATION_REQUIRED"
  | "TABLE_ALREADY_EXISTS"
  | "TABLE_OCCUPANCY_CONFLICT"
  | "TABLE_OCCUPIED_DELETE_CONFLICT"
  | "TABLE_RELEASE_CONFLICT"
  | "TABLE_RESERVATION_CONFLICT"
  | "TABLE_STATE_CONFLICT"
  | "TOMBSTONE_ALREADY_APPLIED"
  | "TOMBSTONE_NOT_ALLOWED"
  | "TOMBSTONE_RECREATION_REQUIRES_NEW_ID"
  | "TOMBSTONE_RESURRECTION_BLOCKED"
  | "TOMBSTONE_SEMANTIC_IDENTITY_CONFLICT"
  | "UNSUPPORTED_OPERATION"
  | "VARIANCE_REASON_REQUIRED";

export class InvalidSyncMergeInputError extends DomainError {
  public readonly code = "INVALID_SYNC_MERGE_INPUT" as const;

  public constructor(field: string) {
    super(`Sync merge input is invalid at ${field}.`);
    this.field = field;
  }

  public readonly field: string;
}

export interface SyncSupervisorAuthorization {
  readonly approved: true;
  readonly actorId: string;
}

/**
 * Envelope metadata carried by every sync merge evaluation.
 * `occurredAt` is preserved for audit context only and NEVER decides priority,
 * ordering, or conflict winners.
 */
export interface SyncMergeEventMeta {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly occurredAt: string;
}

export interface SyncAppliedEventRecord {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly entityId: string;
  readonly operation: SyncMergeOperation;
  readonly intentFingerprint: string;
  readonly canonicalVersion: number;
}

export interface SyncManualReviewEvidence {
  readonly reasonCode: SyncMergeCode;
  readonly financial: boolean;
  readonly entityType: SyncMergeEntityType;
  readonly entityId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly baseVersion: number | null;
  readonly canonicalVersion: number | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly preserveEvidence: true;
}

export interface SyncMergeResultBase {
  readonly entityType: SyncMergeEntityType;
  readonly entityId: string;
  readonly status: SyncMergeStatus;
  readonly code: SyncMergeCode;
  readonly canonicalVersion: number | null;
  readonly financial: boolean;
  readonly requiresManualReview: boolean;
  readonly manualReview: SyncManualReviewEvidence | null;
}

// ---- Tombstone merge -----------------------------------------------------------------------

export interface TombstoneCanonicalState {
  readonly entityType: SyncMergeEntityType;
  readonly entityId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly version: number;
  readonly tombstoned: boolean;
  readonly allowTombstone: boolean;
  readonly appliedEvents?: readonly SyncAppliedEventRecord[];
}

export interface MergeTombstoneSyncEventInput {
  readonly canonical: TombstoneCanonicalState | null;
  readonly event: SyncMergeEventMeta & {
    readonly entityType: SyncMergeEntityType;
    readonly entityId: string;
    readonly operation: SyncMergeOperation;
    readonly baseVersion: number | null;
    readonly semanticIdentityConflict?: boolean;
  };
}

export interface TombstoneSyncMergeResult extends SyncMergeResultBase {
  readonly tombstoned: boolean;
}

// ---- Order merge ---------------------------------------------------------------------------

export interface OrderSyncState {
  readonly orderId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly channel: OrderChannel;
  readonly tableId?: string;
  readonly customerId?: string | null;
  readonly currency: string;
  readonly timeZone: string;
  readonly status: OrderState;
  readonly version: number;
  readonly items: readonly OrderItem[];
  readonly orderDiscount?: OrderDiscountSnapshot;
  readonly tip?: Money;
  readonly deliveryCharge: DeliveryChargeSnapshot | null;
  readonly capturedAmountMinor?: number;
  readonly appliedEvents?: readonly SyncAppliedEventRecord[];
}

export type OrderSyncEventPayload =
  | {
    readonly operation: "create";
    readonly baseVersion: null;
    readonly channel: OrderChannel;
    readonly tableId?: string;
    readonly customerId?: string | null;
    readonly currency: string;
    readonly timeZone: string;
    readonly items?: readonly OrderItemPricingInput[];
    readonly orderDiscount?: OrderDiscountSnapshot;
    readonly tip?: Money;
    readonly deliveryCharge?: DeliveryChargeSnapshot | null;
  }
  | {
    readonly operation: "update";
    readonly kind: "add_items";
    readonly baseVersion: number;
    readonly items: readonly OrderItemPricingInput[];
  }
  | {
    readonly operation: "update";
    readonly kind: "modify_item";
    readonly baseVersion: number;
    readonly item: OrderItemPricingInput;
    readonly customerId?: string | null;
  }
  | {
    readonly operation: "update";
    readonly kind: "apply_discount";
    readonly baseVersion: number;
    readonly orderDiscount: OrderDiscountSnapshot;
    readonly requiresSupervisor?: boolean;
    readonly allowStacking?: boolean;
    readonly authorization?: SyncSupervisorAuthorization;
    readonly reason?: string;
  }
  | {
    readonly operation: "update";
    readonly kind: "update_metadata";
    readonly baseVersion: number;
    readonly customerId?: string | null;
    readonly tableId?: string;
    readonly tip?: Money;
  }
  | {
    readonly operation: "transition";
    readonly baseVersion: number;
    readonly targetStatus: OrderState;
    readonly refundObligation?: OrderRefundObligation;
    readonly reason?: string;
    readonly authorization?: SyncSupervisorAuthorization;
  }
  | {
    readonly operation: "delete";
    readonly baseVersion: number;
  }
  | {
    readonly operation: "compensate";
    readonly baseVersion: number;
    readonly reason: string;
    readonly authorization?: SyncSupervisorAuthorization;
  };

export interface MergeOrderSyncEventInput {
  readonly entityType?: "Order";
  readonly canonical: OrderSyncState | null;
  readonly event: SyncMergeEventMeta & { readonly entityId: string } & OrderSyncEventPayload;
}

export interface OrderSyncMergeResult extends SyncMergeResultBase {
  readonly entityType: "Order";
  readonly mergedState: OrderSyncState | null;
  readonly recalculatedTotals: CalculatedOrderTotals | null;
  readonly payableTotal: Money | null;
}

// ---- OrderItem merge -----------------------------------------------------------------------

export interface OrderItemSyncState {
  readonly orderItemId: string;
  readonly orderId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly version: number;
  readonly status: OrderItemState;
  readonly item: OrderItemPricingInput;
  readonly tombstoned: boolean;
  readonly cancellationAudit?: OrderItemCancellationAudit;
  readonly appliedEvents?: readonly SyncAppliedEventRecord[];
}

export type OrderItemSyncEventPayload =
  | {
    readonly operation: "create";
    readonly baseVersion: null;
    readonly item: OrderItemPricingInput;
    readonly semanticIdentityConflict?: boolean;
  }
  | {
    readonly operation: "update";
    readonly baseVersion: number;
    readonly item: OrderItemPricingInput;
    readonly customerId?: string | null;
  }
  | {
    readonly operation: "transition";
    readonly baseVersion: number;
    readonly targetStatus: OrderItemState;
    readonly reason?: string;
    readonly authorization?: SyncSupervisorAuthorization;
    readonly kdsEvidenceVerified?: boolean;
  }
  | {
    readonly operation: "delete";
    readonly baseVersion: number;
    readonly reason?: string;
  }
  | {
    readonly operation: "compensate";
    readonly baseVersion: number;
    readonly reason: string;
    readonly authorization?: SyncSupervisorAuthorization;
  };

export interface MergeOrderItemSyncEventInput {
  readonly entityType?: "OrderItem";
  readonly canonical: OrderItemSyncState | null;
  readonly parentOrderStatus: OrderState;
  readonly orderCurrency: string;
  readonly event: SyncMergeEventMeta & {
    readonly entityId: string;
    readonly orderId: string;
  } & OrderItemSyncEventPayload;
}

export interface OrderItemSyncMergeResult extends SyncMergeResultBase {
  readonly entityType: "OrderItem";
  readonly tombstoned: boolean;
  readonly mergedState: OrderItemSyncState | null;
  readonly recalculatedLineTotals: CalculatedOrderItemTotals | null;
}

// ---- DiningTable merge ---------------------------------------------------------------------

export interface DiningTableSyncState {
  readonly tableId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly version: number;
  readonly status: DiningTableSyncStatus;
  readonly activeOrderId: string | null;
  readonly reservationId: string | null;
  readonly waiterUserId: string | null;
  readonly shiftId: string | null;
  readonly tombstoned: boolean;
  readonly appliedEvents?: readonly SyncAppliedEventRecord[];
}

export type DiningTableSyncEventPayload =
  | {
    readonly operation: "create";
    readonly baseVersion: null;
    readonly status?: DiningTableSyncStatus;
    readonly semanticIdentityConflict?: boolean;
  }
  | {
    readonly operation: "transition" | "update";
    readonly baseVersion: number;
    readonly targetStatus: DiningTableSyncStatus;
    readonly activeOrderId: string | null;
    readonly expectedActiveOrderId?: string | null;
    readonly reservationId?: string | null;
    readonly waiterUserId?: string | null;
    readonly shiftId?: string | null;
    readonly shiftOpen?: boolean;
    /** If another table in the same branch already holds the requested exclusive reservation, pass its tableId. */
    readonly exclusiveReservationHolderTableId?: string | null;
  }
  | {
    readonly operation: "delete";
    readonly baseVersion: number;
  };

export interface MergeDiningTableSyncEventInput {
  readonly entityType?: "DiningTable";
  readonly canonical: DiningTableSyncState | null;
  readonly event: SyncMergeEventMeta & { readonly entityId: string } & DiningTableSyncEventPayload;
}

export interface DiningTableSyncMergeResult extends SyncMergeResultBase {
  readonly entityType: "DiningTable";
  readonly tombstoned: boolean;
  readonly mergedState: DiningTableSyncState | null;
}

// ---- KdsTicket merge -----------------------------------------------------------------------

export interface KdsTicketSyncState {
  readonly ticketId: string;
  readonly orderId: string;
  readonly orderItemId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly stationId: string;
  readonly version: number;
  readonly status: KdsTicketSyncStatus;
  readonly acknowledged: boolean;
  readonly appliedEvents?: readonly SyncAppliedEventRecord[];
}

export type KdsTicketSyncEventPayload =
  | {
    readonly operation: "create";
    readonly baseVersion: null;
    readonly orderId: string;
    readonly orderItemId: string;
    readonly stationId: string;
  }
  | {
    readonly operation: "transition";
    readonly baseVersion: number;
    readonly orderId: string;
    readonly orderItemId: string;
    readonly stationId: string;
    readonly targetStatus: KdsTicketSyncStatus;
    readonly acknowledge?: boolean;
    readonly reason?: string;
    readonly authorization?: SyncSupervisorAuthorization;
  }
  | {
    readonly operation: "compensate";
    readonly baseVersion: number;
    readonly orderId: string;
    readonly orderItemId: string;
    readonly stationId: string;
    readonly targetStationId: string;
    readonly reason: string;
    readonly authorization?: SyncSupervisorAuthorization;
  }
  | {
    readonly operation: "delete" | "update";
    readonly baseVersion: number;
    readonly orderId: string;
    readonly orderItemId: string;
    readonly stationId: string;
  };

export interface MergeKdsTicketSyncEventInput {
  readonly entityType?: "KdsTicket";
  readonly canonical: KdsTicketSyncState | null;
  readonly event: SyncMergeEventMeta & { readonly entityId: string } & KdsTicketSyncEventPayload;
}

export interface KdsTicketSyncMergeResult extends SyncMergeResultBase {
  readonly entityType: "KdsTicket";
  readonly keepTicketVisible: boolean;
  readonly requiresCursorResync: boolean;
  readonly mergedState: KdsTicketSyncState | null;
}

// ---- Payment merge -------------------------------------------------------------------------

export interface PaymentSyncRecord {
  readonly paymentId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly orderId: string;
  readonly amountMinor: number;
  readonly tipMinor: number;
  readonly tenderedAmountMinor: number | null;
  readonly currency: string;
  readonly method: PaymentMethod;
  readonly state: PaymentSyncRecordState;
  readonly deviceId: string;
  readonly cashRegisterId: string | null;
  readonly cashierId: string | null;
  readonly cashSequence: number | null;
  readonly receiptNumber: string | null;
  readonly refundedAmountMinor?: number;
}

export interface PaymentSyncContext {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
  readonly orderStatus: OrderState;
  readonly currency: string;
  readonly orderTotalMinor: number;
  readonly existingPayments: readonly PaymentSyncRecord[];
  readonly cashRegisterOpen?: boolean;
  readonly offlineCashLimitMinor?: number | null;
  readonly expectedCashSequenceByDevice?: Readonly<Record<string, number>>;
}

export interface IncomingPaymentSyncEvent extends SyncMergeEventMeta {
  readonly entityId: string;
  readonly orderId: string;
  readonly operation: SyncMergeOperation;
  readonly baseVersion: number | null;
  readonly amountMinor: number;
  readonly tipMinor?: number;
  readonly tenderedAmountMinor?: number | null;
  readonly currency: string;
  readonly method: PaymentMethod;
  readonly isOfflineEvent: boolean;
  readonly cashRegisterId?: string | null;
  readonly cashierId?: string | null;
  readonly cashSequence?: number | null;
  readonly receiptNumber?: string | null;
  readonly providerStatus?: "confirmed" | "pending" | "uncertain" | null;
  readonly cardManualExternalConfirmed?: boolean;
  readonly compensatesPaymentId?: string;
  readonly reason?: string;
  readonly authorization?: SyncSupervisorAuthorization;
}

export interface MergePaymentSyncEventInput {
  readonly entityType?: "Payment";
  readonly context: PaymentSyncContext;
  readonly event: IncomingPaymentSyncEvent;
}

export interface PaymentSyncMergeResult extends SyncMergeResultBase {
  readonly entityType: "Payment";
  readonly blockNewCollection: boolean;
  readonly requiresReconciliation: boolean;
  readonly resultingPaymentState: PaymentSyncRecordState | null;
  readonly changeMinor: number | null;
  readonly remainingObligationMinor: number | null;
  readonly overcollectionMinor: number;
  readonly resultingOrderPaymentStatus: "unpaid" | "partially_paid" | "paid" | "pending" | "ambiguous" | null;
  readonly existingPaymentId: string | null;
}

// ---- CashMovement merge --------------------------------------------------------------------

export interface CashMovementSyncRecord {
  readonly movementId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly localSequence: number;
  readonly type: CashMovementType;
  readonly direction: CashMovementDirection;
  readonly amountMinor: number;
  readonly currency: string;
  readonly source?: CashMovementSource;
  readonly compensatesMovementId?: string;
  readonly reason?: string;
}

export interface CashRegisterSyncState {
  readonly cashRegisterId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly registerId: string;
  readonly shiftId: string;
  readonly cashierId: string;
  readonly currency: string;
  readonly status: CashRegisterState;
  readonly version: number;
  readonly openingFloatMinor: number;
  readonly movements: readonly CashMovementSyncRecord[];
  readonly expectedNextSequenceByDevice: Readonly<Record<string, number>>;
  readonly offlineCashLimitMinor?: number | null;
  readonly closeEventId?: string | null;
  readonly closeIdempotencyKey?: string | null;
  readonly countedClosingBalanceMinor?: number | null;
  readonly closeReason?: string | null;
}

export type CashMovementSyncEventPayload =
  | {
    readonly operation: "create" | "compensate";
    readonly baseVersion: number | null;
    readonly cashRegisterId: string;
    readonly registerId: string;
    readonly shiftId: string;
    readonly cashierId: string;
    readonly localSequence: number;
    readonly type: CashMovementType;
    readonly direction: CashMovementDirection;
    readonly amountMinor: number;
    readonly currency: string;
    readonly isOfflineEvent: boolean;
    readonly source?: CashMovementSource;
    readonly compensatesMovementId?: string;
    readonly reason?: string;
    readonly authorization?: SyncSupervisorAuthorization;
  }
  | {
    readonly operation: "transition";
    readonly baseVersion: number;
    readonly cashRegisterId: string;
    readonly registerId: string;
    readonly shiftId: string;
    readonly cashierId: string;
    readonly targetStatus: CashRegisterState;
    readonly countedClosingBalanceMinor?: number;
    readonly currency: string;
    readonly isOfflineEvent: boolean;
    readonly reason?: string;
    readonly authorization?: SyncSupervisorAuthorization;
  }
  | {
    readonly operation: "delete" | "update";
    readonly baseVersion: number;
    readonly cashRegisterId: string;
    readonly registerId: string;
    readonly shiftId: string;
    readonly cashierId: string;
  };

export interface MergeCashMovementSyncEventInput {
  readonly entityType?: "CashMovement";
  readonly canonical: CashRegisterSyncState;
  readonly event: SyncMergeEventMeta & { readonly entityId: string } & CashMovementSyncEventPayload;
}

export interface CashMovementSyncMergeResult extends SyncMergeResultBase {
  readonly entityType: "CashMovement";
  readonly expectedBalanceMinor: number | null;
  readonly closingDifferenceMinor: number | null;
  readonly mergedState: CashRegisterSyncState | null;
}

// ---- Unified dispatcher types --------------------------------------------------------------

export type SyncMergeInput =
  | (MergeOrderSyncEventInput & { readonly entityType: "Order" })
  | (MergeOrderItemSyncEventInput & { readonly entityType: "OrderItem" })
  | (MergeDiningTableSyncEventInput & { readonly entityType: "DiningTable" })
  | (MergeKdsTicketSyncEventInput & { readonly entityType: "KdsTicket" })
  | (MergePaymentSyncEventInput & { readonly entityType: "Payment" })
  | (MergeCashMovementSyncEventInput & { readonly entityType: "CashMovement" });

export type SyncMergeResult =
  | OrderSyncMergeResult
  | OrderItemSyncMergeResult
  | DiningTableSyncMergeResult
  | KdsTicketSyncMergeResult
  | PaymentSyncMergeResult
  | CashMovementSyncMergeResult;

// ---- Monotonic state rank tables -----------------------------------------------------------

const ORDER_STATES: readonly OrderState[] = ["draft", "open", "partially_paid", "paid", "closed", "cancelled"];
const ORDER_ITEM_STATES: readonly OrderItemState[] = ["pending", "sent", "preparing", "ready", "delivered", "cancelled"];
const ORDER_CHANNELS: readonly OrderChannel[] = ["table", "counter", "takeout", "delivery"];
const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash", "card_manual", "card_terminal", "transfer", "other"];
const PAYMENT_RECORD_STATES: readonly PaymentSyncRecordState[] = [
  "initiated", "authorized", "captured", "failed", "voided", "refunded", "ambiguous",
];
const CASH_MOVEMENT_TYPES: readonly CashMovementType[] = [
  "cash_sale", "tip_in", "cash_refund", "cash_in", "cash_out", "cash_adjustment",
];

const ORDER_FORWARD_RANK: Readonly<Partial<Record<OrderState, number>>> = Object.freeze({
  draft: 0,
  open: 1,
  partially_paid: 2,
  paid: 3,
  closed: 4,
});

const ORDER_ITEM_FORWARD_RANK: Readonly<Partial<Record<OrderItemState, number>>> = Object.freeze({
  pending: 0,
  sent: 1,
  preparing: 2,
  ready: 3,
  delivered: 4,
});

const KDS_TICKET_FORWARD_RANK: Readonly<Partial<Record<KdsTicketSyncStatus, number>>> = Object.freeze({
  sent: 0,
  preparing: 1,
  ready: 2,
  delivered: 3,
});

const ISO_4217_PATTERN = /^[A-Z]{3}$/u;
const RFC3339_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

// ---- Public dispatcher ---------------------------------------------------------------------

/**
 * Pure, deterministic dispatcher for OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §4.2.
 * Never uses LWW for financial or critical state conflicts; never uses `occurredAt`
 * to order events or pick winners; never performs floating-point arithmetic.
 */
export function evaluateSyncMerge(input: SyncMergeInput): SyncMergeResult {
  const record = asPlainRecord(input, "input");
  const entityType = readRequiredString(record, "entityType", "entityType");
  switch (entityType) {
    case "Order":
      return mergeOrderSyncEvent(input as MergeOrderSyncEventInput);
    case "OrderItem":
      return mergeOrderItemSyncEvent(input as MergeOrderItemSyncEventInput);
    case "DiningTable":
      return mergeDiningTableSyncEvent(input as MergeDiningTableSyncEventInput);
    case "KdsTicket":
      return mergeKdsTicketSyncEvent(input as MergeKdsTicketSyncEventInput);
    case "Payment":
      return mergePaymentSyncEvent(input as MergePaymentSyncEventInput);
    case "CashMovement":
      return mergeCashMovementSyncEvent(input as MergeCashMovementSyncEventInput);
    default:
      throw new InvalidSyncMergeInputError("entityType");
  }
}

// ---- Reusable Tombstone merge --------------------------------------------------------------

/**
 * Enforces OFFLINE_SYNC_CONTRACT §10 and MATRIX §4.2 ("Borrado sincronizable"):
 * - Tombstones are forbidden on non-tombstonable entities (e.g. financial records).
 * - Repeated tombstones on an already tombstoned entity are idempotent (`accepted`).
 * - Stale updates/transitions NEVER resurrect a tombstoned entity (`conflict` / `rejected`).
 * - Recreating the same entityId is rejected; semantic identity conflicts escalate to `manual_review`.
 */
export function mergeTombstoneSyncEvent(input: MergeTombstoneSyncEventInput): TombstoneSyncMergeResult {
  const root = asPlainRecord(input, "input");
  const rawCanonical = ownData(root, "canonical", "canonical");
  const rawEvent = asPlainRecord(ownData(root, "event", "event"), "event");

  const entityType = readEnum(rawEvent, "entityType", SYNC_MERGE_ENTITY_TYPES, "event.entityType");
  const entityId = readRequiredString(rawEvent, "entityId", "event.entityId");
  const operation = readEnum(rawEvent, "operation", SYNC_MERGE_OPERATIONS, "event.operation");
  const baseVersion = readBaseVersion(rawEvent, operation, "event.baseVersion");
  const meta = readEventMeta(rawEvent, "event");
  const semanticIdentityConflict = readOptionalBoolean(rawEvent, "semanticIdentityConflict", "event.semanticIdentityConflict") ?? false;

  if (rawCanonical === null) {
    if (operation === "create") {
      if (semanticIdentityConflict) {
        return makeTombstoneResult(entityType, entityId, "manual_review", "TOMBSTONE_SEMANTIC_IDENTITY_CONFLICT", null, false, false, meta, baseVersion);
      }
      return makeTombstoneResult(entityType, entityId, "accepted", "ACCEPTED", 1, false, false, meta, baseVersion);
    }
    return makeTombstoneResult(entityType, entityId, "rejected", "ENTITY_NOT_FOUND", null, false, false, meta, baseVersion);
  }

  const canonical = normalizeTombstoneCanonical(rawCanonical);
  if (canonical.entityType !== entityType || canonical.entityId !== entityId) {
    throw new InvalidSyncMergeInputError("canonical.entity");
  }
  if (!sameScope(canonical, meta)) {
    return makeTombstoneResult(entityType, entityId, "rejected", "SCOPE_MISMATCH", null, false, canonical.tombstoned, meta, baseVersion);
  }

  const fingerprint = `tombstone:${entityType}:${entityId}:${operation}:${String(baseVersion)}:${String(semanticIdentityConflict)}`;
  const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, operation, fingerprint);
  if (dedup !== null) {
    return makeTombstoneResult(entityType, entityId, dedup.status, dedup.code, canonical.version, false, canonical.tombstoned, meta, baseVersion);
  }

  if (operation === "delete" && !canonical.allowTombstone) {
    return makeTombstoneResult(entityType, entityId, "rejected", "TOMBSTONE_NOT_ALLOWED", canonical.version, false, canonical.tombstoned, meta, baseVersion);
  }

  if (canonical.tombstoned) {
    if (operation === "delete") {
      return makeTombstoneResult(entityType, entityId, "accepted", "TOMBSTONE_ALREADY_APPLIED", canonical.version, false, true, meta, baseVersion);
    }
    if (operation === "create") {
      return makeTombstoneResult(entityType, entityId, "rejected", "TOMBSTONE_RECREATION_REQUIRES_NEW_ID", canonical.version, false, true, meta, baseVersion);
    }
    const status: SyncMergeStatus = baseVersion !== null && baseVersion < canonical.version ? "conflict" : "rejected";
    return makeTombstoneResult(entityType, entityId, status, "TOMBSTONE_RESURRECTION_BLOCKED", canonical.version, false, true, meta, baseVersion);
  }

  if (operation === "delete") {
    if (baseVersion !== canonical.version) {
      const status: SyncMergeStatus = baseVersion !== null && baseVersion > canonical.version ? "rejected" : "conflict";
      const code: SyncMergeCode = status === "rejected" ? "INVALID_BASE_VERSION" : "STALE_BASE_VERSION";
      return makeTombstoneResult(entityType, entityId, status, code, canonical.version, false, false, meta, baseVersion);
    }
    return makeTombstoneResult(entityType, entityId, "accepted", "ACCEPTED", canonical.version + 1, false, true, meta, baseVersion);
  }

  if (operation === "create") {
    return makeTombstoneResult(entityType, entityId, "conflict", "STALE_BASE_VERSION", canonical.version, false, false, meta, baseVersion);
  }

  if (baseVersion !== canonical.version) {
    const status: SyncMergeStatus = baseVersion !== null && baseVersion > canonical.version ? "rejected" : "conflict";
    const code: SyncMergeCode = status === "rejected" ? "INVALID_BASE_VERSION" : "STALE_BASE_VERSION";
    return makeTombstoneResult(entityType, entityId, status, code, canonical.version, false, false, meta, baseVersion);
  }
  return makeTombstoneResult(entityType, entityId, "accepted", "ACCEPTED", canonical.version + 1, false, false, meta, baseVersion);
}

// ---- Order merge ---------------------------------------------------------------------------

/**
 * Pure merge rules for `Order` (MATRIX §4.2):
 * - Additive lines with distinct `orderItemId` combine even across concurrent versions,
 *   preserving historical snapshots and recalculating totals in exact minor units.
 * - Concurrent edits of an existing line, competing discounts, terminal-state edits,
 *   post-send cancellation races, and reopening closed/cancelled orders NEVER use LWW:
 *   they return `conflict` or `manual_review` with preserved evidence.
 * - Monotonic transitions accept or deduplicate without ever regressing state.
 */
export function mergeOrderSyncEvent(input: MergeOrderSyncEventInput): OrderSyncMergeResult {
  const root = asPlainRecord(input, "input");
  const rawCanonical = ownData(root, "canonical", "canonical");
  const rawEvent = asPlainRecord(ownData(root, "event", "event"), "event");

  const meta = readEventMeta(rawEvent, "event");
  const entityId = readRequiredString(rawEvent, "entityId", "event.entityId");
  const operation = readEnum(rawEvent, "operation", SYNC_MERGE_OPERATIONS, "event.operation");
  const baseVersion = readBaseVersion(rawEvent, operation, "event.baseVersion");

  if (operation === "delete") {
    const canonical = rawCanonical === null ? null : normalizeOrderCanonical(rawCanonical);
    if (canonical !== null && !sameScope(canonical, meta)) {
      return orderResult(entityId, "rejected", "SCOPE_MISMATCH", null, false, false, null, null, null, meta, baseVersion);
    }
    return orderResult(entityId, "rejected", "TOMBSTONE_NOT_ALLOWED", canonical?.version ?? null, false, false, null, null, null, meta, baseVersion);
  }

  if (operation === "create") {
    return mergeOrderCreate(rawCanonical === null ? null : normalizeOrderCanonical(rawCanonical), rawEvent, entityId, meta);
  }

  if (rawCanonical === null) {
    return orderResult(entityId, "rejected", "ENTITY_NOT_FOUND", null, false, false, null, null, null, meta, baseVersion);
  }

  const canonical = normalizeOrderCanonical(rawCanonical);
  if (canonical.orderId !== entityId) throw new InvalidSyncMergeInputError("event.entityId");
  if (!sameScope(canonical, meta)) {
    return orderResult(entityId, "rejected", "SCOPE_MISMATCH", null, false, false, null, null, null, meta, baseVersion);
  }

  const canonicalTotals = computeOrderTotals(canonical);

  if (operation === "update") {
    return mergeOrderUpdate(canonical, canonicalTotals, rawEvent, meta, baseVersion!);
  }
  if (operation === "transition") {
    return mergeOrderTransition(canonical, canonicalTotals, rawEvent, meta, baseVersion!);
  }
  return mergeOrderCompensate(canonical, canonicalTotals, rawEvent, meta, baseVersion!);
}

function mergeOrderCreate(
  canonical: OrderSyncState | null,
  rawEvent: PlainRecord,
  entityId: string,
  meta: SyncMergeEventMeta,
): OrderSyncMergeResult {
  const channel = readEnum(rawEvent, "channel", ORDER_CHANNELS, "event.channel");
  const tableId = readOptionalString(rawEvent, "tableId", "event.tableId");
  if ((channel === "table") !== (tableId !== undefined)) {
    throw new InvalidSyncMergeInputError("event.tableId");
  }
  const customerId = readOptionalNullableString(rawEvent, "customerId", "event.customerId");
  const currency = readCurrency(rawEvent, "currency", "event.currency");
  const timeZone = readRequiredString(rawEvent, "timeZone", "event.timeZone");
  const rawItems = optionalOwnData(rawEvent, "items", "event.items");
  const itemsInput = rawItems === undefined ? [] : readDataArray(rawItems, "event.items") as readonly OrderItemPricingInput[];
  const orderDiscount = optionalOwnData(rawEvent, "orderDiscount", "event.orderDiscount") as OrderDiscountSnapshot | undefined;
  const tip = optionalOwnData(rawEvent, "tip", "event.tip") as Money | undefined;
  const deliveryCharge = readOptionalDeliveryCharge(rawEvent, "deliveryCharge", currency, "event.deliveryCharge");

  const seenIds = new Set<string>();
  const builtItems: OrderItem[] = [];
  const itemFingerprints: string[] = [];
  for (const itemInput of itemsInput) {
    const calculated = validateLineForOrder(itemInput, currency);
    if (seenIds.has(calculated.input.orderItemId)) {
      return orderResult(entityId, "rejected", "DUPLICATE_ORDER_ITEM_ID", null, false, false, null, null, null, meta, null);
    }
    seenIds.add(calculated.input.orderItemId);
    itemFingerprints.push(linePricingFingerprint(calculated.input));
    builtItems.push(deepFreeze({
      ...calculated.input,
      restaurantId: meta.restaurantId,
      branchId: meta.branchId,
      status: "pending" as const,
    }));
  }

  const discountFp = orderDiscount === undefined ? "" : orderDiscountFingerprint(orderDiscount, "event.orderDiscount");
  const tipFp = tip === undefined ? "" : `${assertValidMoney(tip, "event.tip").amountMinor}:${tip.currency}`;
  const deliveryFp = deliveryCharge === null ? "" : `${deliveryCharge.quoteId}:${deliveryCharge.amount.amountMinor}`;
  const fingerprint = `order:create:${entityId}:${channel}:${tableId ?? ""}:${currency}:${discountFp}:${tipFp}:${deliveryFp}:${itemFingerprints.join("|")}`;
  if (canonical !== null) {
    if (!sameScope(canonical, meta)) {
      return orderResult(entityId, "rejected", "SCOPE_MISMATCH", null, false, false, null, null, null, meta, null);
    }
    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "create", fingerprint);
    if (dedup !== null) {
      const existingTotals = computeOrderTotals(canonical);
      return orderResult(entityId, dedup.status, dedup.code, canonical.version, false, false, dedup.status === "duplicate" ? canonical : null, dedup.status === "duplicate" ? existingTotals.totals : null, dedup.status === "duplicate" ? existingTotals.payable : null, meta, null);
    }
    return orderResult(entityId, "conflict", "ORDER_ALREADY_EXISTS", canonical.version, false, true, null, null, null, meta, null);
  }

  const created: OrderSyncState = deepFreeze({
    orderId: entityId,
    restaurantId: meta.restaurantId,
    branchId: meta.branchId,
    channel,
    ...(tableId === undefined ? {} : { tableId }),
    ...(customerId === undefined ? {} : { customerId }),
    currency,
    timeZone,
    status: "draft" as const,
    version: 1,
    items: builtItems,
    ...(orderDiscount === undefined ? {} : { orderDiscount }),
    ...(tip === undefined ? {} : { tip }),
    deliveryCharge,
    capturedAmountMinor: 0,
    appliedEvents: [appliedEvent(meta, entityId, "create", fingerprint, 1)],
  });

  const computed = safeComputeOrderTotals(created);
  if (!computed.ok) {
    return orderResult(entityId, "rejected", computed.code, null, true, false, null, null, null, meta, null);
  }
  return orderResult(entityId, "accepted", "ACCEPTED", 1, false, false, created, computed.totals, computed.payable, meta, null);
}

function mergeOrderUpdate(
  canonical: OrderSyncState,
  canonicalTotals: { readonly totals: CalculatedOrderTotals; readonly payable: Money },
  rawEvent: PlainRecord,
  meta: SyncMergeEventMeta,
  baseVersion: number,
): OrderSyncMergeResult {
  const kind = readEnum(rawEvent, "kind", ["add_items", "modify_item", "apply_discount", "update_metadata"] as const, "event.kind");

  if (kind === "add_items") {
    const rawItems = readDataArray(ownData(rawEvent, "items", "event.items"), "event.items");
    if (rawItems.length === 0) throw new InvalidSyncMergeInputError("event.items");
    const itemsInput = rawItems as readonly OrderItemPricingInput[];
    const incomingIds = itemsInput.map(readItemIdUnsafe);
    const fingerprint = `order:add_items:${canonical.orderId}:${incomingIds.join(",")}:${itemsInput.map(linePricingFingerprint).join("|")}`;
    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, canonical.orderId, "update", fingerprint);
    if (dedup !== null) {
      return orderResult(
        canonical.orderId, dedup.status, dedup.code, canonical.version, false, false,
        dedup.status === "duplicate" ? canonical : null,
        dedup.status === "duplicate" ? canonicalTotals.totals : null,
        dedup.status === "duplicate" ? canonicalTotals.payable : null,
        meta, baseVersion,
      );
    }

    if (baseVersion > canonical.version) {
      return orderResult(canonical.orderId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, false, null, null, null, meta, baseVersion);
    }

    if (!orderAcceptsNewLines(canonical.status)) {
      const financial = canonical.status === "paid" || canonical.status === "closed" || (canonical.capturedAmountMinor ?? 0) > 0;
      if (baseVersion < canonical.version) {
        return orderResult(canonical.orderId, "conflict", "ORDER_DOES_NOT_ACCEPT_NEW_LINES", canonical.version, financial, true, null, null, null, meta, baseVersion);
      }
      return orderResult(canonical.orderId, "rejected", "ORDER_DOES_NOT_ACCEPT_NEW_LINES", canonical.version, financial, false, null, null, null, meta, baseVersion);
    }

    const existingIds = new Set(canonical.items.map((item) => item.orderItemId));
    const batchIds = new Set<string>();
    const newItems: OrderItem[] = [];
    for (const itemInput of itemsInput) {
      const calculated = validateLineForOrder(itemInput, canonical.currency);
      const id = calculated.input.orderItemId;
      if (batchIds.has(id)) {
        return orderResult(canonical.orderId, "rejected", "DUPLICATE_ORDER_ITEM_ID", canonical.version, false, false, null, null, null, meta, baseVersion);
      }
      batchIds.add(id);
      if (existingIds.has(id)) {
        return orderResult(canonical.orderId, "conflict", "CONCURRENT_ORDER_ITEM_MODIFICATION", canonical.version, true, true, null, null, null, meta, baseVersion);
      }
      newItems.push(deepFreeze({
        ...calculated.input,
        restaurantId: canonical.restaurantId,
        branchId: canonical.branchId,
        status: "pending" as const,
      }));
    }

    const nextVersion = canonical.version + 1;
    const merged: OrderSyncState = deepFreeze({
      ...canonical,
      version: nextVersion,
      items: [...canonical.items, ...newItems],
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, canonical.orderId, "update", fingerprint, nextVersion)],
    });
    const computed = safeComputeOrderTotals(merged);
    if (!computed.ok) {
      return orderResult(canonical.orderId, "rejected", computed.code, canonical.version, true, false, null, null, null, meta, baseVersion);
    }
    const code: SyncMergeCode = baseVersion < canonical.version ? "ADDITIVE_LINES_MERGED" : "ACCEPTED";
    return orderResult(canonical.orderId, "accepted", code, nextVersion, false, false, merged, computed.totals, computed.payable, meta, baseVersion);
  }

  if (kind === "modify_item") {
    const rawItem = ownData(rawEvent, "item", "event.item") as OrderItemPricingInput;
    const customerId = readOptionalNullableString(rawEvent, "customerId", "event.customerId");
    const calculated = validateLineForOrder(rawItem, canonical.currency);
    const fingerprint = `order:modify_item:${canonical.orderId}:${linePricingFingerprint(calculated.input)}:${customerId ?? ""}`;
    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, canonical.orderId, "update", fingerprint);
    if (dedup !== null) {
      return orderResult(
        canonical.orderId, dedup.status, dedup.code, canonical.version, false, false,
        dedup.status === "duplicate" ? canonical : null,
        dedup.status === "duplicate" ? canonicalTotals.totals : null,
        dedup.status === "duplicate" ? canonicalTotals.payable : null,
        meta, baseVersion,
      );
    }

    if (baseVersion > canonical.version) {
      return orderResult(canonical.orderId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, false, null, null, null, meta, baseVersion);
    }
    if (canonical.status === "paid" || canonical.status === "closed" || canonical.status === "cancelled") {
      return orderResult(canonical.orderId, "manual_review", "HISTORICAL_ORDER_IMMUTABLE", canonical.version, true, true, null, null, null, meta, baseVersion, canonicalTotals.payable.amountMinor, canonical.currency);
    }

    const existing = canonical.items.find((entry) => entry.orderItemId === calculated.input.orderItemId);
    if (existing === undefined) {
      return orderResult(canonical.orderId, "rejected", "ORDER_ITEM_NOT_FOUND", canonical.version, false, false, null, null, null, meta, baseVersion);
    }
    if (existing.status !== "pending") {
      return orderResult(canonical.orderId, "conflict", "POST_SEND_LINE_MODIFICATION_CONFLICT", canonical.version, true, true, null, null, null, meta, baseVersion, calculated.total.amountMinor, canonical.currency);
    }
    if (baseVersion !== canonical.version) {
      return orderResult(canonical.orderId, "conflict", "CONCURRENT_ORDER_ITEM_MODIFICATION", canonical.version, true, true, null, null, null, meta, baseVersion, calculated.total.amountMinor, canonical.currency);
    }
    if (!sameSnapshotUnitPrices(existing.snapshot, calculated.input.snapshot)) {
      return orderResult(canonical.orderId, "manual_review", "ARBITRARY_PRICE_OVERRIDE_BLOCKED", canonical.version, true, true, null, null, null, meta, baseVersion, calculated.total.amountMinor, canonical.currency);
    }

    const nextVersion = canonical.version + 1;
    const updatedItem: OrderItem = deepFreeze({
      ...calculated.input,
      restaurantId: canonical.restaurantId,
      branchId: canonical.branchId,
      status: existing.status,
    });
    const merged: OrderSyncState = deepFreeze({
      ...canonical,
      ...(customerId === undefined ? {} : { customerId }),
      version: nextVersion,
      items: canonical.items.map((entry) => (entry.orderItemId === updatedItem.orderItemId ? updatedItem : entry)),
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, canonical.orderId, "update", fingerprint, nextVersion)],
    });
    const computed = safeComputeOrderTotals(merged);
    if (!computed.ok) {
      return orderResult(canonical.orderId, "rejected", computed.code, canonical.version, true, false, null, null, null, meta, baseVersion);
    }
    return orderResult(canonical.orderId, "accepted", "ACCEPTED", nextVersion, false, false, merged, computed.totals, computed.payable, meta, baseVersion);
  }

  if (kind === "apply_discount") {
    const orderDiscount = ownData(rawEvent, "orderDiscount", "event.orderDiscount") as OrderDiscountSnapshot;
    const requiresSupervisor = readOptionalBoolean(rawEvent, "requiresSupervisor", "event.requiresSupervisor") ?? false;
    const allowStacking = readOptionalBoolean(rawEvent, "allowStacking", "event.allowStacking") ?? false;
    const authorization = readOptionalAuthorization(rawEvent, "authorization", "event.authorization");
    const reason = readOptionalString(rawEvent, "reason", "event.reason");
    const discountAmount = readMoneyAmountMinor(orderDiscount, "event.orderDiscount");
    const discountFp = orderDiscountFingerprint(orderDiscount, "event.orderDiscount");
    const fingerprint = `order:discount:${canonical.orderId}:${discountFp}:${reason ?? ""}`;

    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, canonical.orderId, "update", fingerprint);
    if (dedup !== null) {
      return orderResult(
        canonical.orderId, dedup.status, dedup.code, canonical.version, true, false,
        dedup.status === "duplicate" ? canonical : null,
        dedup.status === "duplicate" ? canonicalTotals.totals : null,
        dedup.status === "duplicate" ? canonicalTotals.payable : null,
        meta, baseVersion,
      );
    }
    if (baseVersion > canonical.version) {
      return orderResult(canonical.orderId, "rejected", "INVALID_BASE_VERSION", canonical.version, true, false, null, null, null, meta, baseVersion);
    }
    if (canonical.status === "paid" || canonical.status === "closed" || canonical.status === "cancelled") {
      return orderResult(canonical.orderId, "manual_review", "HISTORICAL_ORDER_IMMUTABLE", canonical.version, true, true, null, null, null, meta, baseVersion, discountAmount, canonical.currency);
    }
    if (requiresSupervisor && authorization === undefined) {
      return orderResult(canonical.orderId, "rejected", "SUPERVISOR_AUTHORIZATION_REQUIRED", canonical.version, true, false, null, null, null, meta, baseVersion, discountAmount, canonical.currency);
    }
    if (canonical.orderDiscount !== undefined && (baseVersion !== canonical.version || !allowStacking)) {
      return orderResult(canonical.orderId, "manual_review", "CONCURRENT_DISCOUNT_CONFLICT", canonical.version, true, true, null, null, null, meta, baseVersion, discountAmount, canonical.currency);
    }
    if (baseVersion !== canonical.version) {
      return orderResult(canonical.orderId, "conflict", "CONCURRENT_ORDER_UPDATE", canonical.version, true, true, null, null, null, meta, baseVersion, discountAmount, canonical.currency);
    }

    const nextVersion = canonical.version + 1;
    const merged: OrderSyncState = deepFreeze({
      ...canonical,
      version: nextVersion,
      orderDiscount,
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, canonical.orderId, "update", fingerprint, nextVersion)],
    });
    const computed = safeComputeOrderTotals(merged);
    if (!computed.ok) {
      return orderResult(canonical.orderId, "rejected", computed.code, canonical.version, true, false, null, null, null, meta, baseVersion, discountAmount, canonical.currency);
    }
    return orderResult(canonical.orderId, "accepted", "ACCEPTED", nextVersion, true, false, merged, computed.totals, computed.payable, meta, baseVersion);
  }

  // update_metadata
  const customerId = readOptionalNullableString(rawEvent, "customerId", "event.customerId");
  const tableId = readOptionalString(rawEvent, "tableId", "event.tableId");
  const tip = optionalOwnData(rawEvent, "tip", "event.tip") as Money | undefined;
  const tipMinor = tip === undefined ? "" : String(assertValidMoney(tip, "event.tip").amountMinor);
  const fingerprint = `order:metadata:${canonical.orderId}:${customerId ?? ""}:${tableId ?? ""}:${tipMinor}`;

  const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, canonical.orderId, "update", fingerprint);
  if (dedup !== null) {
    return orderResult(
      canonical.orderId, dedup.status, dedup.code, canonical.version, false, false,
      dedup.status === "duplicate" ? canonical : null,
      dedup.status === "duplicate" ? canonicalTotals.totals : null,
      dedup.status === "duplicate" ? canonicalTotals.payable : null,
      meta, baseVersion,
    );
  }
  if (baseVersion > canonical.version) {
    return orderResult(canonical.orderId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, false, null, null, null, meta, baseVersion);
  }
  if (canonical.status === "paid" || canonical.status === "closed" || canonical.status === "cancelled") {
    return orderResult(canonical.orderId, "manual_review", "HISTORICAL_ORDER_IMMUTABLE", canonical.version, true, true, null, null, null, meta, baseVersion, canonicalTotals.payable.amountMinor, canonical.currency);
  }
  if (baseVersion !== canonical.version) {
    return orderResult(canonical.orderId, "conflict", "CONCURRENT_ORDER_UPDATE", canonical.version, false, true, null, null, null, meta, baseVersion);
  }
  if (tableId !== undefined && canonical.channel !== "table") {
    throw new InvalidSyncMergeInputError("event.tableId");
  }

  const nextVersion = canonical.version + 1;
  const merged: OrderSyncState = deepFreeze({
    ...canonical,
    ...(customerId === undefined ? {} : { customerId }),
    ...(tableId === undefined ? {} : { tableId }),
    ...(tip === undefined ? {} : { tip }),
    version: nextVersion,
    appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, canonical.orderId, "update", fingerprint, nextVersion)],
  });
  const computed = safeComputeOrderTotals(merged);
  if (!computed.ok) {
    return orderResult(canonical.orderId, "rejected", computed.code, canonical.version, true, false, null, null, null, meta, baseVersion);
  }
  return orderResult(canonical.orderId, "accepted", "ACCEPTED", nextVersion, false, false, merged, computed.totals, computed.payable, meta, baseVersion);
}

function mergeOrderTransition(
  canonical: OrderSyncState,
  canonicalTotals: { readonly totals: CalculatedOrderTotals; readonly payable: Money },
  rawEvent: PlainRecord,
  meta: SyncMergeEventMeta,
  baseVersion: number,
): OrderSyncMergeResult {
  const targetStatus = readEnum(rawEvent, "targetStatus", ORDER_STATES, "event.targetStatus");
  const refundObligation = readOptionalEnum(rawEvent, "refundObligation", ["none", "pending"] as const, "event.refundObligation");
  const reason = readOptionalString(rawEvent, "reason", "event.reason");
  const authorization = readOptionalAuthorization(rawEvent, "authorization", "event.authorization");
  const fingerprint = `order:transition:${canonical.orderId}:${targetStatus}:${refundObligation ?? ""}:${reason ?? ""}`;

  const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, canonical.orderId, "transition", fingerprint);
  if (dedup !== null) {
    return orderResult(
      canonical.orderId, dedup.status, dedup.code, canonical.version, false, false,
      dedup.status === "duplicate" ? canonical : null,
      dedup.status === "duplicate" ? canonicalTotals.totals : null,
      dedup.status === "duplicate" ? canonicalTotals.payable : null,
      meta, baseVersion,
    );
  }

  if (baseVersion > canonical.version) {
    return orderResult(canonical.orderId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, false, null, null, null, meta, baseVersion);
  }

  const financial = canonical.status === "partially_paid"
    || canonical.status === "paid"
    || canonical.status === "closed"
    || targetStatus === "partially_paid"
    || targetStatus === "paid"
    || targetStatus === "closed"
    || (canonical.capturedAmountMinor ?? 0) > 0;

  if (canonical.status === targetStatus) {
    return orderResult(canonical.orderId, "duplicate", "ALREADY_IN_TARGET_STATE", canonical.version, financial, false, canonical, canonicalTotals.totals, canonicalTotals.payable, meta, baseVersion);
  }

  // Reopening a closed or cancelled order is never resolved by LWW.
  if (canonical.status === "closed" || canonical.status === "cancelled") {
    const code: SyncMergeCode = targetStatus === "cancelled" && canonical.status === "closed"
      ? "ORDER_ALREADY_CLOSED"
      : "ORDER_REOPEN_CONFLICT";
    return orderResult(canonical.orderId, "conflict", code, canonical.version, financial, true, null, null, null, meta, baseVersion, canonicalTotals.payable.amountMinor, canonical.currency);
  }

  if (targetStatus === "cancelled") {
    if (canonical.items.some((item) => item.status === "delivered")) {
      return orderResult(canonical.orderId, "conflict", "ORDER_CANCELLATION_DELIVERED_ITEMS", canonical.version, financial, true, null, null, null, meta, baseVersion, canonicalTotals.payable.amountMinor, canonical.currency);
    }
    const hasPostSendActiveItems = canonical.items.some((item) => item.status === "sent" || item.status === "preparing" || item.status === "ready");
    if (hasPostSendActiveItems) {
      return orderResult(canonical.orderId, "conflict", "POST_SEND_CANCELLATION_CONFLICT", canonical.version, financial, true, null, null, null, meta, baseVersion, canonicalTotals.payable.amountMinor, canonical.currency);
    }
    if (baseVersion < canonical.version) {
      return orderResult(canonical.orderId, "conflict", "ORDER_CANCELLATION_CONFLICT", canonical.version, financial, true, null, null, null, meta, baseVersion, canonicalTotals.payable.amountMinor, canonical.currency);
    }
    if (reason === undefined) {
      return orderResult(canonical.orderId, "rejected", "REASON_REQUIRED", canonical.version, financial, false, null, null, null, meta, baseVersion);
    }
    if (authorization === undefined) {
      return orderResult(canonical.orderId, "rejected", "SUPERVISOR_AUTHORIZATION_REQUIRED", canonical.version, financial, false, null, null, null, meta, baseVersion);
    }
    if ((canonical.status === "partially_paid" || canonical.status === "paid" || (canonical.capturedAmountMinor ?? 0) > 0) && refundObligation !== "pending") {
      return orderResult(canonical.orderId, "manual_review", "REFUND_OBLIGATION_REQUIRED", canonical.version, true, true, null, null, null, meta, baseVersion, canonical.capturedAmountMinor ?? canonicalTotals.payable.amountMinor, canonical.currency);
    }

    transitionOrder(canonical.status, "cancelled", {
      ...(refundObligation === undefined ? {} : { refundObligation }),
      reason,
    });
    const nextVersion = canonical.version + 1;
    const cancelledItems = canonical.items.map((item) => (
      item.status === "pending"
        ? deepFreeze({
          ...item,
          status: "cancelled" as const,
          cancellationAudit: deepFreeze({
            eventId: meta.eventId,
            idempotencyKey: meta.idempotencyKey,
            from: "pending" as const,
            actorId: meta.actorId,
            branchId: meta.branchId,
            deviceId: meta.deviceId,
            occurredAt: meta.occurredAt,
            reason,
            authorization,
          }),
        })
        : item
    ));
    const merged: OrderSyncState = deepFreeze({
      ...canonical,
      status: "cancelled" as const,
      version: nextVersion,
      items: cancelledItems,
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, canonical.orderId, "transition", fingerprint, nextVersion)],
    });
    const computed = computeOrderTotals(merged);
    return orderResult(canonical.orderId, "accepted", "ACCEPTED", nextVersion, financial, false, merged, computed.totals, computed.payable, meta, baseVersion);
  }

  // Forward monotonic progression check (never regress state).
  const currentRank = ORDER_FORWARD_RANK[canonical.status];
  const targetRank = ORDER_FORWARD_RANK[targetStatus];
  if (currentRank !== undefined && targetRank !== undefined && targetRank < currentRank) {
    if (baseVersion < canonical.version) {
      return orderResult(canonical.orderId, "duplicate", "STATE_ALREADY_SURPASSED", canonical.version, financial, false, canonical, canonicalTotals.totals, canonicalTotals.payable, meta, baseVersion);
    }
    return orderResult(canonical.orderId, "rejected", "INVALID_BACKWARD_TRANSITION", canonical.version, financial, false, null, null, null, meta, baseVersion);
  }

  try {
    transitionOrder(canonical.status, targetStatus, {});
  } catch {
    return orderResult(canonical.orderId, "rejected", "INVALID_STATE_TRANSITION", canonical.version, financial, false, null, null, null, meta, baseVersion);
  }

  if (targetStatus === "closed") {
    const incomplete = canonical.items.some((item) => item.status !== "delivered" && item.status !== "cancelled");
    if (incomplete) {
      if (baseVersion < canonical.version) {
        return orderResult(canonical.orderId, "conflict", "ORDER_CLOSURE_REQUIRES_ITEM_COMPLETION", canonical.version, true, true, null, null, null, meta, baseVersion);
      }
      return orderResult(canonical.orderId, "rejected", "ORDER_CLOSURE_REQUIRES_ITEM_COMPLETION", canonical.version, true, false, null, null, null, meta, baseVersion);
    }
  }

  const nextVersion = canonical.version + 1;
  const merged: OrderSyncState = deepFreeze({
    ...canonical,
    status: targetStatus,
    version: nextVersion,
    appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, canonical.orderId, "transition", fingerprint, nextVersion)],
  });
  return orderResult(canonical.orderId, "accepted", "ACCEPTED", nextVersion, financial, false, merged, canonicalTotals.totals, canonicalTotals.payable, meta, baseVersion);
}

function mergeOrderCompensate(
  canonical: OrderSyncState,
  canonicalTotals: { readonly totals: CalculatedOrderTotals; readonly payable: Money },
  rawEvent: PlainRecord,
  meta: SyncMergeEventMeta,
  baseVersion: number,
): OrderSyncMergeResult {
  const reason = readOptionalString(rawEvent, "reason", "event.reason");
  const authorization = readOptionalAuthorization(rawEvent, "authorization", "event.authorization");
  const fingerprint = `order:compensate:${canonical.orderId}:${reason ?? ""}`;
  const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, canonical.orderId, "compensate", fingerprint);
  if (dedup !== null) {
    return orderResult(
      canonical.orderId, dedup.status, dedup.code, canonical.version, true, false,
      dedup.status === "duplicate" ? canonical : null,
      dedup.status === "duplicate" ? canonicalTotals.totals : null,
      dedup.status === "duplicate" ? canonicalTotals.payable : null,
      meta, baseVersion,
    );
  }
  if (reason === undefined) {
    return orderResult(canonical.orderId, "rejected", "REASON_REQUIRED", canonical.version, true, false, null, null, null, meta, baseVersion);
  }
  if (authorization === undefined) {
    return orderResult(canonical.orderId, "rejected", "SUPERVISOR_AUTHORIZATION_REQUIRED", canonical.version, true, false, null, null, null, meta, baseVersion);
  }
  if (baseVersion !== canonical.version) {
    const status: SyncMergeStatus = baseVersion > canonical.version ? "rejected" : "conflict";
    const code: SyncMergeCode = status === "rejected" ? "INVALID_BASE_VERSION" : "STALE_BASE_VERSION";
    return orderResult(canonical.orderId, status, code, canonical.version, true, status === "conflict", null, null, null, meta, baseVersion);
  }
  const nextVersion = canonical.version + 1;
  const merged: OrderSyncState = deepFreeze({
    ...canonical,
    version: nextVersion,
    appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, canonical.orderId, "compensate", fingerprint, nextVersion)],
  });
  return orderResult(canonical.orderId, "accepted", "ACCEPTED", nextVersion, true, false, merged, canonicalTotals.totals, canonicalTotals.payable, meta, baseVersion);
}

// ---- OrderItem merge -----------------------------------------------------------------------

/**
 * Pure merge rules for `OrderItem` (MATRIX §4.2):
 * - Concurrent edits of the same line return `conflict` (requiring manual review), never LWW.
 * - Monotonic forward transitions (`pending -> sent -> preparing -> ready -> delivered`) accept
 *   or deduplicate without ever regressing state.
 * - Post-send cancellation or cancel vs prepare/deliver conflicts NEVER merge silently.
 * - Tombstones are idempotent and block resurrection from stale updates.
 */
export function mergeOrderItemSyncEvent(input: MergeOrderItemSyncEventInput): OrderItemSyncMergeResult {
  const root = asPlainRecord(input, "input");
  const rawCanonical = ownData(root, "canonical", "canonical");
  const parentOrderStatus = readEnum(root, "parentOrderStatus", ORDER_STATES, "parentOrderStatus");
  const orderCurrency = readCurrency(root, "orderCurrency", "orderCurrency");
  const rawEvent = asPlainRecord(ownData(root, "event", "event"), "event");

  const meta = readEventMeta(rawEvent, "event");
  const entityId = readRequiredString(rawEvent, "entityId", "event.entityId");
  const orderId = readRequiredString(rawEvent, "orderId", "event.orderId");
  const operation = readEnum(rawEvent, "operation", SYNC_MERGE_OPERATIONS, "event.operation");
  const baseVersion = readBaseVersion(rawEvent, operation, "event.baseVersion");

  const canonical = rawCanonical === null ? null : normalizeOrderItemCanonical(rawCanonical, orderCurrency);
  if (canonical !== null) {
    if (canonical.orderItemId !== entityId || canonical.orderId !== orderId) {
      throw new InvalidSyncMergeInputError("canonical.orderItem");
    }
    if (!sameScope(canonical, meta)) {
      return orderItemResult(entityId, "rejected", "SCOPE_MISMATCH", null, false, false, canonical.tombstoned, null, null, meta, baseVersion);
    }
  }

  if (operation === "create") {
    const rawItem = ownData(rawEvent, "item", "event.item") as OrderItemPricingInput;
    const semanticIdentityConflict = readOptionalBoolean(rawEvent, "semanticIdentityConflict", "event.semanticIdentityConflict") ?? false;
    const calculated = validateLineForOrder(rawItem, orderCurrency);
    if (calculated.input.orderItemId !== entityId) throw new InvalidSyncMergeInputError("event.item.orderItemId");
    const fingerprint = `order_item:create:${orderId}:${linePricingFingerprint(calculated.input)}`;

    if (canonical !== null) {
      const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "create", fingerprint);
      if (dedup !== null) {
        const currentCalc = calculateOrderItemTotals(canonical.item);
        return orderItemResult(entityId, dedup.status, dedup.code, canonical.version, false, false, canonical.tombstoned, dedup.status === "duplicate" ? canonical : null, dedup.status === "duplicate" ? currentCalc : null, meta, null);
      }
      if (canonical.tombstoned) {
        return orderItemResult(entityId, "rejected", "TOMBSTONE_RECREATION_REQUIRES_NEW_ID", canonical.version, false, false, true, null, null, meta, null);
      }
      return orderItemResult(entityId, "conflict", "CONCURRENT_ORDER_ITEM_MODIFICATION", canonical.version, true, true, false, null, null, meta, null, calculated.total.amountMinor, orderCurrency);
    }

    if (semanticIdentityConflict) {
      return orderItemResult(entityId, "manual_review", "TOMBSTONE_SEMANTIC_IDENTITY_CONFLICT", null, false, true, false, null, null, meta, null);
    }
    if (!orderAcceptsNewLines(parentOrderStatus)) {
      const financial = parentOrderStatus === "paid" || parentOrderStatus === "closed";
      return orderItemResult(entityId, "conflict", "ORDER_DOES_NOT_ACCEPT_NEW_LINES", null, financial, true, false, null, null, meta, null, calculated.total.amountMinor, orderCurrency);
    }

    const created: OrderItemSyncState = deepFreeze({
      orderItemId: entityId,
      orderId,
      restaurantId: meta.restaurantId,
      branchId: meta.branchId,
      version: 1,
      status: "pending" as const,
      item: calculated.input,
      tombstoned: false,
      appliedEvents: [appliedEvent(meta, entityId, "create", fingerprint, 1)],
    });
    return orderItemResult(entityId, "accepted", "ACCEPTED", 1, false, false, false, created, calculated, meta, null);
  }

  if (canonical === null) {
    return orderItemResult(entityId, "rejected", "ENTITY_NOT_FOUND", null, false, false, false, null, null, meta, baseVersion);
  }

  const canonicalCalc = calculateOrderItemTotals(canonical.item);

  // Tombstone enforcement before mutating a deleted item.
  if (canonical.tombstoned) {
    const reason = operation === "delete" ? readOptionalString(rawEvent, "reason", "event.reason") : undefined;
    const tombstoneFp = operation === "delete"
      ? `order_item:delete:${entityId}:${reason ?? ""}`
      : `order_item:${operation}:${entityId}:${String(baseVersion)}`;
    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, operation, tombstoneFp);
    if (dedup !== null) {
      return orderItemResult(entityId, dedup.status, dedup.code, canonical.version, false, false, true, dedup.status === "duplicate" ? canonical : null, null, meta, baseVersion);
    }
    if (operation === "delete") {
      return orderItemResult(entityId, "accepted", "TOMBSTONE_ALREADY_APPLIED", canonical.version, false, false, true, canonical, null, meta, baseVersion);
    }
    const status: SyncMergeStatus = baseVersion !== null && baseVersion < canonical.version ? "conflict" : "rejected";
    return orderItemResult(entityId, status, "TOMBSTONE_RESURRECTION_BLOCKED", canonical.version, false, status === "conflict", true, null, null, meta, baseVersion);
  }

  if (operation === "delete") {
    const reason = readOptionalString(rawEvent, "reason", "event.reason");
    const fingerprint = `order_item:delete:${entityId}:${reason ?? ""}`;
    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "delete", fingerprint);
    if (dedup !== null) {
      return orderItemResult(entityId, dedup.status, dedup.code, canonical.version, false, false, canonical.tombstoned, dedup.status === "duplicate" ? canonical : null, null, meta, baseVersion);
    }
    if (baseVersion! > canonical.version) {
      return orderItemResult(entityId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, false, false, null, null, meta, baseVersion);
    }
    if (canonical.status !== "pending") {
      return orderItemResult(entityId, "conflict", "POST_SEND_DELETE_FORBIDDEN", canonical.version, true, true, false, null, null, meta, baseVersion, canonicalCalc.total.amountMinor, orderCurrency);
    }
    if (parentOrderStatus === "paid" || parentOrderStatus === "closed" || parentOrderStatus === "cancelled") {
      return orderItemResult(entityId, "manual_review", "HISTORICAL_ORDER_IMMUTABLE", canonical.version, true, true, false, null, null, meta, baseVersion, canonicalCalc.total.amountMinor, orderCurrency);
    }
    if (baseVersion !== canonical.version) {
      return orderItemResult(entityId, "conflict", "STALE_BASE_VERSION", canonical.version, false, true, false, null, null, meta, baseVersion);
    }
    const nextVersion = canonical.version + 1;
    const tombstonedState: OrderItemSyncState = deepFreeze({
      ...canonical,
      version: nextVersion,
      tombstoned: true,
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "delete", fingerprint, nextVersion)],
    });
    return orderItemResult(entityId, "accepted", "ACCEPTED", nextVersion, false, false, true, tombstonedState, null, meta, baseVersion);
  }

  if (operation === "update") {
    const rawItem = ownData(rawEvent, "item", "event.item") as OrderItemPricingInput;
    const customerId = readOptionalNullableString(rawEvent, "customerId", "event.customerId");
    const calculated = validateLineForOrder(rawItem, orderCurrency);
    if (calculated.input.orderItemId !== entityId) throw new InvalidSyncMergeInputError("event.item.orderItemId");
    const fingerprint = `order_item:update:${entityId}:${linePricingFingerprint(calculated.input)}:${customerId ?? ""}`;
    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "update", fingerprint);
    if (dedup !== null) {
      return orderItemResult(entityId, dedup.status, dedup.code, canonical.version, false, false, false, dedup.status === "duplicate" ? canonical : null, dedup.status === "duplicate" ? canonicalCalc : null, meta, baseVersion);
    }
    if (baseVersion! > canonical.version) {
      return orderItemResult(entityId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, false, false, null, null, meta, baseVersion);
    }
    if (parentOrderStatus === "paid" || parentOrderStatus === "closed" || parentOrderStatus === "cancelled") {
      return orderItemResult(entityId, "manual_review", "HISTORICAL_ORDER_IMMUTABLE", canonical.version, true, true, false, null, null, meta, baseVersion, calculated.total.amountMinor, orderCurrency);
    }
    if (canonical.status !== "pending") {
      return orderItemResult(entityId, "conflict", "POST_SEND_LINE_MODIFICATION_CONFLICT", canonical.version, true, true, false, null, null, meta, baseVersion, calculated.total.amountMinor, orderCurrency);
    }
    if (baseVersion !== canonical.version) {
      return orderItemResult(entityId, "conflict", "CONCURRENT_ORDER_ITEM_MODIFICATION", canonical.version, true, true, false, null, null, meta, baseVersion, calculated.total.amountMinor, orderCurrency);
    }
    if (!sameSnapshotUnitPrices(canonical.item.snapshot, calculated.input.snapshot)) {
      return orderItemResult(entityId, "manual_review", "ARBITRARY_PRICE_OVERRIDE_BLOCKED", canonical.version, true, true, false, null, null, meta, baseVersion, calculated.total.amountMinor, orderCurrency);
    }
    const nextVersion = canonical.version + 1;
    const merged: OrderItemSyncState = deepFreeze({
      ...canonical,
      version: nextVersion,
      item: calculated.input,
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "update", fingerprint, nextVersion)],
    });
    return orderItemResult(entityId, "accepted", "ACCEPTED", nextVersion, false, false, false, merged, calculated, meta, baseVersion);
  }

  if (operation === "transition") {
    const targetStatus = readEnum(rawEvent, "targetStatus", ORDER_ITEM_STATES, "event.targetStatus");
    const reason = readOptionalString(rawEvent, "reason", "event.reason");
    const authorization = readOptionalAuthorization(rawEvent, "authorization", "event.authorization");
    const kdsEvidenceVerified = readOptionalBoolean(rawEvent, "kdsEvidenceVerified", "event.kdsEvidenceVerified") ?? false;
    const fingerprint = `order_item:transition:${entityId}:${targetStatus}:${reason ?? ""}`;

    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "transition", fingerprint);
    if (dedup !== null) {
      return orderItemResult(entityId, dedup.status, dedup.code, canonical.version, false, false, false, dedup.status === "duplicate" ? canonical : null, dedup.status === "duplicate" ? canonicalCalc : null, meta, baseVersion);
    }
    if (baseVersion! > canonical.version) {
      return orderItemResult(entityId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, false, false, null, null, meta, baseVersion);
    }
    if (parentOrderStatus === "closed" || parentOrderStatus === "cancelled") {
      return orderItemResult(entityId, "conflict", "ORDER_TERMINAL_STATE_CONFLICT", canonical.version, true, true, false, null, null, meta, baseVersion, canonicalCalc.total.amountMinor, orderCurrency);
    }

    if (canonical.status === targetStatus) {
      return orderItemResult(entityId, "duplicate", "ALREADY_IN_TARGET_STATE", canonical.version, false, false, false, canonical, canonicalCalc, meta, baseVersion);
    }

    // Cancel vs prepare/deliver conflict (already cancelled item cannot advance).
    if (canonical.status === "cancelled") {
      return orderItemResult(entityId, "conflict", "CANCEL_VS_PROGRESS_CONFLICT", canonical.version, false, true, false, null, null, meta, baseVersion);
    }

    // Incoming cancellation.
    if (targetStatus === "cancelled") {
      if (canonical.status === "delivered") {
        return orderItemResult(entityId, "conflict", "CANCEL_AFTER_DELIVERY_CONFLICT", canonical.version, true, true, false, null, null, meta, baseVersion, canonicalCalc.total.amountMinor, orderCurrency);
      }
      const isPostSend = canonical.status === "sent" || canonical.status === "preparing" || canonical.status === "ready";
      if (isPostSend) {
        if (baseVersion! < canonical.version || !kdsEvidenceVerified || authorization === undefined || reason === undefined) {
          return orderItemResult(entityId, "conflict", "POST_SEND_CANCELLATION_CONFLICT", canonical.version, true, true, false, null, null, meta, baseVersion, canonicalCalc.total.amountMinor, orderCurrency);
        }
        const transition = transitionOrderItem(canonical.status, "cancelled", {
          cancellationAudit: {
            eventId: meta.eventId,
            idempotencyKey: meta.idempotencyKey,
            from: canonical.status,
            actorId: meta.actorId,
            branchId: meta.branchId,
            deviceId: meta.deviceId,
            occurredAt: meta.occurredAt,
            reason,
            authorization: authorization as CancellationAuthorization,
          },
        });
        const nextVersion = canonical.version + 1;
        const merged: OrderItemSyncState = deepFreeze({
          ...canonical,
          version: nextVersion,
          status: "cancelled" as const,
          ...(transition.cancellationAudit === undefined ? {} : { cancellationAudit: transition.cancellationAudit }),
          appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "transition", fingerprint, nextVersion)],
        });
        return orderItemResult(entityId, "accepted", "ACCEPTED", nextVersion, true, false, false, merged, canonicalCalc, meta, baseVersion);
      }

      // Cancelling a pending item.
      if (baseVersion !== canonical.version) {
        return orderItemResult(entityId, "conflict", "STALE_BASE_VERSION", canonical.version, false, true, false, null, null, meta, baseVersion);
      }
      if (reason === undefined) {
        return orderItemResult(entityId, "rejected", "REASON_REQUIRED", canonical.version, false, false, false, null, null, meta, baseVersion);
      }
      const transition = transitionOrderItem("pending", "cancelled", {
        cancellationAudit: {
          eventId: meta.eventId,
          idempotencyKey: meta.idempotencyKey,
          from: "pending",
          actorId: meta.actorId,
          branchId: meta.branchId,
          deviceId: meta.deviceId,
          occurredAt: meta.occurredAt,
          reason,
          ...(authorization === undefined ? {} : { authorization }),
        },
      });
      const nextVersion = canonical.version + 1;
      const merged: OrderItemSyncState = deepFreeze({
        ...canonical,
        version: nextVersion,
        status: "cancelled" as const,
        ...(transition.cancellationAudit === undefined ? {} : { cancellationAudit: transition.cancellationAudit }),
        appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "transition", fingerprint, nextVersion)],
      });
      return orderItemResult(entityId, "accepted", "ACCEPTED", nextVersion, false, false, false, merged, canonicalCalc, meta, baseVersion);
    }

    // Forward monotonic transitions (pending -> sent -> preparing -> ready -> delivered).
    const currentRank = ORDER_ITEM_FORWARD_RANK[canonical.status];
    const targetRank = ORDER_ITEM_FORWARD_RANK[targetStatus];
    if (currentRank !== undefined && targetRank !== undefined && targetRank < currentRank) {
      if (baseVersion! < canonical.version) {
        return orderItemResult(entityId, "duplicate", "STATE_ALREADY_SURPASSED", canonical.version, false, false, false, canonical, canonicalCalc, meta, baseVersion);
      }
      return orderItemResult(entityId, "rejected", "INVALID_BACKWARD_TRANSITION", canonical.version, false, false, false, null, null, meta, baseVersion);
    }

    try {
      transitionOrderItem(canonical.status, targetStatus);
    } catch {
      return orderItemResult(entityId, "rejected", "INVALID_STATE_TRANSITION", canonical.version, false, false, false, null, null, meta, baseVersion);
    }

    const nextVersion = canonical.version + 1;
    const merged: OrderItemSyncState = deepFreeze({
      ...canonical,
      version: nextVersion,
      status: targetStatus,
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "transition", fingerprint, nextVersion)],
    });
    return orderItemResult(entityId, "accepted", "ACCEPTED", nextVersion, false, false, false, merged, canonicalCalc, meta, baseVersion);
  }

  // compensate
  const reason = readOptionalString(rawEvent, "reason", "event.reason");
  const authorization = readOptionalAuthorization(rawEvent, "authorization", "event.authorization");
  const fingerprint = `order_item:compensate:${entityId}:${reason ?? ""}`;
  const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "compensate", fingerprint);
  if (dedup !== null) {
    return orderItemResult(entityId, dedup.status, dedup.code, canonical.version, true, false, false, dedup.status === "duplicate" ? canonical : null, dedup.status === "duplicate" ? canonicalCalc : null, meta, baseVersion);
  }
  if (reason === undefined) {
    return orderItemResult(entityId, "rejected", "REASON_REQUIRED", canonical.version, true, false, false, null, null, meta, baseVersion);
  }
  if (authorization === undefined) {
    return orderItemResult(entityId, "rejected", "SUPERVISOR_AUTHORIZATION_REQUIRED", canonical.version, true, false, false, null, null, meta, baseVersion);
  }
  if (baseVersion !== canonical.version) {
    const status: SyncMergeStatus = baseVersion! > canonical.version ? "rejected" : "conflict";
    const code: SyncMergeCode = status === "rejected" ? "INVALID_BASE_VERSION" : "STALE_BASE_VERSION";
    return orderItemResult(entityId, status, code, canonical.version, true, status === "conflict", false, null, null, meta, baseVersion);
  }
  const nextVersion = canonical.version + 1;
  const merged: OrderItemSyncState = deepFreeze({
    ...canonical,
    version: nextVersion,
    appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "compensate", fingerprint, nextVersion)],
  });
  return orderItemResult(entityId, "accepted", "ACCEPTED", nextVersion, true, false, false, merged, canonicalCalc, meta, baseVersion);
}

// ---- DiningTable merge ---------------------------------------------------------------------

/**
 * Pure merge rules for `DiningTable` (MATRIX §4.2):
 * - Two exclusive assignments, occupancy changes, or open/close races NEVER merge by LWW:
 *   they return `conflict` requiring manual review so diners are never silently displaced.
 * - Independent changes on distinct tables in the same branch succeed unless they compete
 *   for the same exclusive reservation.
 * - Tombstones are idempotent and block resurrection; occupied tables cannot be tombstoned.
 */
export function mergeDiningTableSyncEvent(input: MergeDiningTableSyncEventInput): DiningTableSyncMergeResult {
  const root = asPlainRecord(input, "input");
  const rawCanonical = ownData(root, "canonical", "canonical");
  const rawEvent = asPlainRecord(ownData(root, "event", "event"), "event");

  const meta = readEventMeta(rawEvent, "event");
  const entityId = readRequiredString(rawEvent, "entityId", "event.entityId");
  const operation = readEnum(rawEvent, "operation", SYNC_MERGE_OPERATIONS, "event.operation");
  const baseVersion = readBaseVersion(rawEvent, operation, "event.baseVersion");

  if (operation === "compensate") {
    return diningTableResult(entityId, "rejected", "UNSUPPORTED_OPERATION", null, false, false, null, meta, baseVersion);
  }

  const canonical = rawCanonical === null ? null : normalizeDiningTableCanonical(rawCanonical);
  if (canonical !== null) {
    if (canonical.tableId !== entityId) throw new InvalidSyncMergeInputError("canonical.tableId");
    if (!sameScope(canonical, meta)) {
      return diningTableResult(entityId, "rejected", "SCOPE_MISMATCH", null, false, canonical.tombstoned, null, meta, baseVersion);
    }
  }

  if (operation === "create") {
    const status = readOptionalEnum(rawEvent, "status", DINING_TABLE_SYNC_STATES, "event.status") ?? "free";
    const semanticIdentityConflict = readOptionalBoolean(rawEvent, "semanticIdentityConflict", "event.semanticIdentityConflict") ?? false;
    const fingerprint = `table:create:${entityId}:${status}`;

    if (canonical !== null) {
      const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "create", fingerprint);
      if (dedup !== null) {
        return diningTableResult(entityId, dedup.status, dedup.code, canonical.version, false, canonical.tombstoned, dedup.status === "duplicate" ? canonical : null, meta, null);
      }
      if (canonical.tombstoned) {
        return diningTableResult(entityId, "rejected", "TOMBSTONE_RECREATION_REQUIRES_NEW_ID", canonical.version, false, true, null, meta, null);
      }
      return diningTableResult(entityId, "conflict", "TABLE_ALREADY_EXISTS", canonical.version, true, false, null, meta, null);
    }
    if (semanticIdentityConflict) {
      return diningTableResult(entityId, "manual_review", "TOMBSTONE_SEMANTIC_IDENTITY_CONFLICT", null, true, false, null, meta, null);
    }

    const created: DiningTableSyncState = deepFreeze({
      tableId: entityId,
      restaurantId: meta.restaurantId,
      branchId: meta.branchId,
      version: 1,
      status,
      activeOrderId: null,
      reservationId: null,
      waiterUserId: null,
      shiftId: null,
      tombstoned: false,
      appliedEvents: [appliedEvent(meta, entityId, "create", fingerprint, 1)],
    });
    return diningTableResult(entityId, "accepted", "ACCEPTED", 1, false, false, created, meta, null);
  }

  if (canonical === null) {
    return diningTableResult(entityId, "rejected", "ENTITY_NOT_FOUND", null, false, false, null, meta, baseVersion);
  }

  if (canonical.tombstoned) {
    const fp = operation === "delete"
      ? `table:delete:${entityId}`
      : `table:${operation}:${entityId}:${String(baseVersion)}`;
    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, operation, fp);
    if (dedup !== null) {
      return diningTableResult(entityId, dedup.status, dedup.code, canonical.version, false, true, dedup.status === "duplicate" ? canonical : null, meta, baseVersion);
    }
    if (operation === "delete") {
      return diningTableResult(entityId, "accepted", "TOMBSTONE_ALREADY_APPLIED", canonical.version, false, true, canonical, meta, baseVersion);
    }
    const status: SyncMergeStatus = baseVersion! < canonical.version ? "conflict" : "rejected";
    return diningTableResult(entityId, status, "TOMBSTONE_RESURRECTION_BLOCKED", canonical.version, status === "conflict", true, null, meta, baseVersion);
  }

  if (operation === "delete") {
    const fingerprint = `table:delete:${entityId}`;
    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "delete", fingerprint);
    if (dedup !== null) {
      return diningTableResult(entityId, dedup.status, dedup.code, canonical.version, false, canonical.tombstoned, dedup.status === "duplicate" ? canonical : null, meta, baseVersion);
    }
    if (baseVersion! > canonical.version) {
      return diningTableResult(entityId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, false, null, meta, baseVersion);
    }
    if (canonical.status === "occupied" || canonical.activeOrderId !== null) {
      return diningTableResult(entityId, "conflict", "TABLE_OCCUPIED_DELETE_CONFLICT", canonical.version, true, false, null, meta, baseVersion);
    }
    if (baseVersion !== canonical.version) {
      return diningTableResult(entityId, "conflict", "STALE_BASE_VERSION", canonical.version, true, false, null, meta, baseVersion);
    }
    const nextVersion = canonical.version + 1;
    const merged: DiningTableSyncState = deepFreeze({
      ...canonical,
      version: nextVersion,
      tombstoned: true,
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "delete", fingerprint, nextVersion)],
    });
    return diningTableResult(entityId, "accepted", "ACCEPTED", nextVersion, false, true, merged, meta, baseVersion);
  }

  // transition | update
  const targetStatus = readEnum(rawEvent, "targetStatus", DINING_TABLE_SYNC_STATES, "event.targetStatus");
  const activeOrderId = readNullableString(rawEvent, "activeOrderId", "event.activeOrderId");
  const expectedActiveOrderId = readOptionalNullableString(rawEvent, "expectedActiveOrderId", "event.expectedActiveOrderId");
  const reservationId = readOptionalNullableString(rawEvent, "reservationId", "event.reservationId") ?? null;
  const waiterUserId = readOptionalNullableString(rawEvent, "waiterUserId", "event.waiterUserId") ?? null;
  const shiftId = readOptionalNullableString(rawEvent, "shiftId", "event.shiftId") ?? null;
  const shiftOpen = readOptionalBoolean(rawEvent, "shiftOpen", "event.shiftOpen") ?? true;
  const exclusiveReservationHolderTableId = readOptionalNullableString(
    rawEvent,
    "exclusiveReservationHolderTableId",
    "event.exclusiveReservationHolderTableId",
  ) ?? null;

  if (targetStatus === "occupied" && activeOrderId === null) {
    throw new InvalidSyncMergeInputError("event.activeOrderId");
  }
  if (targetStatus !== "occupied" && activeOrderId !== null) {
    throw new InvalidSyncMergeInputError("event.activeOrderId");
  }

  const fingerprint = `table:${operation}:${entityId}:${targetStatus}:${activeOrderId ?? ""}:${reservationId ?? ""}:${waiterUserId ?? ""}:${shiftId ?? ""}`;
  const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, operation, fingerprint);
  if (dedup !== null) {
    return diningTableResult(entityId, dedup.status, dedup.code, canonical.version, false, false, dedup.status === "duplicate" ? canonical : null, meta, baseVersion);
  }
  if (baseVersion! > canonical.version) {
    return diningTableResult(entityId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, false, null, meta, baseVersion);
  }
  if (!shiftOpen && targetStatus === "occupied") {
    return diningTableResult(entityId, "rejected", "SHIFT_REQUIRED", canonical.version, false, false, null, meta, baseVersion);
  }

  // Shared exclusive reservation dispute across two different tables.
  if (
    reservationId !== null
    && exclusiveReservationHolderTableId !== null
    && exclusiveReservationHolderTableId !== entityId
  ) {
    return diningTableResult(entityId, "conflict", "SHARED_EXCLUSIVE_RESERVATION_CONFLICT", canonical.version, true, false, null, meta, baseVersion);
  }

  // Exact same state already in place (no displacement).
  if (
    canonical.status === targetStatus
    && canonical.activeOrderId === activeOrderId
    && canonical.reservationId === reservationId
    && canonical.waiterUserId === waiterUserId
  ) {
    return diningTableResult(entityId, "duplicate", "ALREADY_IN_TARGET_STATE", canonical.version, false, false, canonical, meta, baseVersion);
  }

  // Attempting to occupy an already occupied table with a DIFFERENT order: never displace the diner.
  if (
    targetStatus === "occupied"
    && canonical.status === "occupied"
    && canonical.activeOrderId !== null
    && canonical.activeOrderId !== activeOrderId
  ) {
    return diningTableResult(entityId, "conflict", "TABLE_OCCUPANCY_CONFLICT", canonical.version, true, false, null, meta, baseVersion);
  }

  // Attempting to occupy a reserved table for a different reservation.
  if (
    targetStatus === "occupied"
    && canonical.status === "reserved"
    && canonical.reservationId !== null
    && canonical.reservationId !== reservationId
  ) {
    return diningTableResult(entityId, "conflict", "TABLE_RESERVATION_CONFLICT", canonical.version, true, false, null, meta, baseVersion);
  }

  // Attempting to release/close a table whose active order changed concurrently.
  if (
    targetStatus === "free"
    && canonical.activeOrderId !== null
    && expectedActiveOrderId !== undefined
    && expectedActiveOrderId !== canonical.activeOrderId
  ) {
    return diningTableResult(entityId, "conflict", "TABLE_RELEASE_CONFLICT", canonical.version, true, false, null, meta, baseVersion);
  }

  // Any stale exclusive state change conflicts (never LWW).
  if (baseVersion !== canonical.version) {
    return diningTableResult(entityId, "conflict", "TABLE_STATE_CONFLICT", canonical.version, true, false, null, meta, baseVersion);
  }

  const nextVersion = canonical.version + 1;
  const merged: DiningTableSyncState = deepFreeze({
    ...canonical,
    version: nextVersion,
    status: targetStatus,
    activeOrderId,
    reservationId: targetStatus === "free" ? null : reservationId,
    waiterUserId: targetStatus === "free" ? null : waiterUserId,
    shiftId: targetStatus === "free" ? canonical.shiftId : (shiftId ?? canonical.shiftId),
    appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, operation, fingerprint, nextVersion)],
  });
  return diningTableResult(entityId, "accepted", "ACCEPTED", nextVersion, false, false, merged, meta, baseVersion);
}

// ---- KdsTicket merge -----------------------------------------------------------------------

/**
 * Pure merge rules for `KdsTicket` (MATRIX §4.2):
 * - Strict branch and station isolation: another station cannot transition a ticket
 *   (`KDS_DOUBLE_STATION_CONFLICT`, ticket stays visible for manual review).
 * - Two ACKs/starts/readies for the same ticket and station are idempotent; monotonic
 *   progression (`sent -> preparing -> ready -> delivered`) never regresses state.
 * - Incompatible states, lost tickets, or cancel-vs-prepare races return `conflict`
 *   with `keepTicketVisible: true` and `requiresManualReview: true`.
 */
export function mergeKdsTicketSyncEvent(input: MergeKdsTicketSyncEventInput): KdsTicketSyncMergeResult {
  const root = asPlainRecord(input, "input");
  const rawCanonical = ownData(root, "canonical", "canonical");
  const rawEvent = asPlainRecord(ownData(root, "event", "event"), "event");

  const meta = readEventMeta(rawEvent, "event");
  const entityId = readRequiredString(rawEvent, "entityId", "event.entityId");
  const orderId = readRequiredString(rawEvent, "orderId", "event.orderId");
  const orderItemId = readRequiredString(rawEvent, "orderItemId", "event.orderItemId");
  const stationId = readRequiredString(rawEvent, "stationId", "event.stationId");
  const operation = readEnum(rawEvent, "operation", SYNC_MERGE_OPERATIONS, "event.operation");
  const baseVersion = readBaseVersion(rawEvent, operation, "event.baseVersion");

  const canonical = rawCanonical === null ? null : normalizeKdsTicketCanonical(rawCanonical);
  if (canonical !== null) {
    if (canonical.ticketId !== entityId) throw new InvalidSyncMergeInputError("canonical.ticketId");
    if (!sameScope(canonical, meta)) {
      return kdsResult(entityId, "rejected", "SCOPE_MISMATCH", null, false, false, false, null, meta, baseVersion);
    }
  }

  if (operation === "delete") {
    return kdsResult(entityId, "rejected", "TOMBSTONE_NOT_ALLOWED", canonical?.version ?? null, false, true, false, null, meta, baseVersion);
  }
  if (operation === "update") {
    return kdsResult(entityId, "rejected", "UNSUPPORTED_OPERATION", canonical?.version ?? null, false, true, false, null, meta, baseVersion);
  }

  if (operation === "create") {
    const fingerprint = `kds:create:${entityId}:${orderId}:${orderItemId}:${stationId}`;
    if (canonical !== null) {
      const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "create", fingerprint);
      if (dedup !== null) {
        return kdsResult(entityId, dedup.status, dedup.code, canonical.version, false, true, false, dedup.status === "duplicate" ? canonical : null, meta, null);
      }
      if (canonical.orderId !== orderId || canonical.orderItemId !== orderItemId) {
        return kdsResult(entityId, "rejected", "KDS_TICKET_LINK_MISMATCH", canonical.version, false, true, false, null, meta, null);
      }
      if (canonical.stationId !== stationId) {
        return kdsResult(entityId, "conflict", "KDS_DOUBLE_STATION_CONFLICT", canonical.version, true, true, true, null, meta, null);
      }
      return kdsResult(entityId, "conflict", "KDS_TICKET_ALREADY_EXISTS", canonical.version, true, true, false, null, meta, null);
    }
    const created: KdsTicketSyncState = deepFreeze({
      ticketId: entityId,
      orderId,
      orderItemId,
      restaurantId: meta.restaurantId,
      branchId: meta.branchId,
      stationId,
      version: 1,
      status: "sent" as const,
      acknowledged: false,
      appliedEvents: [appliedEvent(meta, entityId, "create", fingerprint, 1)],
    });
    return kdsResult(entityId, "accepted", "ACCEPTED", 1, false, true, false, created, meta, null);
  }

  // Lost / missing ticket requires cursor resync + manual review (never hide loss).
  if (canonical === null) {
    return kdsResult(entityId, "conflict", "KDS_TICKET_NOT_FOUND", null, true, true, true, null, meta, baseVersion);
  }

  if (canonical.orderId !== orderId || canonical.orderItemId !== orderItemId) {
    return kdsResult(entityId, "rejected", "KDS_TICKET_LINK_MISMATCH", canonical.version, false, true, false, null, meta, baseVersion);
  }

  if (operation === "compensate") {
    const targetStationId = readRequiredString(rawEvent, "targetStationId", "event.targetStationId");
    const reason = readOptionalString(rawEvent, "reason", "event.reason");
    const authorization = readOptionalAuthorization(rawEvent, "authorization", "event.authorization");
    const fingerprint = `kds:compensate:${entityId}:${stationId}:${targetStationId}:${reason ?? ""}`;
    const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "compensate", fingerprint);
    if (dedup !== null) {
      return kdsResult(entityId, dedup.status, dedup.code, canonical.version, false, true, false, dedup.status === "duplicate" ? canonical : null, meta, baseVersion);
    }
    if (reason === undefined) {
      return kdsResult(entityId, "rejected", "REASON_REQUIRED", canonical.version, false, true, false, null, meta, baseVersion);
    }
    if (authorization === undefined) {
      return kdsResult(entityId, "rejected", "SUPERVISOR_AUTHORIZATION_REQUIRED", canonical.version, false, true, false, null, meta, baseVersion);
    }
    if (baseVersion! > canonical.version) {
      return kdsResult(entityId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, true, false, null, meta, baseVersion);
    }
    if (baseVersion !== canonical.version || canonical.stationId !== stationId) {
      return kdsResult(entityId, "conflict", "KDS_DOUBLE_STATION_CONFLICT", canonical.version, true, true, true, null, meta, baseVersion);
    }
    const nextVersion = canonical.version + 1;
    const merged: KdsTicketSyncState = deepFreeze({
      ...canonical,
      stationId: targetStationId,
      version: nextVersion,
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "compensate", fingerprint, nextVersion)],
    });
    return kdsResult(entityId, "accepted", "ACCEPTED", nextVersion, false, true, false, merged, meta, baseVersion);
  }

  // transition
  const targetStatus = readEnum(rawEvent, "targetStatus", KDS_TICKET_SYNC_STATES, "event.targetStatus");
  const acknowledge = readOptionalBoolean(rawEvent, "acknowledge", "event.acknowledge") ?? false;
  const reason = readOptionalString(rawEvent, "reason", "event.reason");
  const authorization = readOptionalAuthorization(rawEvent, "authorization", "event.authorization");
  const fingerprint = `kds:transition:${entityId}:${stationId}:${targetStatus}:${String(acknowledge)}:${reason ?? ""}`;

  const dedup = checkAppliedEventDedup(canonical.appliedEvents, meta.eventId, meta.idempotencyKey, entityId, "transition", fingerprint);
  if (dedup !== null) {
    return kdsResult(entityId, dedup.status, dedup.code, canonical.version, false, true, false, dedup.status === "duplicate" ? canonical : null, meta, baseVersion);
  }
  if (baseVersion! > canonical.version) {
    return kdsResult(entityId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, true, false, null, meta, baseVersion);
  }

  // Double-station guard: another station cannot silently take over or advance the ticket.
  if (canonical.stationId !== stationId) {
    return kdsResult(entityId, "conflict", "KDS_DOUBLE_STATION_CONFLICT", canonical.version, true, true, true, null, meta, baseVersion);
  }

  // Cancelled ticket cannot be acknowledged or progressed.
  if (canonical.status === "cancelled") {
    if (targetStatus === "cancelled") {
      return kdsResult(entityId, "duplicate", "ALREADY_IN_TARGET_STATE", canonical.version, false, true, false, canonical, meta, baseVersion);
    }
    return kdsResult(entityId, "conflict", "KDS_CANCELLED_TICKET_CONFLICT", canonical.version, true, true, true, null, meta, baseVersion);
  }

  // Incoming cancellation on KDS ticket.
  if (targetStatus === "cancelled") {
    if (canonical.status === "delivered") {
      return kdsResult(entityId, "conflict", "CANCEL_AFTER_DELIVERY_CONFLICT", canonical.version, true, true, false, null, meta, baseVersion);
    }
    if (baseVersion! < canonical.version || reason === undefined || authorization === undefined) {
      return kdsResult(entityId, "conflict", "POST_SEND_CANCELLATION_CONFLICT", canonical.version, true, true, true, null, meta, baseVersion);
    }
    const nextVersion = canonical.version + 1;
    const merged: KdsTicketSyncState = deepFreeze({
      ...canonical,
      status: "cancelled" as const,
      version: nextVersion,
      appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "transition", fingerprint, nextVersion)],
    });
    return kdsResult(entityId, "accepted", "ACCEPTED", nextVersion, false, true, false, merged, meta, baseVersion);
  }

  // Pure ACK idempotency when status is unchanged.
  if (canonical.status === targetStatus) {
    if (acknowledge && !canonical.acknowledged) {
      const nextVersion = canonical.version + 1;
      const merged: KdsTicketSyncState = deepFreeze({
        ...canonical,
        acknowledged: true,
        version: nextVersion,
        appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "transition", fingerprint, nextVersion)],
      });
      return kdsResult(entityId, "accepted", "ACCEPTED", nextVersion, false, true, false, merged, meta, baseVersion);
    }
    const code: SyncMergeCode = acknowledge && canonical.acknowledged ? "ALREADY_ACKNOWLEDGED" : "ALREADY_IN_TARGET_STATE";
    return kdsResult(entityId, "duplicate", code, canonical.version, false, true, false, canonical, meta, baseVersion);
  }

  const currentRank = KDS_TICKET_FORWARD_RANK[canonical.status]!;
  const targetRank = KDS_TICKET_FORWARD_RANK[targetStatus]!;

  // Monotonicity: never regress a KDS ticket.
  if (targetRank < currentRank) {
    if (baseVersion! < canonical.version) {
      return kdsResult(entityId, "duplicate", "STATE_ALREADY_SURPASSED", canonical.version, false, true, false, canonical, meta, baseVersion);
    }
    return kdsResult(entityId, "rejected", "INVALID_BACKWARD_TRANSITION", canonical.version, false, true, false, null, meta, baseVersion);
  }

  // Step-by-step monotonic advancement (`sent -> preparing -> ready -> delivered`).
  if (targetRank > currentRank + 1) {
    if (baseVersion! < canonical.version) {
      return kdsResult(entityId, "conflict", "KDS_INCOMPATIBLE_STATE_TRANSITION", canonical.version, true, true, true, null, meta, baseVersion);
    }
    return kdsResult(entityId, "rejected", "INVALID_STATE_TRANSITION", canonical.version, false, true, false, null, meta, baseVersion);
  }

  const nextVersion = canonical.version + 1;
  const merged: KdsTicketSyncState = deepFreeze({
    ...canonical,
    status: targetStatus,
    acknowledged: canonical.acknowledged || acknowledge,
    version: nextVersion,
    appliedEvents: [...(canonical.appliedEvents ?? []), appliedEvent(meta, entityId, "transition", fingerprint, nextVersion)],
  });
  return kdsResult(entityId, "accepted", "ACCEPTED", nextVersion, false, true, false, merged, meta, baseVersion);
}

// ---- Payment merge -------------------------------------------------------------------------

/**
 * Pure merge rules for `Payment` (MATRIX §4.2):
 * - Same `eventId`/`idempotencyKey` with identical business intent deduplicates (`duplicate`).
 * - Same `eventId`/`idempotencyKey` with altered business fields rejects (`EVENT_ID_REUSE_CONFLICT` / `IDEMPOTENCY_KEY_REUSE`).
 * - Distinct keys exceeding remaining obligation, duplicate payment for a paid order, unresolved
 *   pending/ambiguous exposure, uncertain provider responses, or offline cash limit/sequence anomalies
 *   escalate to `manual_review` and block new collection (`blockNewCollection: true`). Never LWW.
 */
export function mergePaymentSyncEvent(input: MergePaymentSyncEventInput): PaymentSyncMergeResult {
  const root = asPlainRecord(input, "input");
  const context = normalizePaymentContext(ownData(root, "context", "context"));
  const event = normalizeIncomingPaymentEvent(ownData(root, "event", "event"));

  // Scope check precedes dedup lookup (OFFLINE_SYNC_CONTRACT §3.1).
  if (
    event.restaurantId !== context.restaurantId
    || event.branchId !== context.branchId
    || event.orderId !== context.orderId
  ) {
    return paymentResult(event, "rejected", "SCOPE_MISMATCH", false, false, null, null, null, 0, null, null);
  }

  if (event.operation === "delete") {
    return paymentResult(event, "rejected", "TOMBSTONE_NOT_ALLOWED", false, false, null, null, null, 0, null, null);
  }
  if (event.operation === "update" || event.operation === "transition") {
    return paymentResult(event, "rejected", "PAYMENT_IMMUTABLE_USE_COMPENSATE", false, false, null, null, null, 0, null, null);
  }

  // Deduplication by eventId or idempotencyKey.
  const existingByEvent = context.existingPayments.find((item) => item.eventId === event.eventId);
  const existingByKey = context.existingPayments.find((item) => item.idempotencyKey === event.idempotencyKey);
  const prior = existingByEvent ?? existingByKey;
  if (prior !== undefined) {
    const keyMismatchOnEvent = existingByEvent !== undefined && existingByEvent.idempotencyKey !== event.idempotencyKey;
    if (keyMismatchOnEvent || !samePaymentBusinessIntent(prior, event)) {
      const code: SyncMergeCode = existingByEvent !== undefined ? "EVENT_ID_REUSE_CONFLICT" : "IDEMPOTENCY_KEY_REUSE";
      return paymentResult(event, "rejected", code, false, false, prior.state, null, null, 0, null, prior.paymentId);
    }
    const code: SyncMergeCode = existingByEvent !== undefined ? "DUPLICATE_EVENT" : "DUPLICATE_IDEMPOTENCY_KEY";
    const priorChange = prior.method === "cash" && prior.tenderedAmountMinor !== null
      ? computeChangeMinorSafe(prior.amountMinor, prior.tenderedAmountMinor, prior.tipMinor, prior.currency)
      : null;
    return paymentResult(event, "duplicate", code, false, false, prior.state, priorChange, null, 0, null, prior.paymentId);
  }

  if (event.currency !== context.currency) {
    return paymentResult(event, "rejected", "CURRENCY_MISMATCH", false, false, null, null, null, 0, null, null);
  }
  if (event.amountMinor <= 0) {
    return paymentResult(event, "rejected", "INVALID_PAYMENT_AMOUNT", false, false, null, null, null, 0, null, null);
  }

  if (event.operation === "compensate") {
    return mergePaymentCompensation(context, event);
  }

  // Distinct key attempting to reuse an existing paymentId -> manual_review (never LWW).
  if (context.existingPayments.some((item) => item.paymentId === event.entityId)) {
    return paymentResult(event, "manual_review", "PAYMENT_ID_CONFLICT", true, true, null, null, null, 0, null, event.entityId);
  }

  // Validate cash tendered / change using Money (zero floats).
  let changeMinor: number | null = null;
  if (event.tenderedAmountMinor !== null) {
    if (event.method !== "cash") {
      return paymentResult(event, "rejected", "INSUFFICIENT_TENDERED_AMOUNT", false, false, null, null, null, 0, null, null);
    }
    const calculatedChange = computeChangeMinorSafe(event.amountMinor, event.tenderedAmountMinor, event.tipMinor, event.currency);
    if (calculatedChange === null) {
      return paymentResult(event, "rejected", "INSUFFICIENT_TENDERED_AMOUNT", false, false, null, null, null, 0, null, null);
    }
    changeMinor = calculatedChange;
  }

  // Order terminal states: preserve evidence in manual_review (never drop or LWW).
  if (context.orderStatus === "cancelled" || context.orderStatus === "closed") {
    return paymentResult(event, "manual_review", "PAYMENT_ON_TERMINAL_ORDER", true, true, null, changeMinor, null, 0, null, null);
  }
  if (context.orderStatus === "draft") {
    if (event.isOfflineEvent) {
      return paymentResult(event, "manual_review", "PAYMENT_ON_DRAFT_ORDER", true, true, null, changeMinor, null, 0, null, null);
    }
    return paymentResult(event, "rejected", "ORDER_NOT_PAYABLE", false, false, null, null, null, 0, null, null);
  }

  // Provider uncertainty always requires manual review.
  if (event.providerStatus === "uncertain") {
    return paymentResult(event, "manual_review", "PAYMENT_PROVIDER_UNCERTAIN", true, true, "ambiguous", changeMinor, null, 0, "ambiguous", null);
  }

  // Compute current obligation using BigInt + derivePaymentObligation.
  let capturedBig = 0n;
  let pendingBig = 0n;
  let ambiguousBig = 0n;
  for (const existing of context.existingPayments) {
    if (existing.currency !== context.currency) {
      throw new InvalidSyncMergeInputError("context.existingPayments.currency");
    }
    if (existing.state === "captured") {
      const refunded = BigInt(existing.refundedAmountMinor ?? 0);
      const net = BigInt(existing.amountMinor) - refunded;
      if (net > 0n) capturedBig += net;
    } else if (existing.state === "initiated" || existing.state === "authorized") {
      pendingBig += BigInt(existing.amountMinor);
    } else if (existing.state === "ambiguous") {
      ambiguousBig += BigInt(existing.amountMinor);
    }
  }

  const orderTotalBig = BigInt(context.orderTotalMinor);
  if (capturedBig > orderTotalBig) {
    return paymentResult(
      event, "manual_review", "PAYMENT_EXCEEDS_OBLIGATION", true, true, null, changeMinor, 0,
      toSafeIntClamped(BigInt(event.amountMinor)), "ambiguous", null,
    );
  }

  if (capturedBig > MAX_SAFE_BIGINT || pendingBig > MAX_SAFE_BIGINT || ambiguousBig > MAX_SAFE_BIGINT) {
    return paymentResult(event, "manual_review", "MONEY_OVERFLOW", true, true, null, null, null, 0, "ambiguous", null);
  }

  const obligation = derivePaymentObligation({
    orderTotal: new Money(context.orderTotalMinor, context.currency),
    capturedAmount: new Money(Number(capturedBig), context.currency),
    pendingAmount: new Money(Number(pendingBig), context.currency),
    ambiguousAmount: new Money(Number(ambiguousBig), context.currency),
  });

  if (obligation.collectibleAmount === null) {
    return paymentResult(
      event, "manual_review", "PAYMENT_UNRESOLVED_EXPOSURE", true, true, null, changeMinor,
      obligation.remainingBalance.amountMinor, 0, obligation.paymentStatus, null,
    );
  }

  const remainingMinor = BigInt(obligation.collectibleAmount.amountMinor);
  const incomingMinor = BigInt(event.amountMinor);
  if (incomingMinor > remainingMinor) {
    const overcollection = toSafeIntClamped(incomingMinor - remainingMinor);
    const code: SyncMergeCode = remainingMinor === 0n
      ? "DUPLICATE_OBLIGATION_PAYMENT_DIFFERENT_KEY"
      : "PAYMENT_EXCEEDS_OBLIGATION";
    return paymentResult(
      event, "manual_review", code, true, true, null, changeMinor,
      obligation.remainingBalance.amountMinor, overcollection, obligation.paymentStatus, null,
    );
  }

  // Offline method and cash-sequence/limit checks (MATRIX §2.1 & §4.2).
  if (event.isOfflineEvent) {
    if (event.method === "card_terminal" || event.method === "transfer" || event.method === "other") {
      return paymentResult(
        event, "rejected", "OFFLINE_PAYMENT_METHOD_NOT_ALLOWED", false, false, null, null,
        obligation.remainingBalance.amountMinor, 0, obligation.paymentStatus, null,
      );
    }
    if (event.method === "card_manual") {
      if (!event.cardManualExternalConfirmed) {
        return paymentResult(
          event, "rejected", "EXTERNAL_TERMINAL_CONFIRMATION_REQUIRED", false, false, null, null,
          obligation.remainingBalance.amountMinor, 0, obligation.paymentStatus, null,
        );
      }
      // MATRIX §2.1: card_manual offline is NOT marked captured; stays pending reconciliation.
      return paymentResult(
        event, "accepted", "ACCEPTED", false, true, "authorized", null,
        obligation.remainingBalance.amountMinor, 0, "pending", null,
      );
    }

    // Offline cash.
    if (context.cashRegisterOpen === false || event.cashRegisterId === null || event.cashierId === null) {
      return paymentResult(
        event, "manual_review", "CASH_REGISTER_CLOSED_OFFLINE_PAYMENT", true, true, null, changeMinor,
        obligation.remainingBalance.amountMinor, 0, obligation.paymentStatus, null,
      );
    }
    if (context.offlineCashLimitMinor !== null && event.amountMinor > context.offlineCashLimitMinor) {
      return paymentResult(
        event, "manual_review", "OFFLINE_CASH_LIMIT_EXCEEDED", true, true, null, changeMinor,
        obligation.remainingBalance.amountMinor, 0, obligation.paymentStatus, null,
      );
    }
    if (context.expectedCashSequenceByDevice !== undefined) {
      const expectedSeq = ownOptionalSafePositiveInt(context.expectedCashSequenceByDevice, event.deviceId);
      if (event.cashSequence === null || event.cashSequence <= 0) {
        return paymentResult(
          event, "manual_review", "CASH_SEQUENCE_INVALID", true, true, null, changeMinor,
          obligation.remainingBalance.amountMinor, 0, obligation.paymentStatus, null,
        );
      }
      if (expectedSeq !== undefined && event.cashSequence < expectedSeq) {
        return paymentResult(
          event, "manual_review", "CASH_SEQUENCE_DUPLICATE", true, true, null, changeMinor,
          obligation.remainingBalance.amountMinor, 0, obligation.paymentStatus, null,
        );
      }
      if (expectedSeq !== undefined && event.cashSequence > expectedSeq) {
        return paymentResult(
          event, "manual_review", "CASH_SEQUENCE_GAP", true, true, null, changeMinor,
          obligation.remainingBalance.amountMinor, 0, obligation.paymentStatus, null,
        );
      }
    }
  }

  const nextRemaining = Number(remainingMinor - incomingMinor);
  const resultingOrderPaymentStatus = event.providerStatus === "pending"
    ? "pending"
    : nextRemaining === 0 ? "paid" : "partially_paid";
  const resultingPaymentState: PaymentSyncRecordState = event.providerStatus === "pending" ? "authorized" : "captured";

  return paymentResult(
    event,
    "accepted",
    "ACCEPTED",
    false,
    event.isOfflineEvent,
    resultingPaymentState,
    changeMinor,
    event.providerStatus === "pending" ? obligation.remainingBalance.amountMinor : nextRemaining,
    0,
    resultingOrderPaymentStatus,
    null,
  );
}

function mergePaymentCompensation(
  context: PaymentSyncContext,
  event: NormalizedIncomingPaymentEvent,
): PaymentSyncMergeResult {
  if (event.isOfflineEvent) {
    return paymentResult(event, "rejected", "OFFLINE_COMPENSATION_FORBIDDEN", false, false, null, null, null, 0, null, null);
  }
  if (event.providerStatus === "uncertain") {
    return paymentResult(event, "manual_review", "PAYMENT_PROVIDER_UNCERTAIN", true, true, "ambiguous", null, null, 0, "ambiguous", event.compensatesPaymentId ?? null);
  }
  if (event.reason === undefined) {
    return paymentResult(event, "rejected", "REASON_REQUIRED", false, false, null, null, null, 0, null, null);
  }
  if (event.authorization === undefined) {
    return paymentResult(event, "rejected", "SUPERVISOR_AUTHORIZATION_REQUIRED", false, false, null, null, null, 0, null, null);
  }
  if (event.compensatesPaymentId === undefined) {
    return paymentResult(event, "rejected", "COMPENSATION_INVALID", false, false, null, null, null, 0, null, null);
  }
  const original = context.existingPayments.find((item) => item.paymentId === event.compensatesPaymentId);
  if (original === undefined || original.state !== "captured") {
    return paymentResult(event, "rejected", "COMPENSATION_INVALID", false, false, null, null, null, 0, null, event.compensatesPaymentId);
  }
  const refundable = BigInt(original.amountMinor) - BigInt(original.refundedAmountMinor ?? 0);
  if (BigInt(event.amountMinor) > refundable) {
    return paymentResult(event, "rejected", "COMPENSATION_INVALID", false, false, original.state, null, null, 0, null, original.paymentId);
  }
  const nextState: PaymentSyncRecordState = BigInt(event.amountMinor) === refundable ? "refunded" : "captured";
  return paymentResult(event, "accepted", "ACCEPTED", false, false, nextState, null, null, 0, null, original.paymentId);
}

// ---- CashMovement merge --------------------------------------------------------------------

/**
 * Pure merge rules for `CashMovement` and cash-register closing (MATRIX §4.2):
 * - Additive cash movements combine across open registers when each device's `localSequence`
 *   matches the authoritative expected cursor, stays within offline limits, and never creates
 *   an impossible negative balance.
 * - Sequence gaps/duplicates, offline movements arriving after register close, offline limit
 *   breaches, or impossible negative balances escalate to `manual_review`.
 * - Concurrent double cash-register close or reopening a closed register returns `conflict`
 *   requiring manual review (never LWW).
 */
export function mergeCashMovementSyncEvent(input: MergeCashMovementSyncEventInput): CashMovementSyncMergeResult {
  const root = asPlainRecord(input, "input");
  const canonical = normalizeCashRegisterCanonical(ownData(root, "canonical", "canonical"));
  const rawEvent = asPlainRecord(ownData(root, "event", "event"), "event");

  const meta = readEventMeta(rawEvent, "event");
  const entityId = readRequiredString(rawEvent, "entityId", "event.entityId");
  const operation = readEnum(rawEvent, "operation", SYNC_MERGE_OPERATIONS, "event.operation");
  const baseVersion = readBaseVersion(rawEvent, operation, "event.baseVersion");
  const cashRegisterId = readRequiredString(rawEvent, "cashRegisterId", "event.cashRegisterId");
  const registerId = readRequiredString(rawEvent, "registerId", "event.registerId");
  const shiftId = readRequiredString(rawEvent, "shiftId", "event.shiftId");
  const cashierId = readRequiredString(rawEvent, "cashierId", "event.cashierId");

  if (
    meta.restaurantId !== canonical.restaurantId
    || meta.branchId !== canonical.branchId
    || cashRegisterId !== canonical.cashRegisterId
    || registerId !== canonical.registerId
    || shiftId !== canonical.shiftId
    || cashierId !== canonical.cashierId
  ) {
    return cashResult(entityId, "rejected", "SCOPE_MISMATCH", null, false, null, null, null, meta, baseVersion, null, null);
  }

  if (operation === "delete") {
    return cashResult(entityId, "rejected", "TOMBSTONE_NOT_ALLOWED", canonical.version, false, null, null, null, meta, baseVersion, null, canonical.currency);
  }
  if (operation === "update") {
    return cashResult(entityId, "rejected", "CASH_MOVEMENT_IMMUTABLE", canonical.version, false, null, null, null, meta, baseVersion, null, canonical.currency);
  }

  const currentBalanceBig = computeCashBalanceBigInt(canonical);
  const currentBalanceMinor = currentBalanceBig >= 0n && currentBalanceBig <= MAX_SAFE_BIGINT
    ? Number(currentBalanceBig)
    : null;

  if (operation === "transition") {
    return mergeCashRegisterTransition(canonical, currentBalanceBig, currentBalanceMinor, rawEvent, entityId, meta, baseVersion!);
  }

  // create | compensate (append-only cash movement)
  const localSequence = readSafePositiveInt(rawEvent, "localSequence", "event.localSequence");
  const type = readEnum(rawEvent, "type", CASH_MOVEMENT_TYPES, "event.type");
  const direction = readEnum(rawEvent, "direction", ["in", "out"] as const, "event.direction");
  const amountMinor = readSafeInteger(rawEvent, "amountMinor", "event.amountMinor");
  const currency = readCurrency(rawEvent, "currency", "event.currency");
  const isOfflineEvent = readBoolean(rawEvent, "isOfflineEvent", "event.isOfflineEvent");
  const source = readOptionalCashSource(rawEvent, "source", "event.source");
  const compensatesMovementId = readOptionalString(rawEvent, "compensatesMovementId", "event.compensatesMovementId");
  const reason = readOptionalString(rawEvent, "reason", "event.reason");
  const authorization = readOptionalAuthorization(rawEvent, "authorization", "event.authorization");

  // Deduplication FIRST (same eventId or idempotencyKey).
  const existingByEvent = canonical.movements.find((item) => item.eventId === meta.eventId);
  const existingByKey = canonical.movements.find((item) => item.idempotencyKey === meta.idempotencyKey);
  const prior = existingByEvent ?? existingByKey;
  if (prior !== undefined) {
    const identical = prior.movementId === entityId
      && prior.deviceId === meta.deviceId
      && prior.localSequence === localSequence
      && prior.type === type
      && prior.direction === direction
      && prior.amountMinor === amountMinor
      && prior.currency === currency
      && sameCashSource(prior.source, source)
      && prior.compensatesMovementId === compensatesMovementId
      && prior.reason === reason;
    if (!identical) {
      const code: SyncMergeCode = existingByEvent !== undefined ? "EVENT_ID_REUSE_CONFLICT" : "IDEMPOTENCY_KEY_REUSE";
      return cashResult(entityId, "rejected", code, canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
    }
    const code: SyncMergeCode = existingByEvent !== undefined ? "DUPLICATE_EVENT" : "DUPLICATE_IDEMPOTENCY_KEY";
    return cashResult(entityId, "duplicate", code, canonical.version, false, currentBalanceMinor, null, canonical, meta, baseVersion, amountMinor, currency);
  }

  if (canonical.movements.some((item) => item.movementId === entityId)) {
    return cashResult(entityId, "manual_review", "CASH_MOVEMENT_ID_CONFLICT", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }
  if (currency !== canonical.currency) {
    return cashResult(entityId, "rejected", "CURRENCY_MISMATCH", canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }
  if (amountMinor <= 0) {
    return cashResult(entityId, "rejected", "INVALID_CASH_MOVEMENT_AMOUNT", canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }

  // Movement arriving after register close -> manual_review (never silently drop cash).
  if (canonical.status === "closed") {
    return cashResult(entityId, "manual_review", "CASH_REGISTER_ALREADY_CLOSED", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }

  // Offline cash limit check.
  if (isOfflineEvent && canonical.offlineCashLimitMinor !== null && amountMinor > canonical.offlineCashLimitMinor) {
    return cashResult(entityId, "manual_review", "OFFLINE_CASH_LIMIT_EXCEEDED", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }

  // Per-device monotonic sequence validation (MATRIX §4.2: gap/duplicate -> manual_review).
  const expectedSeq = ownOptionalSafePositiveInt(canonical.expectedNextSequenceByDevice, meta.deviceId) ?? 1;
  const maxSeenForDevice = canonical.movements
    .filter((item) => item.deviceId === meta.deviceId)
    .reduce((max, item) => (item.localSequence > max ? item.localSequence : max), 0);
  const effectiveExpected = expectedSeq > maxSeenForDevice ? expectedSeq : maxSeenForDevice + 1;

  if (localSequence < effectiveExpected) {
    return cashResult(entityId, "manual_review", "CASH_SEQUENCE_DUPLICATE", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }
  if (localSequence > effectiveExpected) {
    return cashResult(entityId, "manual_review", "CASH_SEQUENCE_GAP", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }

  // Movement shape and compensation validation (aligned with cash-register.ts).
  const shapeCode = validateCashMovementShape(canonical, operation, type, direction, amountMinor, currency, isOfflineEvent, source, compensatesMovementId, reason, authorization);
  if (shapeCode !== null) {
    return cashResult(entityId, "rejected", shapeCode, canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }

  // Impossible total guard (cannot drive physical cash balance negative or overflow safe int).
  const nextBalanceBig = direction === "in"
    ? currentBalanceBig + BigInt(amountMinor)
    : currentBalanceBig - BigInt(amountMinor);
  if (nextBalanceBig < 0n) {
    return cashResult(entityId, "manual_review", "CASH_BALANCE_IMPOSSIBLE", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }
  if (nextBalanceBig > MAX_SAFE_BIGINT) {
    return cashResult(entityId, "manual_review", "MONEY_OVERFLOW", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, amountMinor, currency);
  }

  const nextVersion = canonical.version + 1;
  const newMovement: CashMovementSyncRecord = deepFreeze({
    movementId: entityId,
    eventId: meta.eventId,
    idempotencyKey: meta.idempotencyKey,
    deviceId: meta.deviceId,
    localSequence,
    type,
    direction,
    amountMinor,
    currency,
    ...(source === undefined ? {} : { source }),
    ...(compensatesMovementId === undefined ? {} : { compensatesMovementId }),
    ...(reason === undefined ? {} : { reason }),
  });
  const nextSequences: Record<string, number> = {
    ...canonical.expectedNextSequenceByDevice,
    [meta.deviceId]: localSequence + 1,
  };
  const merged: CashRegisterSyncState = deepFreeze({
    ...canonical,
    version: nextVersion,
    movements: [...canonical.movements, newMovement],
    expectedNextSequenceByDevice: nextSequences,
  });
  return cashResult(entityId, "accepted", "ACCEPTED", nextVersion, false, Number(nextBalanceBig), null, merged, meta, baseVersion, amountMinor, currency);
}

function mergeCashRegisterTransition(
  canonical: CashRegisterSyncState,
  currentBalanceBig: bigint,
  currentBalanceMinor: number | null,
  rawEvent: PlainRecord,
  entityId: string,
  meta: SyncMergeEventMeta,
  baseVersion: number,
): CashMovementSyncMergeResult {
  const targetStatus = readEnum(rawEvent, "targetStatus", ["open", "closed"] as const, "event.targetStatus");
  const currency = readCurrency(rawEvent, "currency", "event.currency");
  const isOfflineEvent = readBoolean(rawEvent, "isOfflineEvent", "event.isOfflineEvent");
  const counted = readOptionalSafeInteger(rawEvent, "countedClosingBalanceMinor", "event.countedClosingBalanceMinor");
  const reason = readOptionalString(rawEvent, "reason", "event.reason");
  const authorization = readOptionalAuthorization(rawEvent, "authorization", "event.authorization");

  if (currency !== canonical.currency) {
    return cashResult(entityId, "rejected", "CURRENCY_MISMATCH", canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, counted ?? null, currency);
  }

  // Closed register: deduplicate exact same close replay, reject key reuse, conflict on double close or reopen!
  if (canonical.status === "closed") {
    if (targetStatus === "open") {
      return cashResult(entityId, "conflict", "CASH_REGISTER_REOPEN_CONFLICT", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, null, currency);
    }
    const sameEvent = canonical.closeEventId === meta.eventId;
    const sameKey = canonical.closeIdempotencyKey === meta.idempotencyKey;
    if (sameEvent || sameKey) {
      const sameFields = canonical.countedClosingBalanceMinor === (counted ?? null)
        && (canonical.closeReason ?? undefined) === reason;
      if (sameEvent) {
        if (!sameKey || !sameFields) {
          return cashResult(entityId, "rejected", "EVENT_ID_REUSE_CONFLICT", canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, counted ?? null, currency);
        }
        const diff = counted !== undefined && currentBalanceMinor !== null ? counted - currentBalanceMinor : null;
        return cashResult(entityId, "duplicate", "DUPLICATE_EVENT", canonical.version, false, currentBalanceMinor, diff, canonical, meta, baseVersion, counted ?? null, currency);
      }
      if (!sameFields) {
        return cashResult(entityId, "rejected", "IDEMPOTENCY_KEY_REUSE", canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, counted ?? null, currency);
      }
      const diff = counted !== undefined && currentBalanceMinor !== null ? counted - currentBalanceMinor : null;
      return cashResult(entityId, "duplicate", "DUPLICATE_IDEMPOTENCY_KEY", canonical.version, false, currentBalanceMinor, diff, canonical, meta, baseVersion, counted ?? null, currency);
    }
    return cashResult(entityId, "conflict", "CONCURRENT_CASH_REGISTER_CLOSE", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, counted ?? null, currency);
  }

  // Register is currently open.
  if (targetStatus === "open") {
    return cashResult(entityId, "duplicate", "ALREADY_IN_TARGET_STATE", canonical.version, false, currentBalanceMinor, null, canonical, meta, baseVersion, null, currency);
  }
  if (isOfflineEvent) {
    return cashResult(entityId, "rejected", "OFFLINE_CASH_REGISTER_CLOSE_FORBIDDEN", canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, counted ?? null, currency);
  }
  if (baseVersion > canonical.version) {
    return cashResult(entityId, "rejected", "INVALID_BASE_VERSION", canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, counted ?? null, currency);
  }
  if (baseVersion !== canonical.version) {
    return cashResult(entityId, "conflict", "STALE_BASE_VERSION", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, counted ?? null, currency);
  }
  if (authorization === undefined) {
    return cashResult(entityId, "rejected", "SUPERVISOR_AUTHORIZATION_REQUIRED", canonical.version, false, currentBalanceMinor, null, null, meta, baseVersion, counted ?? null, currency);
  }
  if (counted === undefined || counted < 0) {
    throw new InvalidSyncMergeInputError("event.countedClosingBalanceMinor");
  }
  if (currentBalanceBig < 0n || currentBalanceBig > MAX_SAFE_BIGINT) {
    return cashResult(entityId, "manual_review", "CASH_BALANCE_IMPOSSIBLE", canonical.version, true, currentBalanceMinor, null, null, meta, baseVersion, counted, currency);
  }

  const expectedMoney = new Money(Number(currentBalanceBig), currency);
  const countedMoney = new Money(counted, currency);
  const differenceMoney = countedMoney.subtract(expectedMoney);
  if (differenceMoney.amountMinor !== 0 && reason === undefined) {
    return cashResult(entityId, "rejected", "VARIANCE_REASON_REQUIRED", canonical.version, false, expectedMoney.amountMinor, differenceMoney.amountMinor, null, meta, baseVersion, counted, currency);
  }

  const nextVersion = canonical.version + 1;
  const merged: CashRegisterSyncState = deepFreeze({
    ...canonical,
    status: "closed" as const,
    version: nextVersion,
    closeEventId: meta.eventId,
    closeIdempotencyKey: meta.idempotencyKey,
    countedClosingBalanceMinor: counted,
    closeReason: reason ?? null,
  });
  return cashResult(entityId, "accepted", "ACCEPTED", nextVersion, false, expectedMoney.amountMinor, differenceMoney.amountMinor, merged, meta, baseVersion, counted, currency);
}

// ---- Helpers & Boundary Guards -------------------------------------------------------------

type PlainRecord = Readonly<Record<string, unknown>>;

function validateCashMovementShape(
  canonical: CashRegisterSyncState,
  operation: "create" | "compensate",
  type: CashMovementType,
  direction: CashMovementDirection,
  amountMinor: number,
  currency: string,
  isOfflineEvent: boolean,
  source: CashMovementSource | undefined,
  compensatesMovementId: string | undefined,
  reason: string | undefined,
  authorization: SyncSupervisorAuthorization | undefined,
): SyncMergeCode | null {
  if (operation === "compensate" || type === "cash_adjustment") {
    if (operation !== "compensate" || type !== "cash_adjustment") return "INVALID_CASH_MOVEMENT_SHAPE";
    if (reason === undefined) return "REASON_REQUIRED";
    if (authorization === undefined) return "SUPERVISOR_AUTHORIZATION_REQUIRED";
    if (source !== undefined || compensatesMovementId === undefined) return "COMPENSATION_INVALID";
    const original = canonical.movements.find((item) => item.movementId === compensatesMovementId);
    if (original === undefined || original.type === "cash_adjustment") return "COMPENSATION_INVALID";
    if (original.direction === direction || original.currency !== currency) return "COMPENSATION_INVALID";
    const alreadyCompensated = canonical.movements
      .filter((item) => item.compensatesMovementId === original.movementId)
      .reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
    const remaining = BigInt(original.amountMinor) - alreadyCompensated;
    if (BigInt(amountMinor) > remaining) return "COMPENSATION_INVALID";
    return null;
  }

  if (type === "cash_sale" || type === "tip_in") {
    if (direction !== "in" || compensatesMovementId !== undefined || source?.type !== "payment") {
      return "INVALID_CASH_MOVEMENT_SHAPE";
    }
    return null;
  }
  if (type === "cash_refund") {
    if (isOfflineEvent) return "OFFLINE_REFUND_FORBIDDEN";
    if (direction !== "out" || compensatesMovementId !== undefined || source?.type !== "refund") {
      return "INVALID_CASH_MOVEMENT_SHAPE";
    }
    return null;
  }
  // cash_in | cash_out
  if (reason === undefined) return "REASON_REQUIRED";
  if (compensatesMovementId !== undefined || source !== undefined) return "INVALID_CASH_MOVEMENT_SHAPE";
  if ((type === "cash_in" && direction !== "in") || (type === "cash_out" && direction !== "out")) {
    return "INVALID_CASH_MOVEMENT_SHAPE";
  }
  return null;
}

function computeCashBalanceBigInt(canonical: CashRegisterSyncState): bigint {
  let balance = BigInt(canonical.openingFloatMinor);
  for (const movement of canonical.movements) {
    balance = movement.direction === "in"
      ? balance + BigInt(movement.amountMinor)
      : balance - BigInt(movement.amountMinor);
  }
  return balance;
}

function computeChangeMinorSafe(
  amountMinor: number,
  tenderedMinor: number,
  tipMinor: number,
  currency: string,
): number | null {
  try {
    const amount = new Money(amountMinor, currency);
    const tendered = new Money(tenderedMinor, currency);
    const tip = tipMinor > 0 ? new Money(tipMinor, currency) : undefined;
    return cashChange(amount, tendered, tip).amountMinor;
  } catch {
    return null;
  }
}

function samePaymentBusinessIntent(prior: PaymentSyncRecord, event: NormalizedIncomingPaymentEvent): boolean {
  return prior.paymentId === event.entityId
    && prior.orderId === event.orderId
    && prior.amountMinor === event.amountMinor
    && prior.tipMinor === event.tipMinor
    && prior.tenderedAmountMinor === event.tenderedAmountMinor
    && prior.currency === event.currency
    && prior.method === event.method
    && prior.cashRegisterId === event.cashRegisterId
    && prior.cashierId === event.cashierId
    && prior.cashSequence === event.cashSequence;
}

function validateLineForOrder(input: OrderItemPricingInput, orderCurrency: string): CalculatedOrderItemTotals {
  let calculated: CalculatedOrderItemTotals;
  try {
    calculated = calculateOrderItemTotals(input);
  } catch {
    throw new InvalidSyncMergeInputError("orderItem");
  }
  if (calculated.total.currency !== orderCurrency) {
    throw new InvalidSyncMergeInputError("orderItem.currency");
  }
  return calculated;
}

function computeOrderTotals(order: OrderSyncState): { readonly totals: CalculatedOrderTotals; readonly payable: Money } {
  const result = safeComputeOrderTotals(order);
  if (!result.ok) throw new InvalidSyncMergeInputError("canonical.orderTotals");
  return { totals: result.totals, payable: result.payable };
}

function safeComputeOrderTotals(
  order: OrderSyncState,
): { readonly ok: true; readonly totals: CalculatedOrderTotals; readonly payable: Money } | { readonly ok: false; readonly code: SyncMergeCode } {
  try {
    if (order.status === "cancelled") {
      const totals = calculateOrderTotals({
        currency: order.currency,
        timeZone: order.timeZone,
        lines: [],
      });
      return { ok: true, totals, payable: totals.total };
    }
    const activeLines = order.items.filter((item) => item.status !== "cancelled");
    const totals = calculateOrderTotals({
      currency: order.currency,
      timeZone: order.timeZone,
      lines: activeLines,
      ...(order.orderDiscount === undefined ? {} : { orderDiscount: order.orderDiscount }),
      ...(order.tip === undefined ? {} : { tip: order.tip }),
    });
    const payable = order.deliveryCharge === null ? totals.total : totals.total.add(order.deliveryCharge.amount);
    return { ok: true, totals, payable };
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      if (error.code === "DISCOUNT_EXCEEDS_AMOUNT") return { ok: false, code: "DISCOUNT_EXCEEDS_AMOUNT" };
      if (error.code === "CURRENCY_MISMATCH") return { ok: false, code: "CURRENCY_MISMATCH" };
      if (error.code === "MONEY_OVERFLOW") return { ok: false, code: "MONEY_OVERFLOW" };
      if (error.code === "DUPLICATE_ORDER_ITEM_ID") return { ok: false, code: "DUPLICATE_ORDER_ITEM_ID" };
    }
    throw new InvalidSyncMergeInputError("orderTotals");
  }
}

function sameSnapshotUnitPrices(left: OrderItemPricingInput["snapshot"], right: OrderItemPricingInput["snapshot"]): boolean {
  if (!left.unitPrice.equals(right.unitPrice)) return false;
  if (left.modifiers.length !== right.modifiers.length) return false;
  for (let index = 0; index < left.modifiers.length; index += 1) {
    const a = left.modifiers[index];
    const b = right.modifiers[index];
    if (a === undefined || b === undefined) return false;
    if (a.modifierId !== b.modifierId || a.quantity !== b.quantity || !a.unitPrice.equals(b.unitPrice)) {
      return false;
    }
  }
  return true;
}

function linePricingFingerprint(line: OrderItemPricingInput): string {
  const mods = line.snapshot.modifiers
    .map((m) => `${m.modifierId}:${m.quantity}:${m.unitPrice.amountMinor}:${m.unitPrice.currency}`)
    .join(",");
  const disc = line.lineDiscount === undefined
    ? ""
    : `${line.lineDiscount.discountId}:${line.lineDiscount.amount.amountMinor}:${line.lineDiscount.amount.currency}`;
  return `${line.orderItemId}|${line.snapshot.productId}|${line.quantity}|${line.snapshot.unitPrice.amountMinor}:${line.snapshot.unitPrice.currency}|${mods}|${disc}|${line.note ?? ""}`;
}

function readItemIdUnsafe(item: OrderItemPricingInput): string {
  const record = asPlainRecord(item, "item");
  return readRequiredString(record, "orderItemId", "item.orderItemId");
}

function checkAppliedEventDedup(
  appliedEvents: readonly SyncAppliedEventRecord[] | undefined,
  eventId: string,
  idempotencyKey: string,
  entityId: string,
  operation: SyncMergeOperation,
  intentFingerprint: string,
): { readonly status: "duplicate" | "rejected"; readonly code: SyncMergeCode } | null {
  if (appliedEvents === undefined || appliedEvents.length === 0) return null;
  const byEvent = appliedEvents.find((entry) => entry.eventId === eventId);
  const byKey = appliedEvents.find((entry) => entry.idempotencyKey === idempotencyKey);
  const existing = byEvent ?? byKey;
  if (existing === undefined) return null;

  const sameIntent = existing.entityId === entityId
    && existing.operation === operation
    && existing.intentFingerprint === intentFingerprint;
  if (byEvent !== undefined) {
    if (!sameIntent || byEvent.idempotencyKey !== idempotencyKey) {
      return { status: "rejected", code: "EVENT_ID_REUSE_CONFLICT" };
    }
    return { status: "duplicate", code: "DUPLICATE_EVENT" };
  }
  if (!sameIntent) {
    return { status: "rejected", code: "IDEMPOTENCY_KEY_REUSE" };
  }
  return { status: "duplicate", code: "DUPLICATE_IDEMPOTENCY_KEY" };
}

function appliedEvent(
  meta: SyncMergeEventMeta,
  entityId: string,
  operation: SyncMergeOperation,
  intentFingerprint: string,
  canonicalVersion: number,
): SyncAppliedEventRecord {
  return Object.freeze({
    eventId: meta.eventId,
    idempotencyKey: meta.idempotencyKey,
    entityId,
    operation,
    intentFingerprint,
    canonicalVersion,
  });
}

function makeManualReviewEvidence(
  entityType: SyncMergeEntityType,
  entityId: string,
  code: SyncMergeCode,
  financial: boolean,
  meta: SyncMergeEventMeta,
  baseVersion: number | null,
  canonicalVersion: number | null,
  amountMinor: number | null = null,
  currency: string | null = null,
): SyncManualReviewEvidence {
  return Object.freeze({
    reasonCode: code,
    financial,
    entityType,
    entityId,
    eventId: meta.eventId,
    idempotencyKey: meta.idempotencyKey,
    deviceId: meta.deviceId,
    actorId: meta.actorId,
    baseVersion,
    canonicalVersion,
    amountMinor,
    currency,
    preserveEvidence: true as const,
  });
}

function makeTombstoneResult(
  entityType: SyncMergeEntityType,
  entityId: string,
  status: SyncMergeStatus,
  code: SyncMergeCode,
  canonicalVersion: number | null,
  financial: boolean,
  tombstoned: boolean,
  meta: SyncMergeEventMeta,
  baseVersion: number | null,
): TombstoneSyncMergeResult {
  const requiresManualReview = status === "manual_review" || status === "conflict";
  return deepFreeze({
    entityType,
    entityId,
    status,
    code,
    canonicalVersion,
    financial,
    requiresManualReview,
    manualReview: requiresManualReview
      ? makeManualReviewEvidence(entityType, entityId, code, financial, meta, baseVersion, canonicalVersion)
      : null,
    tombstoned,
  });
}

function orderResult(
  entityId: string,
  status: SyncMergeStatus,
  code: SyncMergeCode,
  canonicalVersion: number | null,
  financial: boolean,
  requiresManualReview: boolean,
  mergedState: OrderSyncState | null,
  recalculatedTotals: CalculatedOrderTotals | null,
  payableTotal: Money | null,
  meta: SyncMergeEventMeta,
  baseVersion: number | null,
  amountMinor: number | null = null,
  currency: string | null = null,
): OrderSyncMergeResult {
  const reviewFlag = status === "manual_review" || requiresManualReview;
  return deepFreeze({
    entityType: "Order" as const,
    entityId,
    status,
    code,
    canonicalVersion,
    financial,
    requiresManualReview: reviewFlag,
    manualReview: reviewFlag
      ? makeManualReviewEvidence("Order", entityId, code, financial, meta, baseVersion, canonicalVersion, amountMinor, currency)
      : null,
    mergedState,
    recalculatedTotals,
    payableTotal,
  });
}

function orderItemResult(
  entityId: string,
  status: SyncMergeStatus,
  code: SyncMergeCode,
  canonicalVersion: number | null,
  financial: boolean,
  requiresManualReview: boolean,
  tombstoned: boolean,
  mergedState: OrderItemSyncState | null,
  recalculatedLineTotals: CalculatedOrderItemTotals | null,
  meta: SyncMergeEventMeta,
  baseVersion: number | null,
  amountMinor: number | null = null,
  currency: string | null = null,
): OrderItemSyncMergeResult {
  const reviewFlag = status === "manual_review" || requiresManualReview;
  return deepFreeze({
    entityType: "OrderItem" as const,
    entityId,
    status,
    code,
    canonicalVersion,
    financial,
    requiresManualReview: reviewFlag,
    manualReview: reviewFlag
      ? makeManualReviewEvidence("OrderItem", entityId, code, financial, meta, baseVersion, canonicalVersion, amountMinor, currency)
      : null,
    tombstoned,
    mergedState,
    recalculatedLineTotals,
  });
}

function diningTableResult(
  entityId: string,
  status: SyncMergeStatus,
  code: SyncMergeCode,
  canonicalVersion: number | null,
  requiresManualReview: boolean,
  tombstoned: boolean,
  mergedState: DiningTableSyncState | null,
  meta: SyncMergeEventMeta,
  baseVersion: number | null,
): DiningTableSyncMergeResult {
  const reviewFlag = status === "manual_review" || requiresManualReview;
  return deepFreeze({
    entityType: "DiningTable" as const,
    entityId,
    status,
    code,
    canonicalVersion,
    financial: false,
    requiresManualReview: reviewFlag,
    manualReview: reviewFlag
      ? makeManualReviewEvidence("DiningTable", entityId, code, false, meta, baseVersion, canonicalVersion)
      : null,
    tombstoned,
    mergedState,
  });
}

function kdsResult(
  entityId: string,
  status: SyncMergeStatus,
  code: SyncMergeCode,
  canonicalVersion: number | null,
  requiresManualReview: boolean,
  keepTicketVisible: boolean,
  requiresCursorResync: boolean,
  mergedState: KdsTicketSyncState | null,
  meta: SyncMergeEventMeta,
  baseVersion: number | null,
): KdsTicketSyncMergeResult {
  const reviewFlag = status === "manual_review" || requiresManualReview;
  return deepFreeze({
    entityType: "KdsTicket" as const,
    entityId,
    status,
    code,
    canonicalVersion,
    financial: false,
    requiresManualReview: reviewFlag,
    manualReview: reviewFlag
      ? makeManualReviewEvidence("KdsTicket", entityId, code, false, meta, baseVersion, canonicalVersion)
      : null,
    keepTicketVisible,
    requiresCursorResync,
    mergedState,
  });
}

function paymentResult(
  event: NormalizedIncomingPaymentEvent,
  status: SyncMergeStatus,
  code: SyncMergeCode,
  blockNewCollection: boolean,
  requiresReconciliation: boolean,
  resultingPaymentState: PaymentSyncRecordState | null,
  changeMinor: number | null,
  remainingObligationMinor: number | null,
  overcollectionMinor: number,
  resultingOrderPaymentStatus: PaymentSyncMergeResult["resultingOrderPaymentStatus"],
  existingPaymentId: string | null,
): PaymentSyncMergeResult {
  const reviewFlag = status === "manual_review" || status === "conflict";
  return deepFreeze({
    entityType: "Payment" as const,
    entityId: event.entityId,
    status,
    code,
    canonicalVersion: status === "accepted" ? 1 : null,
    financial: true,
    requiresManualReview: reviewFlag,
    manualReview: reviewFlag
      ? makeManualReviewEvidence("Payment", event.entityId, code, true, event, event.baseVersion, null, event.amountMinor, event.currency)
      : null,
    blockNewCollection,
    requiresReconciliation,
    resultingPaymentState,
    changeMinor,
    remainingObligationMinor,
    overcollectionMinor,
    resultingOrderPaymentStatus,
    existingPaymentId,
  });
}

function cashResult(
  entityId: string,
  status: SyncMergeStatus,
  code: SyncMergeCode,
  canonicalVersion: number | null,
  requiresManualReview: boolean,
  expectedBalanceMinor: number | null,
  closingDifferenceMinor: number | null,
  mergedState: CashRegisterSyncState | null,
  meta: SyncMergeEventMeta,
  baseVersion: number | null,
  amountMinor: number | null,
  currency: string | null,
): CashMovementSyncMergeResult {
  const reviewFlag = status === "manual_review" || requiresManualReview;
  return deepFreeze({
    entityType: "CashMovement" as const,
    entityId,
    status,
    code,
    canonicalVersion,
    financial: true,
    requiresManualReview: reviewFlag,
    manualReview: reviewFlag
      ? makeManualReviewEvidence("CashMovement", entityId, code, true, meta, baseVersion, canonicalVersion, amountMinor, currency)
      : null,
    expectedBalanceMinor,
    closingDifferenceMinor,
    mergedState,
  });
}

// ---- Normalization & Input Validation ------------------------------------------------------

function normalizeTombstoneCanonical(value: unknown): TombstoneCanonicalState {
  const record = asPlainRecord(value, "canonical");
  return deepFreeze({
    entityType: readEnum(record, "entityType", SYNC_MERGE_ENTITY_TYPES, "canonical.entityType"),
    entityId: readRequiredString(record, "entityId", "canonical.entityId"),
    restaurantId: readRequiredString(record, "restaurantId", "canonical.restaurantId"),
    branchId: readRequiredString(record, "branchId", "canonical.branchId"),
    version: readSafeNonNegativeInt(record, "version", "canonical.version"),
    tombstoned: readBoolean(record, "tombstoned", "canonical.tombstoned"),
    allowTombstone: readBoolean(record, "allowTombstone", "canonical.allowTombstone"),
    ...(optionalOwnData(record, "appliedEvents", "canonical.appliedEvents") === undefined
      ? {}
      : { appliedEvents: normalizeAppliedEvents(ownData(record, "appliedEvents", "canonical.appliedEvents")) }),
  });
}

function normalizeOrderCanonical(value: unknown): OrderSyncState {
  const record = asPlainRecord(value, "canonical");
  const channel = readEnum(record, "channel", ORDER_CHANNELS, "canonical.channel");
  const tableId = readOptionalString(record, "tableId", "canonical.tableId");
  if ((channel === "table") !== (tableId !== undefined)) {
    throw new InvalidSyncMergeInputError("canonical.tableId");
  }
  const currency = readCurrency(record, "currency", "canonical.currency");
  const deliveryCharge = readOptionalDeliveryCharge(record, "deliveryCharge", currency, "canonical.deliveryCharge");
  const rawItems = readDataArray(ownData(record, "items", "canonical.items"), "canonical.items");
  const restaurantId = readRequiredString(record, "restaurantId", "canonical.restaurantId");
  const branchId = readRequiredString(record, "branchId", "canonical.branchId");
  const seenIds = new Set<string>();
  const items: OrderItem[] = [];
  for (const rawItem of rawItems) {
    const itemRecord = asPlainRecord(rawItem, "canonical.items");
    const itemRestaurantId = readRequiredString(itemRecord, "restaurantId", "canonical.items.restaurantId");
    const itemBranchId = readRequiredString(itemRecord, "branchId", "canonical.items.branchId");
    if (itemRestaurantId !== restaurantId || itemBranchId !== branchId) {
      throw new InvalidSyncMergeInputError("canonical.items.scope");
    }
    const itemStatus = readEnum(itemRecord, "status", ORDER_ITEM_STATES, "canonical.items.status");
    const cancellationAudit = optionalOwnData(itemRecord, "cancellationAudit", "canonical.items.cancellationAudit") as OrderItemCancellationAudit | undefined;
    const rawLineDiscount = optionalOwnData(itemRecord, "lineDiscount", "canonical.items.lineDiscount");
    const rawNote = optionalOwnData(itemRecord, "note", "canonical.items.note");
    const pricingInput: OrderItemPricingInput = {
      orderItemId: readRequiredString(itemRecord, "orderItemId", "canonical.items.orderItemId"),
      snapshot: ownData(itemRecord, "snapshot", "canonical.items.snapshot") as OrderItemPricingInput["snapshot"],
      quantity: readSafePositiveInt(itemRecord, "quantity", "canonical.items.quantity"),
      ...(rawLineDiscount === undefined
        ? {}
        : { lineDiscount: rawLineDiscount as NonNullable<OrderItemPricingInput["lineDiscount"]> }),
      ...(rawNote === undefined
        ? {}
        : { note: rawNote as string | null }),
    };
    const calculated = validateLineForOrder(pricingInput, currency);
    if (seenIds.has(calculated.input.orderItemId)) {
      throw new InvalidSyncMergeInputError("canonical.items.orderItemId");
    }
    seenIds.add(calculated.input.orderItemId);
    items.push(deepFreeze({
      ...calculated.input,
      restaurantId: itemRestaurantId,
      branchId: itemBranchId,
      status: itemStatus,
      ...(cancellationAudit === undefined ? {} : { cancellationAudit }),
    }));
  }

  const capturedAmountMinor = readOptionalSafeNonNegativeInt(record, "capturedAmountMinor", "canonical.capturedAmountMinor") ?? 0;
  const orderDiscount = optionalOwnData(record, "orderDiscount", "canonical.orderDiscount") as OrderDiscountSnapshot | undefined;
  const tip = optionalOwnData(record, "tip", "canonical.tip") as Money | undefined;
  const customerId = readOptionalNullableString(record, "customerId", "canonical.customerId");

  return deepFreeze({
    orderId: readRequiredString(record, "orderId", "canonical.orderId"),
    restaurantId,
    branchId,
    channel,
    ...(tableId === undefined ? {} : { tableId }),
    ...(customerId === undefined ? {} : { customerId }),
    currency,
    timeZone: readRequiredString(record, "timeZone", "canonical.timeZone"),
    status: readEnum(record, "status", ORDER_STATES, "canonical.status"),
    version: readSafeNonNegativeInt(record, "version", "canonical.version"),
    items,
    ...(orderDiscount === undefined ? {} : { orderDiscount }),
    ...(tip === undefined ? {} : { tip }),
    deliveryCharge,
    capturedAmountMinor,
    ...(optionalOwnData(record, "appliedEvents", "canonical.appliedEvents") === undefined
      ? {}
      : { appliedEvents: normalizeAppliedEvents(ownData(record, "appliedEvents", "canonical.appliedEvents")) }),
  });
}

function normalizeOrderItemCanonical(value: unknown, orderCurrency: string): OrderItemSyncState {
  const record = asPlainRecord(value, "canonical");
  const rawItem = ownData(record, "item", "canonical.item") as OrderItemPricingInput;
  const calculated = validateLineForOrder(rawItem, orderCurrency);
  const orderItemId = readRequiredString(record, "orderItemId", "canonical.orderItemId");
  if (calculated.input.orderItemId !== orderItemId) throw new InvalidSyncMergeInputError("canonical.item.orderItemId");
  const cancellationAudit = optionalOwnData(record, "cancellationAudit", "canonical.cancellationAudit") as OrderItemCancellationAudit | undefined;
  return deepFreeze({
    orderItemId,
    orderId: readRequiredString(record, "orderId", "canonical.orderId"),
    restaurantId: readRequiredString(record, "restaurantId", "canonical.restaurantId"),
    branchId: readRequiredString(record, "branchId", "canonical.branchId"),
    version: readSafeNonNegativeInt(record, "version", "canonical.version"),
    status: readEnum(record, "status", ORDER_ITEM_STATES, "canonical.status"),
    item: calculated.input,
    tombstoned: readBoolean(record, "tombstoned", "canonical.tombstoned"),
    ...(cancellationAudit === undefined ? {} : { cancellationAudit }),
    ...(optionalOwnData(record, "appliedEvents", "canonical.appliedEvents") === undefined
      ? {}
      : { appliedEvents: normalizeAppliedEvents(ownData(record, "appliedEvents", "canonical.appliedEvents")) }),
  });
}

function normalizeDiningTableCanonical(value: unknown): DiningTableSyncState {
  const record = asPlainRecord(value, "canonical");
  const status = readEnum(record, "status", DINING_TABLE_SYNC_STATES, "canonical.status");
  const activeOrderId = readNullableString(record, "activeOrderId", "canonical.activeOrderId");
  if (status === "occupied" && activeOrderId === null) {
    throw new InvalidSyncMergeInputError("canonical.activeOrderId");
  }
  if (status !== "occupied" && activeOrderId !== null) {
    throw new InvalidSyncMergeInputError("canonical.activeOrderId");
  }
  return deepFreeze({
    tableId: readRequiredString(record, "tableId", "canonical.tableId"),
    restaurantId: readRequiredString(record, "restaurantId", "canonical.restaurantId"),
    branchId: readRequiredString(record, "branchId", "canonical.branchId"),
    version: readSafeNonNegativeInt(record, "version", "canonical.version"),
    status,
    activeOrderId,
    reservationId: readNullableString(record, "reservationId", "canonical.reservationId"),
    waiterUserId: readNullableString(record, "waiterUserId", "canonical.waiterUserId"),
    shiftId: readNullableString(record, "shiftId", "canonical.shiftId"),
    tombstoned: readBoolean(record, "tombstoned", "canonical.tombstoned"),
    ...(optionalOwnData(record, "appliedEvents", "canonical.appliedEvents") === undefined
      ? {}
      : { appliedEvents: normalizeAppliedEvents(ownData(record, "appliedEvents", "canonical.appliedEvents")) }),
  });
}

function normalizeKdsTicketCanonical(value: unknown): KdsTicketSyncState {
  const record = asPlainRecord(value, "canonical");
  return deepFreeze({
    ticketId: readRequiredString(record, "ticketId", "canonical.ticketId"),
    orderId: readRequiredString(record, "orderId", "canonical.orderId"),
    orderItemId: readRequiredString(record, "orderItemId", "canonical.orderItemId"),
    restaurantId: readRequiredString(record, "restaurantId", "canonical.restaurantId"),
    branchId: readRequiredString(record, "branchId", "canonical.branchId"),
    stationId: readRequiredString(record, "stationId", "canonical.stationId"),
    version: readSafeNonNegativeInt(record, "version", "canonical.version"),
    status: readEnum(record, "status", KDS_TICKET_SYNC_STATES, "canonical.status"),
    acknowledged: readBoolean(record, "acknowledged", "canonical.acknowledged"),
    ...(optionalOwnData(record, "appliedEvents", "canonical.appliedEvents") === undefined
      ? {}
      : { appliedEvents: normalizeAppliedEvents(ownData(record, "appliedEvents", "canonical.appliedEvents")) }),
  });
}

interface NormalizedPaymentContext extends PaymentSyncContext {
  readonly offlineCashLimitMinor: number | null;
}

function normalizePaymentContext(value: unknown): NormalizedPaymentContext {
  const record = asPlainRecord(value, "context");
  const currency = readCurrency(record, "currency", "context.currency");
  const rawPayments = readDataArray(ownData(record, "existingPayments", "context.existingPayments"), "context.existingPayments");
  const existingPayments: PaymentSyncRecord[] = rawPayments.map((raw, index) => {
    const p = asPlainRecord(raw, `context.existingPayments[${index}]`);
    const amountMinor = readSafePositiveInt(p, "amountMinor", `context.existingPayments[${index}].amountMinor`);
    const tipMinor = readSafeNonNegativeInt(p, "tipMinor", `context.existingPayments[${index}].tipMinor`);
    const tenderedAmountMinor = readNullableSafeNonNegativeInt(p, "tenderedAmountMinor", `context.existingPayments[${index}].tenderedAmountMinor`);
    const refundedAmountMinor = readOptionalSafeNonNegativeInt(p, "refundedAmountMinor", `context.existingPayments[${index}].refundedAmountMinor`) ?? 0;
    return deepFreeze({
      paymentId: readRequiredString(p, "paymentId", `context.existingPayments[${index}].paymentId`),
      eventId: readRequiredString(p, "eventId", `context.existingPayments[${index}].eventId`),
      idempotencyKey: readRequiredString(p, "idempotencyKey", `context.existingPayments[${index}].idempotencyKey`),
      orderId: readRequiredString(p, "orderId", `context.existingPayments[${index}].orderId`),
      amountMinor,
      tipMinor,
      tenderedAmountMinor,
      currency: readCurrency(p, "currency", `context.existingPayments[${index}].currency`),
      method: readEnum(p, "method", PAYMENT_METHODS, `context.existingPayments[${index}].method`),
      state: readEnum(p, "state", PAYMENT_RECORD_STATES, `context.existingPayments[${index}].state`),
      deviceId: readRequiredString(p, "deviceId", `context.existingPayments[${index}].deviceId`),
      cashRegisterId: readNullableString(p, "cashRegisterId", `context.existingPayments[${index}].cashRegisterId`),
      cashierId: readNullableString(p, "cashierId", `context.existingPayments[${index}].cashierId`),
      cashSequence: readNullableSafePositiveInt(p, "cashSequence", `context.existingPayments[${index}].cashSequence`),
      receiptNumber: readNullableString(p, "receiptNumber", `context.existingPayments[${index}].receiptNumber`),
      refundedAmountMinor,
    });
  });

  const cashRegisterOpen = readOptionalBoolean(record, "cashRegisterOpen", "context.cashRegisterOpen");
  const rawLimit = optionalOwnData(record, "offlineCashLimitMinor", "context.offlineCashLimitMinor");
  let offlineCashLimitMinor: number | null = null;
  if (rawLimit !== undefined && rawLimit !== null) {
    if (typeof rawLimit !== "number" || !Number.isSafeInteger(rawLimit) || rawLimit < 0) {
      throw new InvalidSyncMergeInputError("context.offlineCashLimitMinor");
    }
    offlineCashLimitMinor = rawLimit;
  }
  const rawSeqMap = optionalOwnData(record, "expectedCashSequenceByDevice", "context.expectedCashSequenceByDevice");
  const expectedCashSequenceByDevice = rawSeqMap === undefined
    ? undefined
    : normalizeDeviceSequenceMap(rawSeqMap, "context.expectedCashSequenceByDevice");

  return deepFreeze({
    restaurantId: readRequiredString(record, "restaurantId", "context.restaurantId"),
    branchId: readRequiredString(record, "branchId", "context.branchId"),
    orderId: readRequiredString(record, "orderId", "context.orderId"),
    orderStatus: readEnum(record, "orderStatus", ORDER_STATES, "context.orderStatus"),
    currency,
    orderTotalMinor: readSafeNonNegativeInt(record, "orderTotalMinor", "context.orderTotalMinor"),
    existingPayments,
    ...(cashRegisterOpen === undefined ? {} : { cashRegisterOpen }),
    offlineCashLimitMinor,
    ...(expectedCashSequenceByDevice === undefined ? {} : { expectedCashSequenceByDevice }),
  });
}

interface NormalizedIncomingPaymentEvent extends SyncMergeEventMeta {
  readonly entityId: string;
  readonly orderId: string;
  readonly operation: SyncMergeOperation;
  readonly baseVersion: number | null;
  readonly amountMinor: number;
  readonly tipMinor: number;
  readonly tenderedAmountMinor: number | null;
  readonly currency: string;
  readonly method: PaymentMethod;
  readonly isOfflineEvent: boolean;
  readonly cashRegisterId: string | null;
  readonly cashierId: string | null;
  readonly cashSequence: number | null;
  readonly receiptNumber: string | null;
  readonly providerStatus: "confirmed" | "pending" | "uncertain" | null;
  readonly cardManualExternalConfirmed: boolean;
  readonly compensatesPaymentId?: string;
  readonly reason?: string;
  readonly authorization?: SyncSupervisorAuthorization;
}

function normalizeIncomingPaymentEvent(value: unknown): NormalizedIncomingPaymentEvent {
  const record = asPlainRecord(value, "event");
  const meta = readEventMeta(record, "event");
  const operation = readEnum(record, "operation", SYNC_MERGE_OPERATIONS, "event.operation");
  const baseVersion = readOptionalBaseVersion(record, "event.baseVersion");
  const rawTendered = optionalOwnData(record, "tenderedAmountMinor", "event.tenderedAmountMinor");
  let tenderedAmountMinor: number | null = null;
  if (rawTendered !== undefined && rawTendered !== null) {
    if (typeof rawTendered !== "number" || !Number.isSafeInteger(rawTendered) || rawTendered < 0) {
      throw new InvalidSyncMergeInputError("event.tenderedAmountMinor");
    }
    tenderedAmountMinor = rawTendered;
  }
  const rawCashSeq = optionalOwnData(record, "cashSequence", "event.cashSequence");
  let cashSequence: number | null = null;
  if (rawCashSeq !== undefined && rawCashSeq !== null) {
    if (typeof rawCashSeq !== "number" || !Number.isSafeInteger(rawCashSeq)) {
      throw new InvalidSyncMergeInputError("event.cashSequence");
    }
    cashSequence = rawCashSeq;
  }
  const rawProvider = optionalOwnData(record, "providerStatus", "event.providerStatus");
  let providerStatus: "confirmed" | "pending" | "uncertain" | null = null;
  if (rawProvider !== undefined && rawProvider !== null) {
    if (rawProvider !== "confirmed" && rawProvider !== "pending" && rawProvider !== "uncertain") {
      throw new InvalidSyncMergeInputError("event.providerStatus");
    }
    providerStatus = rawProvider;
  }

  const compensatesPaymentId = readOptionalString(record, "compensatesPaymentId", "event.compensatesPaymentId");
  const reason = readOptionalString(record, "reason", "event.reason");
  const authorization = readOptionalAuthorization(record, "authorization", "event.authorization");

  return deepFreeze({
    ...meta,
    entityId: readRequiredString(record, "entityId", "event.entityId"),
    orderId: readRequiredString(record, "orderId", "event.orderId"),
    operation,
    baseVersion,
    amountMinor: readSafeInteger(record, "amountMinor", "event.amountMinor"),
    tipMinor: readOptionalSafeNonNegativeInt(record, "tipMinor", "event.tipMinor") ?? 0,
    tenderedAmountMinor,
    currency: readCurrency(record, "currency", "event.currency"),
    method: readEnum(record, "method", PAYMENT_METHODS, "event.method"),
    isOfflineEvent: readBoolean(record, "isOfflineEvent", "event.isOfflineEvent"),
    cashRegisterId: readOptionalNullableString(record, "cashRegisterId", "event.cashRegisterId") ?? null,
    cashierId: readOptionalNullableString(record, "cashierId", "event.cashierId") ?? null,
    cashSequence,
    receiptNumber: readOptionalNullableString(record, "receiptNumber", "event.receiptNumber") ?? null,
    providerStatus,
    cardManualExternalConfirmed: readOptionalBoolean(record, "cardManualExternalConfirmed", "event.cardManualExternalConfirmed") ?? false,
    ...(compensatesPaymentId === undefined ? {} : { compensatesPaymentId }),
    ...(reason === undefined ? {} : { reason }),
    ...(authorization === undefined ? {} : { authorization }),
  });
}

interface NormalizedCashRegisterCanonical extends CashRegisterSyncState {
  readonly offlineCashLimitMinor: number | null;
}

function normalizeCashRegisterCanonical(value: unknown): NormalizedCashRegisterCanonical {
  const record = asPlainRecord(value, "canonical");
  const currency = readCurrency(record, "currency", "canonical.currency");
  const rawMovements = readDataArray(ownData(record, "movements", "canonical.movements"), "canonical.movements");
  const movements: CashMovementSyncRecord[] = rawMovements.map((raw, index) => {
    const m = asPlainRecord(raw, `canonical.movements[${index}]`);
    const source = readOptionalCashSource(m, "source", `canonical.movements[${index}].source`);
    const compensatesMovementId = readOptionalString(m, "compensatesMovementId", `canonical.movements[${index}].compensatesMovementId`);
    const reason = readOptionalString(m, "reason", `canonical.movements[${index}].reason`);
    return deepFreeze({
      movementId: readRequiredString(m, "movementId", `canonical.movements[${index}].movementId`),
      eventId: readRequiredString(m, "eventId", `canonical.movements[${index}].eventId`),
      idempotencyKey: readRequiredString(m, "idempotencyKey", `canonical.movements[${index}].idempotencyKey`),
      deviceId: readRequiredString(m, "deviceId", `canonical.movements[${index}].deviceId`),
      localSequence: readSafePositiveInt(m, "localSequence", `canonical.movements[${index}].localSequence`),
      type: readEnum(m, "type", CASH_MOVEMENT_TYPES, `canonical.movements[${index}].type`),
      direction: readEnum(m, "direction", ["in", "out"] as const, `canonical.movements[${index}].direction`),
      amountMinor: readSafePositiveInt(m, "amountMinor", `canonical.movements[${index}].amountMinor`),
      currency: readCurrency(m, "currency", `canonical.movements[${index}].currency`),
      ...(source === undefined ? {} : { source }),
      ...(compensatesMovementId === undefined ? {} : { compensatesMovementId }),
      ...(reason === undefined ? {} : { reason }),
    });
  });

  const expectedNextSequenceByDevice = normalizeDeviceSequenceMap(
    ownData(record, "expectedNextSequenceByDevice", "canonical.expectedNextSequenceByDevice"),
    "canonical.expectedNextSequenceByDevice",
  );
  const rawLimit = optionalOwnData(record, "offlineCashLimitMinor", "canonical.offlineCashLimitMinor");
  let offlineCashLimitMinor: number | null = null;
  if (rawLimit !== undefined && rawLimit !== null) {
    if (typeof rawLimit !== "number" || !Number.isSafeInteger(rawLimit) || rawLimit < 0) {
      throw new InvalidSyncMergeInputError("canonical.offlineCashLimitMinor");
    }
    offlineCashLimitMinor = rawLimit;
  }

  const closeEventId = readOptionalNullableString(record, "closeEventId", "canonical.closeEventId") ?? null;
  const closeIdempotencyKey = readOptionalNullableString(record, "closeIdempotencyKey", "canonical.closeIdempotencyKey") ?? null;
  const rawCounted = optionalOwnData(record, "countedClosingBalanceMinor", "canonical.countedClosingBalanceMinor");
  let countedClosingBalanceMinor: number | null = null;
  if (rawCounted !== undefined && rawCounted !== null) {
    if (typeof rawCounted !== "number" || !Number.isSafeInteger(rawCounted) || rawCounted < 0) {
      throw new InvalidSyncMergeInputError("canonical.countedClosingBalanceMinor");
    }
    countedClosingBalanceMinor = rawCounted;
  }
  const closeReason = readOptionalNullableString(record, "closeReason", "canonical.closeReason") ?? null;

  return deepFreeze({
    cashRegisterId: readRequiredString(record, "cashRegisterId", "canonical.cashRegisterId"),
    restaurantId: readRequiredString(record, "restaurantId", "canonical.restaurantId"),
    branchId: readRequiredString(record, "branchId", "canonical.branchId"),
    registerId: readRequiredString(record, "registerId", "canonical.registerId"),
    shiftId: readRequiredString(record, "shiftId", "canonical.shiftId"),
    cashierId: readRequiredString(record, "cashierId", "canonical.cashierId"),
    currency,
    status: readEnum(record, "status", ["open", "closed"] as const, "canonical.status"),
    version: readSafeNonNegativeInt(record, "version", "canonical.version"),
    openingFloatMinor: readSafeNonNegativeInt(record, "openingFloatMinor", "canonical.openingFloatMinor"),
    movements,
    expectedNextSequenceByDevice,
    offlineCashLimitMinor,
    closeEventId,
    closeIdempotencyKey,
    countedClosingBalanceMinor,
    closeReason,
  });
}

function normalizeAppliedEvents(value: unknown): readonly SyncAppliedEventRecord[] {
  const array = readDataArray(value, "appliedEvents");
  return deepFreeze(array.map((raw, index) => {
    const r = asPlainRecord(raw, `appliedEvents[${index}]`);
    return Object.freeze({
      eventId: readRequiredString(r, "eventId", `appliedEvents[${index}].eventId`),
      idempotencyKey: readRequiredString(r, "idempotencyKey", `appliedEvents[${index}].idempotencyKey`),
      entityId: readRequiredString(r, "entityId", `appliedEvents[${index}].entityId`),
      operation: readEnum(r, "operation", SYNC_MERGE_OPERATIONS, `appliedEvents[${index}].operation`),
      intentFingerprint: readRequiredString(r, "intentFingerprint", `appliedEvents[${index}].intentFingerprint`),
      canonicalVersion: readSafeNonNegativeInt(r, "canonicalVersion", `appliedEvents[${index}].canonicalVersion`),
    });
  }));
}

function normalizeDeviceSequenceMap(value: unknown, field: string): Readonly<Record<string, number>> {
  const record = asPlainRecord(value, field);
  const copy: Record<string, number> = {};
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || key.trim().length === 0 || key === "__proto__") {
      throw new InvalidSyncMergeInputError(field);
    }
    const seq = ownData(record, key, `${field}.${key}`);
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq <= 0) {
      throw new InvalidSyncMergeInputError(`${field}.${key}`);
    }
    copy[key] = seq;
  }
  return Object.freeze(copy);
}

function ownOptionalSafePositiveInt(map: Readonly<Record<string, number>>, key: string): number | undefined {
  if (!Object.hasOwn(map, key)) return undefined;
  const val = map[key];
  return typeof val === "number" && Number.isSafeInteger(val) && val > 0 ? val : undefined;
}

function readEventMeta(record: PlainRecord, field: string): SyncMergeEventMeta {
  const occurredAt = readRequiredString(record, "occurredAt", `${field}.occurredAt`);
  if (!isValidRfc3339Utc(occurredAt)) {
    throw new InvalidSyncMergeInputError(`${field}.occurredAt`);
  }
  return Object.freeze({
    eventId: readRequiredString(record, "eventId", `${field}.eventId`),
    idempotencyKey: readRequiredString(record, "idempotencyKey", `${field}.idempotencyKey`),
    deviceId: readRequiredString(record, "deviceId", `${field}.deviceId`),
    actorId: readRequiredString(record, "actorId", `${field}.actorId`),
    restaurantId: readRequiredString(record, "restaurantId", `${field}.restaurantId`),
    branchId: readRequiredString(record, "branchId", `${field}.branchId`),
    occurredAt,
  });
}

function readBaseVersion(record: PlainRecord, operation: SyncMergeOperation, field: string): number | null {
  const value = ownData(record, "baseVersion", field);
  if (operation === "create") {
    if (value !== null) throw new InvalidSyncMergeInputError(field);
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readOptionalBaseVersion(record: PlainRecord, field: string): number | null {
  const value = optionalOwnData(record, "baseVersion", field);
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readOptionalDeliveryCharge(
  record: PlainRecord,
  key: string,
  currency: string,
  field: string,
): DeliveryChargeSnapshot | null {
  const value = optionalOwnData(record, key, field);
  if (value === undefined || value === null) return null;
  const dc = asPlainRecord(value, field);
  const quoteId = readRequiredString(dc, "quoteId", `${field}.quoteId`);
  const amount = assertValidMoney(ownData(dc, "amount", `${field}.amount`), `${field}.amount`);
  if (amount.amountMinor < 0 || amount.currency !== currency) {
    throw new InvalidSyncMergeInputError(field);
  }
  return deepFreeze({ amount, quoteId });
}

function readOptionalCashSource(record: PlainRecord, key: string, field: string): CashMovementSource | undefined {
  const value = optionalOwnData(record, key, field);
  if (value === undefined) return undefined;
  const src = asPlainRecord(value, field);
  const type = readEnum(src, "type", ["payment", "refund"] as const, `${field}.type`);
  if (type === "payment") {
    return Object.freeze({
      type: "payment" as const,
      paymentId: readRequiredString(src, "paymentId", `${field}.paymentId`),
    });
  }
  return Object.freeze({
    type: "refund" as const,
    refundId: readRequiredString(src, "refundId", `${field}.refundId`),
    paymentId: readRequiredString(src, "paymentId", `${field}.paymentId`),
  });
}

function sameCashSource(left: CashMovementSource | undefined, right: CashMovementSource | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.type !== right.type) return false;
  if (left.type === "payment" && right.type === "payment") return left.paymentId === right.paymentId;
  if (left.type === "refund" && right.type === "refund") {
    return left.refundId === right.refundId && left.paymentId === right.paymentId;
  }
  return false;
}

function readOptionalAuthorization(record: PlainRecord, key: string, field: string): SyncSupervisorAuthorization | undefined {
  const value = optionalOwnData(record, key, field);
  if (value === undefined) return undefined;
  const auth = asPlainRecord(value, field);
  const approved = ownData(auth, "approved", `${field}.approved`);
  const actorId = readRequiredString(auth, "actorId", `${field}.actorId`);
  if (approved !== true) throw new InvalidSyncMergeInputError(`${field}.approved`);
  return Object.freeze({ approved: true as const, actorId });
}

function readMoneyAmountMinor(discount: OrderDiscountSnapshot, field: string): number {
  const record = asPlainRecord(discount, field);
  const amount = assertValidMoney(ownData(record, "amount", `${field}.amount`), `${field}.amount`);
  return amount.amountMinor;
}

function orderDiscountFingerprint(discount: OrderDiscountSnapshot, field: string): string {
  const record = asPlainRecord(discount, field);
  const discountId = readRequiredString(record, "discountId", `${field}.discountId`);
  const discountRuleVersion = readRequiredString(record, "discountRuleVersion", `${field}.discountRuleVersion`);
  const allocationStrategy = readRequiredString(record, "allocationStrategy", `${field}.allocationStrategy`);
  const amount = assertValidMoney(ownData(record, "amount", `${field}.amount`), `${field}.amount`);
  return `${discountId}:${discountRuleVersion}:${allocationStrategy}:${amount.amountMinor}:${amount.currency}`;
}

function assertValidMoney(value: unknown, field: string): Money {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Money.prototype) {
    throw new InvalidSyncMergeInputError(field);
  }
  const record = value as PlainRecord;
  const amountMinor = ownData(record, "amountMinor", `${field}.amountMinor`);
  const currency = ownData(record, "currency", `${field}.currency`);
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || typeof currency !== "string" || !ISO_4217_PATTERN.test(currency)) {
    throw new InvalidSyncMergeInputError(field);
  }
  return new Money(amountMinor, currency);
}

function sameScope(
  left: { readonly restaurantId: string; readonly branchId: string },
  right: { readonly restaurantId: string; readonly branchId: string },
): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

function isValidRfc3339Utc(value: string): boolean {
  const match = RFC3339_UTC_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toSafeIntClamped(value: bigint): number {
  if (value <= 0n) return 0;
  return value > MAX_SAFE_BIGINT ? Number.MAX_SAFE_INTEGER : Number(value);
}

function asPlainRecord(value: unknown, field: string): PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidSyncMergeInputError(field);
  }
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidSyncMergeInputError(field);
    }
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new InvalidSyncMergeInputError(field);
      }
    }
    return value as PlainRecord;
  } catch (error: unknown) {
    if (error instanceof InvalidSyncMergeInputError) throw error;
    throw new InvalidSyncMergeInputError(field);
  }
}

function ownData(record: PlainRecord, key: string, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new InvalidSyncMergeInputError(field);
  }
  return descriptor.value;
}

function optionalOwnData(record: PlainRecord, key: string, field: string): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new InvalidSyncMergeInputError(field);
  return descriptor.value;
}

function readDataArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new InvalidSyncMergeInputError(field);
  }
  const lengthDesc = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDesc === undefined || !("value" in lengthDesc) || typeof lengthDesc.value !== "number" || !Number.isSafeInteger(lengthDesc.value) || lengthDesc.value < 0) {
    throw new InvalidSyncMergeInputError(field);
  }
  const items: unknown[] = [];
  for (let index = 0; index < lengthDesc.value; index += 1) {
    const desc = Object.getOwnPropertyDescriptor(value, index);
    if (desc === undefined || !("value" in desc)) {
      throw new InvalidSyncMergeInputError(field);
    }
    items.push(desc.value);
  }
  return items;
}

function readRequiredString(record: PlainRecord, key: string, field: string): string {
  const value = ownData(record, key, field);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readOptionalString(record: PlainRecord, key: string, field: string): string | undefined {
  const value = optionalOwnData(record, key, field);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readNullableString(record: PlainRecord, key: string, field: string): string | null {
  const value = ownData(record, key, field);
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readOptionalNullableString(record: PlainRecord, key: string, field: string): string | null | undefined {
  const value = optionalOwnData(record, key, field);
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readCurrency(record: PlainRecord, key: string, field: string): string {
  const value = ownData(record, key, field);
  if (typeof value !== "string" || !ISO_4217_PATTERN.test(value)) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readBoolean(record: PlainRecord, key: string, field: string): boolean {
  const value = ownData(record, key, field);
  if (typeof value !== "boolean") throw new InvalidSyncMergeInputError(field);
  return value;
}

function readOptionalBoolean(record: PlainRecord, key: string, field: string): boolean | undefined {
  const value = optionalOwnData(record, key, field);
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new InvalidSyncMergeInputError(field);
  return value;
}

function readSafeInteger(record: PlainRecord, key: string, field: string): number {
  const value = ownData(record, key, field);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readOptionalSafeInteger(record: PlainRecord, key: string, field: string): number | undefined {
  const value = optionalOwnData(record, key, field);
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readSafeNonNegativeInt(record: PlainRecord, key: string, field: string): number {
  const value = readSafeInteger(record, key, field);
  if (value < 0) throw new InvalidSyncMergeInputError(field);
  return value;
}

function readOptionalSafeNonNegativeInt(record: PlainRecord, key: string, field: string): number | undefined {
  const value = readOptionalSafeInteger(record, key, field);
  if (value === undefined) return undefined;
  if (value < 0) throw new InvalidSyncMergeInputError(field);
  return value;
}

function readNullableSafeNonNegativeInt(record: PlainRecord, key: string, field: string): number | null {
  const value = ownData(record, key, field);
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readSafePositiveInt(record: PlainRecord, key: string, field: string): number {
  const value = readSafeInteger(record, key, field);
  if (value <= 0) throw new InvalidSyncMergeInputError(field);
  return value;
}

function readNullableSafePositiveInt(record: PlainRecord, key: string, field: string): number | null {
  const value = ownData(record, key, field);
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value;
}

function readEnum<const T extends readonly string[]>(
  record: PlainRecord,
  key: string,
  allowed: T,
  field: string,
): T[number] {
  const value = ownData(record, key, field);
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value as T[number];
}

function readOptionalEnum<const T extends readonly string[]>(
  record: PlainRecord,
  key: string,
  allowed: T,
  field: string,
): T[number] | undefined {
  const value = optionalOwnData(record, key, field);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new InvalidSyncMergeInputError(field);
  }
  return value as T[number];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.get === undefined && descriptor.set === undefined) {
        deepFreeze(descriptor.value, seen);
      }
    }
    Object.freeze(value);
  }
  return value;
}
