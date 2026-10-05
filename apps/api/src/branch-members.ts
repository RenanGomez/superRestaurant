import {
  parseBranchMembersRequestV1,
  parseBranchMembersV1,
  type BranchMembersRequestV1,
  type BranchMembersV1,
} from "@super-restaurant/shared-types";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Inject,
  Injectable,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";

import { getAuthenticatedPrincipal, type AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

const listSql = "select app_private.list_branch_members($1::uuid, $2::uuid, $3::uuid, $4::text[]) as result";

export type BranchMembersErrorCode = "authorization" | "request" | "unavailable";

export class BranchMembersError extends Error {
  public constructor(public readonly code: BranchMembersErrorCode) {
    super(`BRANCH_MEMBERS_${code.toUpperCase()}`);
    this.name = "BranchMembersError";
  }
}

export interface BranchMembersPort {
  list(actorId: string, request: BranchMembersRequestV1): Promise<unknown>;
}

export const BRANCH_MEMBERS_PORT = Symbol("BRANCH_MEMBERS_PORT");

@Injectable()
export class PostgresBranchMembersAdapter implements BranchMembersPort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async list(actorId: string, request: BranchMembersRequestV1): Promise<unknown> {
    const result = await this.database.query(listSql, [
      actorId, request.scope.restaurantId, request.scope.branchId, request.roles === null ? null : [...request.roles],
    ]);
    // The SQL is `select fn(...) as result`: the row is `{ result: <jsonb> }`.
    const row = result.rows.length === 1 ? record(result.rows[0], ["result"]) : undefined;
    if (row === undefined) throw new BranchMembersError("unavailable");
    return Object.getOwnPropertyDescriptor(row, "result")?.value;
  }
}

@Injectable()
export class BranchMembersService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(BRANCH_MEMBERS_PORT) private readonly members: BranchMembersPort,
  ) {}

  public async list(principal: AuthenticatedPrincipal, input: unknown): Promise<BranchMembersV1> {
    const request = parseBranchMembersRequestV1(input);
    if (request === undefined) throw new BranchMembersError("request");
    let actorId: string;
    try {
      actorId = (await this.authorization.authorizeBranch(principal, request.scope, "memberships.read")).principal.actorId;
    } catch { throw new BranchMembersError("authorization"); }
    let raw: unknown;
    try { raw = await this.members.list(actorId, request); } catch { throw new BranchMembersError("unavailable"); }
    const minimal = record(raw, ["status"]);
    if (minimal !== undefined) {
      throw new BranchMembersError(Object.getOwnPropertyDescriptor(minimal, "status")?.value === "forbidden" ? "authorization" : "unavailable");
    }
    const parsed = parseBranchMembersV1(raw);
    if (parsed === undefined || parsed.scope.restaurantId !== request.scope.restaurantId
      || parsed.scope.branchId !== request.scope.branchId) throw new BranchMembersError("unavailable");
    return parsed;
  }
}

@Controller("access")
export class BranchMembersController {
  public constructor(@Inject(BranchMembersService) private readonly members: BranchMembersService) {}

  @Post("branch-members")
  @Header("Cache-Control", "private, no-store")
  public async list(@Req() request: unknown, @Body() body: unknown): Promise<BranchMembersV1> {
    try {
      return await this.members.list(getAuthenticatedPrincipal(request), body);
    } catch (error: unknown) {
      if (!(error instanceof BranchMembersError)) throw new ServiceUnavailableException({ code: "BRANCH_MEMBERS_UNAVAILABLE" });
      if (error.code === "request") throw new BadRequestException({ code: "BRANCH_MEMBERS_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      throw new ServiceUnavailableException({ code: "BRANCH_MEMBERS_UNAVAILABLE" });
    }
  }
}

function record(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
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
