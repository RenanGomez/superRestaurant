import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { KdsEventPageV1, KdsTicketListV1, OrderMutationSummaryV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { OrderApplicationError, OrderService } from "./orders.js";

@Controller()
export class OrdersController {
  public constructor(@Inject(OrderService) private readonly orders: OrderService) {}

  @Post("orders")
  @Header("Cache-Control", "private, no-store")
  public create(@Req() request: unknown, @Body() body: unknown): Promise<OrderMutationSummaryV1> {
    return this.map(() => this.orders.create(getAuthenticatedPrincipal(request), body));
  }

  @Post("orders/items")
  @Header("Cache-Control", "private, no-store")
  public addItem(@Req() request: unknown, @Body() body: unknown): Promise<OrderMutationSummaryV1> {
    return this.map(() => this.orders.addItem(getAuthenticatedPrincipal(request), body));
  }

  @Post("orders/open")
  @Header("Cache-Control", "private, no-store")
  public open(@Req() request: unknown, @Body() body: unknown): Promise<OrderMutationSummaryV1> {
    return this.map(() => this.orders.open(getAuthenticatedPrincipal(request), body));
  }

  @Post("orders/items/transition")
  @Header("Cache-Control", "private, no-store")
  public transitionItem(@Req() request: unknown, @Body() body: unknown): Promise<OrderMutationSummaryV1> {
    return this.map(() => this.orders.transitionItem(getAuthenticatedPrincipal(request), body));
  }

  @Get("kds/events")
  @Header("Cache-Control", "private, no-store")
  public recoverKds(
    @Req() request: unknown,
    @Query("restaurantId") restaurantId: unknown,
    @Query("branchId") branchId: unknown,
    @Query("stationId") stationId: unknown,
    @Query("after") after: unknown,
    @Query("limit") limit: unknown,
  ): Promise<KdsEventPageV1> {
    return this.map(() => this.orders.recoverKds(
      getAuthenticatedPrincipal(request),
      { schemaVersion: 1, scope: { branchId, restaurantId }, stationId },
      after,
      limit,
    ));
  }

  @Get("kds/tickets")
  @Header("Cache-Control", "private, no-store")
  public listKdsTickets(
    @Req() request: unknown,
    @Query("restaurantId") restaurantId: unknown,
    @Query("branchId") branchId: unknown,
    @Query("stationId") stationId: unknown,
  ): Promise<KdsTicketListV1> {
    return this.map(() => this.orders.listKdsTickets(
      getAuthenticatedPrincipal(request),
      { schemaVersion: 1, scope: { branchId, restaurantId }, stationId },
    ));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error: unknown) {
      if (!(error instanceof OrderApplicationError)) throw unavailable();
      if (error.code === "request") throw new BadRequestException({ code: "ORDER_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      if (error.code === "not_found") throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
      if (error.code === "conflict") throw new ConflictException({ code: "ORDER_CONFLICT" });
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "ORDER_UNAVAILABLE" });
}
