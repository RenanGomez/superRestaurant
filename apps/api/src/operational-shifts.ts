import { Inject, Injectable } from "@nestjs/common";
import {
  parseBranchScope,
  parseOpenOperationalShiftCommandV1,
  parseOpenOperationalShiftResultV1,
  parseOperationalShiftListV1,
  type BranchScope,
  type OpenOperationalShiftCommandV1,
  type OpenOperationalShiftResultV1,
  type OperationalShiftListV1,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const listSql = "select app_private.list_active_operational_shifts($1::uuid, $2::uuid, $3::uuid) as state";
const openSql = "select app_private.open_operational_shift($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::jsonb) as result";

export type OperationalShiftApplicationErrorCode = "authorization" | "conflict" | "request" | "unavailable";

export class OperationalShiftApplicationError extends Error {
  public constructor(public readonly code: OperationalShiftApplicationErrorCode) {
    super(`OPERATIONAL_SHIFT_${code.toUpperCase()}`);
    this.name = "OperationalShiftApplicationError";
  }
}

export interface OperationalShiftDirectoryPort {
  listActive(actorId: string, scope: BranchScope): Promise<OperationalShiftListV1 | "forbidden">;
}

export const OPERATIONAL_SHIFT_DIRECTORY = Symbol("OPERATIONAL_SHIFT_DIRECTORY");

export type OpenOperationalShiftResult =
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "replayed"; shiftId: string }>
  | Readonly<{ status: "saved"; shiftId: string }>;

export interface OperationalShiftWriterPort {
  open(actorId: string, command: OpenOperationalShiftCommandV1): Promise<OpenOperationalShiftResult>;
}

export const OPERATIONAL_SHIFT_WRITER = Symbol("OPERATIONAL_SHIFT_WRITER");

@Injectable()
export class PostgresOperationalShiftDirectory implements OperationalShiftDirectoryPort, OperationalShiftWriterPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async listActive(actorId: string, scope: BranchScope): Promise<OperationalShiftListV1 | "forbidden"> {
    let rows: readonly unknown[];
    try {
      rows = (await this.database.query(listSql, [actorId, scope.restaurantId, scope.branchId])).rows;
    } catch { throw unavailable(); }
    if (rows.length !== 1) throw unavailable();
    const record = exactRecord(rows[0], ["state"]);
    if (record === undefined) throw unavailable();
    const state = own(record, "state");
    if (state === null) return "forbidden";
    const parsed = parseOperationalShiftListV1(state);
    if (parsed === undefined || !sameScope(parsed.scope, scope)) throw unavailable();
    return parsed;
  }

  public async open(actorId: string, command: OpenOperationalShiftCommandV1): Promise<OpenOperationalShiftResult> {
    const audit = {
      actorId, branchId: command.scope.branchId, deviceId: command.deviceId, entityId: command.shiftId,
      entityType: "operational_shift", eventId: command.eventId, idempotencyKey: command.idempotencyKey,
      occurredAt: command.occurredAt, operation: "operational_shift.opened", restaurantId: command.scope.restaurantId,
      schemaVersion: 1,
    };
    const result = await this.database.query(openSql, [
      actorId, command.scope.restaurantId, command.scope.branchId, command.shiftId, command.name, JSON.stringify(audit),
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
    const record = exactRecord(raw, ["status", "shiftId"]);
    const status = record === undefined ? undefined : own(record, "status");
    if (status !== "saved" && status !== "replayed") throw unavailable();
    const shiftId = own(record as Readonly<Record<string, unknown>>, "shiftId");
    if (typeof shiftId !== "string" || shiftId !== command.shiftId) throw unavailable();
    return Object.freeze({ shiftId, status });
  }
}

@Injectable()
export class OperationalShiftService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(OPERATIONAL_SHIFT_DIRECTORY) private readonly shifts: OperationalShiftDirectoryPort,
    @Inject(OPERATIONAL_SHIFT_WRITER) private readonly writer: OperationalShiftWriterPort,
  ) {}

  public async listActive(principal: AuthenticatedPrincipal, input: unknown): Promise<OperationalShiftListV1> {
    const scope = parseUuidScope(input);
    if (scope === undefined) throw applicationError("request");
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, scope, "branch.select")).principal.actorId;
    } catch { throw applicationError("authorization"); }
    try {
      const result = await this.shifts.listActive(actorId, scope);
      if (result === "forbidden") throw applicationError("authorization");
      return result;
    } catch (error: unknown) {
      if (error instanceof OperationalShiftApplicationError) throw error;
      throw unavailable();
    }
  }

  /** `cash-register.manage` is reused here: opening the branch's service period is the same
   * cashier/manager-level daily-operations action as opening a cash register, and every role that
   * already opens a register (cashier, supervisor, manager, admin, owner) is who actually opens a
   * shift on the floor. */
  public async open(principal: AuthenticatedPrincipal, input: unknown): Promise<OpenOperationalShiftResultV1> {
    const command = parseOpenOperationalShiftCommandV1(input);
    if (command === undefined) throw applicationError("request");
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, command.scope, "cash-register.manage")).principal.actorId;
    } catch { throw applicationError("authorization"); }
    let result: OpenOperationalShiftResult;
    try {
      result = await this.writer.open(actorId, command);
    } catch (error: unknown) {
      if (error instanceof OperationalShiftApplicationError) throw error;
      throw unavailable();
    }
    if (result.status === "forbidden") throw applicationError("authorization");
    if (result.status === "conflict") throw applicationError("conflict");
    const parsed = parseOpenOperationalShiftResultV1({
      replayed: result.status === "replayed", schemaVersion: 1, scope: command.scope, shiftId: result.shiftId,
    });
    if (parsed === undefined) throw unavailable();
    return parsed;
  }
}

function parseUuidScope(value: unknown): BranchScope | undefined {
  const scope = parseBranchScope(value);
  return scope !== undefined && UUID_PATTERN.test(scope.restaurantId) && UUID_PATTERN.test(scope.branchId)
    ? scope
    : undefined;
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

function sameScope(left: Readonly<{ branchId: string; restaurantId: string }>, right: BranchScope): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

function unavailable(): OperationalShiftApplicationError {
  return applicationError("unavailable");
}

function applicationError(code: OperationalShiftApplicationErrorCode): OperationalShiftApplicationError {
  return new OperationalShiftApplicationError(code);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
