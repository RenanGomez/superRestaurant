import { Inject, Injectable } from "@nestjs/common";
import {
  BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
  parseBranchMembershipListV1,
  type BranchMembershipListV1,
} from "@super-restaurant/shared-types";

import { DATABASE_CLIENT, type DatabaseClientPort } from "../database.js";
import type { AuthenticatedPrincipal } from "./authentication.js";

const activeMembershipsSql = `
select
  restaurant_id::text as restaurant_id,
  restaurant_name,
  branch_id::text as branch_id,
  branch_name,
  roles
from app_private.list_active_branch_memberships($1::uuid)
order by restaurant_id, branch_id
`;

export const MEMBERSHIP_DIRECTORY = Symbol("MEMBERSHIP_DIRECTORY");

export interface MembershipDirectoryPort {
  listActiveMemberships(principal: AuthenticatedPrincipal): Promise<BranchMembershipListV1>;
}

export class MembershipDirectoryUnavailableError extends Error {
  public constructor() {
    super("MEMBERSHIP_DIRECTORY_UNAVAILABLE");
    this.name = "MembershipDirectoryUnavailableError";
  }
}

@Injectable()
export class PostgresMembershipDirectory implements MembershipDirectoryPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async listActiveMemberships(principal: AuthenticatedPrincipal): Promise<BranchMembershipListV1> {
    const actorId = readActorId(principal);
    if (actorId === undefined) throw unavailable();

    try {
      const result = await this.database.query(activeMembershipsSql, [actorId]);
      if (!Array.isArray(result.rows) || result.rows.length > 500) throw unavailable();

      const memberships = result.rows.map(readMembershipRow);
      if (memberships.includes(undefined)) throw unavailable();

      const parsed = parseBranchMembershipListV1({
        memberships,
        schemaVersion: BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
      });
      if (parsed === undefined) throw unavailable();
      return parsed;
    } catch {
      throw unavailable();
    }
  }
}

function readActorId(value: unknown): string | undefined {
  const record = exactRecord(value, ["actorId"]);
  const actorId = record === undefined ? undefined : dataProperty(record, "actorId");
  return typeof actorId === "string" && uuidPattern.test(actorId) ? actorId.toLowerCase() : undefined;
}

function readMembershipRow(value: unknown): Readonly<{
  branchName: unknown;
  restaurantName: unknown;
  roles: unknown;
  scope: Readonly<{ branchId: unknown; restaurantId: unknown }>;
}> | undefined {
  const record = exactRecord(value, ["restaurant_id", "restaurant_name", "branch_id", "branch_name", "roles"]);
  if (record === undefined) return undefined;
  return Object.freeze({
    branchName: dataProperty(record, "branch_name"),
    restaurantName: dataProperty(record, "restaurant_name"),
    roles: dataProperty(record, "roles"),
    scope: Object.freeze({
      branchId: dataProperty(record, "branch_id"),
      restaurantId: dataProperty(record, "restaurant_id"),
    }),
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function dataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function unavailable(): MembershipDirectoryUnavailableError {
  return new MembershipDirectoryUnavailableError();
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
