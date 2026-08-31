import { Controller, Get, Header, Inject, Req, ServiceUnavailableException } from "@nestjs/common";
import type { BranchMembershipListV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import {
  MEMBERSHIP_DIRECTORY,
  type MembershipDirectoryPort,
} from "./auth/membership-directory.js";

@Controller("access/memberships")
export class AccessMembershipsController {
  public constructor(
    @Inject(MEMBERSHIP_DIRECTORY) private readonly memberships: MembershipDirectoryPort,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  public async listMemberships(@Req() request: unknown): Promise<BranchMembershipListV1> {
    const principal = getAuthenticatedPrincipal(request);
    try {
      return await this.memberships.listActiveMemberships(principal);
    } catch {
      throw new ServiceUnavailableException({ code: "MEMBERSHIP_DIRECTORY_UNAVAILABLE" });
    }
  }
}
