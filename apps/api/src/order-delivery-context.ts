import {
  parseOrderDeliveryV1,
  parseOrderFulfillmentSnapshotV1OrV2,
  type BranchScope,
  type OrderDeliveryV1,
  type OrderFulfillmentSnapshotV1,
  type OrderFulfillmentSnapshotV2,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const readSql = "select app_private.read_order_delivery_context($1::uuid, $2::uuid, $3::uuid, $4::uuid) as result";

/** Raw facts of one Order's frozen fulfillment snapshot and delivery; the caller projects PII. */
export interface OrderDeliveryContext {
  readonly delivery: OrderDeliveryV1 | null;
  readonly snapshot: OrderFulfillmentSnapshotV1 | OrderFulfillmentSnapshotV2 | null;
}

export interface OrderDeliveryContextPort {
  read(actorId: string, scope: BranchScope, orderId: string): Promise<OrderDeliveryContext | "forbidden" | "missing">;
}

export const ORDER_DELIVERY_CONTEXT_PORT = Symbol("ORDER_DELIVERY_CONTEXT_PORT");

@Injectable()
export class PostgresOrderDeliveryContextAdapter implements OrderDeliveryContextPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async read(
    actorId: string,
    scope: BranchScope,
    orderId: string,
  ): Promise<OrderDeliveryContext | "forbidden" | "missing"> {
    const result = await this.database.query(readSql, [actorId, scope.restaurantId, scope.branchId, orderId]);
    // The SQL is `select fn(...) as result`: the row is `{ result: <jsonb> }`.
    const row = result.rows.length === 1 ? exactRecord(result.rows[0], ["result"]) : undefined;
    if (row === undefined) throw new Error("ORDER_DELIVERY_CONTEXT_UNAVAILABLE");
    const raw = own(row, "result");
    if (raw === null) return "missing";
    const minimal = exactRecord(raw, ["status"]);
    if (minimal !== undefined) {
      if (own(minimal, "status") === "forbidden") return "forbidden";
      throw new Error("ORDER_DELIVERY_CONTEXT_UNAVAILABLE");
    }
    const record = exactRecord(raw, ["schemaVersion", "snapshot", "delivery"]);
    if (record === undefined || own(record, "schemaVersion") !== 1) throw new Error("ORDER_DELIVERY_CONTEXT_UNAVAILABLE");
    const rawSnapshot = own(record, "snapshot");
    const snapshot = rawSnapshot === null ? null : parseOrderFulfillmentSnapshotV1OrV2(rawSnapshot);
    const rawDelivery = own(record, "delivery");
    const delivery = rawDelivery === null ? null : parseOrderDeliveryV1(rawDelivery);
    if (snapshot === undefined || delivery === undefined || (snapshot !== null && snapshot.orderId !== orderId)
      || (delivery !== null && (delivery.orderId !== orderId || delivery.scope.restaurantId !== scope.restaurantId
        || delivery.scope.branchId !== scope.branchId))) throw new Error("ORDER_DELIVERY_CONTEXT_UNAVAILABLE");
    return Object.freeze({ delivery, snapshot });
  }
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
