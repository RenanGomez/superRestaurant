import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Header, HttpCode, Inject, NotFoundException, Post, Req, ServiceUnavailableException,
} from "@nestjs/common";
import type { CaptureMutationResultV1, CaptureRecoveryPreferenceResultV1, CaptureWorkspaceV1, CaptureWorkTrayResultV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { CaptureApplicationError, CaptureAttentionService, CaptureCustomerService, CaptureFulfillmentService, CaptureService, CaptureTrayService } from "./captures.js";

@Controller("captures")
export class CapturesController {
  public constructor(
    @Inject(CaptureService) private readonly captures: CaptureService,
    @Inject(CaptureAttentionService) private readonly attention: CaptureAttentionService,
    @Inject(CaptureCustomerService) private readonly customer: CaptureCustomerService,
    @Inject(CaptureFulfillmentService) private readonly fulfillment: CaptureFulfillmentService,
    @Inject(CaptureTrayService) private readonly tray: CaptureTrayService,
  ) {}

  @Post("tray")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async listTray(@Req() request: unknown, @Body() body: unknown): Promise<CaptureWorkTrayResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.tray.list(principal, body));
  }

  @Post()
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async createDraft(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.captures.createDraft(principal, body));
  }

  @Post("autosave")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async autosaveDraft(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.captures.autosaveDraft(principal, body));
  }

  @Post("workspace")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async readWorkspace(@Req() request: unknown, @Body() body: unknown): Promise<CaptureWorkspaceV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.captures.readWorkspace(principal, body));
  }

  @Post("hold")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async hold(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.attention.mutateAttention(principal, "capture.held", body));
  }
  @Post("customer")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async setCustomer(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.customer.setCustomer(principal, body));
  }
  @Post("fulfillment")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async setFulfillment(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.fulfillment.setFulfillment(principal, body));
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
  private async execute<Result>(action: () => Promise<Result>): Promise<Result> {
    try { return await action(); } catch (error: unknown) {
      if (error instanceof CaptureApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "CAPTURE_REQUEST_REJECTED" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "CAPTURE_CONFLICT" });
        if (error.code === "missing") throw new NotFoundException({ code: "CAPTURE_NOT_FOUND" });
      }
      throw new ServiceUnavailableException({ code: "CAPTURE_UNAVAILABLE" });
    }
  }
}
