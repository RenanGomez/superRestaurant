import { Body, Controller, ForbiddenException, Header, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { parseBranchScope } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, membershipRoles } from "./auth/membership-authorization.js";

@Controller("access/branch")
export class BranchAccessController {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
  ) {}

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async selectBranch(@Req() request: unknown, @Body() body: unknown): Promise<Readonly<{
    branchId: string;
    restaurantId: string;
    roles: readonly string[];
  }>> {
    const principal = getAuthenticatedPrincipal(request);
    const scope = parseUuidBranchScope(body);
    if (scope === undefined) throw scopeRejected();

    try {
      const authorized = await this.authorization.authorizeBranch(principal, scope, membershipRoles);
      return Object.freeze({
        branchId: authorized.scope.branchId,
        restaurantId: authorized.scope.restaurantId,
        roles: authorized.roles,
      });
    } catch {
      throw scopeRejected();
    }
  }
}

function parseUuidBranchScope(value: unknown): ReturnType<typeof parseBranchScope> {
  const scope = parseBranchScope(value);
  return scope !== undefined && uuidPattern.test(scope.restaurantId) && uuidPattern.test(scope.branchId) ? scope : undefined;
}

function scopeRejected(): ForbiddenException {
  return new ForbiddenException({ code: "SCOPE_AUTHORIZATION_REJECTED" });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
