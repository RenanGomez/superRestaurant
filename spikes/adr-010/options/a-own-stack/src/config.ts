import { URL } from "node:url";

export interface OwnStackAdr010ServerConfig {
  readonly databaseUrl: string;
}

export class OwnStackAdr010ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OwnStackAdr010ConfigurationError";
  }
}

/** Pure validation; importing the option never opens a database connection. */
export const readOwnStackAdr010ServerConfig = (environment: NodeJS.ProcessEnv): OwnStackAdr010ServerConfig => {
  const databaseUrl = environment.ADR010_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new OwnStackAdr010ConfigurationError("Missing required server-only configuration: ADR010_DATABASE_URL.");
  }
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("unsupported protocol");
  } catch {
    throw new OwnStackAdr010ConfigurationError("ADR010_DATABASE_URL must be a postgres(s) connection URL.");
  }
  return { databaseUrl };
};

/** The integration runner is deliberately inert unless the isolated database is explicitly selected. */
export const requireOwnStackIntegrationOptIn = (environment: NodeJS.ProcessEnv): OwnStackAdr010ServerConfig => {
  if (environment.ADR010_RUN_OPTION_A !== "1") {
    throw new OwnStackAdr010ConfigurationError(
      "Option-A integration is disabled. Set ADR010_RUN_OPTION_A=1 only for the isolated ADR-010 PostgreSQL database.",
    );
  }
  return readOwnStackAdr010ServerConfig(environment);
};
