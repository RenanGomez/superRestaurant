import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, HttpCode, Inject, Param, Post, Req, ServiceUnavailableException } from "@nestjs/common";
import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { SystemOnboardingError, SystemOnboardingService } from "./system-onboarding.js";
@Controller("system/onboarding/restaurants")
export class SystemOnboardingController {
  public constructor(@Inject(SystemOnboardingService) private readonly onboarding: SystemOnboardingService) {}
  @Post() @HttpCode(202) @Header("Cache-Control", "private, no-store")
  public async create(@Req() request: unknown, @Body() body: unknown): Promise<unknown> { try { return await this.onboarding.provision(getAuthenticatedPrincipal(request), body); } catch (error: unknown) { throw map(error); } }
  @Get(":operationId") @Header("Cache-Control", "private, no-store")
  public async read(@Req() request: unknown, @Param("operationId") operationId: string): Promise<unknown> { try { return await this.onboarding.read(getAuthenticatedPrincipal(request), operationId); } catch (error: unknown) { throw map(error); } }
  @Get() @Header("Cache-Control", "private, no-store")
  public async list(@Req() request: unknown): Promise<unknown> { try { return await this.onboarding.list(getAuthenticatedPrincipal(request)); } catch (error: unknown) { throw map(error); } }
  @Post(":restaurantId/disable") @HttpCode(200) @Header("Cache-Control", "private, no-store")
  public async disable(@Req() request: unknown, @Param("restaurantId") restaurantId: string, @Body() body: unknown): Promise<unknown> { const reason = typeof body === "object" && body !== null && "reason" in body && typeof (body as { readonly reason?: unknown }).reason === "string" ? (body as { readonly reason: string }).reason : ""; try { return await this.onboarding.disable(getAuthenticatedPrincipal(request), restaurantId, reason); } catch (error: unknown) { throw map(error); } }
}
function map(error: unknown): Error { if (!(error instanceof SystemOnboardingError)) return new ServiceUnavailableException({ code: "SYSTEM_ONBOARDING_UNAVAILABLE" }); if (error.code === "request") return new BadRequestException({ code: "SYSTEM_ONBOARDING_REQUEST_REJECTED" }); if (error.code === "authorization") return new ForbiddenException({ code: "SYSTEM_ADMIN_REQUIRED" }); if (error.code === "duplicate") return new ConflictException({ code: "SYSTEM_ONBOARDING_DUPLICATE" }); if (error.code === "idempotency") return new ConflictException({ code: "SYSTEM_ONBOARDING_IDEMPOTENCY_CONFLICT" }); return new ServiceUnavailableException({ code: "SYSTEM_ONBOARDING_UNAVAILABLE" }); }
