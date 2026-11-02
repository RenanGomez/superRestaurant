import {
  parseSetOrderAccountLabelCommandV1,
  parseSetOrderAccountLabelResultV1,
  type SetOrderAccountLabelCommandV1,
  type SetOrderAccountLabelResultV1,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const setAccountLabelSql =
  "select app_private.set_order_account_label($1::uuid, $2::bigint, $3::uuid, $4::uuid, $5::uuid, $6::text, $7::jsonb) as result";

export type OrderAccountLabelApplicationErrorCode = "authorization" | "conflict" | "request" | "unavailable";

export class OrderAccountLabelApplicationError extends Error {
  public constructor(public readonly code: OrderAccountLabelApplicationErrorCode) {
    super(`ORDER_ACCOUNT_LABEL_${code.toUpperCase()}`);
    this.name = "OrderAccountLabelApplicationError";
  }
}

export type SetOrderAccountLabelWriteResult =
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "replayed"; version: number; accountLabel: string | null }>
  | Readonly<{ status: "saved"; version: number; accountLabel: string | null }>;

export interface OrderAccountLabelPort {
  setAccountLabel(
    actorId: string,
    command: SetOrderAccountLabelCommandV1,
  ): Promise<SetOrderAccountLabelWriteResult>;
}

export const ORDER_ACCOUNT_LABEL_PORT = Symbol("ORDER_ACCOUNT_LABEL_PORT");

@Injectable()
export class PostgresOrderAccountLabelAdapter implements OrderAccountLabelPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async setAccountLabel(
    actorId: string,
    command: SetOrderAccountLabelCommandV1,
  ): Promise<SetOrderAccountLabelWriteResult> {
    const audit = {
      actorId,
      branchId: command.scope.branchId,
      deviceId: command.deviceId,
      entityId: command.orderId,
      entityType: "order",
      eventId: command.eventId,
      idempotencyKey: command.idempotencyKey,
      occurredAt: command.occurredAt,
      operation: "order.account_label_set",
      orderId: command.orderId,
      payload: { to: command.accountLabel },
      restaurantId: command.scope.restaurantId,
      schemaVersion: 1,
    };
    const result = await this.database.query(setAccountLabelSql, [
      actorId,
      command.expectedVersion,
      command.orderId,
      command.scope.restaurantId,
      command.scope.branchId,
      command.accountLabel,
      JSON.stringify(audit),
    ]);
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
    const order = exactRecord(own(record as Record<string, unknown>, "order"), [
      "orderId",
      "restaurantId",
      "branchId",
      "accountLabel",
      "version",
    ]);
    if (
      typeof version !== "number" || order === undefined
      || own(order, "orderId") !== command.orderId
      || own(order, "restaurantId") !== command.scope.restaurantId
      || own(order, "branchId") !== command.scope.branchId
      || integerValue(own(order, "version")) !== version
    ) throw unavailable();
    const accountLabel = own(order, "accountLabel");
    if (accountLabel !== null && typeof accountLabel !== "string") throw unavailable();
    return Object.freeze({ status, version, accountLabel });
  }
}

@Injectable()
export class OrderAccountLabelService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(ORDER_ACCOUNT_LABEL_PORT) private readonly writer: OrderAccountLabelPort,
  ) {}

  public async setAccountLabel(principal: AuthenticatedPrincipal, input: unknown): Promise<SetOrderAccountLabelResultV1> {
    const command = parseSetOrderAccountLabelCommandV1(input);
    if (command === undefined) throw applicationError("request");
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, command.scope, "orders.update")).principal.actorId;
    } catch { throw applicationError("authorization"); }
    let result: SetOrderAccountLabelWriteResult;
    try {
      result = await this.writer.setAccountLabel(actorId, command);
    } catch (error: unknown) {
      if (error instanceof OrderAccountLabelApplicationError) throw error;
      throw unavailable();
    }
    if (result.status === "forbidden") throw applicationError("authorization");
    if (result.status === "conflict") throw applicationError("conflict");
    const parsed = parseSetOrderAccountLabelResultV1({
      accountLabel: result.accountLabel,
      orderId: command.orderId,
      replayed: result.status === "replayed",
      schemaVersion: 1,
      scope: command.scope,
      version: result.version,
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

function unavailable(): OrderAccountLabelApplicationError { return applicationError("unavailable"); }
function applicationError(code: OrderAccountLabelApplicationErrorCode): OrderAccountLabelApplicationError {
  return new OrderAccountLabelApplicationError(code);
}
