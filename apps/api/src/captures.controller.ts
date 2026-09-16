import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Header, HttpCode, Inject, Post, Req, ServiceUnavailableException,
} from "@nestjs/common";
import type { CaptureMutationResultV1, CaptureRecoveryPreferenceResultV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { CaptureApplicationError, CaptureAttentionService, CaptureService } from "./captures.js";

@Controller("captures")
export class CapturesController {
  public constructor(
    @Inject(CaptureService) private readonly captures: CaptureService,
    @Inject(CaptureAttentionService) private readonly attention: CaptureAttentionService,
  ) {}

  @Post()
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async createDraft(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.captures.createDraft(principal, body));
  }

  @Post("hold")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async hold(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.attention.mutateAttention(principal, "capture.held", body));
  }
  @Post("claim")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async claim(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.attention.mutateAttention(principal, "capture.claimed", body));
  }
  @Post("resume")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async resume(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.attention.mutateAttention(principal, "capture.resumed", body));
  }
  @Post("recovery-preference")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async setRecoveryPreference(@Req() request: unknown, @Body() body: unknown): Promise<CaptureRecoveryPreferenceResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.attention.setRecoveryPreference(principal, body));
  }
  private async execute<Result extends CaptureMutationResultV1>(action: () => Promise<Result>): Promise<Result> {
    try { return await action(); } catch (error: unknown) {
      if (error instanceof CaptureApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "CAPTURE_REQUEST_REJECTED" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "CAPTURE_CONFLICT" });
      }
      throw new ServiceUnavailableException({ code: "CAPTURE_UNAVAILABLE" });
    }
  }
}
