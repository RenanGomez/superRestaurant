import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query, Req } from "@nestjs/common";
import { getAuthenticatedPrincipal, RateLimited } from "../auth/authentication.js";
import { SyncPullService } from "./sync-pull.service.js";
import { SyncManualReviewService } from "./sync-manual-review.service.js";

@Controller("sync")
export class SyncReviewController {
  public constructor(@Inject(SyncPullService) private readonly pullService: SyncPullService, @Inject(SyncManualReviewService) private readonly review: SyncManualReviewService) {}
  @RateLimited({ limit: 60, windowMs: 60_000 }) @Post("pull") @HttpCode(200) @Header("Cache-Control", "private, no-store")
  public pull(@Req() request: unknown, @Body() body: unknown) { return this.pullService.pull(getAuthenticatedPrincipal(request).actorId, body); }
  @RateLimited({ limit: 60, windowMs: 60_000 }) @Post("devices") @HttpCode(200) @Header("Cache-Control", "private, no-store")
  public register(@Req() request: unknown, @Body() body: unknown) { return this.pullService.register(getAuthenticatedPrincipal(request).actorId, body); }
  @RateLimited({ limit: 60, windowMs: 60_000 }) @Get("manual-review") @Header("Cache-Control", "private, no-store")
  public list(@Req() request: unknown, @Query() query: { restaurantId?: unknown; branchId?: unknown }) { return this.review.list(getAuthenticatedPrincipal(request).actorId, { restaurantId: query.restaurantId, branchId: query.branchId }); }
  @RateLimited({ limit: 60, windowMs: 60_000 }) @Post("manual-review") @HttpCode(200) @Header("Cache-Control", "private, no-store")
  public resolve(@Req() request: unknown, @Body() body: unknown) { return this.review.resolve(getAuthenticatedPrincipal(request).actorId, body); }
}
