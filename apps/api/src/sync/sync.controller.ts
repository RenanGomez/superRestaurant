import { BadRequestException, Body, Controller, Header, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { parseSyncPushRequestV1, type SyncPushResponseV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal, parseBearerAuthorization, RateLimited } from "../auth/authentication.js";
import { SyncPushService } from "./sync-push.service.js";

@Controller()
export class SyncController {
  public constructor(@Inject(SyncPushService) private readonly sync: SyncPushService) {}

  @RateLimited({ limit: 60, windowMs: 60_000 }) @Post("sync/push")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public push(@Req() request: { headers?: { authorization?: unknown } }, @Body() body: unknown): Promise<SyncPushResponseV1> {
    getAuthenticatedPrincipal(request);
    const token = parseBearerAuthorization(request.headers?.authorization);
    if (token === undefined || parseSyncPushRequestV1(body) === undefined) throw new BadRequestException({ code: "SYNC_REQUEST_INVALID" });
    return this.sync.push(token, body);
  }
}
