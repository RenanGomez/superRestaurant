import { URL } from "node:url";

export interface SupabaseDirectReadConfig {
  readonly url: string;
  readonly publishableKey: string;
}

export const requiredSupabaseDirectReadEnvironmentNames = [
  "ADR010_SUPABASE_URL",
  "ADR010_SUPABASE_PUBLISHABLE_KEY",
] as const;

export class SupabaseDirectReadConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SupabaseDirectReadConfigurationError";
  }
}

/** Public-client configuration. Server/database credentials are not part of this boundary. */
export const readSupabaseDirectReadConfig = (environment: NodeJS.ProcessEnv): SupabaseDirectReadConfig => {
  const missing = requiredSupabaseDirectReadEnvironmentNames.filter(
    (name) => environment[name] === undefined || environment[name]?.trim() === "",
  );
  if (missing.length > 0) {
    throw new SupabaseDirectReadConfigurationError(
      `Missing required option-C public configuration: ${missing.join(", ")}.`,
    );
  }

  const url = environment.ADR010_SUPABASE_URL as string;
  const publishableKey = environment.ADR010_SUPABASE_PUBLISHABLE_KEY as string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
  } catch {
    throw new SupabaseDirectReadConfigurationError("ADR010_SUPABASE_URL must be an http(s) URL.");
  }
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new SupabaseDirectReadConfigurationError(
      "ADR010_SUPABASE_PUBLISHABLE_KEY must be a modern sb_publishable_ key; secret and legacy JWT keys are forbidden.",
    );
  }
  return { url, publishableKey };
};

export const requireSupabaseDirectReadOptIn = (environment: NodeJS.ProcessEnv): SupabaseDirectReadConfig => {
  if (environment.ADR010_RUN_SUPABASE !== "1") {
    throw new SupabaseDirectReadConfigurationError(
      "Remote option-C read probe is disabled. Set ADR010_RUN_SUPABASE=1 only for the isolated spike project.",
    );
  }
  return readSupabaseDirectReadConfig(environment);
};
