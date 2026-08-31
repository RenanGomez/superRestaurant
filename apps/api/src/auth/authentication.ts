import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ApiConfig } from "../config.js";

export const AUTH_PRINCIPAL_VERIFIER = Symbol("AUTH_PRINCIPAL_VERIFIER");
export const PUBLIC_ROUTE = Symbol("PUBLIC_ROUTE");
const authenticatedPrincipalKey = Symbol("authenticatedPrincipal");

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

export interface AuthenticatedPrincipal {
  readonly actorId: string;
}

export interface AuthPrincipalVerifierPort {
  verifyAccessToken(accessToken: string): Promise<AuthenticatedPrincipal>;
}

export class AccessTokenRejectedError extends Error {
  public constructor() {
    super("ACCESS_TOKEN_REJECTED");
    this.name = "AccessTokenRejectedError";
  }
}

type SupabaseAuthClient = Pick<SupabaseClient, "auth">;

export class SupabaseAuthPrincipalVerifier implements AuthPrincipalVerifierPort {
  readonly #client: SupabaseAuthClient;

  public constructor(config: ApiConfig, client?: SupabaseAuthClient) {
    this.#client = client ?? createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
  }

  public async verifyAccessToken(accessToken: string): Promise<AuthenticatedPrincipal> {
    if (!isBoundedAccessToken(accessToken)) throw new AccessTokenRejectedError();

    try {
      const { data, error } = await this.#client.auth.getUser(accessToken);
      if (error !== null || data.user === null || !uuidPattern.test(data.user.id)) {
        throw new AccessTokenRejectedError();
      }
      return Object.freeze({ actorId: data.user.id.toLowerCase() });
    } catch (error) {
      if (error instanceof AccessTokenRejectedError) throw error;
      throw new AccessTokenRejectedError();
    }
  }
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  public constructor(
    @Inject(AUTH_PRINCIPAL_VERIFIER) private readonly verifier: AuthPrincipalVerifierPort,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = parseBearerAuthorization(request.headers?.authorization);
    if (accessToken === undefined) throw authenticationRequired();

    try {
      const principal = normalizePrincipal(await this.verifier.verifyAccessToken(accessToken));
      if (principal === undefined) throw new AccessTokenRejectedError();
      Object.defineProperty(request, authenticatedPrincipalKey, {
        configurable: false,
        enumerable: false,
        value: principal,
        writable: false,
      });
      return true;
    } catch {
      throw authenticationRequired();
    }
  }
}

export function getAuthenticatedPrincipal(request: unknown): AuthenticatedPrincipal {
  if (typeof request !== "object" || request === null) throw authenticationRequired();
  const principal = normalizePrincipal((request as AuthenticatedRequest)[authenticatedPrincipalKey]);
  if (principal === undefined) throw authenticationRequired();
  return principal;
}

export function parseBearerAuthorization(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8_200) return undefined;
  const match = /^Bearer ([^\s]+)$/iu.exec(value);
  if (match === null) return undefined;
  const token = match[1];
  return token !== undefined && isBoundedAccessToken(token) ? token : undefined;
}

type AuthenticatedRequest = {
  readonly headers?: { readonly authorization?: unknown };
  readonly [authenticatedPrincipalKey]?: AuthenticatedPrincipal;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isBoundedAccessToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20 && value.length <= 8_192 && !/\s/u.test(value);
}

function normalizePrincipal(value: unknown): AuthenticatedPrincipal | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== 1 || ownKeys[0] !== "actorId") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "actorId");
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string" || !uuidPattern.test(descriptor.value)) {
      return undefined;
    }
    return Object.freeze({ actorId: descriptor.value.toLowerCase() });
  } catch {
    return undefined;
  }
}

function authenticationRequired(): UnauthorizedException {
  return new UnauthorizedException({ code: "AUTHENTICATION_REQUIRED" });
}
