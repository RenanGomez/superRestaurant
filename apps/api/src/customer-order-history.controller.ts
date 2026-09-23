import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { CustomerRecentOrderListV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { CustomerOrderHistoryError, CustomerOrderHistoryService } from "./customer-order-history.js";

@Controller("customers")
export class CustomerOrderHistoryController {
  public constructor(@Inject(CustomerOrderHistoryService) private readonly history: CustomerOrderHistoryService) {}

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

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (error instanceof CustomerOrderHistoryError) {
        if (error.code === "request") throw new BadRequestException({ code: "CUSTOMER_ORDER_HISTORY_REQUEST_REJECTED" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      }
      throw new ServiceUnavailableException({ code: "CUSTOMER_ORDER_HISTORY_UNAVAILABLE" });
    }
  }
}
