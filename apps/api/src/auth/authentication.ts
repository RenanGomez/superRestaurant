import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { HttpException, Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ApiConfig } from "../config.js";

export const AUTH_PRINCIPAL_VERIFIER = Symbol("AUTH_PRINCIPAL_VERIFIER");
export const PUBLIC_ROUTE = Symbol("PUBLIC_ROUTE");
export const RATE_LIMIT = Symbol("RATE_LIMIT");
const authenticatedPrincipalKey = Symbol("authenticatedPrincipal");

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);
export const RateLimited = (options: { limit: number; windowMs: number }): MethodDecorator => SetMetadata(RATE_LIMIT, options);

export class RateLimitStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();
  private cursor = this.entries.entries();
  private remaining = 0;
  public constructor(private readonly clock: () => number = Date.now, private readonly capacity = 10_000) {}

  public consume(key: string, limit: number, windowMs: number): number {
    const now = this.clock();
    if (this.remaining === 0) { this.cursor = this.entries.entries(); this.remaining = this.entries.size; }
    const next = this.cursor.next();
    if (next.done) this.remaining = 0;
    else this.remaining -= 1;
    if (!next.done && next.value[1].expiresAt <= now) this.entries.delete(next.value[0]);
    let entry = this.entries.get(key);
    if (entry !== undefined && entry.expiresAt <= now) { this.entries.delete(key); entry = undefined; }
    if (entry === undefined) {
      if (this.entries.size >= this.capacity) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      entry = { count: 0, expiresAt: now + windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count >= limit) return Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
    entry.count += 1;
    return 0;
  }

  public refund(key: string): void {
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.count > 0) entry.count -= 1;
  }
}

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
  private readonly requests = new RateLimitStore();
  private readonly authenticationRequests = new RateLimitStore();
  private readonly operations = new WeakMap<object, number>();
  private nextOperation = 0;
  public constructor(
    @Inject(AUTH_PRINCIPAL_VERIFIER) private readonly verifier: AuthPrincipalVerifierPort,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse?.<{ setHeader(name: string, value: string): void }>();
    const ip = request.socket?.remoteAddress ?? "unknown";
    this.rejectLimited(response, this.authenticationRequests.consume(ip, 300, 60_000));
    const accessToken = parseBearerAuthorization(request.headers?.authorization);
    if (accessToken === undefined) throw authenticationRequired();

    let principal: AuthenticatedPrincipal | undefined;
    try {
      principal = normalizePrincipal(await this.verifier.verifyAccessToken(accessToken));
      if (principal === undefined) throw new AccessTokenRejectedError();
      this.authenticationRequests.refund(ip);
      Object.defineProperty(request, authenticatedPrincipalKey, {
        configurable: false,
        enumerable: false,
        value: principal,
        writable: false,
      });
    } catch {
      throw authenticationRequired();
    }
    const handler = context.getHandler();
    const options = this.reflector.getAllAndOverride<{ limit: number; windowMs: number }>(RATE_LIMIT, [handler, context.getClass()]);
    if (options !== undefined && options !== null && typeof options === "object") {
      let operation = this.operations.get(handler);
      if (operation === undefined) { operation = this.nextOperation++; this.operations.set(handler, operation); }
      const branch = request.body?.scope?.branchId;
      const branchKey = typeof branch === "string" && uuidPattern.test(branch) ? branch.toLowerCase() : "none";
      this.rejectLimited(response, this.requests.consume(`${principal.actorId}|${branchKey}|${operation}`, options.limit, options.windowMs));
    }
    return true;
  }

  private rejectLimited(response: { setHeader(name: string, value: string): void } | undefined, retryAfter: number): void {
    if (retryAfter === 0) return;
    response?.setHeader("Retry-After", String(retryAfter));
    throw new HttpException({ code: "RATE_LIMITED" }, 429);
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
  readonly socket?: { readonly remoteAddress?: string };
  readonly body?: { readonly scope?: { readonly branchId?: unknown } };
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
