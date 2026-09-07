import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { parseBranchScope, type BranchOperationalContextV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import {
  BRANCH_OPERATIONAL_CONTEXT_PORT,
  type BranchOperationalContextPort,
} from "./branch-operational-context.js";

@Controller("access/branch/context")
export class BranchOperationalContextController {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(BRANCH_OPERATIONAL_CONTEXT_PORT) private readonly contexts: BranchOperationalContextPort,
  ) {}

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async selectContext(@Req() request: unknown, @Body() body: unknown): Promise<BranchOperationalContextV1> {
    const principal = getAuthenticatedPrincipal(request);
    const scope = parseUuidBranchScope(body);
    if (scope === undefined) throw scopeRejected();

    try {
      await this.authorization.authorizeBranch(principal, scope, "branch.select");
    } catch {
      throw scopeRejected();
    }

    try {
      const context = await this.contexts.select(principal.actorId, scope);
      if (context === "forbidden") throw scopeRejected();
      return context;
    } catch (error: unknown) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException({ code: "BRANCH_OPERATIONAL_CONTEXT_UNAVAILABLE" });
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
