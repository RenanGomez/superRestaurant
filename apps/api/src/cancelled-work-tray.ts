import { Inject, Injectable } from "@nestjs/common";
import { calculateCancelledOrderOriginalTotal, type Order } from "@super-restaurant/domain";
import {
  parseCancelledWorkItemV1,
  parseCancelledWorkTrayRequestV1,
  parseCancelledWorkTrayV1,
  parseOrderFulfillmentSnapshotV1OrV2,
  type CancelledWorkItemV1,
  type CancelledWorkTrayRequestV1,
  type CancelledWorkTrayV1,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { rolesGrantPermission } from "./auth/rbac-policy.js";
import { buildCustomerLabel } from "./branch-order-work-tray.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { OrderApplicationError } from "./orders.js";
import { decodeOrderRecord } from "./persistence/order-persistence-codec.js";

const listSql = "select app_private.list_cancelled_work_items($1::uuid, $2::jsonb) as result";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ITEM_KEYS = [
  "kind", "id", "at", "occurredAt", "reason", "actorId", "refundObligationStatus", "capturedMinor", "capturedTipMinor",
  "currency", "fromStatus", "version", "channel", "order", "snapshot", "folio", "fulfillmentChannel", "sourceChannel",
] as const;

export interface CancelledWorkTrayPort {
  list(actorId: string, request: CancelledWorkTrayRequestV1): Promise<unknown>;
}

export const CANCELLED_WORK_TRAY_PORT = Symbol("CANCELLED_WORK_TRAY_PORT");

@Injectable()
export class PostgresCancelledWorkTray implements CancelledWorkTrayPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async list(actorId: string, input: CancelledWorkTrayRequestV1): Promise<unknown> {
    const request = parseCancelledWorkTrayRequestV1(input);
    if (!UUID_PATTERN.test(actorId) || request === undefined) throw new OrderApplicationError("unavailable");
    const sqlRequest = { after: request.cursor, limit: request.limit, schemaVersion: 1, scope: request.scope };
    const result = await this.database.query(listSql, [actorId, JSON.stringify(sqlRequest)]);
    if (result.rows.length !== 1) throw new OrderApplicationError("unavailable");
    const row = exactRecord(result.rows[0], ["result"]);
    if (row === undefined) throw new OrderApplicationError("unavailable");
    return own(row, "result");
  }
}

@Injectable()
export class CancelledWorkTrayService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CANCELLED_WORK_TRAY_PORT) private readonly tray: CancelledWorkTrayPort,
  ) {}

  public async list(principal: AuthenticatedPrincipal, input: unknown): Promise<CancelledWorkTrayV1> {
    const request = parseCancelledWorkTrayRequestV1(input);
    if (request === undefined) throw new OrderApplicationError("request");
    let actorId: string;
    let canReadCustomers: boolean;
    try {
      const authorized = await this.authorization.authorizeBranch(principal, request.scope, "orders.read");
      actorId = authorized.principal.actorId;
      canReadCustomers = rolesGrantPermission(authorized.roles, "customers.read");
    } catch { throw new OrderApplicationError("authorization"); }
    let raw: unknown;
    try { raw = await this.tray.list(actorId, request); } catch { throw new OrderApplicationError("unavailable"); }
    const outcome = exactRecord(raw, ["status"]);
    if (outcome !== undefined) {
      if (own(outcome, "status") === "denied") throw new OrderApplicationError("authorization");
      if (own(outcome, "status") === "rejected") throw new OrderApplicationError("request");
      throw new OrderApplicationError("unavailable");
    }
    const envelope = exactRecord(raw, ["schemaVersion", "scope", "items", "next"]);
    const scope = envelope === undefined ? undefined : exactRecord(own(envelope, "scope"), ["restaurantId", "branchId"]);
    const rawItems = envelope === undefined ? undefined : own(envelope, "items");
    if (envelope === undefined || own(envelope, "schemaVersion") !== 1 || scope === undefined
      || own(scope, "restaurantId") !== request.scope.restaurantId || own(scope, "branchId") !== request.scope.branchId
      || !Array.isArray(rawItems) || rawItems.length > request.limit) throw new OrderApplicationError("unavailable");
    const items: CancelledWorkItemV1[] = [];
    for (const rawItem of rawItems) {
      const item = projectItem(rawItem, request.scope, canReadCustomers);
      if (item === undefined) throw new OrderApplicationError("unavailable");
      items.push(item);
    }
    const result = parseCancelledWorkTrayV1({
      items, nextCursor: own(envelope, "next"), schemaVersion: 1, scope: request.scope,
    });
    if (result === undefined) throw new OrderApplicationError("unavailable");
    return result;
  }
}

/** Pure projection: money comes from the frozen aggregate and the recorded obligation; SQL derives none. */
function projectItem(
  raw: unknown,
  scope: { readonly restaurantId: string; readonly branchId: string },
  canReadCustomers: boolean,
): CancelledWorkItemV1 | undefined {
  const record = exactRecord(raw, ITEM_KEYS);
  if (record === undefined) return undefined;
  const id = own(record, "id");
  const base = { cancelledAt: own(record, "at"), cancelledByActorId: own(record, "actorId"), reason: own(record, "reason") };
  if (own(record, "kind") === "capture") {
    return parseCancelledWorkItemV1({
      ...base, captureDraftId: id, folio: own(record, "folio"), fulfillmentChannel: own(record, "fulfillmentChannel"),
      kind: "capture", sourceChannel: own(record, "sourceChannel"),
    });
  }
  if (own(record, "kind") !== "order") return undefined;
  let order: Order;
  try { order = decodeOrderRecord(own(record, "order")); } catch { return undefined; }
  if (order.orderId !== id || order.restaurantId !== scope.restaurantId || order.branchId !== scope.branchId
    || order.status !== "cancelled" || order.channel !== own(record, "channel")) return undefined;
  let total: number | null = null;
  try { total = calculateCancelledOrderOriginalTotal(order).amountMinor; } catch { return undefined; }
  const rawSnapshot = own(record, "snapshot");
  let customerLabel: string | null = null;
  if (canReadCustomers && rawSnapshot !== null) {
    const snapshot = parseOrderFulfillmentSnapshotV1OrV2(rawSnapshot);
    if (snapshot === undefined || snapshot.orderId !== order.orderId) return undefined;
    customerLabel = buildCustomerLabel(snapshot);
  }
  return parseCancelledWorkItemV1({
    ...base,
    channel: order.channel,
    customerLabel,
    fromStatus: own(record, "fromStatus"),
    kind: "order",
    lineCount: order.items.length,
    orderId: order.orderId,
    refundObligation: {
      capturedMinor: own(record, "capturedMinor"),
      capturedTipMinor: own(record, "capturedTipMinor"),
      currency: own(record, "currency"),
      status: own(record, "refundObligationStatus"),
    },
    timeZone: order.timeZone,
    totalMinor: total,
    version: own(record, "version"),
  });
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
