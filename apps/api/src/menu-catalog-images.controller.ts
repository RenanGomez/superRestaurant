import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { MenuImageUploadResultV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { MenuCatalogImageApplicationError, MenuCatalogImageService } from "./menu-catalog-images.js";

@Controller("menu/images")
export class MenuCatalogImagesController {
  public constructor(@Inject(MenuCatalogImageService) private readonly images: MenuCatalogImageService) {}

  @Post()
  @Header("Cache-Control", "private, no-store")
  public async upload(@Req() request: unknown, @Body() body: unknown): Promise<MenuImageUploadResultV1> {
    try {
      return await this.images.upload(getAuthenticatedPrincipal(request), body);
    } catch (error: unknown) {
      if (!(error instanceof MenuCatalogImageApplicationError)) throw unavailable();
      if (error.code === "request") throw new BadRequestException({ code: "MENU_CATALOG_IMAGE_REQUEST_REJECTED" });
      if (error.code === "unconfigured") {
        throw new ServiceUnavailableException({ code: "MENU_IMAGES_UNCONFIGURED" });
      }
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "MENU_CATALOG_IMAGE_UNAVAILABLE" });
}
