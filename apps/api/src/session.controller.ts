import { Controller, Get, Header, Req } from "@nestjs/common";

import { getAuthenticatedPrincipal } from "./auth/authentication.js";

@Controller("session")
export class SessionController {
  @Get()
  @Header("Cache-Control", "private, no-store")
  public getSession(@Req() request: unknown): Readonly<{ actorId: string }> {
    const principal = getAuthenticatedPrincipal(request);
    return Object.freeze({ actorId: principal.actorId });
  }
}
