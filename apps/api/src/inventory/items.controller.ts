import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { InventoryItemV1, InventoryWarehouseV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal, RateLimited } from "../auth/authentication.js";
import {
  InventoryApplicationError,
  ItemsService,
  type InventoryItemListV1,
  type InventoryWarehouseListV1,
} from "./items.service.js";

@Controller("inventory")
export class ItemsController {
  public constructor(
    @Inject(ItemsService) private readonly items: ItemsService,
  ) {}

  @Get("items")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async listItems(@Req() request: unknown, @Query() query: unknown): Promise<InventoryItemListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.items.listItems(principal, query));
  }

  @Post("items")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async createItem(@Req() request: unknown, @Body() body: unknown): Promise<InventoryItemV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.items.createItem(principal, body));
  }

  @Patch("items/:id")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async updateItem(
    @Req() request: unknown,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<InventoryItemV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.items.updateItem(principal, id, body));
  }

  @Get("warehouses")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async listWarehouses(
    @Req() request: unknown,
    @Query() query: unknown,
  ): Promise<InventoryWarehouseListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.items.listWarehouses(principal, query));
  }

  @Post("warehouses")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async createWarehouse(@Req() request: unknown, @Body() body: unknown): Promise<InventoryWarehouseV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.items.createWarehouse(principal, body));
  }

  @Patch("warehouses/:id")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async updateWarehouse(
    @Req() request: unknown,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<InventoryWarehouseV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.items.updateWarehouse(principal, id, body));
  }

  private async execute<Result>(action: () => Promise<Result>): Promise<Result> {
    try {
      return await action();
    } catch (error: unknown) {
      if (error instanceof InventoryApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "INVENTORY_REQUEST_INVALID" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "INVENTORY_CONFLICT" });
        if (error.code === "missing") throw new NotFoundException({ code: "INVENTORY_NOT_FOUND" });
      }
      throw new ServiceUnavailableException({ code: "INVENTORY_UNAVAILABLE" });
    }
  }
}
