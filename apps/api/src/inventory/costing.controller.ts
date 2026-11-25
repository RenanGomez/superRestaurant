import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";

import { getAuthenticatedPrincipal, RateLimited } from "../auth/authentication.js";
import {
  CostingApplicationError,
  CostingService,
  type InventoryAverageCostV1,
  type InventoryProductCostListV1,
  type InventoryProductMarginV1,
  type InventoryStockAlertListV1,
} from "./costing.service.js";

@Controller("inventory")
export class CostingController {
  public constructor(
    @Inject(CostingService) private readonly costing: CostingService,
  ) {}

  @Get("alerts")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async listAlerts(@Req() request: unknown, @Query() query: unknown): Promise<InventoryStockAlertListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.costing.listAlerts(principal, query));
  }

  @Get("costs")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async readCost(@Req() request: unknown, @Query() query: unknown): Promise<InventoryAverageCostV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.costing.readCost(principal, query));
  }

  @Get("product-costs")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async listProductCosts(
    @Req() request: unknown,
    @Query() query: unknown,
  ): Promise<InventoryProductCostListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.costing.listProductCosts(principal, query));
  }

  @Get("margins")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async readMargin(
    @Req() request: unknown,
    @Query() query: unknown,
  ): Promise<InventoryProductMarginV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.costing.readMargin(principal, query));
  }

  private async execute<Result>(action: () => Promise<Result>): Promise<Result> {
    try {
      return await action();
    } catch (error: unknown) {
      if (error instanceof CostingApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "INVENTORY_REQUEST_INVALID" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "INVENTORY_CONFLICT" });
        if (error.code === "missing") throw new NotFoundException({ code: "INVENTORY_NOT_FOUND" });
      }
      throw new ServiceUnavailableException({ code: "INVENTORY_UNAVAILABLE" });
    }
  }
}
