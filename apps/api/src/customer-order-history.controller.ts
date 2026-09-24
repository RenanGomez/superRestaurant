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
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  CustomerRecentOrderListV1,
  CustomerRepeatOrderCaptureResultV1,
  CustomerRepeatOrderPreviewV1,
} from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import {
  CustomerOrderHistoryError,
  CustomerOrderHistoryService,
  CustomerOrderRepeatCaptureService,
  CustomerOrderRepeatPreviewService,
} from "./customer-order-history.js";

@Controller("customers")
export class CustomerOrderHistoryController {
  public constructor(
    @Inject(CustomerOrderHistoryService) private readonly history: CustomerOrderHistoryService,
    @Inject(CustomerOrderRepeatPreviewService) private readonly repeatPreview: CustomerOrderRepeatPreviewService,
    @Inject(CustomerOrderRepeatCaptureService) private readonly repeatCapture: CustomerOrderRepeatCaptureService,
  ) {}

  @Get(":customerId/orders/recent")
  @Header("Cache-Control", "private, no-store")
  public list(
    @Req() request: unknown,
    @Param("customerId") customerId: unknown,
    @Query("restaurantId") restaurantId: unknown,
    @Query("branchId") branchId: unknown,
    @Query("limit") limit: unknown,
  ): Promise<CustomerRecentOrderListV1> {
    return this.execute(() => this.history.list(
      getAuthenticatedPrincipal(request),
      { branchId, customerId, limit, restaurantId },
    ));
  }

  @Post(":customerId/orders/:orderId/repeat")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public repeat(
    @Req() request: unknown,
    @Param("customerId") customerId: unknown,
    @Param("orderId") orderId: unknown,
    @Body() body: unknown,
  ): Promise<CustomerRepeatOrderCaptureResultV1> {
    return this.execute(() => this.repeatCapture.apply(
      getAuthenticatedPrincipal(request), body, customerId, orderId,
    ));
  }

  @Get(":customerId/orders/:orderId/repeat-preview")
  @Header("Cache-Control", "private, no-store")
  public preview(
    @Req() request: unknown,
    @Param("customerId") customerId: unknown,
    @Param("orderId") orderId: unknown,
    @Query("restaurantId") restaurantId: unknown,
    @Query("branchId") branchId: unknown,
  ): Promise<CustomerRepeatOrderPreviewV1> {
    return this.execute(() => this.repeatPreview.preview(
      getAuthenticatedPrincipal(request),
      { branchId, customerId, orderId, restaurantId },
    ));
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (error instanceof CustomerOrderHistoryError) {
        if (error.code === "request") throw new BadRequestException({ code: "CUSTOMER_ORDER_HISTORY_REQUEST_REJECTED" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "CUSTOMER_ORDER_REPEAT_CONFLICT" });
        if (error.code === "not_found") throw new NotFoundException({ code: "CUSTOMER_ORDER_HISTORY_NOT_FOUND" });
      }
      throw new ServiceUnavailableException({ code: "CUSTOMER_ORDER_HISTORY_UNAVAILABLE" });
    }
  }
}
