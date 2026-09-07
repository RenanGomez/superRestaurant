import { Inject, Injectable } from "@nestjs/common";
import {
  parseBranchOperationalContextV1,
  type BranchOperationalContextV1,
  type BranchScope,
} from "@super-restaurant/shared-types";

import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const selectContextSql = "select app_private.read_branch_operational_context($1::uuid, $2::uuid, $3::uuid) as result";

export interface BranchOperationalContextPort {
  select(actorId: string, scope: BranchScope): Promise<BranchOperationalContextV1 | "forbidden">;
}

export const BRANCH_OPERATIONAL_CONTEXT_PORT = Symbol("BRANCH_OPERATIONAL_CONTEXT_PORT");

export class BranchOperationalContextUnavailableError extends Error {
  public constructor() {
    super("BRANCH_OPERATIONAL_CONTEXT_UNAVAILABLE");
    this.name = "BranchOperationalContextUnavailableError";
  }
}

@Injectable()
export class PostgresBranchOperationalContext implements BranchOperationalContextPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async select(actorId: string, scope: BranchScope): Promise<BranchOperationalContextV1 | "forbidden"> {
    if (!uuidPattern.test(actorId) || !uuidPattern.test(scope.restaurantId) || !uuidPattern.test(scope.branchId)) {
      return "forbidden";
    }

    const result = await this.database.query(selectContextSql, [actorId, scope.restaurantId, scope.branchId]);
    if (result.rows.length !== 1) throw new BranchOperationalContextUnavailableError();
    const row = exactRow(result.rows[0]);
    if (row === undefined) throw new BranchOperationalContextUnavailableError();
    const raw = row.result;
    if (raw === null) return "forbidden";
    const context = parseBranchOperationalContextV1(raw);
    if (
      context === undefined
      || context.scope.restaurantId !== scope.restaurantId
      || context.scope.branchId !== scope.branchId
    ) throw new BranchOperationalContextUnavailableError();
    return context;
  }
}

function exactRow(value: unknown): Readonly<{ result: unknown }> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    const descriptor = Object.getOwnPropertyDescriptor(value, "result");
    return (prototype === Object.prototype || prototype === null)
      && keys.length === 1
      && keys[0] === "result"
      && descriptor !== undefined
      && "value" in descriptor
      && descriptor.enumerable
      ? { result: descriptor.value }
      : undefined;
  } catch {
    return undefined;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
