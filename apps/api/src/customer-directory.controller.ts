import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Header, HttpCode, Inject, NotFoundException, Post, Req, ServiceUnavailableException,
} from "@nestjs/common";
import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { CustomerDirectoryApplicationError, CustomerDirectoryQueryService, CustomerDirectoryService } from "./customer-directory.js";

/** Search uses a body so phone/address PII does not enter URLs or access-log query strings. */
@Controller("customers")
export class CustomerDirectoryController {
  public constructor(
    @Inject(CustomerDirectoryService) private readonly directory: CustomerDirectoryService,
    @Inject(CustomerDirectoryQueryService) private readonly queries: CustomerDirectoryQueryService,
  ) {}

  @Post("profile")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public saveProfile(@Req() request: unknown, @Body() body: unknown) {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.directory.saveProfile(principal, body));
  }

  @Post("address")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public saveAddress(@Req() request: unknown, @Body() body: unknown) {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.directory.saveAddress(principal, body));
  }

  @Post("address/validate")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public validateAddress(@Req() request: unknown, @Body() body: unknown) {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.directory.validateAddress(principal, body));
  }

  @Post("search")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public search(@Req() request: unknown, @Body() body: unknown) {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.queries.search(principal, body));
  }

  @Post("detail")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public read(@Req() request: unknown, @Body() body: unknown) {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.queries.read(principal, body));
  }

  private async execute<Result>(action: () => Promise<Result>): Promise<Result> {
    try { return await action(); } catch (error: unknown) {
      if (error instanceof CustomerDirectoryApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "CUSTOMER_REQUEST_REJECTED" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "CUSTOMER_CONFLICT" });
        if (error.code === "not_found") throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND" });
      }
      throw new ServiceUnavailableException({ code: "CUSTOMER_UNAVAILABLE" });
    }
  }
}
