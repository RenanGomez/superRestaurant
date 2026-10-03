import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Header, Inject, Post, Req, ServiceUnavailableException } from "@nestjs/common";
import type { AssignOrderWaiterResultV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { OrderWaiterApplicationError, OrderWaiterService } from "./order-waiter.js";

@Controller("orders")
export class OrderWaiterController {
  public constructor(@Inject(OrderWaiterService) private readonly waiter: OrderWaiterService) {}

  @Post("assign-waiter")
  @Header("Cache-Control", "private, no-store")
  public async assign(@Req() request: unknown, @Body() body: unknown): Promise<AssignOrderWaiterResultV1> {
    try {
      return await this.waiter.assign(getAuthenticatedPrincipal(request), body);
    } catch (error: unknown) {
      if (!(error instanceof OrderWaiterApplicationError)) throw new ServiceUnavailableException({ code: "ORDER_WAITER_UNAVAILABLE" });
      if (error.code === "request") throw new BadRequestException({ code: "ORDER_WAITER_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      if (error.code === "conflict") throw new ConflictException({ code: "ORDER_WAITER_CONFLICT" });
      throw new ServiceUnavailableException({ code: "ORDER_WAITER_UNAVAILABLE" });
    }
  }
}
