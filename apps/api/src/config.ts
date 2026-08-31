export interface ApiConfig {
  readonly port: number;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
}

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
