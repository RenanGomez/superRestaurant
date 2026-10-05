import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  Inject,
  NotFoundException,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  BranchDeliveriesV1,
  OrderDeliveryResultV1,
  OrderDetailV1,
  SettleDeliveryResultV1,
} from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { DeliveryApplicationError, DeliveryService } from "./deliveries.js";

@Controller("deliveries")
export class DeliveriesController {
  public constructor(@Inject(DeliveryService) private readonly deliveries: DeliveryService) {}

  @Post("list")
  @Header("Cache-Control", "private, no-store")
  public list(@Req() request: unknown, @Body() body: unknown): Promise<BranchDeliveriesV1> {
    return this.map(() => this.deliveries.list(getAuthenticatedPrincipal(request), body));
  }

  @Post("order-detail")
  @Header("Cache-Control", "private, no-store")
  public orderDetail(@Req() request: unknown, @Body() body: unknown): Promise<OrderDetailV1> {
    return this.map(() => this.deliveries.orderDetail(getAuthenticatedPrincipal(request), body));
  }

  @Post("assign")
  @Header("Cache-Control", "private, no-store")
  public assign(@Req() request: unknown, @Body() body: unknown): Promise<OrderDeliveryResultV1> {
    return this.map(() => this.deliveries.assign(getAuthenticatedPrincipal(request), body));
  }

  @Post("dispatch")
  @Header("Cache-Control", "private, no-store")
  public dispatch(@Req() request: unknown, @Body() body: unknown): Promise<OrderDeliveryResultV1> {
    return this.map(() => this.deliveries.dispatch(getAuthenticatedPrincipal(request), body));
  }

  @Post("complete")
  @Header("Cache-Control", "private, no-store")
  public complete(@Req() request: unknown, @Body() body: unknown): Promise<OrderDeliveryResultV1> {
    return this.map(() => this.deliveries.complete(getAuthenticatedPrincipal(request), body));
  }

  @Post("fail")
  @Header("Cache-Control", "private, no-store")
  public fail(@Req() request: unknown, @Body() body: unknown): Promise<OrderDeliveryResultV1> {
    return this.map(() => this.deliveries.fail(getAuthenticatedPrincipal(request), body));
  }

  @Post("settle")
  @Header("Cache-Control", "private, no-store")
  public settle(@Req() request: unknown, @Body() body: unknown): Promise<SettleDeliveryResultV1> {
    return this.map(() => this.deliveries.settle(getAuthenticatedPrincipal(request), body));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!(error instanceof DeliveryApplicationError)) throw new ServiceUnavailableException({ code: "DELIVERY_UNAVAILABLE" });
      if (error.code === "request") throw new BadRequestException({ code: "DELIVERY_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      if (error.code === "not_found") throw new NotFoundException({ code: "DELIVERY_NOT_FOUND" });
      if (error.code === "conflict") throw new ConflictException({ code: "DELIVERY_CONFLICT" });
      throw new ServiceUnavailableException({ code: "DELIVERY_UNAVAILABLE" });
    }
  }
}
