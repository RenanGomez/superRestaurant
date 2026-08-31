/**
 * Fail-closed server-only configuration for apps/web.
 *
 * Only four variables are read, none of them `NEXT_PUBLIC_`: this app never
 * ships a Supabase client, key, or URL to the browser (see AGENTS.md/frontend.md
 * — no browser Supabase client, no Data API access from the client).
 *
 * Mirrors the validation shape of apps/api/src/config.ts so both apps reject
 * the same malformed inputs (embedded credentials, query strings, fragments).
 */

export interface WebServerEnv {
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly apiBaseUrl: string;
  readonly webOrigin: string;
  /** Whether auth cookies must be marked Secure for this origin. */
  readonly cookiesSecure: boolean;
}

export class WebConfigurationError extends Error {
  public constructor(code: string) {
    super(code);
    this.name = "WebConfigurationError";
  }
}

export function readWebServerEnv(environment: Readonly<Record<string, string | undefined>>): WebServerEnv {
  const isProduction = environment.NODE_ENV === "production";

  const supabaseUrl = readStrictHttpsUrl(environment.SUPABASE_URL, "SUPABASE_URL");
  const supabasePublishableKey = readPublishableKey(environment.SUPABASE_PUBLISHABLE_KEY);
  const apiBaseUrl = readHttpsOrLocalDevUrl(environment.API_BASE_URL, "API_BASE_URL", isProduction).url;
  const { origin, cookiesSecure } = readWebOrigin(environment.WEB_ORIGIN);

  return Object.freeze({
    apiBaseUrl,
    cookiesSecure,
    supabasePublishableKey,
    supabaseUrl,
    webOrigin: origin,
  });
}

let cachedEnv: WebServerEnv | undefined;

/** Lazily reads and caches `process.env`. Never call at module top level. */
export function getServerEnv(): WebServerEnv {
  cachedEnv ??= readWebServerEnv(process.env);
  return cachedEnv;
}

/** Strict HTTPS, no exceptions. Used only for SUPABASE_URL: Supabase is always a remote service. */
function readStrictHttpsUrl(value: string | undefined, name: "SUPABASE_URL"): string {
  const parsed = parseRootUrl(value, name);
  if (parsed.protocol !== "https:") {
    throw new WebConfigurationError(`${name}_INVALID`);
  }
  return normalizeUrl(parsed);
}

/**
 * HTTPS in production, always. In non-production (`NODE_ENV !== "production"`)
 * also accepts plain `http://localhost` or `http://127.0.0.1`, so apps/api can
 * be reached locally without a TLS proxy during development. Any other
 * `http:` host is rejected in every environment.
 */
function readHttpsOrLocalDevUrl(
  value: string | undefined,
  name: "API_BASE_URL",
  isProduction: boolean,
): { readonly url: string } {
  const parsed = parseRootUrl(value, name);

  if (parsed.protocol === "https:") {
    return { url: normalizeUrl(parsed) };
  }

  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol === "http:" && isLocalhost && !isProduction) {
    return { url: normalizeUrl(parsed) };
  }

  throw new WebConfigurationError(`${name}_INVALID`);
}

function parseRootUrl(value: string | undefined, name: string): URL {
  if (value === undefined || value.trim() === "") {
    throw new WebConfigurationError(`${name}_REQUIRED`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WebConfigurationError(`${name}_INVALID`);
  }

  if (
    parsed.username !== ""
    || parsed.password !== ""
    || parsed.hash !== ""
    || parsed.search !== ""
    || parsed.pathname !== "/"
  ) {
    throw new WebConfigurationError(`${name}_INVALID`);
  }

  return parsed;
}

function normalizeUrl(parsed: URL): string {
  return parsed.toString().replace(/\/$/u, "");
}

function readPublishableKey(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "") {
    throw new WebConfigurationError("SUPABASE_PUBLISHABLE_KEY_REQUIRED");
  }
  if (
    !normalized.startsWith("sb_publishable_")
    || normalized.length <= "sb_publishable_".length
    || normalized.length > 1_024
    || !/^[A-Za-z0-9_-]+$/u.test(normalized)
  ) {
    throw new WebConfigurationError("SUPABASE_PUBLISHABLE_KEY_INVALID");
  }
  return normalized;
}

function readWebOrigin(value: string | undefined): { readonly origin: string; readonly cookiesSecure: boolean } {
  const parsed = parseRootUrl(value, "WEB_ORIGIN");

  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol === "https:") {
    return { cookiesSecure: true, origin: parsed.origin };
  }
  if (parsed.protocol === "http:" && isLocalhost) {
    return { cookiesSecure: false, origin: parsed.origin };
  }
  throw new WebConfigurationError("WEB_ORIGIN_INVALID");
}
