import {
  DINING_LAYOUT_SCHEMA_VERSION,
  parseBranchScope,
  parseCreateDiningTableCommandV1,
  parseDiningLayoutV1,
  parseDiningTableV1,
  parseUpdateDiningTableLayoutCommandV1,
  type BranchScope,
  type CreateDiningTableCommandV1,
  type DiningLayoutV1,
  type DiningTableV1,
  type UpdateDiningTableLayoutCommandV1,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const listLayoutSql = `select app_private.list_dining_layout($1::uuid, $2::uuid, $3::uuid) as layout`;
const createTableSql = `
select * from app_private.create_dining_table(
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
  $9::timestamptz, $10::text, $11::integer, $12::text, $13::integer, $14::integer, $15::integer, $16::integer
)`;
const updateLayoutSql = `
select * from app_private.update_dining_table_layout(
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::timestamptz,
  $9::bigint, $10::integer, $11::integer, $12::integer, $13::integer
)`;

export type DiningTableApplicationErrorCode = "authorization" | "conflict" | "request" | "unavailable";

export class DiningTableApplicationError extends Error {
  public constructor(public readonly code: DiningTableApplicationErrorCode) {
    super(`DINING_TABLE_${code.toUpperCase()}`);
    this.name = "DiningTableApplicationError";
  }
}

type MutationResult = Readonly<{ status: "conflict" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "created"; table: DiningTableV1 }>
  | Readonly<{ status: "replayed"; table: DiningTableV1 }>
  | Readonly<{ status: "updated"; table: DiningTableV1 }>;

export interface DiningTablePort {
  create(actorId: string, command: CreateDiningTableCommandV1): Promise<MutationResult>;
  list(actorId: string, scope: BranchScope): Promise<DiningLayoutV1 | "forbidden">;
  updateLayout(actorId: string, command: UpdateDiningTableLayoutCommandV1): Promise<MutationResult>;
}

export const DINING_TABLE_PORT = Symbol("DINING_TABLE_PORT");

@Injectable()
export class PostgresDiningTableAdapter implements DiningTablePort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async list(actorId: string, scope: BranchScope): Promise<DiningLayoutV1 | "forbidden"> {
    const result = await this.database.query(listLayoutSql, [actorId, scope.restaurantId, scope.branchId]);
    if (result.rows.length !== 1) throw unavailable();
    const row = exactRecord(result.rows[0], ["layout"]);
    if (row === undefined) throw unavailable();
    const layout = dataProperty(row, "layout");
    if (layout === null) return "forbidden";
    const parsed = parseDiningLayoutV1(layout);
    if (parsed === undefined) throw unavailable();
    return parsed;
  }

  public async create(actorId: string, command: CreateDiningTableCommandV1): Promise<MutationResult> {
    const result = await this.database.query(createTableSql, [
      actorId, command.scope.restaurantId, command.scope.branchId, command.tableId, command.zoneId,
      command.eventId, command.idempotencyKey, command.deviceId, command.occurredAt, command.name,
      command.capacity, command.shape, command.layout.x, command.layout.y, command.layout.width, command.layout.height,
    ]);
    return parseMutationResult(result.rows);
  }

  public async updateLayout(actorId: string, command: UpdateDiningTableLayoutCommandV1): Promise<MutationResult> {
    const result = await this.database.query(updateLayoutSql, [
      actorId, command.scope.restaurantId, command.scope.branchId, command.tableId, command.eventId,
      command.idempotencyKey, command.deviceId, command.occurredAt, command.expectedVersion,
      command.layout.x, command.layout.y, command.layout.width, command.layout.height,
    ]);
    return parseMutationResult(result.rows);
  }
}

@Injectable()
export class DiningTableService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(DINING_TABLE_PORT) private readonly tables: DiningTablePort,
  ) {}

  public async list(principal: AuthenticatedPrincipal, input: unknown): Promise<DiningLayoutV1> {
    const scope = parseUuidScope(input);
    if (scope === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, scope, "tables.read");
    try {
      const result = await this.tables.list(actorId, scope);
      if (result === "forbidden") throw applicationError("authorization");
      return result;
    } catch (error: unknown) {
      if (error instanceof DiningTableApplicationError) throw error;
      throw unavailable();
    }
  }

  public async create(principal: AuthenticatedPrincipal, input: unknown): Promise<DiningTableV1> {
    const command = parseCreateDiningTableCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "tables.manage");
    return this.mutate(() => this.tables.create(actorId, command));
  }

  public async updateLayout(principal: AuthenticatedPrincipal, input: unknown): Promise<DiningTableV1> {
    const command = parseUpdateDiningTableLayoutCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "tables.manage");
    return this.mutate(() => this.tables.updateLayout(actorId, command));
  }

  private async authorize(principal: AuthenticatedPrincipal, scope: BranchScope, permission: "tables.read" | "tables.manage"): Promise<string> {
    try {
      return (await this.authorization.authorizeBranch(principal, scope, permission)).principal.actorId;
    } catch {
      throw applicationError("authorization");
    }
  }

  private async mutate(operation: () => Promise<MutationResult>): Promise<DiningTableV1> {
    let result: MutationResult;
    try { result = await operation(); } catch { throw unavailable(); }
    if (result.status === "forbidden") throw applicationError("authorization");
    if (result.status === "conflict") throw applicationError("conflict");
    return result.table;
  }
}

function parseUuidScope(value: unknown): BranchScope | undefined {
  const scope = parseBranchScope(value);
  return scope !== undefined && UUID_PATTERN.test(scope.restaurantId) && UUID_PATTERN.test(scope.branchId) ? scope : undefined;
}

function parseMutationResult(rows: readonly unknown[]): MutationResult {
  if (rows.length !== 1) throw unavailable();
  const record = exactRecord(rows[0], [
    "status", "schema_version", "restaurant_id", "branch_id", "table_id", "zone_id", "table_name",
    "capacity", "shape", "layout_x", "layout_y", "layout_width", "layout_height", "table_version",
    "updated_at", "updated_by",
  ]);
  if (record === undefined) throw unavailable();
  const status = dataProperty(record, "status");
  if (status === "conflict" || status === "forbidden") {
    if (Reflect.ownKeys(record).filter((key) => key !== "status").some((key) => dataProperty(record, String(key)) !== null)) throw unavailable();
    return Object.freeze({ status });
  }
  if (status !== "created" && status !== "replayed" && status !== "updated") throw unavailable();
  const table = parseDiningTableV1({
    capacity: integerValue(dataProperty(record, "capacity")),
    layout: {
      height: integerValue(dataProperty(record, "layout_height")), width: integerValue(dataProperty(record, "layout_width")),
      x: integerValue(dataProperty(record, "layout_x")), y: integerValue(dataProperty(record, "layout_y")),
    },
    name: dataProperty(record, "table_name"), replayed: status === "replayed",
    schemaVersion: dataProperty(record, "schema_version"),
    scope: { branchId: dataProperty(record, "branch_id"), restaurantId: dataProperty(record, "restaurant_id") },
    shape: dataProperty(record, "shape"), tableId: dataProperty(record, "table_id"),
    updatedAt: timestampText(dataProperty(record, "updated_at")), updatedBy: dataProperty(record, "updated_by"),
    version: integerValue(dataProperty(record, "table_version")), zoneId: dataProperty(record, "zone_id"),
  });
  if (table === undefined || table.schemaVersion !== DINING_LAYOUT_SCHEMA_VERSION) throw unavailable();
  return Object.freeze({ status, table });
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

function dataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function integerValue(value: unknown): unknown {
  return typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value) ? Number(value) : value;
}

function timestampText(value: unknown): unknown { return value instanceof Date ? value.toISOString() : value; }
function unavailable(): DiningTableApplicationError { return applicationError("unavailable"); }
function applicationError(code: DiningTableApplicationErrorCode): DiningTableApplicationError { return new DiningTableApplicationError(code); }
