import {
  parseAddOrderItemCommandV1,
  parseCreateOrderCommandV1,
  parseKdsCursorV1,
  parseKdsEventPageV1,
  parseKdsEventV1,
  parseKdsTicketListV1,
  parseOpenOrderCommandV1,
  parseBranchScope,
  parseRealtimeSubscriptionV1,
  parseTransitionOrderItemCommandV1,
  type BranchScope,
  type CreateOrderCommandV1,
  type KdsCursorV1,
  type KdsEventPageV1,
  type KdsEventV1,
  type KdsTicketListV1,
  type MenuCatalogV1,
  type OrderAuditInputV1,
  type OrderMutationSummaryV1,
  type RealtimeSubscriptionV1,
} from "@super-restaurant/shared-types";
import {
  Money,
  addOrderItem,
  createMenuProductPriceSnapshot,
  createOrder,
  transitionOrderItemStatus,
  transitionOrderStatus,
  type MenuCatalog,
  type Order,
  type OrderAuditContext,
  type OrderMutation,
} from "@super-restaurant/domain";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { MENU_CATALOG_PORT, type MenuCatalogPort } from "./menu-catalog.js";
import {
  decodeOrderRecord,
  encodeOrderAuditEventRecord,
  encodeOrderRecord,
} from "./persistence/order-persistence-codec.js";

const readOrderSql = "select app_private.read_order($1::uuid, $2::uuid, $3::uuid, $4::uuid) as result";
const persistOrderSql = "select app_private.persist_order_mutation($1::uuid, $2::bigint, $3::jsonb, $4::jsonb) as result";
const recoverKdsSql = "select app_private.recover_kds_events($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::integer) as result";
const listKdsTicketsSql = "select app_private.list_kds_tickets($1::uuid, $2::uuid, $3::uuid, $4::text) as result";

export type OrderApplicationErrorCode = "authorization" | "conflict" | "not_found" | "request" | "unavailable";

export class OrderApplicationError extends Error {
  public constructor(public readonly code: OrderApplicationErrorCode) {
    super(`ORDER_${code.toUpperCase()}`);
    this.name = "OrderApplicationError";
  }
}

export interface StoredOrder {
  readonly order: Order;
  readonly version: number;
}

export type PersistOrderResult =
  | Readonly<{ readonly status: "conflict" | "forbidden" }>
  | Readonly<{
    readonly kdsEvent: KdsEventV1 | null;
    readonly order: Order;
    readonly status: "replayed" | "saved";
    readonly version: number;
  }>;

export interface OrderPersistencePort {
  listKdsTickets(actorId: string, subscription: RealtimeSubscriptionV1): Promise<KdsTicketListV1 | "forbidden">;
  persist(actorId: string, expectedVersion: number, mutation: OrderMutation): Promise<PersistOrderResult>;
  read(actorId: string, scope: BranchScope, orderId: string): Promise<StoredOrder | "missing">;
  recoverKds(actorId: string, subscription: RealtimeSubscriptionV1, after: KdsCursorV1, limit: number): Promise<KdsEventPageV1 | "forbidden">;
}

export const ORDER_PERSISTENCE_PORT = Symbol("ORDER_PERSISTENCE_PORT");

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
    const result = await this.database.query(readOrderSql, [actorId, scope.restaurantId, scope.branchId, orderId]);
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

  public async persist(actorId: string, expectedVersion: number, mutation: OrderMutation): Promise<PersistOrderResult> {
    const encodedOrder = encodeOrderRecord(mutation.order);
    const encodedAudit = encodeOrderAuditEventRecord(mutation.auditEvent);
    const result = await this.database.query(persistOrderSql, [
      actorId,
      expectedVersion,
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
  ) {}

  public async create(principal: AuthenticatedPrincipal, input: unknown): Promise<OrderMutationSummaryV1> {
    const command = parseCreateOrderCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "orders.create");
    return this.persist(actorId, 0, createOrder(orderInput(command), auditContext(command, actorId)));
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
        toDomainCatalog(catalog, command.scope.restaurantId),
        { currency: stored.order.currency, productId: command.productId, restaurantId: command.scope.restaurantId },
        command.modifierGroups,
      );
      mutation = addOrderItem(stored.order, { orderItemId: command.orderItemId, quantity: command.quantity, snapshot }, auditContext(command, actorId));
    } catch {
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

  private async persist(actorId: string, expectedVersion: number, mutation: OrderMutation): Promise<OrderMutationSummaryV1> {
    let result: PersistOrderResult;
    try { result = await this.orders.persist(actorId, expectedVersion, mutation); } catch { throw unavailable(); }
    if (result.status === "forbidden") throw applicationError("authorization");
    if (result.status === "conflict") throw applicationError("conflict");
    if (result.status !== "saved" && result.status !== "replayed") throw unavailable();
    if (result.status === "saved" && result.kdsEvent !== null) {
      try { await this.notifications.notify(result.kdsEvent); } catch { /* Durable cursor recovery is authoritative. */ }
    }
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

  private async authorize(
    principal: AuthenticatedPrincipal,
    scope: BranchScope,
    permission: "kds.read" | "kds.transition" | "orders.create" | "orders.update",
  ): Promise<string> {
    try { return (await this.authorization.authorizeBranch(principal, scope, permission)).principal.actorId; }
    catch { throw applicationError("authorization"); }
  }
}

function orderInput(command: CreateOrderCommandV1): Parameters<typeof createOrder>[0] {
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

function toDomainCatalog(catalog: MenuCatalogV1, restaurantId: string): MenuCatalog {
  return {
    catalogVersion: catalog.catalogVersion,
    categories: catalog.categories.map((category) => ({
      active: category.active,
      catalogVersion: catalog.catalogVersion,
      displayOrder: category.displayOrder,
      id: category.categoryId,
      name: category.name,
      restaurantId,
    })),
    currency: catalog.currency,
    modifierGroups: catalog.modifierGroups.map((group) => ({
      active: group.active,
      catalogVersion: catalog.catalogVersion,
      id: group.groupId,
      maximumQuantity: group.maximumQuantity,
      minimumQuantity: group.minimumQuantity,
      name: group.name,
      options: group.options.map((option) => ({
        active: option.active,
        id: option.optionId,
        ...(option.maximumQuantity === null ? {} : { maximumQuantity: option.maximumQuantity }),
        name: option.name,
        unitPrice: new Money(option.unitPriceMinor, catalog.currency),
      })),
      productId: group.productId,
      restaurantId,
    })),
    products: catalog.products.map((product) => ({
      active: product.active,
      catalogVersion: catalog.catalogVersion,
      categoryId: product.categoryId,
      displayOrder: product.displayOrder,
      id: product.productId,
      modifierGroupIds: catalog.modifierGroups.filter((group) => group.productId === product.productId).map((group) => group.groupId),
      name: product.name,
      restaurantId,
      ...(product.sku === null ? {} : { sku: product.sku }),
      stationId: product.stationId,
      ...(product.tax === null ? {} : { tax: {
        inclusion: product.tax.inclusion,
        name: product.tax.name,
        rate: { denominator: BigInt(product.tax.rateDenominator), numerator: BigInt(product.tax.rateNumerator) },
        taxId: product.tax.taxId,
        taxRuleVersion: product.tax.taxRuleVersion,
      } }),
      unit: product.unit,
      unitPrice: new Money(product.unitPriceMinor, catalog.currency),
    })),
    restaurantId,
  };
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
