import { URL } from "node:url";

export interface SupabaseAdr010ServerConfig {
  readonly url: string;
  readonly secretKey: string;
  /** Server-only PostgreSQL connection; never a Data API credential. */
  readonly databaseUrl: string;
}

export interface SupabaseAdr010ClientCheckConfig {
  readonly url: string;
  readonly publishableKey: string;
}

export interface SupabaseAdr010Config extends SupabaseAdr010ServerConfig, SupabaseAdr010ClientCheckConfig {}

export interface SupabaseAdr010GateConfig extends SupabaseAdr010Config {
  /** Project ref repeated deliberately to acknowledge destructive spike resets. */
  readonly confirmedIsolatedProjectRef: string;
}

export interface SupabaseAdr010DestructiveServerConfig extends SupabaseAdr010ServerConfig {
  /** Project ref repeated deliberately to acknowledge destructive spike work. */
  readonly confirmedIsolatedProjectRef: string;
}

export const requiredSupabaseServerEnvironmentNames = [
  "ADR010_SUPABASE_URL",
  "ADR010_SUPABASE_SECRET_KEY",
  "ADR010_DATABASE_URL",
] as const;

export const requiredSupabaseClientEnvironmentNames = [
  "ADR010_SUPABASE_URL",
  "ADR010_SUPABASE_PUBLISHABLE_KEY",
] as const;

const legacyServerKeyEnvironmentNames = ["ADR010_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

export class SupabaseAdr010ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SupabaseAdr010ConfigurationError";
  }
}

/**
 * Pure validation only. It intentionally neither constructs a client nor makes
 * a network call, so the normal CI pipeline can execute it safely.
 */
export const readSupabaseAdr010Config = (environment: NodeJS.ProcessEnv): SupabaseAdr010Config => {
  return { ...readSupabaseAdr010ServerConfig(environment), ...readSupabaseAdr010ClientCheckConfig(environment) };
};

export const readSupabaseAdr010ServerConfig = (environment: NodeJS.ProcessEnv): SupabaseAdr010ServerConfig => {
  assertRequiredEnvironment(environment, requiredSupabaseServerEnvironmentNames);
  assertNoLegacyServerKey(environment);
  const url = requireEnvironmentValue(environment, "ADR010_SUPABASE_URL");
  const secretKey = requireEnvironmentValue(environment, "ADR010_SUPABASE_SECRET_KEY");
  const databaseUrl = requireEnvironmentValue(environment, "ADR010_DATABASE_URL");
  validateUrl(url);
  validateModernSecretKey(secretKey);
  validatePostgresUrl(databaseUrl);
  return { url, secretKey, databaseUrl };
};

export const readSupabaseAdr010ClientCheckConfig = (environment: NodeJS.ProcessEnv): SupabaseAdr010ClientCheckConfig => {
  assertRequiredEnvironment(environment, requiredSupabaseClientEnvironmentNames);
  const url = requireEnvironmentValue(environment, "ADR010_SUPABASE_URL");
  const publishableKey = requireEnvironmentValue(environment, "ADR010_SUPABASE_PUBLISHABLE_KEY");
  validateUrl(url);
  validatePublishableKey(publishableKey);
  return { url, publishableKey };
};

const validateUrl = (url: string): void => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new SupabaseAdr010ConfigurationError("ADR010_SUPABASE_URL must be an http(s) URL.");
  }
};

const assertRequiredEnvironment = (environment: NodeJS.ProcessEnv, names: readonly string[]): void => {
  const missing = names.filter((name) => environment[name]?.trim() === "" || environment[name] === undefined);
  if (missing.length > 0) {
    throw new SupabaseAdr010ConfigurationError(`Missing required Supabase ADR-010 configuration: ${missing.join(", ")}.`);
  }
};

const requireEnvironmentValue = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name];
  if (value === undefined || value.trim() === "") {
    throw new SupabaseAdr010ConfigurationError(`Missing required Supabase ADR-010 configuration: ${name}.`);
  }
  return value;
};

const assertNoLegacyServerKey = (environment: NodeJS.ProcessEnv): void => {
  const configuredLegacyNames = legacyServerKeyEnvironmentNames.filter((name) => {
    const value = environment[name];
    return value !== undefined && value.trim() !== "";
  });
  if (configuredLegacyNames.length > 0) {
    throw new SupabaseAdr010ConfigurationError("Legacy Supabase service-role environment variables are not accepted for ADR-010.");
  }
};

const validateModernSecretKey = (secretKey: string): void => {
  if (!secretKey.startsWith("sb_secret_")) {
    throw new SupabaseAdr010ConfigurationError("ADR010_SUPABASE_SECRET_KEY must use a modern Supabase secret key.");
  }
};

const validatePostgresUrl = (databaseUrl: string): void => {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new SupabaseAdr010ConfigurationError("ADR010_DATABASE_URL must be a PostgreSQL connection URL.");
  }
};

const validatePublishableKey = (publishableKey: string): void => {
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new SupabaseAdr010ConfigurationError("ADR010_SUPABASE_PUBLISHABLE_KEY must use a modern Supabase publishable key.");
  }
};

/** Only the explicitly invoked remote runner is allowed to demand credentials. */
export const requireSupabaseIntegrationOptIn = (environment: NodeJS.ProcessEnv): SupabaseAdr010ServerConfig => {
  if (environment.ADR010_RUN_SUPABASE !== "1") {
    throw new SupabaseAdr010ConfigurationError("Remote Supabase integration is disabled. Set ADR010_RUN_SUPABASE=1 only for the isolated spike project.");
  }
  return readSupabaseAdr010ServerConfig(environment);
};

/**
 * The common gates reset only the isolated ADR-010 schema's business rows. A
 * caller must repeat the project ref from the Supabase URL so a copied database
 * URL cannot silently target a different project.
 */
export const requireSupabaseGateIntegrationOptIn = (environment: NodeJS.ProcessEnv): SupabaseAdr010GateConfig => {
  const serverConfig = requireSupabaseDestructiveServerOptIn(environment);
  const clientConfig = readSupabaseAdr010ClientCheckConfig(environment);
  return { ...serverConfig, ...clientConfig };
};

/** Server-only destructive commands use the same exact project guard without requiring a client key. */
export const requireSupabaseDestructiveServerOptIn = (environment: NodeJS.ProcessEnv): SupabaseAdr010DestructiveServerConfig => {
  const config = requireSupabaseIntegrationOptIn(environment);
  const supabaseUrl = new URL(config.url);
  const hostParts = supabaseUrl.hostname.toLowerCase().split(".");
  const projectRef = hostParts.length === 3 && hostParts[1] === "supabase" && hostParts[2] === "co"
    ? hostParts[0]
    : undefined;
  const confirmation = environment.ADR010_CONFIRM_ISOLATED_PROJECT?.trim();
  if (supabaseUrl.protocol !== "https:" || supabaseUrl.port !== "" || supabaseUrl.username !== "" || supabaseUrl.password !== "" ||
      supabaseUrl.pathname !== "/" || projectRef === undefined || !/^[a-z0-9]{20}$/u.test(projectRef) || confirmation !== projectRef) {
    throw new SupabaseAdr010ConfigurationError(
      "ADR010_SUPABASE_URL must be a hosted project URL and ADR010_CONFIRM_ISOLATED_PROJECT must exactly match its project ref.",
    );
  }
  assertDatabaseTargetsProject(config.databaseUrl, projectRef);
  return { ...config, confirmedIsolatedProjectRef: projectRef };
};

const assertDatabaseTargetsProject = (databaseUrl: string, projectRef: string): void => {
  const parsed = new URL(databaseUrl);
  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username).toLowerCase();
  const normalizedProjectRef = projectRef.toLowerCase();
  const isDirect = hostname === `db.${normalizedProjectRef}.supabase.co` && username === "postgres";
  const isPooler = hostname.endsWith(".pooler.supabase.com") && username === `postgres.${normalizedProjectRef}`;
  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
  if ((!isDirect && !isPooler) || parsed.pathname !== "/postgres" ||
      (sslMode !== "require" && sslMode !== "verify-ca" && sslMode !== "verify-full")) {
    throw new SupabaseAdr010ConfigurationError(
      "ADR010_DATABASE_URL does not identify the confirmed Supabase project.",
    );
  }
};
