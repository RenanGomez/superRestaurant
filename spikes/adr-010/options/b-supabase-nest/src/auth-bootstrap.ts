import { randomBytes, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  SupabaseAdr010ClientCheckConfig,
  SupabaseAdr010DestructiveServerConfig,
  SupabaseAdr010GateConfig,
  SupabaseAdr010ServerConfig,
} from "./config.js";

type FixtureKey = "amber" | "cobalt";
type Adr010BBootstrapRunId = string;

export interface Adr010BDisposableUser {
  readonly fixtureKey: FixtureKey;
  readonly userId: string;
  readonly restaurantId: string;
  readonly branchIds: readonly string[];
}

export interface Adr010BAuthBootstrapPlan {
  readonly assignments: readonly {
    readonly fixtureKey: FixtureKey;
    readonly restaurantId: string;
    readonly branchIds: readonly string[];
    readonly role: "cashier";
  }[];
  readonly cleanup: readonly string[];
}

export interface Adr010BAuthenticatedFixture {
  readonly fixtureKey: FixtureKey;
  readonly restaurantId: string;
  readonly branchIds: readonly string[];
  /**
   * Authenticated solely with the publishable key and the disposable user's
   * in-memory session. The server secret is never attached to this client.
   */
  readonly client: SupabaseClient;
}

export interface Adr010BAuthenticatedFixtureContext {
  readonly users: readonly Adr010BAuthenticatedFixture[];
  /** Server-only fixture control used to demonstrate immediate RLS revocation. */
  revokeBranchMembership(fixtureKey: FixtureKey, branchId: string): Promise<void>;
}

const fixtureAssignments = [
  {
    fixtureKey: "amber" as const,
    restaurantId: "00000000-0000-4000-8000-0000000000a1",
    branchIds: ["00000000-0000-4000-8000-0000000000a2", "00000000-0000-4000-8000-0000000000a3"],
    role: "cashier" as const,
  },
  {
    fixtureKey: "cobalt" as const,
    restaurantId: "00000000-0000-4000-8000-0000000000b1",
    branchIds: ["00000000-0000-4000-8000-0000000000b2", "00000000-0000-4000-8000-0000000000b3"],
    role: "cashier" as const,
  },
] as const;

// Stored in Auth app_metadata at creation time so a user remains discoverable
// even if the following private database function never creates its marker.
const authBootstrapMetadataKey = "adr010_b_bootstrap";
const authBootstrapMetadataValue = "v1";

const cleanupSteps = [
  "Call adr010_b_private.adr010_b_cleanup_auth_bootstrap through the private PostgreSQL connection to remove only artifacts and memberships owned by tracked bootstrap users.",
  "Discover marked disposable Auth users through server-only Admin API metadata, then delete them; adr010_b.bootstrap_users is removed by its ON DELETE CASCADE marker.",
  "If a database marker or an Admin API deletion fails, retry cleanup: the Auth metadata marker remains discoverable and no credentials are emitted.",
] as const;

/**
 * The plan contains fixture IDs and cleanup semantics only. It never contains
 * generated emails, passwords, API keys, sessions, or user IDs.
 */
export const adr010BAuthBootstrapPlan = (): Adr010BAuthBootstrapPlan => ({
  assignments: fixtureAssignments.map((assignment) => ({ ...assignment, branchIds: [...assignment.branchIds] })),
  cleanup: [...cleanupSteps],
});

export class Adr010BAuthBootstrapError extends Error {
  public readonly diagnostic?: Readonly<{ code: string; message: string }>;

  public constructor(message: string, cause?: unknown) {
    const diagnostic = summarizeSafePostgresDiagnostic(cause);
    super(diagnostic === undefined ? message : `${message} [PostgreSQL ${diagnostic.code}: ${diagnostic.message}]`);
    this.name = "Adr010BAuthBootstrapError";
    if (diagnostic !== undefined) this.diagnostic = diagnostic;
  }
}

const safePostgresCode = /^[0-9A-Z]{5}$/u;
const unsafeDiagnosticContent = /(?:\b(?:password|token|secret|api[_ -]?key|connection[_ -]?string|query)\b\s*(?:=|:)|postgres(?:ql)?:\/\/|https?:\/\/|bearer\s+)/iu;

/**
 * Keeps only a bounded PostgreSQL code and message; message content that could
 * carry credentials, a connection string, or query text is replaced entirely.
 */
export const summarizeSafePostgresDiagnostic = (cause: unknown): Readonly<{ code: string; message: string }> | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined;
  const candidate = cause as { readonly code?: unknown; readonly message?: unknown };
  if (typeof candidate.code !== "string" || !safePostgresCode.test(candidate.code)) return undefined;
  const message = typeof candidate.message === "string" && !unsafeDiagnosticContent.test(candidate.message)
    ? candidate.message.replace(/[\r\n\t]+/gu, " ").trim().slice(0, 240)
    : "database error details redacted";
  return { code: candidate.code, message: message === "" ? "database error details redacted" : message };
};

/**
 * Private bootstrap functions accept jsonb arrays, while node-postgres
 * serializes JavaScript arrays as PostgreSQL arrays. Keep this conversion
 * explicit so the SQL parameter remains valid jsonb.
 */
export const serializeJsonbArrayParameter = (values: readonly unknown[]): string => JSON.stringify(values);

/** Maps the TypeScript fixture fields to the exact jsonb_to_recordset contract. */
export const toAuthMembershipBootstrapRows = (
  users: readonly { readonly fixtureKey: string; readonly userId: string; readonly bootstrapRunId: string }[],
): readonly { readonly fixture_key: string; readonly user_id: string; readonly bootstrap_run_id: string }[] => users.map((user) => ({
  fixture_key: user.fixtureKey,
  user_id: user.userId,
  bootstrap_run_id: user.bootstrapRunId,
}));

/**
 * Creates exactly two disposable Auth users through the server-only Admin API,
 * then atomically attaches their deterministic memberships through a dedicated
 * server-only PostgreSQL function. Generated credentials stay in this function's stack and are
 * intentionally neither returned nor logged.
 *
 * This is remote setup evidence only. It does not validate a Nest principal,
 * derive actorId, or prove the ADR-010 Auth/scope gate.
 */
export const bootstrapAdr010BAuth = async (config: SupabaseAdr010DestructiveServerConfig): Promise<readonly Adr010BDisposableUser[]> => {
  const client = createServerOnlyClient(config);
  const database = createPrivateDatabaseClient(config);
  const bootstrapRunId = randomUUID();
  let created: readonly Adr010BCreatedUser[] = [];
  try {
    created = await createDisposableUsers(client, bootstrapRunId);
    await attachDeterministicMemberships(database, created);
    return created.map(toDisposableUser);
  } catch (error) {
    const cleanupCompleted = await cleanupAfterFailedBootstrap(client, database, bootstrapRunId, created.map((user) => user.userId));
    if (!cleanupCompleted) {
      throw new Adr010BAuthBootstrapError("ADR-010 Auth bootstrap failed and automatic cleanup was incomplete; rerun the explicit cleanup command safely.");
    }
    if (error instanceof Adr010BAuthBootstrapError) throw error;
    throw new Adr010BAuthBootstrapError("ADR-010 Auth bootstrap failed without exposing credentials or server configuration.");
  } finally {
    await database.end();
  }
};

/**
 * Runs a callback with two real publishable-key Auth sessions. Emails,
 * passwords and session tokens remain in this call stack and are never
 * returned, logged or persisted. All tracked Auth and database evidence is
 * cleaned in a finally block, even when login or the callback fails.
 */
export const withAdr010BAuthenticatedFixtures = async <Result>(
  config: SupabaseAdr010GateConfig,
  callback: (context: Adr010BAuthenticatedFixtureContext) => Promise<Result>,
): Promise<Result> => {
  const serverClient = createServerOnlyClient(config);
  const database = createPrivateDatabaseClient(config);
  const bootstrapRunId = randomUUID();
  let created: readonly Adr010BCreatedUser[] = [];
  // A user may be created just before the Admin API call that returns the
  // complete list fails. Always attempt and surface cleanup in that case too.
  try {
    created = await createDisposableUsers(serverClient, bootstrapRunId);
    await attachDeterministicMemberships(database, created);
    const users = await Promise.all(created.map((user) => authenticateDisposableUser(config, user)));
    return await callback({
      users,
      revokeBranchMembership: async (fixtureKey, branchId) => {
        const target = created.find((user) => user.fixtureKey === fixtureKey);
        if (target === undefined || !target.branchIds.includes(branchId)) {
          throw new Adr010BAuthBootstrapError("ADR-010 RLS probe requested an invalid disposable membership revocation.");
        }
        await revokeTrackedBranchMembership(database, target.userId, branchId);
      },
    });
  } catch (error) {
    if (error instanceof Adr010BAuthBootstrapError) throw error;
    throw new Adr010BAuthBootstrapError("ADR-010 authenticated fixture setup failed without exposing credentials or server configuration.");
  } finally {
    try {
      await cleanupTrackedAndMarkedAuthUsers(serverClient, database, bootstrapRunId, created.map((user) => user.userId));
    } catch {
      // The outer error remains deliberately non-sensitive. The tracked marker
      // and Auth metadata make the documented explicit cleanup retryable.
      throw new Adr010BAuthBootstrapError("ADR-010 authenticated fixture cleanup was incomplete; rerun the explicit cleanup command safely.");
    } finally {
      await database.end();
    }
  }
};

/**
 * Deletes only tracked bootstrap evidence before deleting the matching Auth
 * users. Historical tables retain ON DELETE RESTRICT; cleanup must remove their
 * dependent rows first. This call is safe to retry after a partial Admin API
 * failure because the tracking marker is removed only by Auth-user deletion.
 */
export const cleanupAdr010BAuthBootstrap = async (config: SupabaseAdr010DestructiveServerConfig): Promise<void> => {
  const client = createServerOnlyClient(config);
  const database = createPrivateDatabaseClient(config);
  try {
    const markedUsers = await discoverMarkedAuthUsers(client);
    const usersByRun = new Map<Adr010BBootstrapRunId, string[]>();
    for (const user of markedUsers) {
      const current = usersByRun.get(user.bootstrapRunId) ?? [];
      current.push(user.userId);
      usersByRun.set(user.bootstrapRunId, current);
    }
    for (const [bootstrapRunId, userIds] of usersByRun) {
      await cleanupTrackedAndMarkedAuthUsers(client, database, bootstrapRunId, userIds);
    }
  } finally {
    await database.end();
  }
};

const createServerOnlyClient = (config: SupabaseAdr010ServerConfig): SupabaseClient =>
  createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

const createPrivateDatabaseClient = (config: SupabaseAdr010ServerConfig): Pool => new Pool({ connectionString: config.databaseUrl });

type Adr010BCreatedUser = Adr010BDisposableUser & {
  readonly bootstrapRunId: Adr010BBootstrapRunId;
  readonly credentials: { readonly email: string; readonly password: string };
};

const createDisposableUsers = async (client: SupabaseClient, bootstrapRunId: Adr010BBootstrapRunId): Promise<readonly Adr010BCreatedUser[]> => {
  const created: Adr010BCreatedUser[] = [];
  for (const assignment of fixtureAssignments) {
    const credentials = makeDisposableCredentials(assignment.fixtureKey);
    const { data, error } = await client.auth.admin.createUser({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true,
      app_metadata: {
        [authBootstrapMetadataKey]: authBootstrapMetadataValue,
        fixture_key: assignment.fixtureKey,
        bootstrap_run_id: bootstrapRunId,
      },
    });
    if (error !== null || data.user === null) {
      throw new Adr010BAuthBootstrapError("Supabase Admin API could not create a disposable ADR-010 Auth user.");
    }
    created.push({
      fixtureKey: assignment.fixtureKey,
      userId: data.user.id,
      bootstrapRunId,
      restaurantId: assignment.restaurantId,
      branchIds: [...assignment.branchIds],
      credentials,
    });
  }
  return created;
};

const toDisposableUser = (user: Adr010BCreatedUser): Adr010BDisposableUser => ({
  fixtureKey: user.fixtureKey,
  userId: user.userId,
  restaurantId: user.restaurantId,
  branchIds: user.branchIds,
});

const authenticateDisposableUser = async (
  config: SupabaseAdr010ClientCheckConfig,
  user: Adr010BCreatedUser,
): Promise<Adr010BAuthenticatedFixture> => {
  const client = createClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword(user.credentials);
  if (error !== null || data.session === null || data.user?.id !== user.userId) {
    throw new Adr010BAuthBootstrapError("Supabase could not create an authenticated disposable RLS probe session.");
  }
  return {
    fixtureKey: user.fixtureKey,
    restaurantId: user.restaurantId,
    branchIds: [...user.branchIds],
    client,
  };
};

const makeDisposableCredentials = (fixtureKey: FixtureKey): { readonly email: string; readonly password: string } => ({
  email: `adr010-b-${fixtureKey}-${randomUUID()}@example.invalid`,
  password: randomBytes(32).toString("base64url"),
});

const attachDeterministicMemberships = async (database: Pool, users: readonly Adr010BCreatedUser[]): Promise<void> => {
  try {
    await database.query(
      "select adr010_b_private.adr010_b_bootstrap_auth_memberships($1::jsonb)",
      [serializeJsonbArrayParameter(toAuthMembershipBootstrapRows(users))],
    );
  } catch (error) {
    throw new Adr010BAuthBootstrapError("Supabase could not attach deterministic ADR-010 memberships.", error);
  }
};

const revokeTrackedBranchMembership = async (database: Pool, userId: string, branchId: string): Promise<void> => {
  const result = await database.query<{ readonly revoked: boolean }>(
    "select adr010_b_private.adr010_b_revoke_bootstrap_membership($1::uuid, $2::uuid) as revoked",
    [userId, branchId],
  );
  if (result.rows[0]?.revoked !== true) {
    throw new Adr010BAuthBootstrapError("Supabase could not revoke the tracked disposable membership for the RLS probe.");
  }
};

const removeTrackedBootstrapEvidence = async (database: Pool, candidateUserIds: readonly string[]): Promise<readonly string[]> => {
  const result = await database.query<{ readonly user_ids: unknown }>(
    "select adr010_b_private.adr010_b_cleanup_auth_bootstrap($1::jsonb) as user_ids",
    [serializeJsonbArrayParameter(candidateUserIds)],
  );
  const trackedUserIds = result.rows[0]?.user_ids;
  if (!Array.isArray(trackedUserIds) || !trackedUserIds.every((value) => typeof value === "string")) {
    throw new Adr010BAuthBootstrapError("Supabase returned an invalid ADR-010 bootstrap cleanup plan.");
  }
  return trackedUserIds;
};

const discoverMarkedAuthUsers = async (client: SupabaseClient, bootstrapRunId?: Adr010BBootstrapRunId): Promise<readonly { readonly userId: string; readonly bootstrapRunId: Adr010BBootstrapRunId }[]> => {
  const users: { userId: string; bootstrapRunId: Adr010BBootstrapRunId }[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error !== null) throw new Adr010BAuthBootstrapError("Supabase could not discover marked disposable Auth users for cleanup.");
    for (const user of data.users) {
      if (user.app_metadata?.[authBootstrapMetadataKey] !== authBootstrapMetadataValue) continue;
      const markedRunId = user.app_metadata.bootstrap_run_id;
      if (typeof markedRunId !== "string" || markedRunId.trim() === "") {
        throw new Adr010BAuthBootstrapError("Supabase returned an invalid ADR-010 bootstrap marker.");
      }
      if (bootstrapRunId === undefined || markedRunId === bootstrapRunId) users.push({ userId: user.id, bootstrapRunId: markedRunId });
    }
    if (data.users.length < 1000) return users;
  }
  throw new Adr010BAuthBootstrapError("Supabase returned too many Auth users while discovering disposable ADR-010 bootstrap users.");
};

const cleanupTrackedAndMarkedAuthUsers = async (
  client: SupabaseClient,
  database: Pool,
  bootstrapRunId: Adr010BBootstrapRunId,
  knownUserIds: readonly string[],
): Promise<void> => {
  const markedUsers = await discoverMarkedAuthUsers(client, bootstrapRunId);
  const candidateUserIds = [...new Set([...knownUserIds, ...markedUsers.map((user) => user.userId)])];
  const trackedUserIds = await removeTrackedBootstrapEvidence(database, candidateUserIds);
  await deleteAuthUsers(client, [...new Set([...candidateUserIds, ...trackedUserIds])]);
};

const deleteAuthUsers = async (client: SupabaseClient, userIds: readonly string[]): Promise<void> => {
  const failures: string[] = [];
  for (const userId of userIds) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error !== null) failures.push(userId);
  }
  if (failures.length > 0) {
    throw new Adr010BAuthBootstrapError("One or more disposable Auth users could not be deleted; rerun cleanup to retry safely.");
  }
};

const cleanupAfterFailedBootstrap = async (
  client: SupabaseClient,
  database: Pool,
  bootstrapRunId: Adr010BBootstrapRunId,
  knownUserIds: readonly string[],
): Promise<boolean> => {
  try {
    await cleanupTrackedAndMarkedAuthUsers(client, database, bootstrapRunId, knownUserIds);
    return true;
  } catch {
    // Metadata on the Auth user makes the explicit cleanup retryable even when
    // membership attachment failed before the database marker existed.
    return false;
  }
};
