/**
 * Public runtime configuration for the mobile client.
 *
 * Expo inlines only `EXPO_PUBLIC_*` variables into the bundle, so this module
 * accepts nothing else. Validation is fail-closed: a missing, malformed or
 * privileged value throws instead of degrading to a default, because a POS
 * device must never talk to an unintended origin or hold a server key.
 */
export interface MobileConfig {
  /** Origin of the Nest API. Every business call goes through it. */
  readonly apiBaseUrl: string;
  /** Supabase *publishable* key. Secret/service-role keys are rejected. */
  readonly supabasePublishableKey: string;
  /** Supabase project origin used for Auth only. */
  readonly supabaseUrl: string;
}

const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";
const FORBIDDEN_KEY_MARKERS = Object.freeze(["sb_secret_", "service_role", "secret"]);

export function readMobileConfig(environment: Readonly<Record<string, string | undefined>>): MobileConfig {
  const supabaseUrl = strictHttps(environment.EXPO_PUBLIC_SUPABASE_URL);
  const apiBaseUrl = apiOrigin(environment.EXPO_PUBLIC_API_BASE_URL);
  const supabasePublishableKey = publishableKey(environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return Object.freeze({ apiBaseUrl, supabasePublishableKey, supabaseUrl });
}

/** Supabase Auth is always reached over TLS, at an origin with no credentials or path. */
function strictHttps(value: string | undefined): string {
  const parsed = parseUrl(value);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== ""
    || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") throw invalid();
  return parsed.origin;
}

/**
 * The API origin is TLS-only, except for loopback development hosts. A device
 * on a shared network never gets a plaintext remote origin from configuration.
 */
function apiOrigin(value: string | undefined): string {
  const parsed = parseUrl(value);
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if ((parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:"))
    || parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/"
    || parsed.search !== "" || parsed.hash !== "") throw invalid();
  return parsed.origin;
}

/**
 * Only a Supabase publishable key may ship inside a client bundle. Anything
 * shaped like a secret, a service-role key or a signed JWT is refused, even if
 * it also carries the publishable prefix.
 */
function publishableKey(value: string | undefined): string {
  const key = bounded(value, 2_048);
  if (key === undefined) throw invalid();
  const lowered = key.toLowerCase();
  // Rejected first, so a privileged key is refused on its own evidence and not
  // merely because it fails the publishable prefix check below.
  if (key.startsWith("eyJ") || FORBIDDEN_KEY_MARKERS.some((marker) => lowered.includes(marker))) throw invalid();
  if (!key.startsWith(PUBLISHABLE_KEY_PREFIX) || key.length === PUBLISHABLE_KEY_PREFIX.length) throw invalid();
  return key;
}

function parseUrl(value: string | undefined): URL {
  const boundedValue = bounded(value, 2_048);
  if (boundedValue === undefined) throw invalid();
  try { return new URL(boundedValue); } catch { throw invalid(); }
}

function bounded(value: string | undefined, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim()
    ? value : undefined;
}

function invalid(): Error {
  return new Error("MOBILE_CONFIGURATION_INVALID");
}
