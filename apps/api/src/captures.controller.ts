import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Header, HttpCode, Inject, NotFoundException, Post, Req, ServiceUnavailableException,
} from "@nestjs/common";
import type { CaptureAssignmentDirectoryV1, CaptureDeliveryInstructionSuggestionsV1, CaptureMutationResultV1, CaptureRecoveryPreferenceResultV1, CaptureWorkspaceV1, CaptureWorkspaceV2, CaptureWorkspaceV3, CaptureWorkspaceV4, CaptureWorkspaceV5, CaptureWorkTrayResultV1, SetCaptureDeliveryInstructionsResultV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { CaptureApplicationError, CaptureAssignmentDirectoryService, CaptureAttentionService, CaptureConfirmationService, CaptureCustomerService, CaptureDeliveryInstructionsService, CaptureDeliveryQuoteService, CapturePaymentIntentInsufficientError, CapturePaymentIntentNoLinesError, CapturePaymentIntentService, CapturePaymentIntentStaleError, CaptureFulfillmentService, CaptureNoSaleService, CaptureSelectionPlanService, CaptureService, CaptureTrayService } from "./captures.js";

@Controller("captures")
export class CapturesController {
  public constructor(
    @Inject(CaptureService) private readonly captures: CaptureService,
    @Inject(CaptureAttentionService) private readonly attention: CaptureAttentionService,
    @Inject(CaptureCustomerService) private readonly customer: CaptureCustomerService,
    @Inject(CaptureFulfillmentService) private readonly fulfillment: CaptureFulfillmentService,
    @Inject(CaptureDeliveryInstructionsService) private readonly deliveryInstructions: CaptureDeliveryInstructionsService,
    @Inject(CaptureConfirmationService) private readonly confirmation: CaptureConfirmationService,
    @Inject(CaptureNoSaleService) private readonly noSale: CaptureNoSaleService,
    @Inject(CaptureSelectionPlanService) private readonly selectionPlan: CaptureSelectionPlanService,
    @Inject(CaptureDeliveryQuoteService) private readonly deliveryQuote: CaptureDeliveryQuoteService,
    @Inject(CapturePaymentIntentService) private readonly paymentIntent: CapturePaymentIntentService,
    @Inject(CaptureTrayService) private readonly tray: CaptureTrayService,
    @Inject(CaptureAssignmentDirectoryService) private readonly assignmentDirectory: CaptureAssignmentDirectoryService,
  ) {}

  @Post("assignment-candidates")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async listAssignmentCandidates(
    @Req() request: unknown,
    @Body() body: unknown,
  ): Promise<CaptureAssignmentDirectoryV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.assignmentDirectory.list(principal, body));
  }

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
  public async readWorkspace(@Req() request: unknown, @Body() body: unknown): Promise<CaptureWorkspaceV1 | CaptureWorkspaceV2 | CaptureWorkspaceV3 | CaptureWorkspaceV4 | CaptureWorkspaceV5> {
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
  @Post("delivery-instructions")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async setDeliveryInstructions(
    @Req() request: unknown,
    @Body() body: unknown,
  ): Promise<SetCaptureDeliveryInstructionsResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.deliveryInstructions.setDeliveryInstructions(principal, body));
  }
  @Post("delivery-instruction-suggestions")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async listDeliveryInstructionSuggestions(
    @Req() request: unknown,
    @Body() body: unknown,
  ): Promise<CaptureDeliveryInstructionSuggestionsV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.deliveryInstructions.listSuggestions(principal, body));
  }
  @Post("confirm")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async confirm(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.confirmation.confirm(principal, body));
  }
  @Post("no-sale")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async closeNoSale(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.noSale.closeNoSale(principal, body));
  }
  @Post("selection-plan")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async replaceSelectionPlan(@Req() request: unknown, @Body() body: unknown): Promise<CaptureWorkspaceV4> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.selectionPlan.replace(principal, body));
  }
  @Post("delivery-quote")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async requestDeliveryQuote(@Req() request: unknown, @Body() body: unknown): Promise<CaptureWorkspaceV5> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.deliveryQuote.requestQuote(principal, body));
  }
  @Post("payment-intent")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async setPaymentIntent(@Req() request: unknown, @Body() body: unknown): Promise<CaptureWorkspaceV5> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.paymentIntent.setPaymentIntent(principal, body));
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
  @Post("transfer")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async transfer(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.attention.mutateAttention(principal, "capture.transferred", body));
  }
  @Post("takeover")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async takeover(@Req() request: unknown, @Body() body: unknown): Promise<CaptureMutationResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.attention.mutateAttention(principal, "capture.taken_over", body));
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
      if (error instanceof CapturePaymentIntentInsufficientError) {
        throw new ConflictException({ code: "CAPTURE_PAYMENT_INTENT_INSUFFICIENT" });
      }
      if (error instanceof CapturePaymentIntentStaleError) {
        throw new ConflictException({ code: "CAPTURE_PAYMENT_INTENT_STALE" });
      }
      if (error instanceof CapturePaymentIntentNoLinesError) {
        throw new ConflictException({ code: "CAPTURE_PAYMENT_INTENT_NO_LINES" });
      }
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
