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

import { getAuthenticatedPrincipal, RateLimited } from "../auth/authentication.js";
import {
  PurchasingApplicationError,
  PurchasingService,
  type CreatePurchaseOrderResultV1,
  type InventorySupplierListV1,
  type InventorySupplierV1,
  type PurchaseOrderListV1,
  type PurchaseOrderV1,
  type ReceivePurchaseOrderResultV1,
} from "./purchasing.service.js";

@Controller("inventory")
export class PurchasingController {
  public constructor(
    @Inject(PurchasingService) private readonly purchasing: PurchasingService,
  ) {}

  @Get("suppliers")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async listSuppliers(
    @Req() request: unknown,
    @Query() query: unknown,
  ): Promise<InventorySupplierListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.purchasing.listSuppliers(principal, query));
  }

  @Post("suppliers")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async createSupplier(@Req() request: unknown, @Body() body: unknown): Promise<InventorySupplierV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.purchasing.createSupplier(principal, body));
  }

  @Patch("suppliers/:id")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async updateSupplier(
    @Req() request: unknown,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<InventorySupplierV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.purchasing.updateSupplier(principal, id, body));
  }

  @Get("purchase-orders")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async listPurchaseOrders(
    @Req() request: unknown,
    @Query() query: unknown,
  ): Promise<PurchaseOrderListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.purchasing.listPurchaseOrders(principal, query));
  }

  @Post("purchase-orders")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async createPurchaseOrder(
    @Req() request: unknown,
    @Body() body: unknown,
  ): Promise<CreatePurchaseOrderResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.purchasing.createPurchaseOrder(principal, body));
  }

  @Get("purchase-orders/:id")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async readPurchaseOrder(@Req() request: unknown, @Param("id") id: string): Promise<PurchaseOrderV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.purchasing.readPurchaseOrder(principal, id));
  }

  @Post("purchase-orders/:id/receive")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async receivePurchaseOrder(
    @Req() request: unknown,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ReceivePurchaseOrderResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.purchasing.receivePurchaseOrder(principal, id, body));
  }

  private async execute<Result>(action: () => Promise<Result>): Promise<Result> {
    try {
      return await action();
    } catch (error: unknown) {
      if (error instanceof PurchasingApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "INVENTORY_REQUEST_INVALID" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "INVENTORY_CONFLICT" });
        if (error.code === "missing") throw new NotFoundException({ code: "INVENTORY_NOT_FOUND" });
        if (error.code === "idempotency-conflict") {
          throw new ConflictException({
            code: "INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT",
            message: "La orden de compra ya existe para esa clave de idempotencia con otro contenido.",
          });
        }
      }
      throw new ServiceUnavailableException({ code: "INVENTORY_UNAVAILABLE" });
    }
  }
}
