import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseSystemOnboardingResultV1, parseSystemRestaurantOnboardingRequestV1, type SystemOnboardingResultV1, type SystemRestaurantOnboardingRequestV1 } from "@super-restaurant/shared-types";
import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

export const SYSTEM_ONBOARDING_AUTH = Symbol("SYSTEM_ONBOARDING_AUTH");
export interface SystemOnboardingAuthPort { findUserByEmail(email: string): Promise<Readonly<{ id: string }> | undefined>; inviteUser(email: string): Promise<Readonly<{ id: string }>>; deleteUser(id: string): Promise<void>; }
export class SystemOnboardingError extends Error { public constructor(public readonly code: "request" | "authorization" | "duplicate" | "idempotency" | "unavailable") { super(`SYSTEM_ONBOARDING_${code.toUpperCase()}`); this.name = "SystemOnboardingError"; } }

const provisionSql = `select app_private.provision_system_restaurant($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text) as result`;
const preflightSql = "select app_private.preflight_system_restaurant($1::uuid,$2::uuid,$3::text,$4::text) as result";
const readSql = "select app_private.read_system_onboarding_operation($1::uuid,$2::uuid) as result";
const listSql = "select app_private.list_system_restaurants($1::uuid) as result";
const disableSql = "select app_private.disable_system_restaurant($1::uuid,$2::uuid,$3::text) as result";

@Injectable()
export class SystemOnboardingService {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort, @Inject(SYSTEM_ONBOARDING_AUTH) private readonly auth: SystemOnboardingAuthPort) {}
  public async provision(principal: AuthenticatedPrincipal, input: unknown): Promise<SystemOnboardingResultV1> {
    const request = parseSystemRestaurantOnboardingRequestV1(input);
    if (request === undefined) throw new SystemOnboardingError("request");
    const requestHash = hashRequest(request);
    const preflight = await this.preflight(principal.actorId, request, requestHash);
    if (preflight.status === "forbidden") throw new SystemOnboardingError("authorization");
    if (preflight.status === "duplicate") throw new SystemOnboardingError("duplicate");
    if (preflight.status === "idempotency_conflict") throw new SystemOnboardingError("idempotency");
    if (preflight.status === "replay" && typeof preflight.operationId === "string") {
      const previous = await this.read(principal, preflight.operationId);
      const parsed = parseSystemOnboardingResultV1(previous.result);
      if (parsed !== undefined) return parsed;
      throw new SystemOnboardingError("unavailable");
    }
    const existing = await this.auth.findUserByEmail(request.manager.email);
    let manager = existing; let created = false;
    try {
      if (manager === undefined) { manager = await this.auth.inviteUser(request.manager.email); created = true; }
      const result = await this.callProvision(principal.actorId, manager.id, request, requestHash);
      if (result.status === "forbidden") throw new SystemOnboardingError("authorization");
      if (result.status === "duplicate") throw new SystemOnboardingError("duplicate");
      if (result.status === "idempotency_conflict") throw new SystemOnboardingError("idempotency");
      if (result.status !== "invitation_pending") throw new SystemOnboardingError("unavailable");
      return result;
    } catch (error: unknown) {
      if (created && manager !== undefined) { try { await this.auth.deleteUser(manager.id); } catch { /* fail closed */ } }
      if (error instanceof SystemOnboardingError) throw error;
      throw new SystemOnboardingError("unavailable");
    }
  }
  private async preflight(actorId: string, request: SystemRestaurantOnboardingRequestV1, requestHash: string): Promise<Readonly<Record<string, unknown>>> {
    let rows: readonly unknown[]; try { rows = (await this.database.query(preflightSql, [actorId, request.idempotencyKey, requestHash, request.restaurant.name])).rows; } catch { throw new SystemOnboardingError("unavailable"); }
    if (rows.length !== 1 || typeof rows[0] !== "object" || rows[0] === null || !("result" in rows[0])) throw new SystemOnboardingError("unavailable");
    const value = (rows[0] as { readonly result?: unknown }).result; if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SystemOnboardingError("unavailable");
    const status = (value as { readonly status?: unknown }).status; if (status === "ready" || status === "replay" || status === "forbidden" || status === "duplicate" || status === "idempotency_conflict") return value as Readonly<Record<string, unknown>>; throw new SystemOnboardingError("unavailable");
  }
  public async read(principal: AuthenticatedPrincipal, operationId: string): Promise<Readonly<Record<string, unknown>>> {
    if (!UUID_PATTERN.test(operationId)) throw new SystemOnboardingError("request");
    let rows: readonly unknown[]; try { rows = (await this.database.query(readSql, [principal.actorId, operationId])).rows; } catch { throw new SystemOnboardingError("unavailable"); }
    if (rows.length !== 1 || typeof rows[0] !== "object" || rows[0] === null || !("result" in rows[0])) throw new SystemOnboardingError("unavailable");
    const result = (rows[0] as { readonly result?: unknown }).result;
    if (result === null) throw new SystemOnboardingError("authorization");
    if (result === undefined || typeof result !== "object") throw new SystemOnboardingError("unavailable");
    return result as Readonly<Record<string, unknown>>;
  }
  public async list(principal: AuthenticatedPrincipal): Promise<readonly Readonly<Record<string, unknown>>[]> {
    let rows: readonly unknown[]; try { rows = (await this.database.query(listSql, [principal.actorId])).rows; } catch { throw new SystemOnboardingError("unavailable"); }
    if (rows.length !== 1 || typeof rows[0] !== "object" || rows[0] === null || !("result" in rows[0])) throw new SystemOnboardingError("unavailable");
    const result = (rows[0] as { readonly result?: unknown }).result;
    if (result === null) throw new SystemOnboardingError("authorization");
    if (!Array.isArray(result)) throw new SystemOnboardingError("unavailable");
    return result.filter((item): item is Readonly<Record<string, unknown>> => typeof item === "object" && item !== null && !Array.isArray(item)) as readonly Readonly<Record<string, unknown>>[];
  }
  public async disable(principal: AuthenticatedPrincipal, restaurantId: string, reason: string): Promise<Readonly<Record<string, unknown>>> {
    if (!UUID_PATTERN.test(restaurantId) || reason.trim() !== reason || reason.length < 1 || reason.length > 500) throw new SystemOnboardingError("request");
    let rows: readonly unknown[]; try { rows = (await this.database.query(disableSql, [principal.actorId, restaurantId, reason])).rows; } catch { throw new SystemOnboardingError("unavailable"); }
    if (rows.length !== 1 || typeof rows[0] !== "object" || rows[0] === null || !("result" in rows[0])) throw new SystemOnboardingError("unavailable");
    const result = (rows[0] as { readonly result?: unknown }).result; if (typeof result !== "object" || result === null) throw new SystemOnboardingError("unavailable");
    const status = (result as { readonly status?: unknown }).status; if (status === "forbidden") throw new SystemOnboardingError("authorization"); if (status === "invalid_request" || status === "not_found") throw new SystemOnboardingError("request"); return result as Readonly<Record<string, unknown>>;
  }
  private async callProvision(actorId: string, managerId: string, request: SystemRestaurantOnboardingRequestV1, requestHash: string): Promise<SystemOnboardingResultV1> {
    let rows: readonly unknown[]; try { rows = (await this.database.query(provisionSql, [actorId, managerId, request.manager.email, request.idempotencyKey, requestHash, request.restaurant.name, request.restaurant.timeZone, request.restaurant.currency, request.branch.name, request.seedProfile])).rows; } catch { throw new SystemOnboardingError("unavailable"); }
    if (rows.length !== 1 || typeof rows[0] !== "object" || rows[0] === null || !("result" in rows[0])) throw new SystemOnboardingError("unavailable");
    const parsed = parseSystemOnboardingResultV1((rows[0] as { readonly result?: unknown }).result); if (parsed === undefined) throw new SystemOnboardingError("unavailable"); return parsed;
  }
}

export function hashRequest(request: SystemRestaurantOnboardingRequestV1): string { return createHash("sha256").update(JSON.stringify(request)).digest("hex"); }
export function createSystemOnboardingAuth(environment: NodeJS.ProcessEnv): SystemOnboardingAuthPort {
  const url = environment.SUPABASE_URL?.trim(); const key = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (url === undefined || key === undefined || !url.startsWith("https://") || key.length < 20) return Object.freeze({ deleteUser: async () => { throw new Error("SYSTEM_ONBOARDING_AUTH_NOT_CONFIGURED"); }, findUserByEmail: async () => { throw new Error("SYSTEM_ONBOARDING_AUTH_NOT_CONFIGURED"); }, inviteUser: async () => { throw new Error("SYSTEM_ONBOARDING_AUTH_NOT_CONFIGURED"); } });
  return new SupabaseSystemOnboardingAuth(createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }));
}
class SupabaseSystemOnboardingAuth implements SystemOnboardingAuthPort {
  public constructor(private readonly client: Pick<SupabaseClient, "auth">) {}
  public async findUserByEmail(email: string): Promise<Readonly<{ id: string }> | undefined> { const { data, error } = await this.client.auth.admin.listUsers({ page: 1, perPage: 1000 }); if (error !== null) return undefined; const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email); return user === undefined ? undefined : Object.freeze({ id: user.id }); }
  public async inviteUser(email: string): Promise<Readonly<{ id: string }>> { const { data, error } = await this.client.auth.admin.inviteUserByEmail(email); if (error !== null || data.user === null) throw new Error("AUTH_INVITE_FAILED"); return Object.freeze({ id: data.user.id }); }
  public async deleteUser(id: string): Promise<void> { const { error } = await this.client.auth.admin.deleteUser(id); if (error !== null) throw error; }
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
