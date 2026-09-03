export interface KdsConfig {
  readonly apiBaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly supabaseUrl: string;
}

export function readKdsConfig(environment: Readonly<Record<string, string | undefined>>): KdsConfig {
  const supabaseUrl = strictHttps(environment.VITE_SUPABASE_URL);
  const apiBaseUrl = apiOrigin(environment.VITE_API_BASE_URL);
  const supabasePublishableKey = bounded(environment.VITE_SUPABASE_PUBLISHABLE_KEY, 2_048);
  if (supabasePublishableKey === undefined || !supabasePublishableKey.startsWith("sb_publishable_")) {
    throw new Error("KDS_CONFIGURATION_INVALID");
  }
  return Object.freeze({ apiBaseUrl, supabasePublishableKey, supabaseUrl });
}

function strictHttps(value: string | undefined): string {
  const parsed = parseUrl(value);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== ""
    || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") throw new Error("KDS_CONFIGURATION_INVALID");
  return parsed.origin;
}

function apiOrigin(value: string | undefined): string {
  const parsed = parseUrl(value);
  const localhost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if ((parsed.protocol !== "https:" && !(localhost && parsed.protocol === "http:"))
    || parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/"
    || parsed.search !== "" || parsed.hash !== "") throw new Error("KDS_CONFIGURATION_INVALID");
  return parsed.origin;
}

function parseUrl(value: string | undefined): URL {
  const boundedValue = bounded(value, 2_048);
  if (boundedValue === undefined) throw new Error("KDS_CONFIGURATION_INVALID");
  try { return new URL(boundedValue); } catch { throw new Error("KDS_CONFIGURATION_INVALID"); }
}

function bounded(value: string | undefined, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim()
    ? value : undefined;
}
