import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Header, HttpCode, Inject, NotFoundException, Post, Req, ServiceUnavailableException,
} from "@nestjs/common";
import type { DeliveryQuoteV1, DeliveryZoneListV1, DeliveryZoneMatchResultV1, UpsertDeliveryZoneResultV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { DeliveryZoneApplicationError, DeliveryZoneService } from "./delivery-zones.js";

@Controller("delivery-zones")
export class DeliveryZonesController {
  public constructor(
    @Inject(DeliveryZoneService) private readonly zones: DeliveryZoneService,
  ) {}

  @Post("list")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async list(@Req() request: unknown, @Body() body: unknown): Promise<DeliveryZoneListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.zones.listZones(principal, body));
  }

  @Post("upsert")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async upsert(@Req() request: unknown, @Body() body: unknown): Promise<UpsertDeliveryZoneResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.zones.upsertZone(principal, body));
  }

  @Post("quote")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async quote(@Req() request: unknown, @Body() body: unknown): Promise<DeliveryQuoteV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.zones.quoteForCapture(principal, body));
  }

  @Post("match")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async match(@Req() request: unknown, @Body() body: unknown): Promise<DeliveryZoneMatchResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.zones.matchAddress(principal, body));
  }

  private async execute<Result>(action: () => Promise<Result>): Promise<Result> {
    try { return await action(); } catch (error: unknown) {
      if (error instanceof DeliveryZoneApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "DELIVERY_ZONE_REQUEST_REJECTED" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "DELIVERY_ZONE_CONFLICT" });
        if (error.code === "missing") throw new NotFoundException({ code: "DELIVERY_ZONE_NOT_FOUND" });
      }
      throw new ServiceUnavailableException({ code: "DELIVERY_ZONE_UNAVAILABLE" });
    }
  }
}
