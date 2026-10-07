import {
  parseAddOrderItemCommandV1,
  parseCancelOrderCommandV1,
  parseCancelOrderItemCommandV1,
  parseCreateOrderCommandV1,
  parseCreateOrderCommandV2,
  parseKdsCursorV1,
  parseKdsEventPageV1,
  parseKdsEventV1,
  parseKdsTicketListV1,
  parseOpenOrderCommandV1,
  parseOrderRefundObligationV1,
  parseBranchScope,
  parseOrderDetailRequestV1,
  parseOrderDetailV1,
  parseRealtimeSubscriptionV1,
  parseSendOrderToKitchenCommandV1,
  parseTransitionOrderItemCommandV1,
  type BranchScope,
  type CancelOrderCommandV1,
  type CancelOrderResultV1,
  type CreateOrderCommandV1,
  type CreateOrderCommandV2,
  type KdsCursorV1,
  type KdsEventPageV1,
  type KdsEventV1,
  type KdsTicketListV1,
  type MenuCatalogV1,
  type OrderAuditInputV1,
  type OrderDetailActionV1,
  type OrderDetailV1,
  type OrderMutationSummaryV1,
  type RealtimeSubscriptionV1,
  type SendOrderToKitchenCommandV1,
} from "@super-restaurant/shared-types";
import { createHash } from "node:crypto";
import { describeHalvesFromSnapshot, isFractionModifier } from "./fraction-halves.js";
import {
  addOrderItem,
  assessOrderCancellation,
  canAddOrderItem,
  cancelOrder as cancelWholeOrder,
  InactiveMenuProductVariantError,
  MenuProductVariantNotFoundError,
  MenuProductVariantRequiredError,
  MenuFractionSelectionInvalidError,
  calculateOrderAggregateTotals,
  cancelOrderItem,
  createMenuProductPriceSnapshot,
  createOrder,
  transitionOrderItemStatus,
  transitionOrderStatus,
  type Order,
  type OrderAuditContext,
  type OrderMutation,
} from "@super-restaurant/domain";
import { Inject, Injectable, Optional } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipRole } from "./auth/membership-authorization.js";
import { rolesGrantPermission } from "./auth/rbac-policy.js";
import {
  buildAddressLabel,
  buildCourierAddressLabel,
  buildCourierCustomerLabel,
  buildCustomerLabel,
} from "./branch-order-work-tray.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { MENU_CATALOG_PORT, type MenuCatalogPort } from "./menu-catalog.js";
import { toDomainMenuCatalog } from "./menu-catalog-domain.js";
import {
  ORDER_DELIVERY_CONTEXT_PORT,
  type OrderDeliveryContext,
  type OrderDeliveryContextPort,
} from "./order-delivery-context.js";
import {
  decodeOrderRecord,
  encodeOrderAuditEventRecord,
  encodeOrderRecord,
} from "./persistence/order-persistence-codec.js";

const readOrderSql = "select app_private.read_order($1::uuid, $2::uuid, $3::uuid, $4::uuid) as result";
const readAssignedCourierOrderSql = "select app_private.read_courier_delivery_order($1::uuid, $2::uuid, $3::uuid, $4::uuid) as result";
const persistOrderSql = "select app_private.persist_order_mutation($1::uuid, $2::bigint, $3::jsonb, $4::jsonb) as result";
const cancelOrderItemSql = "select app_private.persist_order_item_cancellation($1::uuid, $2::bigint, $3::jsonb, $4::jsonb) as result";
const createOperationalOrderSql = "select app_private.create_operational_order($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) as result";
const sendOrderToKitchenSql = "select app_private.send_order_to_kitchen($1::uuid, $2::bigint, $3::jsonb, $4::jsonb) as result";
const cancelWholeOrderSql = "select app_private.cancel_order($1::uuid, $2::jsonb, $3::jsonb) as result";
const recoverKdsSql = "select app_private.recover_kds_events($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::integer) as result";
const listKdsTicketsSql = "select app_private.list_kds_tickets($1::uuid, $2::uuid, $3::uuid, $4::text) as result";

export type OrderApplicationErrorCode = "authorization" | "conflict" | "not_found" | "request" | "unavailable";

export class OrderApplicationError extends Error {
  public constructor(public readonly code: OrderApplicationErrorCode) {
    super(`ORDER_${code.toUpperCase()}`);
    this.name = "OrderApplicationError";
  }
}

/** A conflict because the order's delivery is `assigned|en_route`; the controller answers 409 `DELIVERY_ACTIVE`. */
export class OrderDeliveryActiveError extends OrderApplicationError {
  public constructor() {
    super("conflict");
    this.name = "OrderDeliveryActiveError";
  }
}

/** A conflict because the order has a non-terminal payment; the controller answers 409 `PAYMENT_IN_FLIGHT`. */
export class OrderPaymentInFlightError extends OrderApplicationError {
  public constructor() {
    super("conflict");
    this.name = "OrderPaymentInFlightError";
  }
}

export interface StoredOrder {
  readonly order: Order;
  readonly version: number;
}

export type SavedOrReplayedOrderResult = Readonly<{
  readonly kdsEvent: KdsEventV1 | null;
  readonly order: Order;
  readonly status: "replayed" | "saved";
  readonly version: number;
}>;

export type PersistOrderResult =
  | Readonly<{ readonly status: "conflict" | "forbidden" }>
  | SavedOrReplayedOrderResult;

/**
 * Result of `app_private.send_order_to_kitchen`'s atomic batch (S9.1 r12): the whole batch is
 * persisted or none of it is, so unlike `PersistOrderResult` there is one `kdsEvents` array (one
 * entry, possibly null, per step) instead of a single `kdsEvent`.
 */
export type SendOrderToKitchenBatchResult =
  | Readonly<{ readonly status: "conflict" }>
  | Readonly<{
    readonly kdsEvents: readonly (KdsEventV1 | null)[];
    readonly order: Order;
    readonly status: "replayed" | "saved";
    readonly version: number;
  }>;

/**
 * Result of `app_private.cancel_order`. `delivery_active` means the order's delivery is `assigned|en_route` (the
 * courier must mark it failed or it must be settled first); `forbidden` is the SQL re-check of the supervisor role.
 */
export type CancelWholeOrderResult =
  | Readonly<{ readonly status: "conflict" | "delivery_active" | "forbidden"; readonly reason?: "payment_in_flight" }>
  | Readonly<{
    readonly kdsEvents: readonly KdsEventV1[];
    readonly order: Order;
    readonly refundObligation: CancelOrderResultV1["refundObligation"];
    readonly status: "replayed" | "saved";
    readonly version: number;
  }>;

export interface OrderPersistencePort {
  cancelWholeOrder(
    actorId: string,
    command: CancelOrderCommandV1,
    steps: readonly OrderMutation[],
  ): Promise<CancelWholeOrderResult>;
  listKdsTickets(actorId: string, subscription: RealtimeSubscriptionV1): Promise<KdsTicketListV1 | "forbidden">;
  persist(actorId: string, expectedVersion: number, mutation: OrderMutation, operationalShiftId?: string | null): Promise<PersistOrderResult>;
  read(actorId: string, scope: BranchScope, orderId: string): Promise<StoredOrder | "missing">;
  /**
   * The Order of a delivery assigned to `actorId` (a courier). Ownership is decided in SQL; anything that is
   * not the actor's own assigned delivery is the same `"missing"`, so a foreign Order's existence is not revealed.
   */
  readAssignedToCourier(actorId: string, scope: BranchScope, orderId: string): Promise<StoredOrder | "missing">;
  recoverKds(actorId: string, subscription: RealtimeSubscriptionV1, after: KdsCursorV1, limit: number): Promise<KdsEventPageV1 | "forbidden">;
  sendOrderToKitchen(
    actorId: string,
    expectedVersion: number,
    command: SendOrderToKitchenCommandV1,
    steps: readonly OrderMutation[],
  ): Promise<SendOrderToKitchenBatchResult>;
}

export const ORDER_PERSISTENCE_PORT = Symbol("ORDER_PERSISTENCE_PORT");

/** How the actor of `OrderService.readDetailForActor` reached the Order; the caller already authorized it. */
export type OrderDetailAccess =
  | { readonly kind: "assigned_courier" }
  | { readonly kind: "branch"; readonly roles: readonly MembershipRole[] };

export interface RealtimeNotificationPort {
  notify(event: KdsEventV1): Promise<void>;
}

export const REALTIME_NOTIFICATION_PORT = Symbol("REALTIME_NOTIFICATION_PORT");

@Injectable()
export class PostgresOrderPersistenceAdapter implements OrderPersistencePort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async listKdsTickets(
    actorId: string,
    subscription: RealtimeSubscriptionV1,
  ): Promise<KdsTicketListV1 | "forbidden"> {
    const result = await this.database.query(listKdsTicketsSql, [
      actorId,
      subscription.scope.restaurantId,
      subscription.scope.branchId,
      subscription.stationId,
    ]);
    const raw = singleResult(result.rows);
    if (raw === null) return "forbidden";
    const tickets = parseKdsTicketListV1(raw);
    if (tickets === undefined || !sameScope(tickets.scope, subscription.scope)
      || tickets.stationId !== subscription.stationId) throw unavailable();
    return tickets;
  }

  public async read(actorId: string, scope: BranchScope, orderId: string): Promise<StoredOrder | "missing"> {
    return this.readWith(readOrderSql, actorId, scope, orderId);
  }

  public async readAssignedToCourier(actorId: string, scope: BranchScope, orderId: string): Promise<StoredOrder | "missing"> {
    return this.readWith(readAssignedCourierOrderSql, actorId, scope, orderId);
  }

  private async readWith(sql: string, actorId: string, scope: BranchScope, orderId: string): Promise<StoredOrder | "missing"> {
    const result = await this.database.query(sql, [actorId, scope.restaurantId, scope.branchId, orderId]);
    const raw = singleResult(result.rows);
    if (raw === null) return "missing";
    const record = exactRecord(raw, ["schemaVersion", "scope", "order", "version", "updatedAt"]);
    if (
      record === undefined
      || own(record, "schemaVersion") !== 1
      || !sameScope(own(record, "scope"), scope)
      || !isTimestamp(own(record, "updatedAt"))
    ) throw unavailable();
    const order = decodeOrderRecord(own(record, "order"));
    const version = positiveInteger(own(record, "version"));
    if (version === undefined || !orderMatchesScope(order, scope, orderId)) throw unavailable();
    return Object.freeze({ order, version });
  }

  public async persist(
    actorId: string,
    expectedVersion: number,
    mutation: OrderMutation,
    operationalShiftId?: string | null,
  ): Promise<PersistOrderResult> {
    const encodedOrder = encodeOrderRecord(mutation.order);
    const encodedAudit = encodeOrderAuditEventRecord(mutation.auditEvent);
    if (operationalShiftId !== undefined && expectedVersion !== 0) throw unavailable();
    const isCancellation = mutation.auditEvent.operation === "order_item.state_changed"
      && mutation.auditEvent.to === "cancelled";
    const result = operationalShiftId === undefined
      ? await this.database.query(isCancellation ? cancelOrderItemSql : persistOrderSql, [
        actorId,
        expectedVersion,
        JSON.stringify(encodedOrder),
        JSON.stringify(encodedAudit),
      ])
      : await this.database.query(createOperationalOrderSql, [
        actorId,
        operationalShiftId,
        JSON.stringify(encodedOrder),
        JSON.stringify(encodedAudit),
      ]);
    const raw = singleResult(result.rows);
    const minimal = exactRecord(raw, ["status"]);
    if (minimal !== undefined) {
      const status = own(minimal, "status");
      if (status === "conflict" || status === "forbidden") return Object.freeze({ status });
      throw unavailable();
    }
    const record = exactRecord(raw, ["schemaVersion", "scope", "status", "order", "version", "kdsEvent"]);
    if (record === undefined || own(record, "schemaVersion") !== 1) throw unavailable();
    const status = own(record, "status");
    if (status !== "saved" && status !== "replayed") throw unavailable();
    const order = decodeOrderRecord(own(record, "order"));
    const version = positiveInteger(own(record, "version"));
    const kdsValue = own(record, "kdsEvent");
    const parsedKdsEvent = kdsValue === null ? undefined : parseKdsEventV1(kdsValue);
    if (kdsValue !== null && parsedKdsEvent === undefined) throw unavailable();
    const kdsEvent = parsedKdsEvent ?? null;
    const kdsExpected = encodedAudit.operation === "order.item_added" || encodedAudit.operation === "order_item.state_changed";
    if (
      version === undefined
      || version !== expectedVersion + 1
      || !sameScopeValues(own(record, "scope"), order.restaurantId, order.branchId)
      || JSON.stringify(encodeOrderRecord(order)) !== JSON.stringify(encodedOrder)
      || kdsExpected !== (kdsEvent !== null)
      || (kdsEvent !== null && (
        kdsEvent.eventId !== encodedAudit.eventId
        || kdsEvent.orderId !== order.orderId
        || kdsEvent.orderItemId !== encodedAudit.entityId
        || kdsEvent.scope.restaurantId !== order.restaurantId
        || kdsEvent.scope.branchId !== order.branchId
      ))
    ) throw unavailable();
    return Object.freeze({ kdsEvent: kdsEvent ?? null, order, status, version });
  }

  public async sendOrderToKitchen(
    actorId: string,
    expectedVersion: number,
    command: SendOrderToKitchenCommandV1,
    steps: readonly OrderMutation[],
  ): Promise<SendOrderToKitchenBatchResult> {
    const encodedCommand = {
      deviceId: command.deviceId,
      eventId: command.eventId,
      expectedVersion: command.expectedVersion,
      idempotencyKey: command.idempotencyKey,
      occurredAt: command.occurredAt,
      orderId: command.orderId,
      orderItemIds: command.orderItemIds,
      schemaVersion: command.schemaVersion,
      scope: command.scope,
    };
    const encodedSteps = steps.map((step) => ({
      audit: encodeOrderAuditEventRecord(step.auditEvent),
      order: encodeOrderRecord(step.order),
    }));
    const result = await this.database.query(sendOrderToKitchenSql, [
      actorId,
      expectedVersion,
      JSON.stringify(encodedCommand),
      JSON.stringify(encodedSteps),
    ]);
    const raw = singleResult(result.rows);
    const minimal = exactRecord(raw, ["status"]);
    if (minimal !== undefined) {
      const status = own(minimal, "status");
      if (status === "conflict") return Object.freeze({ status });
      throw unavailable();
    }
    const record = exactRecord(raw, ["schemaVersion", "scope", "status", "order", "version", "kdsEvents"]);
    if (record === undefined || own(record, "schemaVersion") !== 1) throw unavailable();
    const status = own(record, "status");
    if (status !== "saved" && status !== "replayed") throw unavailable();
    const order = decodeOrderRecord(own(record, "order"));
    const version = positiveInteger(own(record, "version"));
    const kdsEventsRaw = own(record, "kdsEvents");
    if (!Array.isArray(kdsEventsRaw)) throw unavailable();
    const kdsEvents: (KdsEventV1 | null)[] = [];
    for (const entry of kdsEventsRaw) {
      if (entry === null) { kdsEvents.push(null); continue; }
      const parsed = parseKdsEventV1(entry);
      if (parsed === undefined) throw unavailable();
      kdsEvents.push(parsed);
    }
    if (
      version === undefined
      || !sameScopeValues(own(record, "scope"), order.restaurantId, order.branchId)
      || (status === "saved" && version !== expectedVersion + steps.length)
    ) throw unavailable();
    return Object.freeze({ kdsEvents: Object.freeze(kdsEvents), order, status, version });
  }

  public async cancelWholeOrder(
    actorId: string,
    command: CancelOrderCommandV1,
    steps: readonly OrderMutation[],
  ): Promise<CancelWholeOrderResult> {
    const encodedCommand = {
      deviceId: command.deviceId,
      eventId: command.eventId,
      expectedVersion: command.expectedVersion,
      idempotencyKey: command.idempotencyKey,
      occurredAt: command.occurredAt,
      orderId: command.orderId,
      reason: command.reason,
      schemaVersion: command.schemaVersion,
      scope: command.scope,
    };
    const encodedSteps = steps.map((step) => ({
      audit: encodeOrderAuditEventRecord(step.auditEvent),
      order: encodeOrderRecord(step.order),
    }));
    const result = await this.database.query(cancelWholeOrderSql, [
      actorId,
      JSON.stringify(encodedCommand),
      JSON.stringify(encodedSteps),
    ]);
    const raw = singleResult(result.rows);
    const inFlight = exactRecord(raw, ["status", "reason"]);
    if (inFlight !== undefined) {
      if (own(inFlight, "status") === "conflict" && own(inFlight, "reason") === "payment_in_flight") {
        return Object.freeze({ reason: "payment_in_flight" as const, status: "conflict" as const });
      }
      throw unavailable();
    }
    const minimal = exactRecord(raw, ["status"]);
    if (minimal !== undefined) {
      const status = own(minimal, "status");
      if (status === "conflict" || status === "forbidden" || status === "delivery_active") return Object.freeze({ status });
      throw unavailable();
    }
    const record = exactRecord(raw, ["schemaVersion", "scope", "status", "order", "version", "refundObligation", "kdsEvents"]);
    if (record === undefined || own(record, "schemaVersion") !== 1) throw unavailable();
    const status = own(record, "status");
    if (status !== "saved" && status !== "replayed") throw unavailable();
    const order = decodeOrderRecord(own(record, "order"));
    const version = positiveInteger(own(record, "version"));
    const refundObligation = parseOrderRefundObligationV1(own(record, "refundObligation"));
    const rawEvents = own(record, "kdsEvents");
    if (
      version === undefined || refundObligation === undefined || !Array.isArray(rawEvents)
      || order.status !== "cancelled" || order.orderId !== command.orderId
      || order.restaurantId !== command.scope.restaurantId || order.branchId !== command.scope.branchId
      || !sameScopeValues(own(record, "scope"), order.restaurantId, order.branchId)
      || (status === "saved" && (version < command.expectedVersion + 1 || order.cancellationAudit === undefined
        || order.cancellationAudit.eventId !== command.eventId || order.cancellationAudit.reason !== command.reason))
    ) throw unavailable();
    const kdsEvents: KdsEventV1[] = [];
    for (const entry of rawEvents) {
      const parsed = parseKdsEventV1(entry);
      if (parsed === undefined || parsed.status !== "cancelled" || parsed.orderId !== order.orderId
        || parsed.scope.restaurantId !== order.restaurantId || parsed.scope.branchId !== order.branchId) throw unavailable();
      kdsEvents.push(parsed);
    }
    return Object.freeze({ kdsEvents: Object.freeze(kdsEvents), order, refundObligation, status, version });
  }

  public async recoverKds(
    actorId: string,
    subscription: RealtimeSubscriptionV1,
    after: KdsCursorV1,
    limit: number,
  ): Promise<KdsEventPageV1 | "forbidden"> {
    const result = await this.database.query(recoverKdsSql, [
      actorId,
      subscription.scope.restaurantId,
      subscription.scope.branchId,
      subscription.stationId,
      cursorParameter(after),
      limit,
    ]);
    const raw = singleResult(result.rows);
    if (raw === null) return "forbidden";
    const page = parseKdsEventPageV1(raw);
    if (page === undefined || !sameScope(page.scope, subscription.scope) || page.stationId !== subscription.stationId) throw unavailable();
    return page;
  }

}

@Injectable()
export class OrderService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(ORDER_PERSISTENCE_PORT) private readonly orders: OrderPersistencePort,
    @Inject(MENU_CATALOG_PORT) private readonly catalogs: MenuCatalogPort,
    @Inject(REALTIME_NOTIFICATION_PORT) private readonly notifications: RealtimeNotificationPort,
    @Optional() @Inject(ORDER_DELIVERY_CONTEXT_PORT) private readonly deliveryContext?: OrderDeliveryContextPort,
  ) {}

  /**
   * tables-board: `shiftId: null` means the operator never picked one. It is passed to SQL as null
   * and `create_operational_order` resolves the branch's single open shift itself, only after its
   * command-identity lookup, so a retry of an already-saved create replays even if the shift changed.
   */
  public async create(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderMutationSummaryV1> {
    const operationalCommand = parseCreateOrderCommandV2(input);
    const command = operationalCommand ?? parseCreateOrderCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "orders.create");
    return this.persist(
      actorId,
      0,
      createOrder(orderInput(command), auditContext(command, actorId)),
      operationalCommand === undefined ? undefined : operationalCommand.shiftId,
    );
  }

  public async addItem(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderMutationSummaryV1> {
    const command = parseAddOrderItemCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "orders.update");
    const stored = await this.readExact(actorId, command.scope, command.orderId, command.expectedVersion);
    const catalog = await this.readCatalog(actorId, command.scope);
    let mutation: OrderMutation;
    try {
      const snapshot = createMenuProductPriceSnapshot(
        toDomainMenuCatalog(catalog, command.scope.restaurantId),
        {
          currency: stored.order.currency,
          productId: command.productId,
          restaurantId: command.scope.restaurantId,
          variantId: command.variantId ?? null,
          fraction: command.fraction ?? null,
        },
        command.modifierGroups,
      );
      mutation = addOrderItem(stored.order, {
        orderItemId: command.orderItemId,
        quantity: command.quantity,
        snapshot,
        ...(command.note === undefined || command.note === null ? {} : { note: command.note }),
      }, auditContext(command, actorId));
    } catch (error: unknown) {
      // A size that does not exist, is inactive, is missing on a sized product or is sent for a plain
      // product is a state conflict with the live catalog (409), not a malformed request.
      if (
        error instanceof MenuProductVariantRequiredError
        || error instanceof MenuProductVariantNotFoundError
        || error instanceof InactiveMenuProductVariantError
        || error instanceof MenuFractionSelectionInvalidError
      ) throw applicationError("conflict");
      throw applicationError("request");
    }
    return this.persist(actorId, command.expectedVersion, mutation);
  }

  public async open(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderMutationSummaryV1> {
    const command = parseOpenOrderCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "orders.update");
    const stored = await this.readExact(actorId, command.scope, command.orderId, command.expectedVersion);
    try {
      return await this.persist(actorId, command.expectedVersion, transitionOrderStatus(stored.order, "open", auditContext(command, actorId)));
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw applicationError("request");
    }
  }

  public async transitionItem(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderMutationSummaryV1> {
    const command = parseTransitionOrderItemCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const permission = command.to === "preparing" || command.to === "ready" ? "kds.transition" : "orders.update";
    const actorId = await this.authorize(principal, command.scope, permission);
    const stored = await this.readExact(actorId, command.scope, command.orderId, command.expectedVersion);
    try {
      return await this.persist(actorId, command.expectedVersion, transitionOrderItemStatus(
        stored.order,
        command.orderItemId,
        command.to,
        auditContext(command, actorId),
      ));
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw applicationError("request");
    }
  }

  public async cancelItem(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderMutationSummaryV1> {
    const command = parseCancelOrderItemCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const readerId = await this.authorize(principal, command.scope, "orders.read");
    const stored = await this.readExact(readerId, command.scope, command.orderId, command.expectedVersion);
    if (stored.order.status !== "draft" && stored.order.status !== "open") {
      throw applicationError("conflict");
    }
    const item = stored.order.items.find((candidate) => candidate.orderItemId === command.orderItemId);
    if (item === undefined || !["pending", "sent", "preparing", "ready"].includes(item.status)) {
      throw applicationError("request");
    }
    const sensitive = item.status !== "pending";
    const actorId = await this.authorize(
      principal,
      command.scope,
      sensitive ? "orders.cancel.sent" : "orders.cancel.pending",
    );
    try {
      return await this.persist(actorId, command.expectedVersion, cancelOrderItem(
        stored.order,
        command.orderItemId,
        {
          ...auditContext(command, actorId),
          reason: command.reason,
          ...(sensitive ? { authorization: { actorId, approved: true as const } } : {}),
        },
      ));
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw applicationError("request");
    }
  }

  /**
   * T2: whole-order cancellation by owner/admin/manager/supervisor (`orders.cancel.order`). The domain computes the
   * ordered steps (one correction per kitchen line, then the order); SQL re-verifies them, blocks an active delivery
   * (409 `DELIVERY_ACTIVE`), records an immutable pending refund obligation when money was captured and persists
   * everything atomically under the command's idempotency key. The client never sends an approval.
   */
  public async cancelOrder(principal: AuthenticatedPrincipal, input: unknown): Promise<CancelOrderResultV1> {
    const command = parseCancelOrderCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "orders.cancel.order");
    let stored: StoredOrder;
    try {
      const result = await this.orders.read(actorId, command.scope, command.orderId);
      if (result === "missing") throw applicationError("not_found");
      stored = result;
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw unavailable();
    }
    let steps: readonly OrderMutation[] = [];
    if (stored.version === command.expectedVersion) {
      // Delivery state and captured money live in SQL, which has the final word (DELIVERY_ACTIVE, obligation).
      const assessment = assessOrderCancellation({
        capturedAmountMinor: 0,
        deliveryStatus: null,
        items: stored.order.items.map((item) => ({ orderItemId: item.orderItemId, status: item.status })),
        orderStatus: stored.order.status,
      });
      if (!assessment.eligible) throw applicationError("conflict");
      try {
        steps = cancelWholeOrder(stored.order, {
          auditContext: {
            actorId,
            authorization: { actorId, approved: true as const },
            deviceId: command.deviceId,
            eventId: command.eventId,
            idempotencyKey: command.idempotencyKey,
            occurredAt: command.occurredAt,
            reason: command.reason,
          },
          lineContexts: Object.fromEntries(assessment.itemsNeedingKitchenCorrection.map((orderItemId) => [orderItemId, {
            eventId: derivedUuid("cancel-order-event", command.eventId, `${command.orderId}:${command.expectedVersion}:${orderItemId}`),
            idempotencyKey: derivedUuid("cancel-order-idempotency", command.idempotencyKey, `${command.orderId}:${command.expectedVersion}:${orderItemId}`),
          }])),
          refundObligation: stored.order.status === "partially_paid" || stored.order.status === "paid" ? "pending" : "none",
        });
      } catch { throw applicationError("conflict"); }
    }
    // A stale version sends no steps: SQL still resolves an identical retry as a replay (the stored result), and
    // anything else under that key or version is a conflict with no effects.
    let result: CancelWholeOrderResult;
    try { result = await this.orders.cancelWholeOrder(actorId, command, steps); } catch { throw unavailable(); }
    if (result.status === "forbidden") throw applicationError("authorization");
    if (result.status === "delivery_active") throw new OrderDeliveryActiveError();
    if (result.status === "conflict") throw result.reason === "payment_in_flight" ? new OrderPaymentInFlightError() : applicationError("conflict");
    if (result.status !== "saved" && result.status !== "replayed") throw unavailable();
    if (result.status === "saved") {
      for (const kdsEvent of result.kdsEvents) {
        try { await this.notifications.notify(kdsEvent); } catch { /* Durable cursor recovery is authoritative. */ }
      }
    }
    const scope = parseBranchScope({ branchId: result.order.branchId, restaurantId: result.order.restaurantId });
    if (scope === undefined) throw unavailable();
    return Object.freeze({
      kdsEvents: result.kdsEvents,
      orderId: result.order.orderId,
      orderStatus: "cancelled" as const,
      refundObligation: result.refundObligation,
      replayed: result.status === "replayed",
      schemaVersion: 1,
      scope,
      version: result.version,
    });
  }

  /**
   * Read-only projection (S9.1 web-order-actions). Reuses the same aggregate `OrderPersistencePort.read`
   * already scoped by `read_order`, and `calculateOrderAggregateTotals` -- never a second money
   * calculation. The fulfillment summary is deliberately reduced (see `OrderDetailFulfillmentV1`):
   * only the Order's own channel/tableId, no customer/address/payment-intent PII, since that
   * requires a snapshot join not yet wired to this port; a role's `customers.read` grant is
   * therefore irrelevant to this response today, but the field shapes already anticipate it.
   * `availableActions` is fully server-computed from the order's own state plus the caller's
   * granted roles -- the client never infers a permission beyond this list.
   */
  public async detail(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderDetailV1> {
    const request = parseOrderDetailRequestV1(input);
    if (request === undefined) throw applicationError("request");
    const { actorId, roles } = await this.authorizeWithRoles(principal, request.scope, "orders.read");
    return this.readDetailForActor(actorId, request.scope, request.orderId, { kind: "branch", roles });
  }

  /**
   * Internal detail read for an actor the CALLER has already authorized (this method never checks `orders.read`).
   * `branch`: the normal `orders.read` read. `assigned_courier`: the courier of that very delivery -- ownership is
   * enforced twice, in SQL (`read_courier_delivery_order`) and against the frozen delivery's `courierUserId`;
   * anything else is an `authorization` error (never `not_found`, so a foreign Order's existence is not
   * revealed). A courier gets no `availableActions` (their moves live in deliveries) and, only because the
   * delivery is theirs, the full customer/address labels.
   */
  public async readDetailForActor(
    actorId: string,
    scope: BranchScope,
    orderId: string,
    access: OrderDetailAccess,
  ): Promise<OrderDetailV1> {
    const courier = access.kind === "assigned_courier";
    if (courier && this.deliveryContext === undefined) throw unavailable();
    let record: StoredOrder;
    try {
      const result = courier
        ? await this.orders.readAssignedToCourier(actorId, scope, orderId)
        : await this.orders.read(actorId, scope, orderId);
      if (result === "missing") throw applicationError(courier ? "authorization" : "not_found");
      record = result;
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw unavailable();
    }
    // Frozen snapshot and delivery facts: customer/address only for roles with `customers.read`.
    let context: OrderDeliveryContext | undefined;
    if (this.deliveryContext !== undefined) {
      try {
        const read = await this.deliveryContext.read(actorId, scope, orderId);
        if (read === "forbidden") throw applicationError("authorization");
        if (read !== "missing") context = read;
      } catch (error: unknown) {
        if (error instanceof OrderApplicationError) throw error;
        throw unavailable();
      }
    }
    if (courier && (context?.delivery == null || context.delivery.courierUserId !== actorId)) {
      throw applicationError("authorization");
    }
    const detail = projectOrderDetail(record, scope, access.kind === "branch" ? access.roles : [], context, courier);
    if (detail === undefined) throw unavailable();
    return detail;
  }

  public async recoverKds(
    principal: AuthenticatedPrincipal,
    subscriptionInput: unknown,
    afterInput: unknown,
    limitInput: unknown,
  ): Promise<KdsEventPageV1> {
    const subscription = parseRealtimeSubscriptionV1(subscriptionInput);
    const after = parseKdsCursorV1(afterInput);
    const limit = parseLimit(limitInput);
    if (subscription === undefined || after === undefined || limit === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, subscription.scope, "kds.read");
    try {
      const page = await this.orders.recoverKds(actorId, subscription, after, limit);
      if (page === "forbidden") throw applicationError("authorization");
      return page;
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw unavailable();
    }
  }

  public async listKdsTickets(
    principal: AuthenticatedPrincipal,
    subscriptionInput: unknown,
  ): Promise<KdsTicketListV1> {
    const subscription = parseRealtimeSubscriptionV1(subscriptionInput);
    if (subscription === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, subscription.scope, "kds.read");
    try {
      const tickets = await this.orders.listKdsTickets(actorId, subscription);
      if (tickets === "forbidden") throw applicationError("authorization");
      return tickets;
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw unavailable();
    }
  }

  private async readExact(actorId: string, scope: BranchScope, orderId: string, expectedVersion: number): Promise<StoredOrder> {
    try {
      const stored = await this.orders.read(actorId, scope, orderId);
      if (stored === "missing") throw applicationError("not_found");
      if (stored.version !== expectedVersion) throw applicationError("conflict");
      return stored;
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw unavailable();
    }
  }

  private async readCatalog(actorId: string, scope: BranchScope): Promise<MenuCatalogV1> {
    try {
      const state = await this.catalogs.read(actorId, scope);
      if (state === "forbidden") throw applicationError("authorization");
      if (state.catalog === null) throw applicationError("request");
      return state.catalog;
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw unavailable();
    }
  }

  /**
   * S9.1 r12: the batch is persisted atomically by `app_private.send_order_to_kitchen` -- either
   * every step (the draft-open transition, if any, plus one "sent" transition per listed
   * still-pending line) is saved or none is, and the command's own `idempotencyKey` is the replay
   * identity: a byte-identical retry (same actor/scope/idempotencyKey *and* the identical command
   * payload) always replays the stored result, no matter what the order's version has done since.
   * Any other difference under the same key -- a different payload, a stale `expectedVersion`, an
   * unknown line id, or any step no longer matching the order's current aggregate -- is a
   * `conflict`/`not_found`, atomically, with zero persisted effects. All listed lines must be
   * pending.
   */
  public async sendToKitchen(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderMutationSummaryV1> {
    const command = parseSendOrderToKitchenCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "orders.update");
    let stored: StoredOrder;
    try {
      const result = await this.orders.read(actorId, command.scope, command.orderId);
      if (result === "missing") throw applicationError("not_found");
      stored = result;
    } catch (error: unknown) {
      if (error instanceof OrderApplicationError) throw error;
      throw unavailable();
    }
    if (stored.version !== command.expectedVersion) {
      // The identity of a replay lives in SQL under the command's own idempotencyKey, not in
      // whether the order's version still matches: resolve it there instead of guessing from a
      // version mismatch that could just as well be this very command's own earlier, lost-response
      // attempt having already succeeded.
      const batch = await this.sendOrderToKitchenRaw(actorId, command, []);
      if (batch.status !== "replayed") throw applicationError("conflict");
      return this.summaryFromBatch(batch);
    }
    const orderItemIds = new Set(command.orderItemIds);
    const itemsById = new Map(stored.order.items.map((item) => [item.orderItemId, item] as const));
    for (const orderItemId of orderItemIds) {
      const item = itemsById.get(orderItemId);
      if (item === undefined) throw applicationError("not_found");
      // All listed lines must be pending: at an exact version match, the client listed exactly the
      // lines it saw pending, so any listed line that is not pending now is already stale -- never
      // silently skip it and report success for a smaller batch than the client asked for.
      if (item.status !== "pending") throw applicationError("conflict");
    }

    const steps: OrderMutation[] = [];
    let cursor = stored.order;
    if (cursor.status === "draft") {
      const mutation = transitionOrderStatus(cursor, "open", stepAuditContext(command, actorId, "open"));
      steps.push(mutation);
      cursor = mutation.order;
    }
    for (const item of cursor.items) {
      if (item.status !== "pending" || !orderItemIds.has(item.orderItemId)) continue;
      const mutation = transitionOrderItemStatus(cursor, item.orderItemId, "sent", stepAuditContext(command, actorId, item.orderItemId));
      steps.push(mutation);
      cursor = mutation.order;
    }

    const batch = await this.sendOrderToKitchenRaw(actorId, command, steps);
    if (batch.status !== "saved" && batch.status !== "replayed") throw applicationError("conflict");
    return this.summaryFromBatch(batch);
  }

  private async sendOrderToKitchenRaw(
    actorId: string,
    command: SendOrderToKitchenCommandV1,
    steps: readonly OrderMutation[],
  ): Promise<SendOrderToKitchenBatchResult> {
    let result: SendOrderToKitchenBatchResult;
    try { result = await this.orders.sendOrderToKitchen(actorId, command.expectedVersion, command, steps); }
    catch { throw unavailable(); }
    if (result.status === "saved") {
      for (const kdsEvent of result.kdsEvents) {
        if (kdsEvent === null) continue;
        try { await this.notifications.notify(kdsEvent); } catch { /* Durable cursor recovery is authoritative. */ }
      }
    }
    return result;
  }

  private summaryFromBatch(batch: SendOrderToKitchenBatchResult): OrderMutationSummaryV1 {
    if (batch.status === "conflict") throw applicationError("conflict");
    const scope = parseBranchScope({ branchId: batch.order.branchId, restaurantId: batch.order.restaurantId });
    if (scope === undefined) throw unavailable();
    const lastKdsEvent = batch.kdsEvents.length === 0 ? null : batch.kdsEvents[batch.kdsEvents.length - 1]!;
    return Object.freeze({
      kdsEvent: lastKdsEvent,
      orderId: batch.order.orderId,
      orderStatus: batch.order.status,
      replayed: batch.status === "replayed",
      schemaVersion: 1,
      scope,
      version: batch.version,
    });
  }

  private async persistRaw(
    actorId: string,
    expectedVersion: number,
    mutation: OrderMutation,
    operationalShiftId?: string | null,
  ): Promise<SavedOrReplayedOrderResult> {
    let result: PersistOrderResult;
    try { result = await this.orders.persist(actorId, expectedVersion, mutation, operationalShiftId); } catch { throw unavailable(); }
    if (result.status === "forbidden") throw applicationError("authorization");
    if (result.status === "conflict") throw applicationError("conflict");
    if (result.status !== "saved" && result.status !== "replayed") throw unavailable();
    if (result.status === "saved" && result.kdsEvent !== null) {
      try { await this.notifications.notify(result.kdsEvent); } catch { /* Durable cursor recovery is authoritative. */ }
    }
    return result;
  }

  private summaryFromResult(result: SavedOrReplayedOrderResult): OrderMutationSummaryV1 {
    const scope = parseBranchScope({ branchId: result.order.branchId, restaurantId: result.order.restaurantId });
    if (scope === undefined) throw unavailable();
    return Object.freeze({
      kdsEvent: result.kdsEvent,
      orderId: result.order.orderId,
      orderStatus: result.order.status,
      replayed: result.status === "replayed",
      schemaVersion: 1,
      scope,
      version: result.version,
    });
  }

  private async persist(
    actorId: string,
    expectedVersion: number,
    mutation: OrderMutation,
    operationalShiftId?: string | null,
  ): Promise<OrderMutationSummaryV1> {
    const result = await this.persistRaw(actorId, expectedVersion, mutation, operationalShiftId);
    return this.summaryFromResult(result);
  }

  private async authorize(
    principal: AuthenticatedPrincipal,
    scope: BranchScope,
    permission: "kds.read" | "kds.transition" | "orders.cancel.order" | "orders.cancel.pending" | "orders.cancel.sent" | "orders.create" | "orders.read" | "orders.update",
  ): Promise<string> {
    return (await this.authorizeWithRoles(principal, scope, permission)).actorId;
  }

  private async authorizeWithRoles(
    principal: AuthenticatedPrincipal,
    scope: BranchScope,
    permission: "kds.read" | "kds.transition" | "orders.cancel.order" | "orders.cancel.pending" | "orders.cancel.sent" | "orders.create" | "orders.read" | "orders.update",
  ): Promise<{ readonly actorId: string; readonly roles: readonly MembershipRole[] }> {
    try {
      const authorized = await this.authorization.authorizeBranch(principal, scope, permission);
      return { actorId: authorized.principal.actorId, roles: authorized.roles };
    } catch { throw applicationError("authorization"); }
  }
}

/**
 * Pure projection from the already-scoped, already-authorized aggregate. Totals reuse
 * `calculateOrderAggregateTotals` -- never a second money calculation -- and cancelled lines are
 * priced at zero, mirroring that calculator's own exclusion of cancelled lines from the payable
 * total. `roles` decides `availableActions`; the client is never trusted to infer a permission.
 */
function projectOrderDetail(
  stored: StoredOrder,
  scope: BranchScope,
  roles: readonly MembershipRole[],
  context?: OrderDeliveryContext,
  courierView = false,
): OrderDetailV1 | undefined {
  const { order, version } = stored;
  const snapshot = context?.snapshot ?? null;
  const canReadCustomers = rolesGrantPermission(roles, "customers.read");
  const quote = snapshot !== null && "deliveryQuote" in snapshot && snapshot.deliveryQuote !== null
    ? {
      feeMinor: snapshot.deliveryQuote.feeMinor,
      promiseEnd: snapshot.deliveryQuote.promiseEnd,
      promiseStart: snapshot.deliveryQuote.promiseStart,
      zoneId: snapshot.deliveryQuote.zoneId,
    }
    : null;
  const paymentIntent = snapshot !== null && "paymentIntent" in snapshot && snapshot.paymentIntent !== null
    ? {
      method: snapshot.paymentIntent.method,
      tenderedAmountMinor: snapshot.paymentIntent.tenderedAmountMinor,
      tipMinor: snapshot.paymentIntent.tipMinor,
    }
    : null;
  const totals = calculateOrderAggregateTotals(order);
  const lineTotalsByItemId = new Map(totals.lines.map((line) => [line.input.orderItemId, line]));
  const items = order.items.map((item) => {
    const lineTotals = lineTotalsByItemId.get(item.orderItemId);
    return {
      availableActions: computeItemActions(order, item, roles),
      lineTotalMinor: lineTotals === undefined ? 0 : lineTotals.totalAfterOrderDiscount.amountMinor,
      // Half-and-half extras/exclusions are reported per half in `fractionBreakdown`.
      modifiers: item.snapshot.modifiers.filter((modifier) => !isFractionModifier(modifier)).map((modifier) => ({
        modifierId: modifier.modifierId,
        name: modifier.name,
        quantity: modifier.quantity,
        unitPriceMinor: modifier.unitPrice.amountMinor,
      })),
      name: item.snapshot.name,
      note: item.note ?? null,
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      stationId: item.snapshot.stationId,
      status: item.status,
      unitPriceMinor: item.snapshot.unitPrice.amountMinor,
      variantName: item.snapshot.variantName ?? null,
      geometry: item.snapshot.geometry === "halves" ? ("halves" as const) : null,
      fractionBreakdown: describeHalvesFromSnapshot(item.snapshot),
    };
  });
  // A cancelled aggregate is never payable: `calculateOrderAggregateTotals` folds in neither the
  // delivery charge nor a tip for it (see its own `calculateForOrder`), so this projection must not
  // either -- otherwise itemsTotalMinor(0) + deliveryChargeMinor(frozen, nonzero) + tipMinor(0)
  // would disagree with totalMinor(0) and the contract's own additive check would reject it.
  const deliveryChargeMinor = order.status === "cancelled" || order.deliveryCharge === null
    ? 0
    : order.deliveryCharge.amount.amountMinor;
  // H31: itemsTotalMinor must come from the items/discount/tax components alone, never
  // `total - deliveryCharge`, or a tipped order would silently count its tip as part of the items total.
  const itemsTotalMinor = totals.subtotalBeforeOrderDiscount.amountMinor - totals.orderDiscount.amountMinor;
  return parseOrderDetailV1({
    availableActions: computeAvailableActions(order, roles, context?.delivery?.state === undefined || context.delivery.state === "pending" ? null : context.delivery.state),
    channel: order.channel,
    createdAt: null,
    currency: order.currency,
    ...(context === undefined ? {} : { delivery: context.delivery }),
    fulfillment: {
      // `courierView` is set only after ownership of this very delivery was proven; it grants no other PII.
      addressLabel: canReadCustomers ? buildAddressLabel(snapshot) : courierView ? buildCourierAddressLabel(snapshot) : null,
      channel: order.channel,
      customerLabel: canReadCustomers ? buildCustomerLabel(snapshot) : courierView ? buildCourierCustomerLabel(snapshot) : null,
      paymentIntent,
      ...(courierView ? { deliveryInstructions: snapshot?.deliveryInstructions ?? null } : {}),
      ...(context === undefined ? {} : { quote }),
      tableId: order.tableId ?? null,
    },
    items,
    orderId: order.orderId,
    schemaVersion: 1,
    scope,
    status: order.status,
    tableId: order.tableId ?? null,
    timeZone: order.timeZone,
    totals: {
      currency: totals.total.currency,
      deliveryChargeMinor,
      itemsTotalMinor,
      taxMinor: totals.taxTotal.amountMinor,
      tipMinor: totals.tip.amountMinor,
      totalMinor: totals.total.amountMinor,
    },
    updatedAt: null,
    version,
  });
}

const FINANCIAL_ROLES: ReadonlySet<MembershipRole> = new Set(["owner", "admin", "manager", "supervisor", "cashier"]);

/**
 * Order-wide actions only -- open, send-to-kitchen (which the client fires per pending line, but
 * whose *offer* is a single order-wide affordance) and checkout. Per-line actions (markReady,
 * markDelivered, cancelItem) live exclusively on `OrderDetailItemV1.availableActions` below: a role
 * with `orders.cancel.pending` but not `orders.cancel.sent` must never be offered cancellation on a
 * line that already reached KDS, and an order-wide flag can't express that distinction.
 */
function computeAvailableActions(
  order: Order,
  roles: readonly MembershipRole[],
  deliveryState: "assigned" | "en_route" | "delivered" | "failed" | "settled" | null = null,
): readonly OrderDetailActionV1[] {
  const actions: OrderDetailActionV1[] = [];
  const canUpdate = rolesGrantPermission(roles, "orders.update");
  const itemMutable = order.status !== "closed" && order.status !== "cancelled";
  const hasPendingItems = order.items.some((item) => item.status === "pending");
  // Server-side mirror of `OrderService.addItem`: the domain's own rule for accepting a new line.
  if (canUpdate && canAddOrderItem(order)) {
    actions.push("addItem");
  }
  // "sendToKitchen" already implies opening the account first when the order is still a draft (the
  // client sequences open then each item transition); the operator never sees "open" *and*
  // "sendToKitchen" together for the same pending lines. "open" survives on its own only for a
  // table draft with nothing pending yet ("Abrir cuenta" before any line exists) -- a
  // counter/takeout/delivery draft never shows a separate "open the tab" step at all.
  if (canUpdate && itemMutable && hasPendingItems) actions.push("sendToKitchen");
  else if (canUpdate && order.status === "draft" && order.channel === "table") actions.push("open");
  if ((order.status === "open" || order.status === "partially_paid") && roles.some((role) => FINANCIAL_ROLES.has(role))) {
    actions.push("checkout");
  }
  // T2: the whole-order cancel is offered only to roles with `orders.cancel.order`, in a cancellable state and with no
  // active delivery. SQL re-checks all of it; this list only decides what the screen offers.
  if (rolesGrantPermission(roles, "orders.cancel.order") && assessOrderCancellation({
    capturedAmountMinor: 0,
    deliveryStatus: deliveryState,
    items: order.items.map((item) => ({ orderItemId: item.orderItemId, status: item.status })),
    orderStatus: order.status,
  }).eligible) actions.push("cancelOrder");
  return Object.freeze(actions);
}

/** Per-line actions: `orders.cancel.pending` only ever covers a still-pending line of this very
 * order; once a line reached KDS ("sent"/"preparing"/"ready"), only `orders.cancel.sent` can offer
 * cancellation for it, matching the same distinction `OrderService.cancelItem` enforces server-side. */
function computeItemActions(order: Order, item: Order["items"][number], roles: readonly MembershipRole[]): readonly OrderDetailActionV1[] {
  const actions: OrderDetailActionV1[] = [];
  if (order.status === "closed" || order.status === "cancelled") return Object.freeze(actions);
  const canTransitionKds = rolesGrantPermission(roles, "kds.transition");
  const canUpdate = rolesGrantPermission(roles, "orders.update");
  if (canTransitionKds && (item.status === "sent" || item.status === "preparing")) actions.push("markReady");
  if (canUpdate && item.status === "ready") actions.push("markDelivered");
  if (order.status === "draft" || order.status === "open") {
    const canCancel = item.status === "pending"
      ? rolesGrantPermission(roles, "orders.cancel.pending")
      : ["sent", "preparing", "ready"].includes(item.status) && rolesGrantPermission(roles, "orders.cancel.sent");
    if (canCancel) actions.push("cancelItem");
  }
  return Object.freeze(actions);
}

function orderInput(command: CreateOrderCommandV1 | CreateOrderCommandV2): Parameters<typeof createOrder>[0] {
  return {
    branchId: command.scope.branchId,
    channel: command.channel,
    currency: command.currency,
    orderId: command.orderId,
    restaurantId: command.scope.restaurantId,
    ...(command.tableId === null ? {} : { tableId: command.tableId }),
    timeZone: command.timeZone,
  };
}

function auditContext(command: OrderAuditInputV1, actorId: string): OrderAuditContext {
  return {
    actorId,
    deviceId: command.deviceId,
    eventId: command.eventId,
    idempotencyKey: command.idempotencyKey,
    occurredAt: command.occurredAt,
  };
}

/**
 * One derived, deterministic eventId/idempotencyKey pair per step of `sendToKitchen`, from the
 * command's own eventId/idempotencyKey, the step's identity ("open" or an orderItemId), and a
 * canonical fingerprint of the whole command (`orderId`, `expectedVersion`, `orderItemIds` sorted)
 * -- same technique as capture materialization's `derivedUuid` in capture-repeat-order-plan.ts.
 *
 * Folding the fingerprint in means a client that resends the same eventId/idempotencyKey with a
 * *different* `orderItemIds` list never derives the same step keys as the original command: its
 * steps are fully isolated from the first attempt's, so it cannot replay or otherwise interfere with
 * steps that belong to a different list.
 *
 * Limitación: el payload del comando no se persiste (la deuda de nivel A -- búsqueda por clave de
 * idempotencia en SQL -- sigue pendiente), así que este reenvío con otra lista no se *rechaza*,
 * sólo queda aislado: se procesa como un lote nuevo e independiente en vez de compartir pasos con el
 * original. El cliente web evita el escenario por completo acuñando la clave de intento junto con la
 * lista en el mismo momento (ver `nextAttempt`/`runSendToKitchen` en order-detail-panel.tsx).
 */
function stepAuditContext(command: SendOrderToKitchenCommandV1, actorId: string, stepIdentity: string): OrderAuditContext {
  const fingerprint = [command.orderId, String(command.expectedVersion), [...command.orderItemIds].sort().join(",")].join("|");
  return {
    actorId,
    deviceId: command.deviceId,
    eventId: derivedUuid("send-to-kitchen-event", command.eventId, `${fingerprint}:${stepIdentity}`),
    idempotencyKey: derivedUuid("send-to-kitchen-idempotency", command.idempotencyKey, `${fingerprint}:${stepIdentity}`),
    occurredAt: command.occurredAt,
  };
}

function derivedUuid(kind: string, namespace: string, identity: string): string {
  const bytes = createHash("sha256").update(`${kind}:${namespace}:${identity}`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function singleResult(rows: readonly unknown[]): unknown {
  if (rows.length !== 1) throw unavailable();
  const row = exactRecord(rows[0], ["result"]);
  if (row === undefined) throw unavailable();
  return own(row, "result");
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch { return undefined; }
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function sameScope(value: unknown, expected: BranchScope): boolean {
  return sameScopeValues(value, expected.restaurantId, expected.branchId);
}

function sameScopeValues(value: unknown, restaurantId: string, branchId: string): boolean {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  return record !== undefined && own(record, "restaurantId") === restaurantId && own(record, "branchId") === branchId;
}

function orderMatchesScope(order: Order, scope: BranchScope, orderId: string): boolean {
  return order.orderId === orderId && order.restaurantId === scope.restaurantId && order.branchId === scope.branchId;
}

function positiveInteger(value: unknown): number | undefined {
  const normalized = typeof value === "string" && /^[1-9]\d*$/u.test(value) ? Number(value) : value;
  return typeof normalized === "number" && Number.isSafeInteger(normalized) && normalized > 0 ? normalized : undefined;
}

function cursorParameter(value: KdsCursorV1): string {
  return value.slice(3);
}

function isTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function parseLimit(value: unknown): number | undefined {
  const parsed = typeof value === "string" && /^(?:[1-9]\d{0,2})$/u.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 200 ? parsed : undefined;
}

function applicationError(code: OrderApplicationErrorCode): OrderApplicationError { return new OrderApplicationError(code); }
function unavailable(): OrderApplicationError { return applicationError("unavailable"); }
