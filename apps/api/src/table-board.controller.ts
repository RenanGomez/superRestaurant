import { BadRequestException, Body, Controller, ForbiddenException, Header, Inject, Post, Req, ServiceUnavailableException } from "@nestjs/common";
import type { TableBoardV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";
import { TableBoardApplicationError, TableBoardService } from "./table-board.js";

@Controller("tables")
export class TableBoardController {
  public constructor(@Inject(TableBoardService) private readonly board: TableBoardService) {}

  @Post("board")
  @Header("Cache-Control", "private, no-store")
  public async read(@Req() request: unknown, @Body() body: unknown): Promise<TableBoardV1> {
    try {
      return await this.board.read(getAuthenticatedPrincipal(request), body);
    } catch (error: unknown) {
      if (!(error instanceof TableBoardApplicationError)) throw new ServiceUnavailableException({ code: "TABLE_BOARD_UNAVAILABLE" });
      if (error.code === "request") throw new BadRequestException({ code: "TABLE_BOARD_REQUEST_REJECTED" });
      if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
      throw new ServiceUnavailableException({ code: "TABLE_BOARD_UNAVAILABLE" });
    }
  }
}
