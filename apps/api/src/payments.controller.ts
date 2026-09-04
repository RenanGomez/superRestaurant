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
import type { CashRegisterSummaryV1, PaymentCollectionSummaryV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { FinancialApplicationError, FinancialService } from "./payments.js";

@Controller()
export class PaymentsController {
  public constructor(@Inject(FinancialService) private readonly finances: FinancialService) {}

  @Post("cash-registers/open")
  @Header("Cache-Control", "private, no-store")
  public open(@Req() request: unknown, @Body() body: unknown): Promise<CashRegisterSummaryV1> {
    return this.map(() => this.finances.open(getAuthenticatedPrincipal(request), body));
  }

  @Post("payments/collect")
  @Header("Cache-Control", "private, no-store")
  public collect(@Req() request: unknown, @Body() body: unknown): Promise<PaymentCollectionSummaryV1> {
    return this.map(() => this.finances.collect(getAuthenticatedPrincipal(request), body));
  }

  @Post("cash-registers/close")
  @Header("Cache-Control", "private, no-store")
  public close(@Req() request: unknown, @Body() body: unknown): Promise<CashRegisterSummaryV1> {
    return this.map(() => this.finances.close(getAuthenticatedPrincipal(request), body));
  }

  private async map<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error: unknown) {
      if (!(error instanceof FinancialApplicationError)) throw unavailable();
      if (error.code === "request") throw new BadRequestException({ code: "FINANCIAL_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      if (error.code === "not_found") throw new NotFoundException({ code: "FINANCIAL_RESOURCE_NOT_FOUND" });
      if (error.code === "conflict") throw new ConflictException({ code: "FINANCIAL_CONFLICT" });
      throw unavailable();
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: "FINANCIAL_UNAVAILABLE" });
}
