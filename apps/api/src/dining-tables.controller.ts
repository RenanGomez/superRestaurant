import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, HttpCode, Inject, Patch, Post, Query, Req, ServiceUnavailableException } from "@nestjs/common";
import type { DiningLayoutV1, DiningTableV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { DiningTableApplicationError, DiningTableService } from "./dining-tables.js";

@Controller("dining")
export class DiningTablesController {
  public constructor(@Inject(DiningTableService) private readonly tables: DiningTableService) {}

  @Get("layout")
  @Header("Cache-Control", "private, no-store")
  public list(@Req() request: unknown, @Query("restaurantId") restaurantId: unknown, @Query("branchId") branchId: unknown): Promise<DiningLayoutV1> {
    return this.map(() => this.tables.list(getAuthenticatedPrincipal(request), { restaurantId, branchId }));
  }

  @Post("tables")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public create(@Req() request: unknown, @Body() body: unknown): Promise<DiningTableV1> {
    return this.map(() => this.tables.create(getAuthenticatedPrincipal(request), body));
  }

  @Patch("tables/layout")
  @Header("Cache-Control", "private, no-store")
  public updateLayout(@Req() request: unknown, @Body() body: unknown): Promise<DiningTableV1> {
    return this.map(() => this.tables.updateLayout(getAuthenticatedPrincipal(request), body));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (!(error instanceof DiningTableApplicationError)) throw new ServiceUnavailableException({ code: "DINING_TABLE_UNAVAILABLE" });
      if (error.code === "request") throw new BadRequestException({ code: "DINING_TABLE_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      if (error.code === "conflict") throw new ConflictException({ code: "DINING_TABLE_CONFLICT" });
      throw new ServiceUnavailableException({ code: "DINING_TABLE_UNAVAILABLE" });
    }
  }
}
