import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { MenuCatalogStateV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { MenuCatalogApplicationError, MenuCatalogService } from "./menu-catalog.js";

@Controller("catalog/menu")
export class MenuCatalogController {
  public constructor(@Inject(MenuCatalogService) private readonly catalogs: MenuCatalogService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  public read(
    @Req() request: unknown,
    @Query("restaurantId") restaurantId: unknown,
    @Query("branchId") branchId: unknown,
  ): Promise<MenuCatalogStateV1> {
    return this.map(() => this.catalogs.read(getAuthenticatedPrincipal(request), { branchId, restaurantId }));
  }

  @Put()
  @Header("Cache-Control", "private, no-store")
  public save(@Req() request: unknown, @Body() body: unknown): Promise<MenuCatalogStateV1> {
    return this.map(() => this.catalogs.save(getAuthenticatedPrincipal(request), body));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!(error instanceof MenuCatalogApplicationError)) throw unavailable();
      if (error.code === "request") throw new BadRequestException({ code: "MENU_CATALOG_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      if (error.code === "conflict") throw new ConflictException({ code: "MENU_CATALOG_CONFLICT" });
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "MENU_CATALOG_UNAVAILABLE" });
}
