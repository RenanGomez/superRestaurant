import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
  Body,
} from "@nestjs/common";
import type { DiningZoneV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { DiningZoneApplicationError, DiningZoneService } from "./dining-zones.js";

@Controller("dining/zones")
export class DiningZonesController {
  public constructor(@Inject(DiningZoneService) private readonly zones: DiningZoneService) {}

  @Post()
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async createZone(@Req() request: unknown, @Body() body: unknown): Promise<DiningZoneV1> {
    const principal = getAuthenticatedPrincipal(request);
    try {
      return await this.zones.createZone(principal, body);
    } catch (error: unknown) {
      if (!(error instanceof DiningZoneApplicationError)) throw unavailable();
      switch (error.code) {
        case "request":
          throw new BadRequestException({ code: "DINING_ZONE_REQUEST_REJECTED" });
        case "authorization":
          throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        case "conflict":
          throw new ConflictException({ code: "DINING_ZONE_CONFLICT" });
        case "unavailable":
          throw unavailable();
      }
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "DINING_ZONE_UNAVAILABLE" });
}
