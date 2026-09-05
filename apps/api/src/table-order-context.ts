import { Inject, Injectable } from "@nestjs/common";
import {
  parseActiveTableOrderListV1,
  parseBranchScope,
  type ActiveTableOrderListV1,
  type BranchScope,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const listSql = "select app_private.list_active_table_orders($1::uuid, $2::uuid, $3::uuid, $4::uuid) as state";

export type TableOrderContextErrorCode = "authorization" | "request" | "unavailable";

export class TableOrderContextError extends Error {
  public constructor(public readonly code: TableOrderContextErrorCode) {
    super(`TABLE_ORDER_CONTEXT_${code.toUpperCase()}`);
    this.name = "TableOrderContextError";
  }
}

export interface TableOrderContextDirectoryPort {
  listActive(actorId: string, scope: BranchScope, tableId: string): Promise<ActiveTableOrderListV1 | "forbidden">;
}

export const TABLE_ORDER_CONTEXT_DIRECTORY = Symbol("TABLE_ORDER_CONTEXT_DIRECTORY");

@Injectable()
export class PostgresTableOrderContextDirectory implements TableOrderContextDirectoryPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async listActive(
    actorId: string,
    scope: BranchScope,
    tableId: string,
  ): Promise<ActiveTableOrderListV1 | "forbidden"> {
    let rows: readonly unknown[];
    try {
      rows = (await this.database.query(listSql, [actorId, scope.restaurantId, scope.branchId, tableId])).rows;
    } catch { throw unavailable(); }
    if (rows.length !== 1) throw unavailable();
    const record = exactRecord(rows[0], ["state"]);
    if (record === undefined) throw unavailable();
    const state = own(record, "state");
    if (state === null) return "forbidden";
    const parsed = parseActiveTableOrderListV1(state);
    if (parsed === undefined || !sameScope(parsed.scope, scope) || parsed.tableId !== tableId) throw unavailable();
    return parsed;
  }
}

@Injectable()
export class TableOrderContextService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(TABLE_ORDER_CONTEXT_DIRECTORY) private readonly directory: TableOrderContextDirectoryPort,
  ) {}

  public async listActive(principal: AuthenticatedPrincipal, input: unknown): Promise<ActiveTableOrderListV1> {
    const parsed = parseInput(input);
    if (parsed === undefined) throw applicationError("request");
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, parsed.scope, "orders.read")).principal.actorId;
    } catch { throw applicationError("authorization"); }
    try {
      const result = await this.directory.listActive(actorId, parsed.scope, parsed.tableId);
      if (result === "forbidden") throw applicationError("authorization");
      return result;
    } catch (error: unknown) {
      if (error instanceof TableOrderContextError) throw error;
      throw unavailable();
    }
  }
}

function parseInput(value: unknown): Readonly<{ scope: BranchScope; tableId: string }> | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId", "tableId"]);
  if (record === undefined) return undefined;
  const restaurantId = uuid(own(record, "restaurantId"));
  const branchId = uuid(own(record, "branchId"));
  if (restaurantId === undefined || branchId === undefined) return undefined;
  const scope = parseBranchScope({
    branchId,
    restaurantId,
  });
  const tableId = uuid(own(record, "tableId"));
  return scope === undefined || tableId === undefined
    ? undefined
    : Object.freeze({ scope, tableId });
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

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function sameScope(left: BranchScope, right: BranchScope): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

function unavailable(): TableOrderContextError {
  return applicationError("unavailable");
}

function applicationError(code: TableOrderContextErrorCode): TableOrderContextError {
  return new TableOrderContextError(code);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
