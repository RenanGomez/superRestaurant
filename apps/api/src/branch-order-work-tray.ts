import { Inject, Injectable } from "@nestjs/common";
import { calculateOrderAggregateTotals, deriveOrderPreparationStatus, type Order } from "@super-restaurant/domain";
import {
  parseBranchOrderWorkItemV1,
  parseBranchOrderWorkTrayRequestV1,
  parseBranchOrderWorkTrayV1,
  parseOrderFulfillmentSnapshotV1OrV2,
  type BranchOrderWorkItemV1,
  type BranchOrderWorkTrayRequestV1,
  type BranchOrderWorkTrayV1,
  type OrderFulfillmentSnapshotV1,
  type OrderFulfillmentSnapshotV2,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { rolesGrantPermission } from "./auth/rbac-policy.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { decodeOrderRecord } from "./persistence/order-persistence-codec.js";

const listSql = "select app_private.list_branch_order_work_items($1::uuid, $2::jsonb) as result";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CHANNELS = ["table", "counter", "takeout", "delivery"] as const;
const STATUSES = ["draft", "open", "partially_paid"] as const;

export type BranchOrderWorkTrayErrorCode = "authorization" | "request" | "unavailable";

export class BranchOrderWorkTrayError extends Error {
  public constructor(public readonly code: BranchOrderWorkTrayErrorCode) {
    super(`BRANCH_ORDER_WORK_TRAY_${code.toUpperCase()}`);
    this.name = "BranchOrderWorkTrayError";
  }
}

export interface BranchOrderWorkTrayPort {
  list(actorId: string, request: BranchOrderWorkTrayRequestV1): Promise<unknown>;
}

export const BRANCH_ORDER_WORK_TRAY_PORT = Symbol("BRANCH_ORDER_WORK_TRAY_PORT");

@Injectable()
export class PostgresBranchOrderWorkTray implements BranchOrderWorkTrayPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async list(actorId: string, input: BranchOrderWorkTrayRequestV1): Promise<unknown> {
    const request = parseBranchOrderWorkTrayRequestV1(input);
    if (!UUID_PATTERN.test(actorId) || request === undefined) throw unavailable();
    const sqlRequest = {
      after: request.cursor, channel: request.channel, limit: request.limit, schemaVersion: 1, scope: request.scope,
    };
    let rows: readonly unknown[];
    try {
      rows = (await this.database.query(listSql, [actorId, JSON.stringify(sqlRequest)])).rows;
    } catch { throw unavailable(); }
    if (rows.length !== 1) throw unavailable();
    const record = exactRecord(rows[0], ["result"]);
    if (record === undefined) throw unavailable();
    return own(record, "result");
  }
}

@Injectable()
export class BranchOrderWorkTrayService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(BRANCH_ORDER_WORK_TRAY_PORT) private readonly tray: BranchOrderWorkTrayPort,
  ) {}

  public async list(principal: AuthenticatedPrincipal, input: unknown): Promise<BranchOrderWorkTrayV1> {
    const request = parseBranchOrderWorkTrayRequestV1(input);
    if (request === undefined) throw applicationError("request");
    let actorId: string;
    let canReadCustomers: boolean;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, request.scope, "orders.read");
      actorId = authorized.principal.actorId;
      // `customers.read` is an optional capability here, not a gate: a role with `orders.read`
      // alone (e.g. kitchen, viewer, auditor) still sees every active Order, just without the
      // customer name/phone or street-level address -- never a silent authorization bypass.
      canReadCustomers = rolesGrantPermission(authorized.roles, "customers.read");
    } catch { throw applicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.tray.list(actorId, request); } catch { throw unavailable(); }
    const outcome = exactRecord(raw, ["status"]);
    if (outcome !== undefined) {
      if (own(outcome, "status") === "denied") throw applicationError("authorization");
      if (own(outcome, "status") === "rejected") throw applicationError("request");
      throw unavailable();
    }
    const envelope = exactRecord(raw, ["schemaVersion", "scope", "orders", "next"]);
    if (envelope === undefined || own(envelope, "schemaVersion") !== 1) throw unavailable();
    const scope = exactRecord(own(envelope, "scope"), ["restaurantId", "branchId"]);
    if (scope === undefined || own(scope, "restaurantId") !== request.scope.restaurantId
      || own(scope, "branchId") !== request.scope.branchId) throw unavailable();
    const rawOrders = own(envelope, "orders");
    if (!Array.isArray(rawOrders) || rawOrders.length > request.limit) throw unavailable();
    const items: BranchOrderWorkItemV1[] = [];
    for (const rawOrder of rawOrders) items.push(projectBranchOrderWorkItem(rawOrder, request.scope, canReadCustomers));
    const result = parseBranchOrderWorkTrayV1({
      items, nextCursor: own(envelope, "next"), schemaVersion: 1, scope: request.scope,
    });
    if (result === undefined) throw unavailable();
    return result;
  }
}

/**
 * Pure server-side projection only. Totals are read from `calculateOrderAggregateTotals` on the
 * order's own frozen aggregate -- never recalculated from the current catalog. The fulfillment
 * snapshot (when present) contributes only customer/address/payment-intent labels; PII is reduced
 * to a name plus a masked phone suffix, never the full phone or address text. `canReadCustomers`
 * (the caller's own `customers.read` grant, never trusted from the client) additionally nulls out
 * the customer/address labels for a role that only has `orders.read` (kitchen, viewer, auditor).
 */
function projectBranchOrderWorkItem(
  raw: unknown,
  scope: { restaurantId: string; branchId: string },
  canReadCustomers: boolean,
): BranchOrderWorkItemV1 {
  const record = exactRecord(raw, ["orderId", "channel", "status", "version", "createdAt", "updatedAt", "confirmedAt", "order", "snapshot"]);
  if (record === undefined) throw unavailable();
  const orderId = own(record, "orderId");
  const channel = own(record, "channel");
  const status = own(record, "status");
  const createdAt = own(record, "createdAt");
  const updatedAt = own(record, "updatedAt");
  const confirmedAt = own(record, "confirmedAt");
  if (typeof orderId !== "string" || !member(channel, CHANNELS) || !member(status, STATUSES)
    || typeof createdAt !== "string" || typeof updatedAt !== "string"
    || (confirmedAt !== null && typeof confirmedAt !== "string")) throw unavailable();

  let order: Order;
  try { order = decodeOrderRecord(own(record, "order")); } catch { throw unavailable(); }
  if (order.orderId !== orderId || order.restaurantId !== scope.restaurantId || order.branchId !== scope.branchId
    || order.status !== status) throw unavailable();

  const rawSnapshot = own(record, "snapshot");
  let snapshot: OrderFulfillmentSnapshotV1 | OrderFulfillmentSnapshotV2 | null = null;
  if (rawSnapshot !== null) {
    snapshot = parseOrderFulfillmentSnapshotV1OrV2(rawSnapshot) ?? null;
    if (snapshot === null || snapshot.orderId !== orderId) throw unavailable();
  }

  const totals = calculateOrderAggregateTotals(order);
  const deliveryChargeMinor = order.deliveryCharge === null ? 0 : order.deliveryCharge.amount.amountMinor;
  const paymentIntent = snapshot !== null && "paymentIntent" in snapshot && snapshot.paymentIntent !== null
    ? {
      method: snapshot.paymentIntent.method,
      tenderedAmountMinor: snapshot.paymentIntent.tenderedAmountMinor,
      tipMinor: snapshot.paymentIntent.tipMinor,
    }
    : null;
  const fulfillmentChannel = snapshot === null ? (channel === "table" ? "dine_in" : null) : snapshot.fulfillmentChannel;

  const item = parseBranchOrderWorkItemV1({
    addressLabel: canReadCustomers ? buildAddressLabel(snapshot) : null,
    channel,
    createdAt: confirmedAt ?? createdAt,
    customerLabel: canReadCustomers ? buildCustomerLabel(snapshot) : null,
    fulfillmentChannel,
    hasNotes: order.items.some((entry) => typeof entry.note === "string"),
    lineCount: order.items.filter((entry) => entry.status !== "cancelled").length,
    orderId,
    paymentIntent,
    preparation: deriveOrderPreparationStatus(order.items.map((entry) => entry.status)),
    status,
    timeZone: order.timeZone,
    totals: {
      currency: totals.total.currency,
      deliveryChargeMinor,
      itemsTotalMinor: totals.total.amountMinor - deliveryChargeMinor,
      totalMinor: totals.total.amountMinor,
    },
    updatedAt,
  });
  if (item === undefined) throw unavailable();
  return item;
}

function buildCustomerLabel(snapshot: OrderFulfillmentSnapshotV1 | OrderFulfillmentSnapshotV2 | null): string | null {
  const party = snapshot?.partySnapshot ?? null;
  if (party === null) return null;
  const digits = party.phoneDisplayValue.replaceAll(/\D/gu, "");
  const suffix = digits.length >= 2 ? digits.slice(-2) : digits;
  return `${party.displayName} · ****${suffix}`;
}

function buildAddressLabel(snapshot: OrderFulfillmentSnapshotV1 | OrderFulfillmentSnapshotV2 | null): string | null {
  const address = snapshot?.fulfillmentSnapshot ?? null;
  if (address === null) return null;
  const street = address.streetLine.length > 40 ? `${address.streetLine.slice(0, 40)}…` : address.streetLine;
  return `${address.label} · ${street}`;
}

function member<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
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

function unavailable(): BranchOrderWorkTrayError { return applicationError("unavailable"); }
function applicationError(code: BranchOrderWorkTrayErrorCode): BranchOrderWorkTrayError {
  return new BranchOrderWorkTrayError(code);
}
