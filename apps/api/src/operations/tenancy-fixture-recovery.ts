import { createClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";

import type { DatabaseConfig } from "../database.js";
import {
  tenancyAuthMetadataMarker,
  tenancyAuthMetadataVersion,
  tenancyBranchSuffixes,
  tenancyCanarySuffixes,
  tenancyDiningZoneSuffixes,
  tenancyDiningTableSuffixes,
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

interface DiningTableRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly id: string;
  readonly name: string;
  readonly restaurantId: string;
  readonly zoneId: string;
}

interface DiningTableAuditRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly eventId: string;
  readonly name: string;
  readonly operation: string;
  readonly restaurantId: string;
  readonly tableId: string;
  readonly zoneId: string;
}

interface MenuCatalogRow {
  readonly currency: string;
  readonly id: string;
  readonly publishedBy: string;
  readonly restaurantId: string;
  readonly version: number;
}

interface MenuCategoryRow {
  readonly catalogId: string;
  readonly id: string;
  readonly name: string;
  readonly restaurantId: string;
}

interface MenuProductRow extends MenuCategoryRow {
  readonly categoryId: string;
}

interface MenuModifierGroupRow extends MenuCategoryRow {
  readonly productId: string;
}

interface MenuModifierOptionRow extends MenuCategoryRow {
  readonly groupId: string;
}

interface MenuCatalogHeadRow {
  readonly catalogId: string;
  readonly restaurantId: string;
  readonly updatedBy: string;
  readonly version: number;
}

interface MenuCatalogAuditRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly catalogId: string;
  readonly eventId: string;
  readonly restaurantId: string;
  readonly resultVersion: number;
}

interface OrderRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly channel: string;
  readonly id: string;
  readonly restaurantId: string;
  readonly status: string;
  readonly tableId?: string | null;
  readonly version: number;
}

interface OrderAuditRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly orderId: string;
  readonly restaurantId: string;
  readonly resultVersion: number;
}

interface KdsEventRow {
  readonly branchId: string;
  readonly cursor: number;
  readonly eventId: string;
  readonly operation: string;
  readonly orderId: string;
  readonly restaurantId: string;
  readonly stationId: string;
  readonly status: string;
}

interface KdsCursorRow {
  readonly branchId: string;
  readonly lastCursor: number;
  readonly restaurantId: string;
}

interface CashRegisterSessionRow {
  readonly branchId: string;
  readonly cashierId: string;
  readonly currency: string;
  readonly id: string;
  readonly registerId: string;
  readonly restaurantId: string;
  readonly status: string;
  readonly version: number;
}

interface PaymentRow {
  readonly amountMinor: number;
  readonly branchId: string;
  readonly capturedBy: string;
  readonly cashRegisterSessionId: string;
  readonly currency: string;
  readonly id: string;
  readonly method: string;
  readonly orderId: string;
  readonly restaurantId: string;
}

interface CashMovementRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly cashRegisterSessionId: string;
  readonly deviceId: string;
  readonly id: string;
  readonly restaurantId: string;
  readonly sourcePaymentId: string | null;
}

interface FinancialAuditRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly cashRegisterSessionId: string;
  readonly deviceId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly orderId: string | null;
  readonly paymentId: string | null;
  readonly restaurantId: string;
  readonly resultCashRegisterVersion: number;
  readonly resultOrderVersion: number | null;
}

interface FinancialDeviceSequenceRow {
  readonly branchId: string;
  readonly deviceId: string;
  readonly lastSequence: number;
  readonly restaurantId: string;
}

export interface TenancyFixtureRecoverySnapshot {
  readonly branches: readonly BranchRow[];
  readonly cashMovements?: readonly CashMovementRow[];
  readonly cashRegisterSessions?: readonly CashRegisterSessionRow[];
  readonly diningZoneAudits?: readonly DiningZoneAuditRow[];
  readonly diningZones?: readonly DiningZoneRow[];
  readonly diningTableAudits?: readonly DiningTableAuditRow[];
  readonly diningTables?: readonly DiningTableRow[];
  readonly menuCatalogs?: readonly MenuCatalogRow[];
  readonly menuCategories?: readonly MenuCategoryRow[];
  readonly menuProducts?: readonly MenuProductRow[];
  readonly menuModifierGroups?: readonly MenuModifierGroupRow[];
  readonly menuModifierOptions?: readonly MenuModifierOptionRow[];
  readonly menuCatalogHeads?: readonly MenuCatalogHeadRow[];
  readonly menuCatalogAudits?: readonly MenuCatalogAuditRow[];
  readonly orders?: readonly OrderRow[];
  readonly orderAudits?: readonly OrderAuditRow[];
  readonly kdsEvents?: readonly KdsEventRow[];
  readonly kdsCursors?: readonly KdsCursorRow[];
  readonly grants: readonly GrantRow[];
  readonly financialAudits?: readonly FinancialAuditRow[];
  readonly financialDeviceSequences?: readonly FinancialDeviceSequenceRow[];
  readonly memberships: readonly MembershipRow[];
  readonly payments?: readonly PaymentRow[];
  readonly restaurants: readonly RestaurantRow[];
}

interface ValidatedSnapshot {
  readonly branchIds: readonly string[];
  readonly cashMovementIds: readonly string[];
  readonly cashRegisterSessionIds: readonly string[];
  readonly diningZoneEventIds: readonly string[];
  readonly diningZoneIds: readonly string[];
  readonly diningTableEventIds: readonly string[];
  readonly diningTableIds: readonly string[];
  readonly grantIds: readonly string[];
  readonly financialAuditEventIds: readonly string[];
  readonly financialDeviceSequenceScopes: readonly Readonly<{ branchId: string; deviceId: string; restaurantId: string }>[];
  readonly membershipIds: readonly string[];
  readonly orderAuditEventIds: readonly string[];
  readonly orderIds: readonly string[];
  readonly paymentIds: readonly string[];
  readonly kdsEventIds: readonly string[];
  readonly kdsCursorScopes: readonly Readonly<{ branchId: string; restaurantId: string }>[];
  readonly menuCatalogAuditEventIds: readonly string[];
  readonly menuCatalogIds: readonly string[];
  readonly menuCategoryIds: readonly string[];
  readonly menuHeadRestaurantIds: readonly string[];
  readonly menuModifierGroupIds: readonly string[];
  readonly menuModifierOptionIds: readonly string[];
  readonly menuProductIds: readonly string[];
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
    || (snapshot.diningZoneAudits?.length ?? 0) > 0
    || (snapshot.diningTables?.length ?? 0) > 0
    || (snapshot.diningTableAudits?.length ?? 0) > 0
    || (snapshot.menuCatalogs?.length ?? 0) > 0
    || (snapshot.menuCatalogAudits?.length ?? 0) > 0
    || (snapshot.orders?.length ?? 0) > 0
    || (snapshot.orderAudits?.length ?? 0) > 0
    || (snapshot.kdsEvents?.length ?? 0) > 0
    || (snapshot.kdsCursors?.length ?? 0) > 0
    || (snapshot.cashRegisterSessions?.length ?? 0) > 0
    || (snapshot.payments?.length ?? 0) > 0
    || (snapshot.cashMovements?.length ?? 0) > 0
    || (snapshot.financialAudits?.length ?? 0) > 0
    || (snapshot.financialDeviceSequences?.length ?? 0) > 0;
  if (hasMainGraph && mainCount !== expectedMainNames.length) throw contaminationError();

  if (!hasMainGraph) {
    if (snapshot.branches.length !== 0 || snapshot.memberships.length !== 0 || snapshot.grants.length !== 0) {
      throw contaminationError();
    }
    return Object.freeze({
      branchIds: Object.freeze([]),
      cashMovementIds: Object.freeze([]),
      cashRegisterSessionIds: Object.freeze([]),
      diningZoneEventIds: Object.freeze([]),
      diningZoneIds: Object.freeze([]),
      diningTableEventIds: Object.freeze([]),
      diningTableIds: Object.freeze([]),
      grantIds: Object.freeze([]),
      financialAuditEventIds: Object.freeze([]),
      financialDeviceSequenceScopes: Object.freeze([]),
      membershipIds: Object.freeze([]),
      orderAuditEventIds: Object.freeze([]),
      orderIds: Object.freeze([]),
      paymentIds: Object.freeze([]),
      kdsEventIds: Object.freeze([]),
      kdsCursorScopes: Object.freeze([]),
      menuCatalogAuditEventIds: Object.freeze([]),
      menuCatalogIds: Object.freeze([]),
      menuCategoryIds: Object.freeze([]),
      menuHeadRestaurantIds: Object.freeze([]),
      menuModifierGroupIds: Object.freeze([]),
      menuModifierOptionIds: Object.freeze([]),
      menuProductIds: Object.freeze([]),
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
  const diningTables = validateDiningTables(
    runId,
    snapshot.diningTables ?? [],
    snapshot.diningTableAudits ?? [],
    amber.id,
    firstRestaurant.id,
    branchesByName,
    snapshot.diningZones ?? [],
  );
  const menu = validateMenuCatalog(
    runId,
    snapshot,
    amber.id,
    firstRestaurant.id,
    branchesByName,
  );
  const orders = validateOrdersRealtime(
    runId,
    snapshot,
    amber.id,
    firstRestaurant.id,
    branchesByName,
  );
  const finances = validateFinancialJourney(
    runId,
    snapshot,
    amber.id,
    firstRestaurant.id,
    branchesByName,
    orders.orderIds,
  );

  return Object.freeze({
    branchIds: Object.freeze(snapshot.branches.map((row) => row.id)),
    cashMovementIds: finances.cashMovementIds,
    cashRegisterSessionIds: finances.cashRegisterSessionIds,
    diningZoneEventIds: dining.eventIds,
    diningZoneIds: dining.zoneIds,
    diningTableEventIds: diningTables.eventIds,
    diningTableIds: diningTables.tableIds,
    grantIds: Object.freeze(snapshot.grants.map((row) => row.id)),
    financialAuditEventIds: finances.auditEventIds,
    financialDeviceSequenceScopes: finances.deviceSequenceScopes,
    membershipIds: Object.freeze(snapshot.memberships.map((row) => row.id)),
    orderAuditEventIds: orders.auditEventIds,
    orderIds: orders.orderIds,
    paymentIds: finances.paymentIds,
    kdsEventIds: orders.kdsEventIds,
    kdsCursorScopes: orders.cursorScopes,
    menuCatalogAuditEventIds: menu.auditEventIds,
    menuCatalogIds: menu.catalogIds,
    menuCategoryIds: menu.categoryIds,
    menuHeadRestaurantIds: menu.headRestaurantIds,
    menuModifierGroupIds: menu.modifierGroupIds,
    menuModifierOptionIds: menu.modifierOptionIds,
    menuProductIds: menu.productIds,
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
      removed += await deleteExactly(client, "app.financial_audit_events", validated.financialAuditEventIds, "event_id");
      removed += await deleteExactly(client, "app.cash_movements", validated.cashMovementIds);
      removed += await deleteExactly(client, "app.payments", validated.paymentIds);
      removed += await deleteFinancialDeviceSequencesExactly(client, validated.financialDeviceSequenceScopes);
      removed += await deleteExactly(client, "app.cash_register_sessions", validated.cashRegisterSessionIds);
      removed += await deleteExactly(client, "app.kds_events", validated.kdsEventIds, "event_id");
      removed += await deleteExactly(client, "app.order_audit_events", validated.orderAuditEventIds, "event_id");
      removed += await deleteExactly(client, "app.orders", validated.orderIds);
      removed += await deleteKdsCursorsExactly(client, validated.kdsCursorScopes);
      removed += await deleteExactly(client, "app.menu_modifier_options", validated.menuModifierOptionIds);
      removed += await deleteExactly(client, "app.menu_modifier_groups", validated.menuModifierGroupIds);
      removed += await deleteExactly(client, "app.menu_products", validated.menuProductIds);
      removed += await deleteExactly(client, "app.menu_categories", validated.menuCategoryIds);
      removed += await deleteExactly(client, "app.menu_catalog_audit_events", validated.menuCatalogAuditEventIds, "event_id");
      removed += await deleteExactly(client, "app.menu_catalog_heads", validated.menuHeadRestaurantIds, "restaurant_id");
      removed += await deleteExactly(client, "app.menu_catalogs", validated.menuCatalogIds);
      removed += await deleteExactly(client, "app.dining_table_audit_events", validated.diningTableEventIds, "event_id");
      removed += await deleteExactly(client, "app.dining_tables", validated.diningTableIds);
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
        || (snapshot.diningTables?.length ?? 0) !== 0
        || (snapshot.diningTableAudits?.length ?? 0) !== 0
        || (snapshot.menuCatalogs?.length ?? 0) !== 0
        || (snapshot.menuCategories?.length ?? 0) !== 0
        || (snapshot.menuProducts?.length ?? 0) !== 0
        || (snapshot.menuModifierGroups?.length ?? 0) !== 0
        || (snapshot.menuModifierOptions?.length ?? 0) !== 0
        || (snapshot.menuCatalogHeads?.length ?? 0) !== 0
        || (snapshot.menuCatalogAudits?.length ?? 0) !== 0
        || (snapshot.orders?.length ?? 0) !== 0
        || (snapshot.orderAudits?.length ?? 0) !== 0
        || (snapshot.kdsEvents?.length ?? 0) !== 0
        || (snapshot.kdsCursors?.length ?? 0) !== 0
        || (snapshot.cashRegisterSessions?.length ?? 0) !== 0
        || (snapshot.payments?.length ?? 0) !== 0
        || (snapshot.cashMovements?.length ?? 0) !== 0
        || (snapshot.financialAudits?.length ?? 0) !== 0
        || (snapshot.financialDeviceSequences?.length ?? 0) !== 0
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
  const diningCatalog = await client.query<{
    menuAudits: boolean;
    menuCatalogs: boolean;
    menuCategories: boolean;
    menuGroups: boolean;
    menuHeads: boolean;
    menuOptions: boolean;
    menuProducts: boolean;
    orders: boolean;
    orderAudits: boolean;
    kdsEvents: boolean;
    kdsCursors: boolean;
    cashRegisters: boolean;
    payments: boolean;
    cashMovements: boolean;
    financialAudits: boolean;
    financialSequences: boolean;
    tableAudits: boolean;
    tables: boolean;
    zoneAudits: boolean;
    zones: boolean;
  }>(
    `select
       pg_catalog.to_regclass('app.dining_zone_audit_events') is not null as "zoneAudits",
       pg_catalog.to_regclass('app.dining_zones') is not null as zones,
       pg_catalog.to_regclass('app.dining_table_audit_events') is not null as "tableAudits",
       pg_catalog.to_regclass('app.dining_tables') is not null as tables,
       pg_catalog.to_regclass('app.menu_catalogs') is not null as "menuCatalogs",
       pg_catalog.to_regclass('app.menu_categories') is not null as "menuCategories",
       pg_catalog.to_regclass('app.menu_products') is not null as "menuProducts",
       pg_catalog.to_regclass('app.menu_modifier_groups') is not null as "menuGroups",
       pg_catalog.to_regclass('app.menu_modifier_options') is not null as "menuOptions",
       pg_catalog.to_regclass('app.menu_catalog_heads') is not null as "menuHeads",
       pg_catalog.to_regclass('app.menu_catalog_audit_events') is not null as "menuAudits",
       pg_catalog.to_regclass('app.orders') is not null as orders,
       pg_catalog.to_regclass('app.order_audit_events') is not null as "orderAudits",
       pg_catalog.to_regclass('app.kds_events') is not null as "kdsEvents",
       pg_catalog.to_regclass('app_private.kds_branch_cursors') is not null as "kdsCursors",
       pg_catalog.to_regclass('app.cash_register_sessions') is not null as "cashRegisters",
       pg_catalog.to_regclass('app.payments') is not null as payments,
       pg_catalog.to_regclass('app.cash_movements') is not null as "cashMovements",
       pg_catalog.to_regclass('app.financial_audit_events') is not null as "financialAudits",
       pg_catalog.to_regclass('app_private.financial_device_sequences') is not null as "financialSequences"`,
  );
  const catalog = diningCatalog.rows[0];
  if (catalog?.zoneAudits !== catalog?.zones || catalog?.tableAudits !== catalog?.tables || catalog?.tables === true && catalog.zones !== true) throw contaminationError();
  const menuCatalogFlags = [
    catalog?.menuCatalogs,
    catalog?.menuCategories,
    catalog?.menuProducts,
    catalog?.menuGroups,
    catalog?.menuOptions,
    catalog?.menuHeads,
    catalog?.menuAudits,
  ];
  if (menuCatalogFlags.some((value) => value !== menuCatalogFlags[0])) throw contaminationError();
  const ordersFlags = [catalog?.orders, catalog?.orderAudits, catalog?.kdsEvents, catalog?.kdsCursors];
  if (ordersFlags.some((value) => value !== ordersFlags[0])) throw contaminationError();
  const financeFlags = [catalog?.cashRegisters, catalog?.payments, catalog?.cashMovements, catalog?.financialAudits, catalog?.financialSequences];
  if (financeFlags.some((value) => value !== financeFlags[0])) throw contaminationError();
  let diningZones: readonly DiningZoneRow[] = [];
  let diningZoneAudits: readonly DiningZoneAuditRow[] = [];
  let diningTables: readonly DiningTableRow[] = [];
  let diningTableAudits: readonly DiningTableAuditRow[] = [];
  let menuCatalogs: readonly MenuCatalogRow[] = [];
  let menuCategories: readonly MenuCategoryRow[] = [];
  let menuProducts: readonly MenuProductRow[] = [];
  let menuModifierGroups: readonly MenuModifierGroupRow[] = [];
  let menuModifierOptions: readonly MenuModifierOptionRow[] = [];
  let menuCatalogHeads: readonly MenuCatalogHeadRow[] = [];
  let menuCatalogAudits: readonly MenuCatalogAuditRow[] = [];
  let orders: readonly OrderRow[] = [];
  let orderAudits: readonly OrderAuditRow[] = [];
  let kdsEvents: readonly KdsEventRow[] = [];
  let kdsCursors: readonly KdsCursorRow[] = [];
  let cashRegisterSessions: readonly CashRegisterSessionRow[] = [];
  let payments: readonly PaymentRow[] = [];
  let cashMovements: readonly CashMovementRow[] = [];
  let financialAudits: readonly FinancialAuditRow[] = [];
  let financialDeviceSequences: readonly FinancialDeviceSequenceRow[] = [];
  if (catalog?.zones === true) {
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
  if (catalog?.tables === true) {
    const tableNames = tenancyDiningTableSuffixes.map((suffix) => tenancyFixtureName(runId, suffix));
    const tables = await client.query<DiningTableRow>(
      `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId", zone_id::text as "zoneId", name, updated_by::text as "actorId" from app.dining_tables where name = any($1::text[]) or restaurant_id = any($2::uuid[]) or updated_by = any($3::uuid[])${lock}`,
      [tableNames, restaurantIds, userIds],
    );
    diningTables = Object.freeze([...tables.rows]);
    const tableIds = diningTables.map((row) => row.id);
    const audits = await client.query<DiningTableAuditRow>(
      `select event_id::text as "eventId", restaurant_id::text as "restaurantId", branch_id::text as "branchId", table_id::text as "tableId", zone_id::text as "zoneId", actor_id::text as "actorId", operation, name_snapshot as name from app.dining_table_audit_events where table_id = any($1::uuid[]) or actor_id = any($2::uuid[]) or restaurant_id = any($3::uuid[])${lock}`,
      [tableIds, userIds, restaurantIds],
    );
    diningTableAudits = Object.freeze([...audits.rows]);
  }
  if (catalog?.menuCatalogs === true) {
    const catalogs = await client.query<MenuCatalogRow>(
      `select id::text, restaurant_id::text as "restaurantId", version::integer,
              currency, published_by::text as "publishedBy"
       from app.menu_catalogs
       where restaurant_id = any($1::uuid[]) or published_by = any($2::uuid[])${lock}`,
      [restaurantIds, userIds],
    );
    menuCatalogs = Object.freeze([...catalogs.rows]);
    const catalogIds = menuCatalogs.map((row) => row.id);
    const categories = await client.query<MenuCategoryRow>(
      `select id::text, restaurant_id::text as "restaurantId", catalog_id::text as "catalogId", name
       from app.menu_categories where restaurant_id = any($1::uuid[]) or catalog_id = any($2::uuid[])${lock}`,
      [restaurantIds, catalogIds],
    );
    menuCategories = Object.freeze([...categories.rows]);
    const products = await client.query<MenuProductRow>(
      `select id::text, restaurant_id::text as "restaurantId", catalog_id::text as "catalogId",
              category_id::text as "categoryId", name
       from app.menu_products where restaurant_id = any($1::uuid[]) or catalog_id = any($2::uuid[])${lock}`,
      [restaurantIds, catalogIds],
    );
    menuProducts = Object.freeze([...products.rows]);
    const groups = await client.query<MenuModifierGroupRow>(
      `select id::text, restaurant_id::text as "restaurantId", catalog_id::text as "catalogId",
              product_id::text as "productId", name
       from app.menu_modifier_groups where restaurant_id = any($1::uuid[]) or catalog_id = any($2::uuid[])${lock}`,
      [restaurantIds, catalogIds],
    );
    menuModifierGroups = Object.freeze([...groups.rows]);
    const groupIds = menuModifierGroups.map((row) => row.id);
    const options = await client.query<MenuModifierOptionRow>(
      `select id::text, restaurant_id::text as "restaurantId", catalog_id::text as "catalogId",
              group_id::text as "groupId", name
       from app.menu_modifier_options
       where restaurant_id = any($1::uuid[]) or catalog_id = any($2::uuid[]) or group_id = any($3::uuid[])${lock}`,
      [restaurantIds, catalogIds, groupIds],
    );
    menuModifierOptions = Object.freeze([...options.rows]);
    const heads = await client.query<MenuCatalogHeadRow>(
      `select restaurant_id::text as "restaurantId", catalog_id::text as "catalogId",
              version::integer, updated_by::text as "updatedBy"
       from app.menu_catalog_heads where restaurant_id = any($1::uuid[]) or updated_by = any($2::uuid[])${lock}`,
      [restaurantIds, userIds],
    );
    menuCatalogHeads = Object.freeze([...heads.rows]);
    const audits = await client.query<MenuCatalogAuditRow>(
      `select event_id::text as "eventId", restaurant_id::text as "restaurantId",
              branch_id::text as "branchId", catalog_id::text as "catalogId",
              actor_id::text as "actorId", result_version::integer as "resultVersion"
       from app.menu_catalog_audit_events
       where restaurant_id = any($1::uuid[]) or catalog_id = any($2::uuid[]) or actor_id = any($3::uuid[])${lock}`,
      [restaurantIds, catalogIds, userIds],
    );
    menuCatalogAudits = Object.freeze([...audits.rows]);
  }
  if (catalog?.orders === true) {
    const orderResult = await client.query<OrderRow>(
      `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId",
              channel, table_id::text as "tableId", status, version::integer, created_by::text as "actorId"
       from app.orders
       where restaurant_id = any($1::uuid[]) or created_by = any($2::uuid[]) or updated_by = any($2::uuid[])${lock}`,
      [restaurantIds, userIds],
    );
    orders = Object.freeze([...orderResult.rows]);
    const orderIds = orders.map((row) => row.id);
    const auditResult = await client.query<OrderAuditRow>(
      `select event_id::text as "eventId", idempotency_key as "idempotencyKey",
              restaurant_id::text as "restaurantId", branch_id::text as "branchId",
              order_id::text as "orderId", actor_id::text as "actorId", operation,
              result_order_version::integer as "resultVersion"
       from app.order_audit_events
       where order_id = any($1::uuid[]) or restaurant_id = any($2::uuid[]) or actor_id = any($3::uuid[])${lock}`,
      [orderIds, restaurantIds, userIds],
    );
    orderAudits = Object.freeze([...auditResult.rows]);
    const kdsResult = await client.query<KdsEventRow>(
      `select event_id::text as "eventId", restaurant_id::text as "restaurantId",
              branch_id::text as "branchId", cursor::integer, order_id::text as "orderId",
              station_id as "stationId", operation, status
       from app.kds_events
       where order_id = any($1::uuid[]) or restaurant_id = any($2::uuid[])${lock}`,
      [orderIds, restaurantIds],
    );
    kdsEvents = Object.freeze([...kdsResult.rows]);
    const cursorResult = await client.query<KdsCursorRow>(
      `select restaurant_id::text as "restaurantId", branch_id::text as "branchId",
              last_cursor::integer as "lastCursor"
       from app_private.kds_branch_cursors
       where restaurant_id = any($1::uuid[]) or branch_id = any($2::uuid[])${lock}`,
      [restaurantIds, branchIds],
    );
    kdsCursors = Object.freeze([...cursorResult.rows]);
  }
  if (catalog?.cashRegisters === true) {
    const sessionResult = await client.query<CashRegisterSessionRow>(
      `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId",
              register_id::text as "registerId", cashier_id::text as "cashierId", currency, status, version::integer
       from app.cash_register_sessions
       where restaurant_id=any($1::uuid[]) or cashier_id=any($2::uuid[])${lock}`,
      [restaurantIds, userIds],
    );
    cashRegisterSessions = Object.freeze([...sessionResult.rows]);
    const sessionIds = cashRegisterSessions.map((row) => row.id);
    const paymentResult = await client.query<PaymentRow>(
      `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId",
              order_id::text as "orderId", cash_register_session_id::text as "cashRegisterSessionId",
              method, amount_minor::integer as "amountMinor", currency, captured_by::text as "capturedBy"
       from app.payments where restaurant_id=any($1::uuid[]) or captured_by=any($2::uuid[])
          or cash_register_session_id=any($3::uuid[])${lock}`,
      [restaurantIds, userIds, sessionIds],
    );
    payments = Object.freeze([...paymentResult.rows]);
    const paymentIds = payments.map((row) => row.id);
    const movementResult = await client.query<CashMovementRow>(
      `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId",
              cash_register_session_id::text as "cashRegisterSessionId", actor_id::text as "actorId",
              device_id::text as "deviceId", source_payment_id::text as "sourcePaymentId"
       from app.cash_movements where restaurant_id=any($1::uuid[]) or actor_id=any($2::uuid[])
          or cash_register_session_id=any($3::uuid[]) or source_payment_id=any($4::uuid[])${lock}`,
      [restaurantIds, userIds, sessionIds, paymentIds],
    );
    cashMovements = Object.freeze([...movementResult.rows]);
    const auditResult = await client.query<FinancialAuditRow>(
      `select event_id::text as "eventId", idempotency_key as "idempotencyKey",
              restaurant_id::text as "restaurantId", branch_id::text as "branchId", actor_id::text as "actorId",
              device_id::text as "deviceId", operation, cash_register_session_id::text as "cashRegisterSessionId",
              order_id::text as "orderId", payment_id::text as "paymentId",
              result_cash_register_version::integer as "resultCashRegisterVersion",
              result_order_version::integer as "resultOrderVersion"
       from app.financial_audit_events where restaurant_id=any($1::uuid[]) or actor_id=any($2::uuid[])
          or cash_register_session_id=any($3::uuid[])${lock}`,
      [restaurantIds, userIds, sessionIds],
    );
    financialAudits = Object.freeze([...auditResult.rows]);
    const deviceResult = await client.query<FinancialDeviceSequenceRow>(
      `select restaurant_id::text as "restaurantId", branch_id::text as "branchId",
              device_id::text as "deviceId", last_sequence::integer as "lastSequence"
       from app_private.financial_device_sequences
       where restaurant_id=any($1::uuid[]) or branch_id=any($2::uuid[])${lock}`,
      [restaurantIds, branchIds],
    );
    financialDeviceSequences = Object.freeze([...deviceResult.rows]);
  }
  return Object.freeze({
    branches: Object.freeze([...branches.rows]),
    cashMovements,
    cashRegisterSessions,
    diningTableAudits,
    diningTables,
    diningZoneAudits,
    diningZones,
    grants: Object.freeze([...grants.rows]),
    financialAudits,
    financialDeviceSequences,
    kdsCursors,
    kdsEvents,
    memberships: Object.freeze([...memberships.rows]),
    payments,
    menuCatalogAudits,
    menuCatalogHeads,
    menuCatalogs,
    menuCategories,
    menuModifierGroups,
    menuModifierOptions,
    menuProducts,
    orderAudits,
    orders,
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

function validateMenuCatalog(
  runId: string,
  snapshot: TenancyFixtureRecoverySnapshot,
  amberId: string,
  restaurantId: string,
  branchesByName: ReadonlyMap<string, BranchRow>,
): Readonly<{
  auditEventIds: readonly string[];
  catalogIds: readonly string[];
  categoryIds: readonly string[];
  headRestaurantIds: readonly string[];
  modifierGroupIds: readonly string[];
  modifierOptionIds: readonly string[];
  productIds: readonly string[];
}> {
  const catalogs = snapshot.menuCatalogs ?? [];
  const categories = snapshot.menuCategories ?? [];
  const products = snapshot.menuProducts ?? [];
  const groups = snapshot.menuModifierGroups ?? [];
  const options = snapshot.menuModifierOptions ?? [];
  const heads = snapshot.menuCatalogHeads ?? [];
  const audits = snapshot.menuCatalogAudits ?? [];
  const collections = [catalogs, categories, products, groups, options, heads, audits];
  const hasMenu = collections.some((rows) => rows.length > 0);
  if (!hasMenu) {
    return Object.freeze({
      auditEventIds: Object.freeze([]),
      catalogIds: Object.freeze([]),
      categoryIds: Object.freeze([]),
      headRestaurantIds: Object.freeze([]),
      modifierGroupIds: Object.freeze([]),
      modifierOptionIds: Object.freeze([]),
      productIds: Object.freeze([]),
    });
  }
  if (collections.some((rows) => rows.length !== 1)) throw contaminationError();
  const catalog = catalogs[0];
  const category = categories[0];
  const product = products[0];
  const group = groups[0];
  const option = options[0];
  const head = heads[0];
  const audit = audits[0];
  const branch = branchesByName.get(tenancyFixtureName(runId, "branch-11"));
  if (
    catalog === undefined
    || category === undefined
    || product === undefined
    || group === undefined
    || option === undefined
    || head === undefined
    || audit === undefined
    || branch === undefined
    || catalog.restaurantId !== restaurantId
    || catalog.publishedBy !== amberId
    || catalog.version !== 1
    || catalog.currency !== "MXN"
    || category.restaurantId !== restaurantId
    || category.catalogId !== catalog.id
    || category.name !== tenancyFixtureName(runId, "menu-category")
    || product.restaurantId !== restaurantId
    || product.catalogId !== catalog.id
    || product.categoryId !== category.id
    || product.name !== tenancyFixtureName(runId, "menu-product")
    || group.restaurantId !== restaurantId
    || group.catalogId !== catalog.id
    || group.productId !== product.id
    || group.name !== tenancyFixtureName(runId, "menu-group")
    || option.restaurantId !== restaurantId
    || option.catalogId !== catalog.id
    || option.groupId !== group.id
    || option.name !== tenancyFixtureName(runId, "menu-option")
    || head.restaurantId !== restaurantId
    || head.catalogId !== catalog.id
    || head.version !== 1
    || head.updatedBy !== amberId
    || audit.restaurantId !== restaurantId
    || audit.branchId !== branch.id
    || audit.catalogId !== catalog.id
    || audit.actorId !== amberId
    || audit.resultVersion !== 1
  ) throw contaminationError();
  return Object.freeze({
    auditEventIds: Object.freeze([audit.eventId]),
    catalogIds: Object.freeze([catalog.id]),
    categoryIds: Object.freeze([category.id]),
    headRestaurantIds: Object.freeze([head.restaurantId]),
    modifierGroupIds: Object.freeze([group.id]),
    modifierOptionIds: Object.freeze([option.id]),
    productIds: Object.freeze([product.id]),
  });
}

function validateOrdersRealtime(
  runId: string,
  snapshot: TenancyFixtureRecoverySnapshot,
  amberId: string,
  restaurantId: string,
  branchesByName: ReadonlyMap<string, BranchRow>,
): Readonly<{
  auditEventIds: readonly string[];
  cursorScopes: readonly Readonly<{ branchId: string; restaurantId: string }>[];
  kdsEventIds: readonly string[];
  orderIds: readonly string[];
}> {
  const orders = snapshot.orders ?? [];
  const audits = snapshot.orderAudits ?? [];
  const kdsEvents = snapshot.kdsEvents ?? [];
  const cursors = snapshot.kdsCursors ?? [];
  if (orders.length === 0 && audits.length === 0 && kdsEvents.length === 0 && cursors.length === 0) {
    return Object.freeze({ auditEventIds: Object.freeze([]), cursorScopes: Object.freeze([]), kdsEventIds: Object.freeze([]), orderIds: Object.freeze([]) });
  }
  const branch = branchesByName.get(tenancyFixtureName(runId, "branch-11"));
  const order = orders[0];
  if (orders.length !== 1 || order === undefined || branch === undefined || !UUID_PATTERN.test(order.id)
    || order.restaurantId !== restaurantId || order.branchId !== branch.id || order.actorId !== amberId
    || !((order.channel === "counter" && (order.tableId === null || order.tableId === undefined))
      || (order.channel === "table" && order.tableId !== null
        && (snapshot.diningTables ?? []).some((table) => table.id === order.tableId)))
    || order.version < 1 || order.version > 9
    || order.status !== (order.version < 3 ? "draft" : order.version < 8 ? "open" : order.version === 8 ? "partially_paid" : "paid")) throw contaminationError();

  const expectedOperations = [
    "order.created",
    "order.item_added",
    "order.state_changed",
    "order_item.state_changed",
    "order_item.state_changed",
    "order_item.state_changed",
    "order_item.state_changed",
  ] as const;
  const expectedMarkers = ["create", "add-item", "open", "item-sent", "item-preparing", "item-ready", "item-delivered"] as const;
  if (audits.length !== Math.min(order.version, expectedOperations.length)) throw contaminationError();
  const sortedAudits = [...audits].sort((left, right) => left.resultVersion - right.resultVersion);
  for (const [index, audit] of sortedAudits.entries()) {
    if (!UUID_PATTERN.test(audit.eventId) || audit.resultVersion !== index + 1
      || audit.restaurantId !== restaurantId || audit.branchId !== branch.id || audit.orderId !== order.id
      || audit.actorId !== amberId || audit.operation !== expectedOperations[index]
      || audit.idempotencyKey !== `tenancy-orders-v1:${runId}:${expectedMarkers[index]}`) throw contaminationError();
  }

  const expectedKdsAuditIndexes = [1, 3, 4, 5, 6].filter((index) => index < order.version);
  const expectedKdsStatuses = ["pending", "sent", "preparing", "ready", "delivered"] as const;
  if (kdsEvents.length !== expectedKdsAuditIndexes.length) throw contaminationError();
  const sortedKds = [...kdsEvents].sort((left, right) => left.cursor - right.cursor);
  for (const [index, event] of sortedKds.entries()) {
    const audit = sortedAudits[expectedKdsAuditIndexes[index] ?? -1];
    if (audit === undefined || event.eventId !== audit.eventId || event.cursor !== index + 1
      || event.restaurantId !== restaurantId || event.branchId !== branch.id || event.orderId !== order.id
      || event.stationId !== "kitchen" || event.status !== expectedKdsStatuses[index]
      || event.operation !== (index === 0 ? "order_item.created" : "order_item.status_changed")) throw contaminationError();
  }
  if (sortedKds.length === 0) {
    if (cursors.length !== 0) throw contaminationError();
  } else {
    const cursor = cursors[0];
    if (cursors.length !== 1 || cursor?.restaurantId !== restaurantId || cursor.branchId !== branch.id || cursor.lastCursor !== sortedKds.length) {
      throw contaminationError();
    }
  }
  return Object.freeze({
    auditEventIds: Object.freeze(sortedAudits.map((row) => row.eventId)),
    cursorScopes: Object.freeze(cursors.map((row) => Object.freeze({ branchId: row.branchId, restaurantId: row.restaurantId }))),
    kdsEventIds: Object.freeze(sortedKds.map((row) => row.eventId)),
    orderIds: Object.freeze([order.id]),
  });
}

function validateFinancialJourney(
  runId: string,
  snapshot: TenancyFixtureRecoverySnapshot,
  amberId: string,
  restaurantId: string,
  branchesByName: ReadonlyMap<string, BranchRow>,
  orderIds: readonly string[],
): Readonly<{
  auditEventIds: readonly string[];
  cashMovementIds: readonly string[];
  cashRegisterSessionIds: readonly string[];
  deviceSequenceScopes: readonly Readonly<{ branchId: string; deviceId: string; restaurantId: string }>[];
  paymentIds: readonly string[];
}> {
  const sessions = snapshot.cashRegisterSessions ?? [];
  const payments = snapshot.payments ?? [];
  const movements = snapshot.cashMovements ?? [];
  const audits = snapshot.financialAudits ?? [];
  const sequences = snapshot.financialDeviceSequences ?? [];
  if (sessions.length === 0 && payments.length === 0 && movements.length === 0 && audits.length === 0 && sequences.length === 0) {
    return Object.freeze({
      auditEventIds: Object.freeze([]),
      cashMovementIds: Object.freeze([]),
      cashRegisterSessionIds: Object.freeze([]),
      deviceSequenceScopes: Object.freeze([]),
      paymentIds: Object.freeze([]),
    });
  }
  const branch = branchesByName.get(tenancyFixtureName(runId, "branch-11"));
  const session = sessions[0];
  const orderId = orderIds[0];
  if (sessions.length !== 1 || session === undefined || branch === undefined || orderId === undefined
    || !UUID_PATTERN.test(session.id) || !UUID_PATTERN.test(session.registerId)
    || session.restaurantId !== restaurantId || session.branchId !== branch.id || session.cashierId !== amberId
    || session.currency !== "MXN" || session.version < 1 || session.version > 4
    || session.status !== (session.version === 4 ? "closed" : "open")) throw contaminationError();

  const sortedAudits = [...audits].sort((left, right) => left.resultCashRegisterVersion - right.resultCashRegisterVersion);
  const expectedOperations = ["cash_register.opened", "payment.captured", "payment.captured", "cash_register.closed"] as const;
  const expectedMarkers = ["register-open", "cash-partial", "card-settlement", "register-close"] as const;
  if (sortedAudits.length !== session.version) throw contaminationError();
  for (const [index, audit] of sortedAudits.entries()) {
    const paymentIndex = index - 1;
    if (!UUID_PATTERN.test(audit.eventId) || audit.resultCashRegisterVersion !== index + 1
      || audit.restaurantId !== restaurantId || audit.branchId !== branch.id || audit.actorId !== amberId
      || audit.cashRegisterSessionId !== session.id || audit.operation !== expectedOperations[index]
      || audit.idempotencyKey !== `tenancy-full-flow-v1:${runId}:${expectedMarkers[index]}`
      || (paymentIndex >= 0 && paymentIndex <= 1
        ? audit.orderId !== orderId || audit.paymentId === null || audit.resultOrderVersion !== 8 + paymentIndex
        : audit.orderId !== null || audit.paymentId !== null || audit.resultOrderVersion !== null)) throw contaminationError();
  }
  const paymentAudits = sortedAudits.filter((audit) => audit.operation === "payment.captured");
  if (payments.length !== paymentAudits.length || payments.length > 2) throw contaminationError();
  const sortedPayments = paymentAudits.map((audit) => payments.find((payment) => payment.id === audit.paymentId));
  for (const [index, payment] of sortedPayments.entries()) {
    if (payment === undefined || !UUID_PATTERN.test(payment.id) || payment.restaurantId !== restaurantId
      || payment.branchId !== branch.id || payment.orderId !== orderId || payment.cashRegisterSessionId !== session.id
      || payment.capturedBy !== amberId || payment.currency !== session.currency || payment.amountMinor <= 0
      || payment.method !== (index === 0 ? "cash" : "card_manual")) throw contaminationError();
  }
  if (movements.length !== (payments.length >= 1 ? 1 : 0)) throw contaminationError();
  const movement = movements[0];
  const cashPayment = sortedPayments[0];
  if (movement !== undefined && (cashPayment === undefined || movement.id !== cashPayment.id
    || movement.sourcePaymentId !== cashPayment.id || movement.restaurantId !== restaurantId
    || movement.branchId !== branch.id || movement.cashRegisterSessionId !== session.id || movement.actorId !== amberId
    || !sortedAudits.every((audit) => audit.deviceId === movement.deviceId))) throw contaminationError();
  if (sequences.length !== (payments.length > 0 ? 1 : 0)) throw contaminationError();
  const sequence = sequences[0];
  if (sequence !== undefined && (sequence.restaurantId !== restaurantId || sequence.branchId !== branch.id
    || sequence.lastSequence !== payments.length || sequence.deviceId !== sortedAudits[0]?.deviceId)) throw contaminationError();

  return Object.freeze({
    auditEventIds: Object.freeze(sortedAudits.map((row) => row.eventId)),
    cashMovementIds: Object.freeze(movements.map((row) => row.id)),
    cashRegisterSessionIds: Object.freeze([session.id]),
    deviceSequenceScopes: Object.freeze(sequences.map((row) => Object.freeze({
      branchId: row.branchId,
      deviceId: row.deviceId,
      restaurantId: row.restaurantId,
    }))),
    paymentIds: Object.freeze(payments.map((row) => row.id)),
  });
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

function validateDiningTables(
  runId: string,
  tables: readonly DiningTableRow[],
  audits: readonly DiningTableAuditRow[],
  amberId: string,
  restaurantId: string,
  branchesByName: ReadonlyMap<string, BranchRow>,
  zones: readonly DiningZoneRow[],
): Readonly<{ eventIds: readonly string[]; tableIds: readonly string[] }> {
  if (tables.length === 0 && audits.length === 0) return Object.freeze({ eventIds: Object.freeze([]), tableIds: Object.freeze([]) });
  if (tables.length !== 1 || audits.length < 1 || audits.length > 2) throw contaminationError();
  const table = tables[0];
  const branch = branchesByName.get(tenancyFixtureName(runId, "branch-11"));
  const zone = zones.find((candidate) => candidate.name === tenancyFixtureName(runId, "dining-zone-created"));
  const expectedName = tenancyFixtureName(runId, "dining-table-created");
  if (table === undefined || branch === undefined || zone === undefined || !UUID_PATTERN.test(table.id) || table.restaurantId !== restaurantId || table.branchId !== branch.id || table.zoneId !== zone.id || table.name !== expectedName || table.actorId !== amberId) throw contaminationError();
  const operations = new Set<string>();
  for (const audit of audits) {
    if (!UUID_PATTERN.test(audit.eventId) || audit.restaurantId !== restaurantId || audit.branchId !== branch.id || audit.tableId !== table.id || audit.zoneId !== zone.id || audit.actorId !== amberId || audit.name !== expectedName || !["created", "layout_updated"].includes(audit.operation) || operations.has(audit.operation)) throw contaminationError();
    operations.add(audit.operation);
  }
  if (!operations.has("created")) throw contaminationError();
  return Object.freeze({ eventIds: Object.freeze(audits.map((audit) => audit.eventId)), tableIds: Object.freeze([table.id]) });
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
  idColumn: "event_id" | "id" | "restaurant_id" = "id",
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

async function deleteKdsCursorsExactly(
  client: PoolClient,
  scopes: readonly Readonly<{ branchId: string; restaurantId: string }>[],
): Promise<number> {
  let removed = 0;
  for (const scope of scopes) {
    const result = await client.query(
      `delete from app_private.kds_branch_cursors
       where restaurant_id = $1::uuid and branch_id = $2::uuid`,
      [scope.restaurantId, scope.branchId],
    );
    if (result.rowCount !== 1) throw recoveryError("database", "TENANCY_FIXTURE_RECOVERY_DATABASE_FAILED");
    removed += 1;
  }
  return removed;
}

async function deleteFinancialDeviceSequencesExactly(
  client: PoolClient,
  scopes: readonly Readonly<{ branchId: string; deviceId: string; restaurantId: string }>[],
): Promise<number> {
  let removed = 0;
  for (const scope of scopes) {
    const result = await client.query(
      `delete from app_private.financial_device_sequences
       where restaurant_id=$1::uuid and branch_id=$2::uuid and device_id=$3::uuid`,
      [scope.restaurantId, scope.branchId, scope.deviceId],
    );
    if (result.rowCount !== 1) throw contaminationError();
    removed += 1;
  }
  return removed;
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
