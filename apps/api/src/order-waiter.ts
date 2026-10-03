import {
  parseAssignOrderWaiterCommandV1,
  parseAssignOrderWaiterResultV1,
  type AssignOrderWaiterCommandV1,
  type AssignOrderWaiterResultV1,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const assignSql = "select app_private.assign_order_waiter($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::jsonb) as result";

export type OrderWaiterApplicationErrorCode = "authorization" | "conflict" | "request" | "unavailable";

export class OrderWaiterApplicationError extends Error {
  public constructor(public readonly code: OrderWaiterApplicationErrorCode) {
    super(`ORDER_WAITER_${code.toUpperCase()}`);
    this.name = "OrderWaiterApplicationError";
  }
}

export type AssignOrderWaiterWriteResult =
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "replayed"; version: number; waiterUserId: string | null }>
  | Readonly<{ status: "saved"; version: number; waiterUserId: string | null }>;

export interface OrderWaiterPort {
  assign(
    actorId: string,
    command: AssignOrderWaiterCommandV1,
  ): Promise<AssignOrderWaiterWriteResult>;
}

export const ORDER_WAITER_PORT = Symbol("ORDER_WAITER_PORT");

@Injectable()
export class PostgresOrderWaiterAdapter implements OrderWaiterPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async assign(
    actorId: string,
    command: AssignOrderWaiterCommandV1,
  ): Promise<AssignOrderWaiterWriteResult> {
    const audit = {
      actorId, branchId: command.scope.branchId, deviceId: command.deviceId, entityId: command.orderId,
      entityType: "order", eventId: command.eventId, idempotencyKey: command.idempotencyKey,
      occurredAt: command.occurredAt, operation: "order.waiter_assigned", orderId: command.orderId,
      payload: { to: command.waiterUserId },
      restaurantId: command.scope.restaurantId, schemaVersion: 1,
    };
    const result = await this.database.query(assignSql, [
      actorId, command.expectedVersion, command.orderId, command.scope.restaurantId, command.scope.branchId,
      command.waiterUserId, JSON.stringify(audit),
    ]);
    // The SQL is `select fn(...) as result`: the row is `{ result: <jsonb> }`.
    const row = result.rows.length === 1 ? exactRecord(result.rows[0], ["result"]) : undefined;
    if (row === undefined) throw unavailable();
    const raw = own(row, "result");
    const minimal = exactRecord(raw, ["status"]);
    if (minimal !== undefined) {
      const status = own(minimal, "status");
      if (status === "conflict" || status === "forbidden") return Object.freeze({ status });
      throw unavailable();
    }
    const record = exactRecord(raw, ["status", "version", "order"]);
    const status = record === undefined ? undefined : own(record, "status");
    if (status !== "saved" && status !== "replayed") throw unavailable();
    const version = integerValue(own(record as Record<string, unknown>, "version"));
    const order = exactRecord(own(record as Record<string, unknown>, "order"), ["orderId", "restaurantId", "branchId", "waiterUserId", "version"]);
    if (
      typeof version !== "number" || order === undefined
      || own(order, "orderId") !== command.orderId
      || own(order, "restaurantId") !== command.scope.restaurantId
      || own(order, "branchId") !== command.scope.branchId
      || integerValue(own(order, "version")) !== version
    ) throw unavailable();
    const waiterUserId = own(order, "waiterUserId");
    if (waiterUserId !== null && typeof waiterUserId !== "string") throw unavailable();
    return Object.freeze({ status, version, waiterUserId });
  }
}

@Injectable()
export class OrderWaiterService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(ORDER_WAITER_PORT) private readonly writer: OrderWaiterPort,
  ) {}

  public async assign(principal: AuthenticatedPrincipal, input: unknown): Promise<AssignOrderWaiterResultV1> {
    const command = parseAssignOrderWaiterCommandV1(input);
    if (command === undefined) throw applicationError("request");
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, command.scope, "orders.update")).principal.actorId;
    } catch { throw applicationError("authorization"); }
    // The audit `from` is never supplied by the client: assign_order_waiter derives it from the
    // row it reads under FOR UPDATE and stores it in the audit evidence.
    let result: AssignOrderWaiterWriteResult;
    try {
      result = await this.writer.assign(actorId, command);
    } catch (error: unknown) {
      if (error instanceof OrderWaiterApplicationError) throw error;
      throw unavailable();
    }
    if (result.status === "forbidden") throw applicationError("authorization");
    if (result.status === "conflict") throw applicationError("conflict");
    const parsed = parseAssignOrderWaiterResultV1({
      orderId: command.orderId, replayed: result.status === "replayed", schemaVersion: 1,
      scope: command.scope, version: result.version, waiterUserId: result.waiterUserId,
    });
    if (parsed === undefined) throw unavailable();
    return parsed;
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Record<string, unknown>;
  } catch { return undefined; }
}

function own(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function integerValue(value: unknown): unknown {
  return typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value) ? Number(value) : value;
}

function unavailable(): OrderWaiterApplicationError { return applicationError("unavailable"); }
function applicationError(code: OrderWaiterApplicationErrorCode): OrderWaiterApplicationError { return new OrderWaiterApplicationError(code); }
