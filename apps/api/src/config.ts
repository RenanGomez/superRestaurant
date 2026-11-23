export interface ApiConfig {
  readonly port: number;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
}

/**
 * Bounded, opt-in limits for the unauthenticated login surface (the API's token
 * verification boundary). Password sign-in itself is delegated to Supabase Auth by
 * web, mobile and KDS, so it can only be metered there; these counters protect every
 * login attempt that reaches this API and never trust caller-supplied identity.
 *
 * `trustForwardedFor` is a deployment contract: only enable it when exactly one
 * trusted reverse proxy sits in front of the API and it rewrites `x-forwarded-for`.
 * `trustedProxyHops` is the number of trusted proxies that may prepend an address;
 * the guard reads the hop appended by the outermost trusted proxy and rejects the
 * configuration at startup when it is missing or out of range. With
 * `trustForwardedFor=false` (default) caller headers are ignored and the socket
 * address is used.
 */
export interface RateLimitPolicy {
  readonly loginMax: number;
  readonly loginWindowMs: number;
  readonly maxTrackedKeys: number;
  readonly trustForwardedFor: boolean;
  readonly trustedProxyHops: number;
}

export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = Object.freeze({
  loginMax: 60,
  loginWindowMs: 60_000,
  maxTrackedKeys: 10_000,
  trustForwardedFor: false,
  trustedProxyHops: 1,
});

export class ApiConfigurationError extends Error {
  public constructor(code: string) {
    super(code);
    this.name = "ApiConfigurationError";
  }
}

export function readApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const supabaseUrl = readSupabaseUrl(environment.SUPABASE_URL);
  const supabasePublishableKey = readPublishableKey(environment.SUPABASE_PUBLISHABLE_KEY);
  const port = readPort(environment.PORT);

  return Object.freeze({ port, supabaseUrl, supabasePublishableKey });
}

export function readRateLimitPolicy(environment: NodeJS.ProcessEnv): RateLimitPolicy {
  const trustForwardedFor = readBoolean(environment.RATE_LIMIT_TRUST_FORWARDED_FOR, DEFAULT_RATE_LIMIT_POLICY.trustForwardedFor, "RATE_LIMIT_TRUST_FORWARDED_FOR_INVALID");
  const trustedProxyHops = readBoundedInteger(
    environment.RATE_LIMIT_TRUSTED_PROXY_HOPS,
    DEFAULT_RATE_LIMIT_POLICY.trustedProxyHops,
    1,
    10,
    "RATE_LIMIT_TRUSTED_PROXY_HOPS_INVALID",
  );
  // Enabling forwarded headers without trusting at least one hop would let callers
  // spoof their address, so the combination is rejected at startup.
  if (trustForwardedFor && trustedProxyHops < 1) throw new ApiConfigurationError("RATE_LIMIT_TRUSTED_PROXY_HOPS_INVALID");
  return Object.freeze({
    loginMax: readBoundedInteger(environment.RATE_LIMIT_LOGIN_MAX, DEFAULT_RATE_LIMIT_POLICY.loginMax, 1, 10_000, "RATE_LIMIT_LOGIN_MAX_INVALID"),
    loginWindowMs: readBoundedInteger(environment.RATE_LIMIT_LOGIN_WINDOW_MS, DEFAULT_RATE_LIMIT_POLICY.loginWindowMs, 1_000, 3_600_000, "RATE_LIMIT_LOGIN_WINDOW_MS_INVALID"),
    maxTrackedKeys: readBoundedInteger(environment.RATE_LIMIT_MAX_KEYS, DEFAULT_RATE_LIMIT_POLICY.maxTrackedKeys, 100, 1_000_000, "RATE_LIMIT_MAX_KEYS_INVALID"),
    trustForwardedFor,
    trustedProxyHops,
  });
}

function readBoundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, code: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^[0-9]+$/u.test(value)) throw new ApiConfigurationError(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new ApiConfigurationError(code);
  return parsed;
}

function readBoolean(value: string | undefined, fallback: boolean, code: string): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new ApiConfigurationError(code);
}

function readSupabaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new ApiConfigurationError("SUPABASE_URL_REQUIRED");
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.hash !== ""
      || parsed.search !== ""
      || parsed.pathname !== "/"
    ) {
      throw new ApiConfigurationError("SUPABASE_URL_INVALID");
    }
    return parsed.toString().replace(/\/$/u, "");
  } catch (error) {
    if (error instanceof ApiConfigurationError) throw error;
    throw new ApiConfigurationError("SUPABASE_URL_INVALID");
  }
}

function readPublishableKey(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "") {
    throw new ApiConfigurationError("SUPABASE_PUBLISHABLE_KEY_REQUIRED");
  }
  if (
    !normalized.startsWith("sb_publishable_")
    || normalized.length <= "sb_publishable_".length
    || normalized.length > 1_024
    || !/^[A-Za-z0-9_-]+$/u.test(normalized)
  ) {
    throw new ApiConfigurationError("SUPABASE_PUBLISHABLE_KEY_INVALID");
  }
  return normalized;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3000;
  if (!/^[0-9]+$/u.test(value)) throw new ApiConfigurationError("PORT_INVALID");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new ApiConfigurationError("PORT_INVALID");
  }
  return port;
}
