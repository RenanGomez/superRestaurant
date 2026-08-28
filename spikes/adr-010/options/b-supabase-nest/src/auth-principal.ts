import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SupabaseAdr010ServerConfig } from "./config.js";

/** Identity established only after Supabase Auth has verified an access token. */
export interface AuthenticatedSupabasePrincipal {
  readonly actorId: string;
}

/**
 * Server-only authentication boundary. Callers may supply a bearer token, but
 * never an actor ID; a verified principal is the sole source of that identity.
 */
export interface AuthPrincipalVerifierPort {
  verifyAccessToken(accessToken: string): Promise<AuthenticatedSupabasePrincipal>;
}

/** Deliberately does not include a token or provider error detail. */
export class SupabaseAccessTokenRejectedError extends Error {
  public constructor() {
    super("SUPABASE_ACCESS_TOKEN_REJECTED");
    this.name = "SupabaseAccessTokenRejectedError";
  }
}

/**
 * Uses the official Supabase Auth API to validate the token remotely. It does
 * not decode JWT claims locally, which would not establish token authenticity.
 */
export class SupabaseAuthPrincipalVerifier implements AuthPrincipalVerifierPort {
  private readonly client: Pick<SupabaseClient, "auth">;

  public constructor(config: SupabaseAdr010ServerConfig, authClient?: Pick<SupabaseClient, "auth">) {
    this.client = authClient ?? createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  public async verifyAccessToken(accessToken: string): Promise<AuthenticatedSupabasePrincipal> {
    if (typeof accessToken !== "string" || accessToken.trim() === "") throw new SupabaseAccessTokenRejectedError();

    try {
      const { data, error } = await this.client.auth.getUser(accessToken);
      if (error !== null || data.user === null || !uuidPattern.test(data.user.id)) {
        throw new SupabaseAccessTokenRejectedError();
      }

      return Object.freeze({ actorId: data.user.id });
    } catch (error) {
      if (error instanceof SupabaseAccessTokenRejectedError) throw error;
      throw new SupabaseAccessTokenRejectedError();
    }
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
