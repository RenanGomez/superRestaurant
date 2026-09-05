import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ActiveTableOrderListV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { TableOrderContextError, TableOrderContextService } from "./table-order-context.js";

@Controller("orders")
export class TableOrderContextController {
  public constructor(@Inject(TableOrderContextService) private readonly context: TableOrderContextService) {}

  @Get("active")
  @Header("Cache-Control", "private, no-store")
  public listActive(
    @Req() request: unknown,
    @Query("restaurantId") restaurantId: unknown,
    @Query("branchId") branchId: unknown,
    @Query("tableId") tableId: unknown,
  ): Promise<ActiveTableOrderListV1> {
    return this.map(() => this.context.listActive(getAuthenticatedPrincipal(request), { branchId, restaurantId, tableId }));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error: unknown) {
      if (!(error instanceof TableOrderContextError)) throw unavailable();
      if (error.code === "request") throw new BadRequestException({ code: "TABLE_ORDER_CONTEXT_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "TABLE_ORDER_CONTEXT_UNAVAILABLE" });
}
