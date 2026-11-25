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
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";

import { getAuthenticatedPrincipal, RateLimited } from "../auth/authentication.js";
import {
  InventoryMovementApplicationError,
  MovementsService,
  type InventoryBalanceListV1,
  type InventoryMovementListV1,
  type InventoryMovementRecordV1,
  type InventoryTransferResultV1,
} from "./movements.service.js";

@Controller("inventory")
export class MovementsController {
  public constructor(
    @Inject(MovementsService) private readonly movements: MovementsService,
  ) {}

  @Post("movements")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async recordMovement(
    @Req() request: unknown,
    @Body() body: unknown,
  ): Promise<InventoryMovementRecordV1 | InventoryTransferResultV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.movements.recordMovement(principal, body, deviceIdHeader(request)));
  }

  @Get("movements")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async listMovements(@Req() request: unknown, @Query() query: unknown): Promise<InventoryMovementListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.movements.listMovements(principal, query));
  }

  @Get("balances")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async listBalances(@Req() request: unknown, @Query() query: unknown): Promise<InventoryBalanceListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.movements.listBalances(principal, query));
  }

  private async execute<Result>(action: () => Promise<Result>): Promise<Result> {
    try {
      return await action();
    } catch (error: unknown) {
      if (error instanceof InventoryMovementApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "INVENTORY_REQUEST_INVALID" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "INVENTORY_CONFLICT" });
      }
      throw new ServiceUnavailableException({ code: "INVENTORY_UNAVAILABLE" });
    }
  }
}

function deviceIdHeader(request: unknown): unknown {
  if (typeof request !== "object" || request === null) return undefined;
  const headers = (request as { headers?: unknown }).headers;
  if (typeof headers !== "object" || headers === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(headers, "x-device-id");
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}
