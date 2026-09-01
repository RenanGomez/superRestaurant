import { createClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";

import type { DatabaseConfig } from "../database.js";
import {
  tenancyAuthMetadataMarker,
  tenancyAuthMetadataVersion,
  tenancyBranchSuffixes,
  tenancyCanarySuffixes,
  tenancyDiningZoneSuffixes,
  tenancyFixtureAdvisoryLockKey,
  tenancyFixtureEmail,
  tenancyFixtureKeys,
  tenancyFixtureName,
  tenancyMainRestaurantSuffixes,
  type TenancyFixtureKey,
} from "./tenancy-fixture-markers.js";
import {
  TenancyFixtureRecoveryError,
  type TenancyFixtureRecoveryConfig,
} from "./tenancy-fixture-recovery-config.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_AUTH_PAGES = 100;
const AUTH_PAGE_SIZE = 1_000;

export interface RecoveryAuthUser {
  readonly email: string;
  readonly fixtureKey: string;
  readonly id: string;
}

export interface TenancyFixtureRecoveryAuthPort {
  deleteUser(userId: string): Promise<boolean>;
  discoverUsers(runId: string): Promise<readonly RecoveryAuthUser[]>;
  readUser(runId: string, userId: string): Promise<RecoveryAuthUser | undefined>;
}

export interface TenancyFixtureRecoveryDatabasePort {
  assertZero(runId: string, userIds: readonly string[]): Promise<void>;
  close(): Promise<void>;
  deleteVerified(runId: string, users: readonly RecoveryAuthUser[]): Promise<number>;
}

export interface TenancyFixtureRecoveryDependencies {
  readonly auth: TenancyFixtureRecoveryAuthPort;
  readonly database: TenancyFixtureRecoveryDatabasePort;
}

export interface TenancyFixtureRecoverySummary {
  readonly fixtureRowsRemoved: number;
  readonly fixtureUsersRemoved: number;
  readonly runId: string;
  readonly status: "ok";
}

interface RestaurantRow {
  readonly disabledAt: string | null;
  readonly disabledBy: string | null;
  readonly disabledReason: string | null;
  readonly id: string;
  readonly name: string;
  readonly version: number;
}

interface BranchRow {
  readonly disabledAt: string | null;
  readonly disabledBy: string | null;
  readonly disabledReason: string | null;
  readonly id: string;
  readonly name: string;
  readonly restaurantId: string;
  readonly version: number;
}

interface MembershipRow {
  readonly branchId: string;
  readonly grantedBy: string;
  readonly id: string;
  readonly restaurantId: string;
  readonly revocationReason: string | null;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly userId: string;
}

interface GrantRow {
  readonly grantedBy: string;
  readonly id: string;
  readonly membershipId: string;
  readonly revocationReason: string | null;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly roleCode: string;
}

interface DiningZoneRow {
  readonly branchId: string;
  readonly createdBy: string;
  readonly id: string;
  readonly name: string;
  readonly restaurantId: string;
  readonly version: number;
}

interface DiningZoneAuditRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly name: string;
  readonly operation: string;
  readonly restaurantId: string;
  readonly zoneId: string;
}

export interface TenancyFixtureRecoverySnapshot {
  readonly branches: readonly BranchRow[];
  readonly diningZoneAudits?: readonly DiningZoneAuditRow[];
  readonly diningZones?: readonly DiningZoneRow[];
  readonly grants: readonly GrantRow[];
  readonly memberships: readonly MembershipRow[];
  readonly restaurants: readonly RestaurantRow[];
}

interface ValidatedSnapshot {
  readonly branchIds: readonly string[];
  readonly diningZoneEventIds: readonly string[];
  readonly diningZoneIds: readonly string[];
  readonly grantIds: readonly string[];
  readonly membershipIds: readonly string[];
  readonly restaurantIds: readonly string[];
}

export async function recoverTenancyFixtures(
  runId: string,
  dependencies: TenancyFixtureRecoveryDependencies,
): Promise<TenancyFixtureRecoverySummary> {
  let users: readonly RecoveryAuthUser[];
  try {
    users = validateAuthUsers(runId, await dependencies.auth.discoverUsers(runId));
  } catch (error: unknown) {
    if (error instanceof TenancyFixtureRecoveryError) throw error;
    throw recoveryError("discovery", "TENANCY_FIXTURE_RECOVERY_DISCOVERY_FAILED");
  }

  let fixtureRowsRemoved: number;
  for (const user of users) {
    await assertAuthUserUnchanged(runId, user, dependencies.auth, "discovery");
  }
  try {
    fixtureRowsRemoved = await dependencies.database.deleteVerified(runId, users);
  } catch (error: unknown) {
    if (error instanceof TenancyFixtureRecoveryError) throw error;
    throw recoveryError("database", "TENANCY_FIXTURE_RECOVERY_DATABASE_FAILED");
  }

  let fixtureUsersRemoved = 0;
  for (const user of users) {
    await assertAuthUserUnchanged(runId, user, dependencies.auth, "auth");
    let deleted = false;
    try {
      deleted = await dependencies.auth.deleteUser(user.id);
    } catch {
      throw recoveryError("auth", "TENANCY_FIXTURE_RECOVERY_AUTH_FAILED");
    }
    if (!deleted) throw recoveryError("auth", "TENANCY_FIXTURE_RECOVERY_AUTH_FAILED");
    fixtureUsersRemoved += 1;
  }

  try {
    const residualUsers = validateAuthUsers(runId, await dependencies.auth.discoverUsers(runId));
    if (residualUsers.length !== 0) {
      throw recoveryError("postcheck", "TENANCY_FIXTURE_RECOVERY_POSTCHECK_FAILED");
    }
    await dependencies.database.assertZero(runId, users.map((user) => user.id));
  } catch (error: unknown) {
    if (error instanceof TenancyFixtureRecoveryError) throw error;
    throw recoveryError("postcheck", "TENANCY_FIXTURE_RECOVERY_POSTCHECK_FAILED");
  }

  return Object.freeze({ fixtureRowsRemoved, fixtureUsersRemoved, runId, status: "ok" });
}

export async function executeTenancyFixtureRecovery(
  config: TenancyFixtureRecoveryConfig,
): Promise<TenancyFixtureRecoverySummary> {
  const database = new PostgresTenancyFixtureRecoveryStore(config.adminDatabase);
  const auth = createAuthPort(config.supabaseUrl, config.secretKey);
  try {
    return await recoverTenancyFixtures(config.runId, { auth, database });
  } finally {
    try {
      await database.close();
    } catch {
      // The CLI output remains allowlisted; a completed postcheck is authoritative.
    }
  }
}

export function validateTenancyFixtureRecoverySnapshot(
  runId: string,
  users: readonly RecoveryAuthUser[],
  snapshot: TenancyFixtureRecoverySnapshot,
): ValidatedSnapshot {
  const validatedUsers = validateAuthUsers(runId, users);
  const usersByKey = new Map(validatedUsers.map((user) => [user.fixtureKey, user]));
  const expectedMainNames = tenancyMainRestaurantSuffixes.map((suffix) => tenancyFixtureName(runId, suffix));
  const expectedCanaryNames = tenancyCanarySuffixes.map((suffix) => tenancyFixtureName(runId, suffix));
  const allowedRestaurantNames = new Set([...expectedMainNames, ...expectedCanaryNames]);
  assertUniqueIds(snapshot.restaurants);
  assertUniqueValues(snapshot.restaurants.map((row) => row.name));
  if (snapshot.restaurants.some((row) =>
    !allowedRestaurantNames.has(row.name)
    || row.version !== 1
  )) {
    throw contaminationError();
  }

  const restaurantsByName = new Map(snapshot.restaurants.map((row) => [row.name, row]));
  const mainCount = expectedMainNames.filter((name) => restaurantsByName.has(name)).length;
  const hasMainGraph = snapshot.restaurants.length > 0
    || snapshot.branches.length > 0
    || snapshot.memberships.length > 0
    || snapshot.grants.length > 0
    || (snapshot.diningZones?.length ?? 0) > 0
    || (snapshot.diningZoneAudits?.length ?? 0) > 0;
  if (hasMainGraph && mainCount !== expectedMainNames.length) throw contaminationError();

  if (!hasMainGraph) {
    if (snapshot.branches.length !== 0 || snapshot.memberships.length !== 0 || snapshot.grants.length !== 0) {
      throw contaminationError();
    }
    return Object.freeze({
      branchIds: Object.freeze([]),
      diningZoneEventIds: Object.freeze([]),
      diningZoneIds: Object.freeze([]),
      grantIds: Object.freeze([]),
      membershipIds: Object.freeze([]),
      restaurantIds: Object.freeze(snapshot.restaurants.map((row) => row.id)),
    });
  }

  const amber = usersByKey.get("amber");
  const cobalt = usersByKey.get("cobalt");
  if (validatedUsers.length !== 2 || amber === undefined || cobalt === undefined) throw contaminationError();
  const firstRestaurant = restaurantsByName.get(tenancyFixtureName(runId, "restaurant-1"));
  const secondRestaurant = restaurantsByName.get(tenancyFixtureName(runId, "restaurant-2"));
  if (firstRestaurant === undefined || secondRestaurant === undefined) throw contaminationError();

  if (!isActiveRestaurant(firstRestaurant)) throw contaminationError();
  if (!isActiveRestaurant(secondRestaurant) && !isVerificationDisabled(secondRestaurant, cobalt.id)) {
    throw contaminationError();
  }
  for (const canaryName of expectedCanaryNames) {
    const canary = restaurantsByName.get(canaryName);
    if (canary !== undefined && !isActiveRestaurant(canary)) throw contaminationError();
  }

  validateBranches(runId, snapshot.branches, firstRestaurant.id, secondRestaurant.id, cobalt.id);
  const branchesByName = new Map(snapshot.branches.map((row) => [row.name, row]));
  const branch21 = branchesByName.get(tenancyFixtureName(runId, "branch-21"));
  if (branch21 === undefined || (!isActiveRestaurant(secondRestaurant) && !isVerificationDisabled(branch21, cobalt.id))) {
    throw contaminationError();
  }
  const membershipLabels = validateMemberships(
    snapshot.memberships,
    amber,
    cobalt,
    firstRestaurant.id,
    secondRestaurant.id,
    branchesByName,
    runId,
  );
  validateGrants(snapshot.grants, membershipLabels, amber.id);
  validateCrossEntityRevocationPrefix(snapshot.memberships, snapshot.grants, membershipLabels, amber.id);
  const dining = validateDiningZones(
    runId,
    snapshot.diningZones ?? [],
    snapshot.diningZoneAudits ?? [],
    amber.id,
    firstRestaurant.id,
    branchesByName,
  );

  return Object.freeze({
    branchIds: Object.freeze(snapshot.branches.map((row) => row.id)),
    diningZoneEventIds: dining.eventIds,
    diningZoneIds: dining.zoneIds,
    grantIds: Object.freeze(snapshot.grants.map((row) => row.id)),
    membershipIds: Object.freeze(snapshot.memberships.map((row) => row.id)),
    restaurantIds: Object.freeze(snapshot.restaurants.map((row) => row.id)),
  });
}

class PostgresTenancyFixtureRecoveryStore implements TenancyFixtureRecoveryDatabasePort {
  readonly #pool: Pool;

  public constructor(config: DatabaseConfig) {
    this.#pool = new Pool({
      application_name: "super-restaurant-tenancy-recovery",
      connectionTimeoutMillis: 5_000,
      connectionString: config.connectionString,
      idleTimeoutMillis: 5_000,
      max: 1,
      query_timeout: 10_000,
      ssl: { ca: config.caCertificate, rejectUnauthorized: true },
      statement_timeout: 10_000,
    });
  }

  public async deleteVerified(runId: string, users: readonly RecoveryAuthUser[]): Promise<number> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0)) as acquired",
        [tenancyFixtureAdvisoryLockKey(runId)],
      );
      if (lock.rows[0]?.acquired !== true) {
        throw recoveryError("database", "TENANCY_FIXTURE_RECOVERY_RUN_ACTIVE");
      }
      const snapshot = await loadSnapshot(client, runId, users.map((user) => user.id), true);
      const validated = validateTenancyFixtureRecoverySnapshot(runId, users, snapshot);
      let removed = 0;
      removed += await deleteExactly(
        client,
        "app.dining_zone_audit_events",
        validated.diningZoneEventIds,
        "event_id",
      );
      removed += await deleteExactly(client, "app.dining_zones", validated.diningZoneIds);
      removed += await deleteExactly(client, "app.membership_role_grants", validated.grantIds);
      removed += await deleteExactly(client, "app.memberships", validated.membershipIds);
      removed += await deleteExactly(client, "app.branches", validated.branchIds);
      removed += await deleteExactly(client, "app.restaurants", validated.restaurantIds);
      await client.query("COMMIT");
      return removed;
    } catch (error: unknown) {
      await rollbackQuietly(client);
      if (error instanceof TenancyFixtureRecoveryError) throw error;
      throw recoveryError("database", "TENANCY_FIXTURE_RECOVERY_DATABASE_FAILED");
    } finally {
      client.release();
    }
  }

  public async assertZero(runId: string, userIds: readonly string[]): Promise<void> {
    const client = await this.#pool.connect();
    try {
      const snapshot = await loadSnapshot(client, runId, userIds, false);
      if (
        snapshot.restaurants.length !== 0
        || snapshot.branches.length !== 0
        || snapshot.memberships.length !== 0
        || snapshot.grants.length !== 0
        || (snapshot.diningZones?.length ?? 0) !== 0
        || (snapshot.diningZoneAudits?.length ?? 0) !== 0
      ) {
        throw recoveryError("postcheck", "TENANCY_FIXTURE_RECOVERY_POSTCHECK_FAILED");
      }
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.#pool.end();
  }
}

async function loadSnapshot(
  client: PoolClient,
  runId: string,
  userIds: readonly string[],
  lockRows: boolean,
): Promise<TenancyFixtureRecoverySnapshot> {
  const restaurantNames = [
    ...tenancyMainRestaurantSuffixes.map((suffix) => tenancyFixtureName(runId, suffix)),
    ...tenancyCanarySuffixes.map((suffix) => tenancyFixtureName(runId, suffix)),
  ];
  const branchNames = tenancyBranchSuffixes.map((suffix) => tenancyFixtureName(runId, suffix));
  const lock = lockRows ? " for update" : "";
  const restaurants = await client.query<RestaurantRow>(
    `select id::text, name, version::integer, disabled_at::text as "disabledAt",
            disabled_by::text as "disabledBy", disabled_reason as "disabledReason"
     from app.restaurants where name = any($1::text[])${lock}`,
    [restaurantNames],
  );
  const restaurantIds = restaurants.rows.map((row) => row.id);
  const branches = await client.query<BranchRow>(
    `select id::text, restaurant_id::text as "restaurantId", name, version::integer,
            disabled_at::text as "disabledAt", disabled_by::text as "disabledBy",
            disabled_reason as "disabledReason"
     from app.branches
     where name = any($1::text[]) or restaurant_id = any($2::uuid[])${lock}`,
    [branchNames, restaurantIds],
  );
  const branchIds = branches.rows.map((row) => row.id);
  const memberships = await client.query<MembershipRow>(
    `select id::text, user_id::text as "userId", restaurant_id::text as "restaurantId",
            branch_id::text as "branchId", granted_by::text as "grantedBy",
            revoked_at::text as "revokedAt", revoked_by::text as "revokedBy",
            revocation_reason as "revocationReason"
     from app.memberships
     where user_id = any($1::uuid[]) or granted_by = any($1::uuid[]) or revoked_by = any($1::uuid[])
        or restaurant_id = any($2::uuid[]) or branch_id = any($3::uuid[])${lock}`,
    [userIds, restaurantIds, branchIds],
  );
  const membershipIds = memberships.rows.map((row) => row.id);
  const grants = await client.query<GrantRow>(
    `select id::text, membership_id::text as "membershipId", role_code as "roleCode",
            granted_by::text as "grantedBy", revoked_at::text as "revokedAt",
            revoked_by::text as "revokedBy", revocation_reason as "revocationReason"
     from app.membership_role_grants
     where membership_id = any($1::uuid[]) or granted_by = any($2::uuid[]) or revoked_by = any($2::uuid[])${lock}`,
    [membershipIds, userIds],
  );
  const diningTables = await client.query<{ audits: boolean; zones: boolean }>(
    `select
       pg_catalog.to_regclass('app.dining_zone_audit_events') is not null as audits,
       pg_catalog.to_regclass('app.dining_zones') is not null as zones`,
  );
  if (diningTables.rows[0]?.audits !== diningTables.rows[0]?.zones) throw contaminationError();
  let diningZones: readonly DiningZoneRow[] = [];
  let diningZoneAudits: readonly DiningZoneAuditRow[] = [];
  if (diningTables.rows[0]?.zones === true) {
    const diningNames = tenancyDiningZoneSuffixes.map((suffix) => tenancyFixtureName(runId, suffix));
    const zones = await client.query<DiningZoneRow>(
      `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId",
              name, version::integer, created_by::text as "createdBy"
       from app.dining_zones
       where name = any($1::text[]) or restaurant_id = any($2::uuid[]) or created_by = any($3::uuid[])${lock}`,
      [diningNames, restaurantIds, userIds],
    );
    diningZones = Object.freeze([...zones.rows]);
    const zoneIds = diningZones.map((row) => row.id);
    const audits = await client.query<DiningZoneAuditRow>(
      `select event_id::text as "eventId", idempotency_key::text as "idempotencyKey",
              restaurant_id::text as "restaurantId", branch_id::text as "branchId",
              zone_id::text as "zoneId", actor_id::text as "actorId",
              operation, name_snapshot as name
       from app.dining_zone_audit_events
       where zone_id = any($1::uuid[]) or actor_id = any($2::uuid[]) or restaurant_id = any($3::uuid[])${lock}`,
      [zoneIds, userIds, restaurantIds],
    );
    diningZoneAudits = Object.freeze([...audits.rows]);
  }
  return Object.freeze({
    branches: Object.freeze([...branches.rows]),
    diningZoneAudits,
    diningZones,
    grants: Object.freeze([...grants.rows]),
    memberships: Object.freeze([...memberships.rows]),
    restaurants: Object.freeze([...restaurants.rows]),
  });
}

function createAuthPort(supabaseUrl: string, secretKey: string): TenancyFixtureRecoveryAuthPort {
  const client = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return Object.freeze({
    deleteUser: async (userId: string) => {
      const result = await client.auth.admin.deleteUser(userId);
      return result.error === null;
    },
    discoverUsers: async (runId: string) => {
      const users: RecoveryAuthUser[] = [];
      for (let page = 1; page <= MAX_AUTH_PAGES; page += 1) {
        const result = await client.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
        if (result.error !== null) throw recoveryError("discovery", "TENANCY_FIXTURE_RECOVERY_DISCOVERY_FAILED");
        for (const user of result.data.users) {
          const marker = readOwnString(user.app_metadata, tenancyAuthMetadataMarker);
          const version = marker;
          const markedRunId = readOwnString(user.app_metadata, "run_id");
          if (version !== tenancyAuthMetadataVersion || markedRunId !== runId) continue;
          users.push({
            email: typeof user.email === "string" ? user.email : "",
            fixtureKey: readOwnString(user.app_metadata, "fixture_key") ?? "",
            id: user.id,
          });
        }
        if (result.data.nextPage === null) return Object.freeze(users);
      }
      throw recoveryError("discovery", "TENANCY_FIXTURE_RECOVERY_DISCOVERY_FAILED");
    },
    readUser: async (runId: string, userId: string) => {
      const result = await client.auth.admin.getUserById(userId);
      if (result.error !== null) throw recoveryError("auth", "TENANCY_FIXTURE_RECOVERY_AUTH_FAILED");
      const user = result.data.user;
      if (
        user === null
        || readOwnString(user.app_metadata, tenancyAuthMetadataMarker) !== tenancyAuthMetadataVersion
        || readOwnString(user.app_metadata, "run_id") !== runId
      ) return undefined;
      return {
        email: typeof user.email === "string" ? user.email : "",
        fixtureKey: readOwnString(user.app_metadata, "fixture_key") ?? "",
        id: user.id,
      };
    },
  });
}

function validateAuthUsers(runId: string, users: readonly RecoveryAuthUser[]): readonly RecoveryAuthUser[] {
  if (users.length > tenancyFixtureKeys.length) throw contaminationError();
  const ids = new Set<string>();
  const fixtureKeys = new Set<string>();
  for (const user of users) {
    if (
      !UUID_PATTERN.test(user.id)
      || !tenancyFixtureKeys.includes(user.fixtureKey as TenancyFixtureKey)
      || user.email !== tenancyFixtureEmail(runId, user.fixtureKey as TenancyFixtureKey)
      || ids.has(user.id)
      || fixtureKeys.has(user.fixtureKey)
    ) throw contaminationError();
    ids.add(user.id);
    fixtureKeys.add(user.fixtureKey);
  }
  return Object.freeze([...users].sort((left, right) => left.fixtureKey.localeCompare(right.fixtureKey)));
}

function validateBranches(
  runId: string,
  rows: readonly BranchRow[],
  firstRestaurantId: string,
  secondRestaurantId: string,
  cobaltId: string,
): void {
  if (rows.length !== tenancyBranchSuffixes.length) throw contaminationError();
  assertUniqueIds(rows);
  assertUniqueValues(rows.map((row) => row.name));
  const expected = new Map<string, Readonly<{ mayBeDisabled: boolean; restaurantId: string }>>([
    [tenancyFixtureName(runId, "branch-11"), { mayBeDisabled: false, restaurantId: firstRestaurantId }],
    [tenancyFixtureName(runId, "branch-12"), { mayBeDisabled: false, restaurantId: firstRestaurantId }],
    [tenancyFixtureName(runId, "branch-21"), { mayBeDisabled: true, restaurantId: secondRestaurantId }],
    [tenancyFixtureName(runId, "branch-22"), { mayBeDisabled: false, restaurantId: secondRestaurantId }],
  ]);
  for (const row of rows) {
    const expectedRow = expected.get(row.name);
    if (
      expectedRow?.restaurantId !== row.restaurantId
      || row.version !== 1
      || (!isActiveRestaurant(row) && (!expectedRow.mayBeDisabled || !isVerificationDisabled(row, cobaltId)))
    ) throw contaminationError();
  }
}

function validateDiningZones(
  runId: string,
  zones: readonly DiningZoneRow[],
  audits: readonly DiningZoneAuditRow[],
  amberId: string,
  restaurantId: string,
  branchesByName: ReadonlyMap<string, BranchRow>,
): Readonly<{ eventIds: readonly string[]; zoneIds: readonly string[] }> {
  if (zones.length === 0 && audits.length === 0) {
    return Object.freeze({ eventIds: Object.freeze([]), zoneIds: Object.freeze([]) });
  }
  if (zones.length !== 1 || audits.length !== 1) throw contaminationError();
  const zone = zones[0];
  const audit = audits[0];
  const branch = branchesByName.get(tenancyFixtureName(runId, "branch-11"));
  const expectedName = tenancyFixtureName(runId, "dining-zone-created");
  if (
    zone === undefined
    || audit === undefined
    || branch === undefined
    || !UUID_PATTERN.test(zone.id)
    || zone.restaurantId !== restaurantId
    || zone.branchId !== branch.id
    || zone.name !== expectedName
    || zone.version !== 1
    || zone.createdBy !== amberId
    || !UUID_PATTERN.test(audit.eventId)
    || !UUID_PATTERN.test(audit.idempotencyKey)
    || audit.restaurantId !== restaurantId
    || audit.branchId !== branch.id
    || audit.zoneId !== zone.id
    || audit.actorId !== amberId
    || audit.operation !== "created"
    || audit.name !== expectedName
  ) throw contaminationError();
  return Object.freeze({
    eventIds: Object.freeze([audit.eventId]),
    zoneIds: Object.freeze([zone.id]),
  });
}

function validateMemberships(
  rows: readonly MembershipRow[],
  amber: RecoveryAuthUser,
  cobalt: RecoveryAuthUser,
  firstRestaurantId: string,
  secondRestaurantId: string,
  branchesByName: ReadonlyMap<string, BranchRow>,
  runId: string,
): ReadonlyMap<string, string> {
  if (rows.length !== 4) throw contaminationError();
  assertUniqueIds(rows);
  const branch11 = branchesByName.get(tenancyFixtureName(runId, "branch-11"));
  const branch12 = branchesByName.get(tenancyFixtureName(runId, "branch-12"));
  const branch21 = branchesByName.get(tenancyFixtureName(runId, "branch-21"));
  const branch22 = branchesByName.get(tenancyFixtureName(runId, "branch-22"));
  if (branch11 === undefined || branch12 === undefined || branch21 === undefined || branch22 === undefined) {
    throw contaminationError();
  }
  const expected = new Map<string, string>([
    [`${amber.id}:${firstRestaurantId}:${branch11.id}`, "amber:branch-11"],
    [`${amber.id}:${firstRestaurantId}:${branch12.id}`, "amber:branch-12"],
    [`${cobalt.id}:${secondRestaurantId}:${branch21.id}`, "cobalt:branch-21"],
    [`${cobalt.id}:${secondRestaurantId}:${branch22.id}`, "cobalt:branch-22"],
  ]);
  const labels = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.userId}:${row.restaurantId}:${row.branchId}`;
    const label = expected.get(key);
    if (label === undefined || labels.has(row.id) || row.grantedBy !== amber.id || (row.revokedBy !== null && row.revokedBy !== amber.id)) {
      throw contaminationError();
    }
    expected.delete(key);
    labels.set(row.id, label);
  }
  if (expected.size !== 0) throw contaminationError();
  validateRevocationPrefix(rows, labels, amber.id);
  return labels;
}

function validateGrants(rows: readonly GrantRow[], membershipLabels: ReadonlyMap<string, string>, amberId: string): void {
  if (rows.length !== 5) throw contaminationError();
  assertUniqueIds(rows);
  const expected = new Set([
    "amber:branch-11:manager",
    "amber:branch-11:waiter",
    "amber:branch-12:viewer",
    "cobalt:branch-21:cashier",
    "cobalt:branch-22:kitchen",
  ]);
  for (const row of rows) {
    const label = membershipLabels.get(row.membershipId);
    const key = `${label ?? ""}:${row.roleCode}`;
    if (!expected.delete(key) || row.grantedBy !== amberId || (row.revokedBy !== null && row.revokedBy !== amberId)) {
      throw contaminationError();
    }
  }
  if (expected.size !== 0) throw contaminationError();
  validateGrantRevocationPrefix(rows, membershipLabels, amberId);
}

function validateRevocationPrefix(
  rows: readonly MembershipRow[],
  labels: ReadonlyMap<string, string>,
  amberId: string,
): void {
  const byLabel = new Map(rows.map((row) => [labels.get(row.id), row]));
  const amberBranch11 = byLabel.get("amber:branch-11");
  if (amberBranch11 === undefined) throw contaminationError();
  const otherRows = rows.filter((row) => labels.get(row.id) !== "amber:branch-11");
  if (otherRows.some((row) => !isActive(row))) throw contaminationError();
  if (!isActive(amberBranch11) && !isVerificationRevocation(amberBranch11, amberId)) {
    throw contaminationError();
  }
}

function validateGrantRevocationPrefix(
  rows: readonly GrantRow[],
  membershipLabels: ReadonlyMap<string, string>,
  amberId: string,
): void {
  const byKey = new Map(rows.map((row) => [`${membershipLabels.get(row.membershipId) ?? ""}:${row.roleCode}`, row]));
  const waiter = byKey.get("amber:branch-11:waiter");
  const viewer = byKey.get("amber:branch-12:viewer");
  if (waiter === undefined || viewer === undefined) throw contaminationError();
  const alwaysActive = rows.filter((row) => row !== waiter && row !== viewer);
  if (alwaysActive.some((row) => !isActive(row))) throw contaminationError();

  const waiterRevoked = isVerificationRevocation(waiter, amberId);
  const viewerRevoked = isVerificationRevocation(viewer, amberId);
  if ((!isActive(waiter) && !waiterRevoked) || (!isActive(viewer) && !viewerRevoked) || (viewerRevoked && !waiterRevoked)) {
    throw contaminationError();
  }
}

function validateCrossEntityRevocationPrefix(
  memberships: readonly MembershipRow[],
  grants: readonly GrantRow[],
  membershipLabels: ReadonlyMap<string, string>,
  amberId: string,
): void {
  const revokedMembership = memberships.find((row) => membershipLabels.get(row.id) === "amber:branch-11");
  const waiter = grants.find((row) =>
    membershipLabels.get(row.membershipId) === "amber:branch-11" && row.roleCode === "waiter"
  );
  const viewer = grants.find((row) =>
    membershipLabels.get(row.membershipId) === "amber:branch-12" && row.roleCode === "viewer"
  );
  if (revokedMembership === undefined || waiter === undefined || viewer === undefined) throw contaminationError();
  if (isVerificationRevocation(revokedMembership, amberId)
    && (!isVerificationRevocation(waiter, amberId) || !isVerificationRevocation(viewer, amberId))) {
    throw contaminationError();
  }
}

function isActive(row: MembershipRow | GrantRow): boolean {
  return row.revokedAt === null && row.revokedBy === null && row.revocationReason === null;
}

function isVerificationRevocation(row: MembershipRow | GrantRow, amberId: string): boolean {
  return typeof row.revokedAt === "string"
    && row.revokedAt.length > 0
    && row.revokedBy === amberId
    && row.revocationReason === "tenancy verification";
}

function isActiveRestaurant(row: RestaurantRow | BranchRow): boolean {
  return row.disabledAt === null && row.disabledBy === null && row.disabledReason === null;
}

function isVerificationDisabled(row: RestaurantRow | BranchRow, actorId: string): boolean {
  return typeof row.disabledAt === "string"
    && row.disabledAt.length > 0
    && row.disabledBy === actorId
    && row.disabledReason === "tenancy verification";
}

async function deleteExactly(
  client: PoolClient,
  table: string,
  ids: readonly string[],
  idColumn: "event_id" | "id" = "id",
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await client.query<{ id: string }>(
    `delete from ${table} where ${idColumn} = any($1::uuid[]) returning ${idColumn}::text as id`,
    [ids],
  );
  const returned = result.rows.map((row) => row.id).sort();
  const expected = [...ids].sort();
  if (result.rowCount !== ids.length || returned.some((id, index) => id !== expected[index])) {
    throw recoveryError("database", "TENANCY_FIXTURE_RECOVERY_DATABASE_FAILED");
  }
  return ids.length;
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The caller maps the failure to an allowlisted code.
  }
}

function assertUniqueIds(rows: readonly { readonly id: string }[]): void {
  if (rows.some((row) => !UUID_PATTERN.test(row.id))) throw contaminationError();
  assertUniqueValues(rows.map((row) => row.id));
}

function assertUniqueValues(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw contaminationError();
}

function readOwnString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function contaminationError(): TenancyFixtureRecoveryError {
  return recoveryError("database", "TENANCY_FIXTURE_RECOVERY_CONTAMINATION_DETECTED");
}

async function assertAuthUserUnchanged(
  runId: string,
  expected: RecoveryAuthUser,
  auth: TenancyFixtureRecoveryAuthPort,
  stage: "discovery" | "auth",
): Promise<void> {
  let actual: RecoveryAuthUser | undefined;
  try {
    actual = await auth.readUser(runId, expected.id);
  } catch {
    throw recoveryError(stage, stage === "auth"
      ? "TENANCY_FIXTURE_RECOVERY_AUTH_FAILED"
      : "TENANCY_FIXTURE_RECOVERY_DISCOVERY_FAILED");
  }
  if (
    actual === undefined
    || actual.id !== expected.id
    || actual.fixtureKey !== expected.fixtureKey
    || actual.email !== expected.email
  ) throw contaminationError();
}

function recoveryError(
  stage: TenancyFixtureRecoveryError["stage"],
  code: TenancyFixtureRecoveryError["code"],
): TenancyFixtureRecoveryError {
  return new TenancyFixtureRecoveryError(stage, code);
}
