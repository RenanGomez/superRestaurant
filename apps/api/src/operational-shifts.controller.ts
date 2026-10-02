import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, Inject, Post, Query, Req, ServiceUnavailableException } from "@nestjs/common";
import type { OpenOperationalShiftResultV1, OperationalShiftListV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { OperationalShiftApplicationError, OperationalShiftService } from "./operational-shifts.js";

@Controller("shifts")
export class OperationalShiftsController {
  public constructor(@Inject(OperationalShiftService) private readonly shifts: OperationalShiftService) {}

  @Get("active")
  @Header("Cache-Control", "private, no-store")
  public listActive(
    @Req() request: unknown,
    @Query("restaurantId") restaurantId: unknown,
    @Query("branchId") branchId: unknown,
  ): Promise<OperationalShiftListV1> {
    return this.map(() => this.shifts.listActive(getAuthenticatedPrincipal(request), { branchId, restaurantId }));
  }

  @Post("open")
  @Header("Cache-Control", "private, no-store")
  public open(@Req() request: unknown, @Body() body: unknown): Promise<OpenOperationalShiftResultV1> {
    return this.map(() => this.shifts.open(getAuthenticatedPrincipal(request), body));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (!(error instanceof OperationalShiftApplicationError)) throw unavailable();
      if (error.code === "request") throw new BadRequestException({ code: "OPERATIONAL_SHIFT_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      if (error.code === "conflict") throw new ConflictException({ code: "OPERATIONAL_SHIFT_CONFLICT" });
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "OPERATIONAL_SHIFT_UNAVAILABLE" });
}
