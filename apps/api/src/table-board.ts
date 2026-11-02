import {
  parseBranchScope,
  parseDiningLayoutV1,
  parseTableBoardV1,
  type BranchScope,
  type DiningLayoutV1,
  type TableBoardV1,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { DINING_TABLE_PORT, type DiningTablePort } from "./dining-tables.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const listActiveTableOrdersSql = "select app_private.list_table_board($1::uuid, $2::uuid, $3::uuid) as board";

export type TableBoardApplicationErrorCode = "authorization" | "request" | "unavailable";

export class TableBoardApplicationError extends Error {
  public constructor(public readonly code: TableBoardApplicationErrorCode) {
    super(`TABLE_BOARD_${code.toUpperCase()}`);
    this.name = "TableBoardApplicationError";
  }
}

interface RawTableBoardOrder {
  readonly accountLabel?: unknown;
  readonly openedAt: unknown;
  readonly orderId: unknown;
  readonly status: unknown;
  readonly tableId: unknown;
  readonly version: unknown;
  readonly waiterUserId: unknown;
}

export interface TableBoardPort {
  listActiveOrders(actorId: string, scope: BranchScope): Promise<readonly RawTableBoardOrder[] | "forbidden">;
}

export const TABLE_BOARD_PORT = Symbol("TABLE_BOARD_PORT");

@Injectable()
export class PostgresTableBoardAdapter implements TableBoardPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async listActiveOrders(actorId: string, scope: BranchScope): Promise<readonly RawTableBoardOrder[] | "forbidden"> {
    const result = await this.database.query(listActiveTableOrdersSql, [actorId, scope.restaurantId, scope.branchId]);
    if (result.rows.length !== 1) throw unavailable();
    const row = exactRecord(result.rows[0], ["board"]);
    if (row === undefined) throw unavailable();
    const board = dataProperty(row, "board");
    if (board === null) return "forbidden";
    // Above the SQL cap the function answers limit_exceeded; that is never a complete board.
    const limit = exactRecord(board, ["status"]);
    if (limit !== undefined && dataProperty(limit, "status") === "limit_exceeded") throw unavailable();
    const record = exactRecord(board, ["schemaVersion", "scope", "orders"]);
    if (record === undefined || dataProperty(record, "schemaVersion") !== 1 || !sameScope(dataProperty(record, "scope"), scope)) {
      throw unavailable();
    }
    const rawOrders = dataProperty(record, "orders");
    if (!Array.isArray(rawOrders)) throw unavailable();
    return rawOrders.map((entry) => {
      const order = exactRecord(entry, ["tableId", "orderId", "status", "version", "waiterUserId", "openedAt"], ["accountLabel"]);
      if (order === undefined) throw unavailable();
      return Object.freeze({
        accountLabel: dataProperty(order, "accountLabel") ?? null,
        openedAt: dataProperty(order, "openedAt"), orderId: dataProperty(order, "orderId"),
        status: dataProperty(order, "status"), tableId: dataProperty(order, "tableId"),
        version: integerValue(dataProperty(order, "version")), waiterUserId: dataProperty(order, "waiterUserId"),
      });
    });
  }
}

@Injectable()
export class TableBoardService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(DINING_TABLE_PORT) private readonly tables: DiningTablePort,
    @Inject(TABLE_BOARD_PORT) private readonly board: TableBoardPort,
  ) {}

  public async read(principal: AuthenticatedPrincipal, input: unknown): Promise<TableBoardV1> {
    const scope = parseUuidScope(input);
    if (scope === undefined) throw applicationError("request");
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, scope, "tables.read")).principal.actorId;
    } catch { throw applicationError("authorization"); }
    let layout: DiningLayoutV1;
    let activeOrders: readonly RawTableBoardOrder[];
    try {
      const rawLayout = await this.tables.list(actorId, scope);
      if (rawLayout === "forbidden") throw applicationError("authorization");
      const parsedLayout = parseDiningLayoutV1(rawLayout);
      if (parsedLayout === undefined) throw unavailable();
      layout = parsedLayout;
      const rawOrders = await this.board.listActiveOrders(actorId, scope);
      if (rawOrders === "forbidden") throw applicationError("authorization");
      activeOrders = rawOrders;
    } catch (error: unknown) {
      if (error instanceof TableBoardApplicationError) throw error;
      throw unavailable();
    }
    const ordersByTable = new Map<string, RawTableBoardOrder[]>();
    for (const order of activeOrders) {
      const tableId = typeof order.tableId === "string" ? order.tableId : undefined;
      if (tableId === undefined) throw unavailable();
      const bucket = ordersByTable.get(tableId) ?? [];
      bucket.push(order);
      ordersByTable.set(tableId, bucket);
    }
    const activeOrder = (order: RawTableBoardOrder) => ({
      accountLabel: order.accountLabel ?? null,
      openedAt: order.openedAt, orderId: order.orderId, status: order.status,
      version: order.version, waiterUserId: order.waiterUserId,
    });
    const layoutTables = layout.zones.flatMap((zone) => zone.tables);
    const layoutTableIds = new Set(layoutTables.map((table) => table.tableId));
    // Active orders whose table is no longer in the layout (soft-deleted) must stay visible.
    const unassignedOrders = activeOrders
      .filter((order) => typeof order.tableId === "string" && !layoutTableIds.has(order.tableId))
      .map((order) => ({ ...activeOrder(order), tableId: order.tableId }));
    const parsed = parseTableBoardV1({
      schemaVersion: 1,
      scope,
      tables: layoutTables.map((table) => {
        const tableOrders = ordersByTable.get(table.tableId) ?? [];
        return {
          activeOrders: tableOrders.map(activeOrder),
          status: tableOrders.length === 0 ? "free" : "occupied",
          tableId: table.tableId,
        };
      }),
      unassignedOrders,
    });
    if (parsed === undefined) throw unavailable();
    return parsed;
  }
}

function parseUuidScope(value: unknown): BranchScope | undefined {
  const scope = parseBranchScope(value);
  return scope !== undefined && UUID_PATTERN.test(scope.restaurantId) && UUID_PATTERN.test(scope.branchId) ? scope : undefined;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (!ownKeys.includes(key)) return undefined;
    }
    for (const key of ownKeys) {
      if (typeof key !== "string" || (!keys.includes(key) && !optionalKeys.includes(key))) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Record<string, unknown>;
  } catch { return undefined; }
}

function dataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function integerValue(value: unknown): unknown {
  return typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value) ? Number(value) : value;
}

function sameScope(value: unknown, scope: BranchScope): boolean {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  return record !== undefined && dataProperty(record, "restaurantId") === scope.restaurantId && dataProperty(record, "branchId") === scope.branchId;
}

function unavailable(): TableBoardApplicationError { return applicationError("unavailable"); }
function applicationError(code: TableBoardApplicationErrorCode): TableBoardApplicationError { return new TableBoardApplicationError(code); }
