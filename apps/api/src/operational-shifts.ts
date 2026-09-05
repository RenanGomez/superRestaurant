import { Inject, Injectable } from "@nestjs/common";
import {
  parseBranchScope,
  parseOperationalShiftListV1,
  type BranchScope,
  type OperationalShiftListV1,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const listSql = "select app_private.list_active_operational_shifts($1::uuid, $2::uuid, $3::uuid) as state";

export type OperationalShiftApplicationErrorCode = "authorization" | "request" | "unavailable";

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

@Injectable()
export class PostgresOperationalShiftDirectory implements OperationalShiftDirectoryPort {
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
}

@Injectable()
export class OperationalShiftService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(OPERATIONAL_SHIFT_DIRECTORY) private readonly shifts: OperationalShiftDirectoryPort,
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
