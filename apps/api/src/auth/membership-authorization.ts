import {
  MEMBERSHIP_ROLE_CODES,
  parseBranchScope,
  type BranchScope,
  type MembershipRoleCode,
  type RbacPermissionCode,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./authentication.js";
import { rolesGrantPermission } from "./rbac-policy.js";

export const membershipRoles = MEMBERSHIP_ROLE_CODES;

export type MembershipRole = MembershipRoleCode;

export interface ActiveMembership {
  readonly roles: readonly MembershipRole[];
  readonly scope: BranchScope;
}

export interface MembershipLookupPort {
  findActiveMembership(principal: AuthenticatedPrincipal, scope: BranchScope): Promise<ActiveMembership | undefined>;
}

export const MEMBERSHIP_LOOKUP = Symbol("MEMBERSHIP_LOOKUP");

export interface AuthorizedBranchContext {
  readonly principal: AuthenticatedPrincipal;
  readonly roles: readonly MembershipRole[];
  readonly scope: BranchScope;
}

export class ScopeAuthorizationRejectedError extends Error {
  public constructor() {
    super("SCOPE_AUTHORIZATION_REJECTED");
    this.name = "ScopeAuthorizationRejectedError";
  }
}

@Injectable()
export class MembershipAuthorizationService {
  public constructor(@Inject(MEMBERSHIP_LOOKUP) private readonly memberships: MembershipLookupPort) {}

  public async authorizeBranch(
    principal: AuthenticatedPrincipal,
    requestedScope: unknown,
    requiredPermission: RbacPermissionCode,
  ): Promise<AuthorizedBranchContext> {
    const scope = parseBranchScope(requestedScope);
    if (scope === undefined || !isPrincipal(principal)) {
      throw new ScopeAuthorizationRejectedError();
    }

    let membership: ActiveMembership | undefined;
    try {
      membership = await this.memberships.findActiveMembership(principal, scope);
    } catch {
      throw new ScopeAuthorizationRejectedError();
    }

    const parsedMembership = parseMembership(membership);
    if (parsedMembership === undefined || !sameScope(parsedMembership.scope, scope)) {
      throw new ScopeAuthorizationRejectedError();
    }

    if (!rolesGrantPermission(parsedMembership.roles, requiredPermission)) {
      throw new ScopeAuthorizationRejectedError();
    }

    return Object.freeze({
      principal: Object.freeze({ actorId: principal.actorId }),
      roles: parsedMembership.roles,
      scope,
    });
  }
}

function isPrincipal(value: unknown): value is AuthenticatedPrincipal {
  if (typeof value !== "object" || value === null) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "actorId");
    return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string" && uuidPattern.test(descriptor.value);
  } catch {
    return false;
  }
}

function parseRoles(value: unknown): readonly MembershipRole[] | undefined {
  try {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const roles = value.map((role) => typeof role === "string" && isMembershipRole(role) ? role : undefined);
    if (roles.includes(undefined)) return undefined;
    const unique = [...new Set(roles as MembershipRole[])];
    if (unique.length !== value.length) return undefined;
    return Object.freeze(unique);
  } catch {
    return undefined;
  }
}

function parseMembership(value: unknown): ActiveMembership | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== 2 || !ownKeys.includes("roles") || !ownKeys.includes("scope")) return undefined;
    const rolesDescriptor = Object.getOwnPropertyDescriptor(value, "roles");
    const scopeDescriptor = Object.getOwnPropertyDescriptor(value, "scope");
    if (rolesDescriptor === undefined || !("value" in rolesDescriptor) || scopeDescriptor === undefined || !("value" in scopeDescriptor)) {
      return undefined;
    }
    const roles = parseRoles(rolesDescriptor.value);
    const scope = parseBranchScope(scopeDescriptor.value);
    return roles === undefined || scope === undefined ? undefined : Object.freeze({ roles, scope });
  } catch {
    return undefined;
  }
}

function isMembershipRole(value: string): value is MembershipRole {
  return (membershipRoles as readonly string[]).includes(value);
}

function sameScope(left: BranchScope, right: BranchScope): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
