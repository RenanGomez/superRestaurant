import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { SetOrderAccountLabelResultV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { OrderAccountLabelApplicationError, OrderAccountLabelService } from "./order-account-label.js";

@Controller("orders")
export class OrderAccountLabelController {
  public constructor(@Inject(OrderAccountLabelService) private readonly service: OrderAccountLabelService) {}

  @Post("account-label")
  @Header("Cache-Control", "private, no-store")
  public async setAccountLabel(@Req() request: unknown, @Body() body: unknown): Promise<SetOrderAccountLabelResultV1> {
    try {
      return await this.service.setAccountLabel(getAuthenticatedPrincipal(request), body);
    } catch (error: unknown) {
      if (!(error instanceof OrderAccountLabelApplicationError)) {
        throw new ServiceUnavailableException({ code: "ORDER_ACCOUNT_LABEL_UNAVAILABLE" });
      }
      if (error.code === "request") throw new BadRequestException({ code: "ORDER_ACCOUNT_LABEL_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      if (error.code === "conflict") throw new ConflictException({ code: "ORDER_ACCOUNT_LABEL_CONFLICT" });
      throw new ServiceUnavailableException({ code: "ORDER_ACCOUNT_LABEL_UNAVAILABLE" });
    }
  }
}
