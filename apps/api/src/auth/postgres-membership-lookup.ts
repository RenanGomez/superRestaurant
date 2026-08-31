import { Inject, Injectable } from "@nestjs/common";
import type { BranchScope } from "@super-restaurant/shared-types";

import { DATABASE_CLIENT, type DatabaseClientPort } from "../database.js";
import type { AuthenticatedPrincipal } from "./authentication.js";
import {
  membershipRoles,
  type ActiveMembership,
  type MembershipLookupPort,
  type MembershipRole,
} from "./membership-authorization.js";

const activeMembershipSql = `
select
  restaurant_id::text as restaurant_id,
  branch_id::text as branch_id,
  roles
from app_private.find_active_branch_membership($1::uuid, $2::uuid, $3::uuid)
`;

@Injectable()
export class PostgresMembershipLookup implements MembershipLookupPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async findActiveMembership(
    principal: AuthenticatedPrincipal,
    scope: BranchScope,
  ): Promise<ActiveMembership | undefined> {
    if (!uuidPattern.test(principal.actorId) || !uuidPattern.test(scope.restaurantId) || !uuidPattern.test(scope.branchId)) {
      return undefined;
    }

    const result = await this.database.query(activeMembershipSql, [principal.actorId, scope.restaurantId, scope.branchId]);
    if (result.rows.length !== 1) return undefined;
    return parseMembershipRow(result.rows[0], scope);
  }
}

function parseMembershipRow(value: unknown, requestedScope: BranchScope): ActiveMembership | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== 3 || !ownKeys.includes("restaurant_id") || !ownKeys.includes("branch_id") || !ownKeys.includes("roles")) return undefined;

    const restaurantId = dataProperty(value, "restaurant_id");
    const branchId = dataProperty(value, "branch_id");
    const rawRoles = dataProperty(value, "roles");
    if (restaurantId !== requestedScope.restaurantId || branchId !== requestedScope.branchId || !Array.isArray(rawRoles) || rawRoles.length === 0) return undefined;

    const roles: MembershipRole[] = [];
    for (const role of rawRoles) {
      if (typeof role !== "string" || !(membershipRoles as readonly string[]).includes(role) || roles.includes(role as MembershipRole)) return undefined;
      roles.push(role as MembershipRole);
    }
    return Object.freeze({ roles: Object.freeze(roles), scope: requestedScope });
  } catch {
    return undefined;
  }
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
