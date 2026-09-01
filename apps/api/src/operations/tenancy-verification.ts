import "reflect-metadata";

import { randomBytes, randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
  DINING_LAYOUT_SCHEMA_VERSION,
  DINING_ZONE_SCHEMA_VERSION,
  parseBranchMembershipListV1,
  parseCreateDiningZoneCommandV1,
  parseCreateDiningTableCommandV1,
  parseDiningLayoutV1,
  parseDiningTableV1,
  parseDiningZoneV1,
  parseUpdateDiningTableLayoutCommandV1,
  type BranchMembershipSummaryV1,
  type CreateDiningZoneCommandV1,
  type CreateDiningTableCommandV1,
  type DiningLayoutV1,
  type DiningTableV1,
  type DiningZoneV1,
  type UpdateDiningTableLayoutCommandV1,
} from "@super-restaurant/shared-types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";

import { AppModule } from "../app.module.js";
import type { DatabaseConfig } from "../database.js";
import {
  codeForStage,
  TenancyVerificationError,
  type TenancyVerificationConfig,
  type TenancyVerificationStage,
} from "./tenancy-verification-config.js";
import { validateCatalogAuditSql } from "./schema-verification.js";
import {
  appApiLifecycleAdvisoryLockKey,
  tenancyAuthMetadataMarker,
  tenancyAuthMetadataVersion,
  tenancyCanarySuffixes,
  tenancyDiningZoneSuffixes,
  tenancyDiningTableSuffixes,
  tenancyFixtureAdvisoryLockKey,
  tenancyFixtureEmail,
  tenancyFixtureName,
  type TenancyFixtureKey,
} from "./tenancy-fixture-markers.js";

type FixtureKey = TenancyFixtureKey;
type AppTable =
  | "roles"
  | "restaurants"
  | "branches"
  | "memberships"
  | "membership_role_grants"
  | "dining_zones"
  | "dining_zone_audit_events"
  | "dining_tables"
  | "dining_table_audit_events";

const appTables: readonly AppTable[] = [
  "roles",
  "restaurants",
  "branches",
  "memberships",
  "membership_role_grants",
];
const expectedRoleCodes = [
  "admin",
  "auditor",
  "cashier",
  "kitchen",
  "manager",
  "owner",
  "supervisor",
  "viewer",
  "waiter",
] as const;
export interface TenancyVerificationSummary {
  readonly checks: number;
  readonly diningZonesVerified: boolean;
  readonly diningTablesVerified: boolean;
  readonly fixtureRowsRemoved: true;
  readonly fixtureUsersRemoved: 2;
  readonly runId: string;
  readonly status: "ok";
}

export interface RunTenancyVerificationOptions {
  readonly apiPort?: number;
  readonly config: TenancyVerificationConfig;
  readonly liveFixtureHooks?: TenancyVerificationLiveFixtureHooks;
  readonly runtimeCatalogAuditSql: string;
  readonly onStart?: (runId: string) => void;
  readonly verifyDiningZones?: true;
  readonly verifyDiningTables?: true;
}

export interface TenancyVerificationLiveFixture {
  readonly apiBaseUrl: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly credentials: Readonly<{ email: string; password: string }>;
  readonly restaurantId: string;
  readonly restaurantName: string;
  readonly runId: string;
}

export interface TenancyVerificationLiveFixtureHooks {
  afterRevocation(fixture: TenancyVerificationLiveFixture): Promise<void>;
  beforeRevocation(fixture: TenancyVerificationLiveFixture): Promise<void>;
}

interface DiningZoneFixtureCommand {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly name: string;
  readonly zoneId: string;
}

interface DiningZoneFixturePlan {
  readonly commands: readonly [
    DiningZoneFixtureCommand,
    DiningZoneFixtureCommand,
    DiningZoneFixtureCommand,
    DiningZoneFixtureCommand,
    DiningZoneFixtureCommand,
  ];
  readonly deviceId: string;
  readonly occurredAt: string;
}

interface DiningTableFixturePlan {
  readonly commands: readonly [DiningZoneFixtureCommand, DiningZoneFixtureCommand, DiningZoneFixtureCommand, DiningZoneFixtureCommand, DiningZoneFixtureCommand];
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly updateEventId: string;
  readonly updateIdempotencyKey: string;
  readonly updateOccurredAt: string;
  readonly staleEventId: string;
  readonly staleIdempotencyKey: string;
}

interface FixtureUserPlan {
  readonly branchIds: readonly string[];
  readonly credentials: Readonly<{ email: string; password: string }>;
  readonly fixtureKey: FixtureKey;
  readonly restaurantId: string;
  userId?: string;
}

interface FixturePlan {
  readonly branchIds: readonly [string, string, string, string];
  readonly canaryRestaurantIds: readonly [string, string, string];
  readonly grantIds: readonly [string, string, string, string, string];
  readonly membershipIds: readonly [string, string, string, string];
  readonly restaurantIds: readonly [string, string];
  readonly diningZones: DiningZoneFixturePlan;
  readonly diningTables: DiningTableFixturePlan;
  readonly runId: string;
  readonly users: readonly [FixtureUserPlan, FixtureUserPlan];
  authCreationAttempted: boolean;
  databaseFixturesInserted: boolean;
  diningZoneCreated: boolean;
  diningZonesEnabled: boolean;
  diningTableCreated: boolean;
  diningTablesEnabled: boolean;
}

interface AuthenticatedFixture {
  readonly accessToken: string;
  readonly client: SupabaseClient;
  readonly fixtureKey: FixtureKey;
  readonly userId: string;
}

class VerificationCounter {
  public checks = 0;

  public assert(stage: TenancyVerificationStage, condition: boolean): void {
    this.checks += 1;
    if (!condition) {
      throw new TenancyVerificationError(stage, "TENANCY_VERIFICATION_ASSERTION_FAILED");
    }
  }
}

export async function runTenancyVerification(
  options: RunTenancyVerificationOptions,
): Promise<TenancyVerificationSummary> {
  const verifyDiningTables = options.verifyDiningTables === true;
  const verifyDiningZones = options.verifyDiningZones === true || verifyDiningTables;
  const runtimeCatalogAuditSql = validateRuntimeAuditSql(
    options.runtimeCatalogAuditSql,
    verifyDiningZones,
    verifyDiningTables,
  );
  const apiPort = readApiPort(options.apiPort);
  const plan = createFixturePlan(verifyDiningZones, verifyDiningTables);
  options.onStart?.(plan.runId);
  const counter = new VerificationCounter();
  const adminPool = createPool(options.config.adminDatabase, "super-restaurant-tenancy-admin");
  const appApiPool = createPool(options.config.appDatabase, "super-restaurant-tenancy-app-api");
  const serverClient = createSupabaseClient(options.config.supabaseUrl, options.config.secretKey);
  let app: INestApplication | undefined;
  let operationLock: PoolClient | undefined;
  let failure: TenancyVerificationError | undefined;

  try {
    operationLock = await executeStage("fixtures", async () => acquireFixtureOperationLock(adminPool, plan.runId));
    await executeStage("catalog_audit", async () => {
      await adminPool.query(runtimeCatalogAuditSql);
    });
    await executeStage("app_api", async () => verifyAppApiSurface(appApiPool, counter, verifyDiningZones, verifyDiningTables));
    await executeStage("fixtures", async () => createFixtures(serverClient, adminPool, plan, counter));
    const authenticated = await executeStage("authentication", async () => authenticateFixtures(options.config, plan, counter));

    app = await executeStage("http", async () => startProductApi(apiPort));
    await executeStage("data_api", async () => verifyDataApiBaseline(
      options.config,
      plan,
      authenticated,
      counter,
      verifyDiningZones,
      verifyDiningTables,
    ));
    await executeStage("app_api", async () => verifyPrivateLookupBaseline(appApiPool, plan, counter));
    await executeStage("http", async () => verifyHttpBaseline(app as INestApplication, plan, authenticated, counter));
    const liveFixture = await readLiveFixture(app as INestApplication, plan);
    if (options.liveFixtureHooks !== undefined) {
      await executeStage("http", async () => options.liveFixtureHooks?.beforeRevocation(liveFixture));
    }
    if (verifyDiningZones) {
      await executeStage("dining_zones", async () => verifyDiningZonesBaseline(
        adminPool,
        app as INestApplication,
        plan,
        authenticated,
        counter,
      ));
    }
    if (verifyDiningTables) {
      await executeStage("dining_tables", async () => verifyDiningTablesBaseline(
        adminPool,
        app as INestApplication,
        plan,
        authenticated,
        counter,
      ));
    }
    await executeStage("revocation", async () => verifyRevocations(
      adminPool,
      appApiPool,
      app as INestApplication,
      plan,
      authenticated,
      counter,
    ));
    if (options.liveFixtureHooks !== undefined) {
      await executeStage("http", async () => options.liveFixtureHooks?.afterRevocation(liveFixture));
    }
    if (verifyDiningTables) {
      await executeStage("dining_tables", async () => verifyDiningTableAfterRevocation(
        adminPool,
        app as INestApplication,
        plan,
        authenticated[0],
        counter,
      ));
    }
    if (verifyDiningZones) {
      await executeStage("dining_zones", async () => verifyDiningZoneAfterRevocation(
        adminPool,
        app as INestApplication,
        plan,
        authenticated[0],
        counter,
      ));
    }
    await executeStage("constraints", async () => verifyConstraints(adminPool, plan, counter));
  } catch (error: unknown) {
    failure = sanitizeExecutionError(error);
  } finally {
    try {
      if (app !== undefined) await app.close();
    } catch {
      failure ??= new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
    }

    try {
      await cleanupFixtures(serverClient, adminPool, plan, counter);
    } catch {
      failure = new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
    }

    if (operationLock !== undefined) {
      await rollbackQuietly(operationLock);
      operationLock.release();
    }

    try {
      await Promise.all([appApiPool.end(), adminPool.end()]);
    } catch {
      failure ??= new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
    }
  }

  if (failure !== undefined) throw failure;
  return Object.freeze({
    checks: counter.checks,
    diningZonesVerified: verifyDiningZones,
    diningTablesVerified: verifyDiningTables,
    fixtureRowsRemoved: true,
    fixtureUsersRemoved: 2,
    runId: plan.runId,
    status: "ok",
  });
}

async function acquireFixtureOperationLock(pool: Pool, runId: string): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "select pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))",
      [appApiLifecycleAdvisoryLockKey],
    );
    await client.query(
      "select pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))",
      [tenancyFixtureAdvisoryLockKey(runId)],
    );
    return client;
  } catch {
    await rollbackQuietly(client);
    client.release();
    throw new TenancyVerificationError("fixtures", "TENANCY_VERIFICATION_FIXTURES_FAILED");
  }
}

function createFixturePlan(diningZonesEnabled: boolean, diningTablesEnabled: boolean): FixturePlan {
  const runId = randomUUID();
  const restaurantIds = [randomUUID(), randomUUID()] as const;
  const branchIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
  const diningZones: DiningZoneFixturePlan = {
    commands: tenancyDiningZoneSuffixes.map((suffix) => ({
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      name: tenancyFixtureName(runId, suffix),
      zoneId: randomUUID(),
    })) as unknown as DiningZoneFixturePlan["commands"],
    deviceId: randomUUID(),
    occurredAt: new Date().toISOString(),
  };
  const diningTables: DiningTableFixturePlan = {
    commands: tenancyDiningTableSuffixes.map((suffix) => ({
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      name: tenancyFixtureName(runId, suffix),
      zoneId: randomUUID(),
    })) as unknown as DiningTableFixturePlan["commands"],
    deviceId: randomUUID(),
    occurredAt: new Date().toISOString(),
    staleEventId: randomUUID(),
    staleIdempotencyKey: randomUUID(),
    updateEventId: randomUUID(),
    updateIdempotencyKey: randomUUID(),
    updateOccurredAt: new Date(Date.now() + 1_000).toISOString(),
  };
  return {
    branchIds,
    authCreationAttempted: false,
    canaryRestaurantIds: [randomUUID(), randomUUID(), randomUUID()],
    databaseFixturesInserted: false,
    diningZoneCreated: false,
    diningZones,
    diningZonesEnabled,
    diningTableCreated: false,
    diningTables,
    diningTablesEnabled,
    grantIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    membershipIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    restaurantIds,
    runId,
    users: [
      {
        branchIds: [branchIds[0], branchIds[1]],
        credentials: createCredentials("amber", runId),
        fixtureKey: "amber",
        restaurantId: restaurantIds[0],
      },
      {
        branchIds: [branchIds[2], branchIds[3]],
        credentials: createCredentials("cobalt", runId),
        fixtureKey: "cobalt",
        restaurantId: restaurantIds[1],
      },
    ],
  };
}

function createCredentials(fixtureKey: FixtureKey, runId: string): Readonly<{ email: string; password: string }> {
  return Object.freeze({
    email: tenancyFixtureEmail(runId, fixtureKey),
    password: randomBytes(32).toString("base64url"),
  });
}

function createPool(config: DatabaseConfig, applicationName: string): Pool {
  return new Pool({
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    connectionString: config.connectionString,
    idleTimeoutMillis: 5_000,
    max: 3,
    query_timeout: 10_000,
    ssl: { ca: config.caCertificate, rejectUnauthorized: true },
    statement_timeout: 10_000,
  });
}

function createSupabaseClient(url: string, key: string, accessToken?: string): SupabaseClient {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    ...(accessToken === undefined ? {} : { global: { headers: { Authorization: `Bearer ${accessToken}` } } }),
  });
}

async function createFixtures(
  serverClient: SupabaseClient,
  adminPool: Pool,
  plan: FixturePlan,
  counter: VerificationCounter,
): Promise<void> {
  for (const user of plan.users) {
    plan.authCreationAttempted = true;
    const result = await serverClient.auth.admin.createUser({
      app_metadata: {
        fixture_key: user.fixtureKey,
        run_id: plan.runId,
        [tenancyAuthMetadataMarker]: tenancyAuthMetadataVersion,
      },
      email: user.credentials.email,
      email_confirm: true,
      password: user.credentials.password,
    });
    counter.assert("fixtures", result.error === null && result.data.user !== null);
    if (result.data.user === null) throw new TenancyVerificationError("fixtures", "TENANCY_VERIFICATION_FIXTURES_FAILED");
    user.userId = result.data.user.id;
  }

  const amberId = requireUserId(plan.users[0]);
  const cobaltId = requireUserId(plan.users[1]);
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `insert into app.restaurants (id, name) values ($1::uuid, $3::text), ($2::uuid, $4::text)`,
      [
        plan.restaurantIds[0],
        plan.restaurantIds[1],
        tenancyFixtureName(plan.runId, "restaurant-1"),
        tenancyFixtureName(plan.runId, "restaurant-2"),
      ],
    );
    await client.query(
      `insert into app.branches (id, restaurant_id, name) values
        ($1::uuid, $5::uuid, $7::text),
        ($2::uuid, $5::uuid, $8::text),
        ($3::uuid, $6::uuid, $9::text),
        ($4::uuid, $6::uuid, $10::text)`,
      [
        ...plan.branchIds,
        ...plan.restaurantIds,
        tenancyFixtureName(plan.runId, "branch-11"),
        tenancyFixtureName(plan.runId, "branch-12"),
        tenancyFixtureName(plan.runId, "branch-21"),
        tenancyFixtureName(plan.runId, "branch-22"),
      ],
    );
    await client.query(
      `insert into app.memberships (id, user_id, restaurant_id, branch_id, granted_by) values
        ($1::uuid, $5::uuid, $7::uuid, $9::uuid, $5::uuid),
        ($2::uuid, $5::uuid, $7::uuid, $10::uuid, $5::uuid),
        ($3::uuid, $6::uuid, $8::uuid, $11::uuid, $5::uuid),
        ($4::uuid, $6::uuid, $8::uuid, $12::uuid, $5::uuid)`,
      [...plan.membershipIds, amberId, cobaltId, ...plan.restaurantIds, ...plan.branchIds],
    );
    await client.query(
      `insert into app.membership_role_grants (id, membership_id, role_code, granted_by) values
        ($1::uuid, $6::uuid, 'manager', $10::uuid),
        ($2::uuid, $6::uuid, 'waiter', $10::uuid),
        ($3::uuid, $7::uuid, 'viewer', $10::uuid),
        ($4::uuid, $8::uuid, 'cashier', $10::uuid),
        ($5::uuid, $9::uuid, 'kitchen', $10::uuid)`,
      [...plan.grantIds, ...plan.membershipIds, amberId],
    );
    await client.query("COMMIT");
    plan.databaseFixturesInserted = true;
  } catch {
    await rollbackQuietly(client);
    throw new TenancyVerificationError("fixtures", "TENANCY_VERIFICATION_FIXTURES_FAILED");
  } finally {
    client.release();
  }
}

async function authenticateFixtures(
  config: TenancyVerificationConfig,
  plan: FixturePlan,
  counter: VerificationCounter,
): Promise<readonly [AuthenticatedFixture, AuthenticatedFixture]> {
  const authenticated: AuthenticatedFixture[] = [];
  for (const user of plan.users) {
    const loginClient = createSupabaseClient(config.supabaseUrl, config.publishableKey);
    const result = await loginClient.auth.signInWithPassword(user.credentials);
    const expectedUserId = requireUserId(user);
    counter.assert(
      "authentication",
      result.error === null && result.data.session !== null && result.data.user?.id === expectedUserId,
    );
    if (result.data.session === null) {
      throw new TenancyVerificationError("authentication", "TENANCY_VERIFICATION_AUTHENTICATION_FAILED");
    }
    const accessToken = result.data.session.access_token;
    const client = createSupabaseClient(config.supabaseUrl, config.publishableKey, accessToken);
    const verified = await client.auth.getUser(accessToken);
    counter.assert("authentication", verified.error === null && verified.data.user?.id === expectedUserId);
    authenticated.push({ accessToken, client, fixtureKey: user.fixtureKey, userId: expectedUserId });
  }
  if (authenticated.length !== 2) {
    throw new TenancyVerificationError("authentication", "TENANCY_VERIFICATION_AUTHENTICATION_FAILED");
  }
  return authenticated as unknown as readonly [AuthenticatedFixture, AuthenticatedFixture];
}

async function startProductApi(port: number): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { abortOnError: false, logger: false });
  try {
    app.setGlobalPrefix("api/v1");
    app.enableShutdownHooks();
    await app.listen(port, "127.0.0.1");
    return app;
  } catch {
    try {
      await app.close();
    } catch {
      // The outer stage maps both failures to one non-sensitive HTTP code.
    }
    throw new TenancyVerificationError("http", "TENANCY_VERIFICATION_HTTP_FAILED");
  }
}

async function readLiveFixture(
  app: INestApplication,
  plan: FixturePlan,
): Promise<TenancyVerificationLiveFixture> {
  return Object.freeze({
    apiBaseUrl: await app.getUrl(),
    branchId: plan.branchIds[0],
    branchName: tenancyFixtureName(plan.runId, "branch-11"),
    credentials: plan.users[0].credentials,
    restaurantId: plan.restaurantIds[0],
    restaurantName: tenancyFixtureName(plan.runId, "restaurant-1"),
    runId: plan.runId,
  });
}

async function verifyDataApiBaseline(
  config: TenancyVerificationConfig,
  plan: FixturePlan,
  authenticated: readonly [AuthenticatedFixture, AuthenticatedFixture],
  counter: VerificationCounter,
  verifyDiningZones: boolean,
  verifyDiningTables: boolean,
): Promise<void> {
  const anon = createSupabaseClient(config.supabaseUrl, config.publishableKey);
  const serviceRole = createSupabaseClient(config.supabaseUrl, config.secretKey);
  const tables = verifyDiningTables
    ? [...appTables, "dining_zones", "dining_zone_audit_events", "dining_tables", "dining_table_audit_events"] as const
    : verifyDiningZones
    ? [...appTables, "dining_zones", "dining_zone_audit_events"] as const
    : appTables;
  for (const table of tables) {
    await expectDataApiDeniedRead(anon, table, counter);
    await expectDataApiDeniedRead(serviceRole, table, counter);
  }
  await expectDataApiDeniedWrites(
    anon,
    plan.canaryRestaurantIds[0],
    tenancyFixtureName(plan.runId, tenancyCanarySuffixes[0]),
    counter,
  );
  await expectDataApiDeniedWrites(
    authenticated[0].client,
    plan.canaryRestaurantIds[1],
    tenancyFixtureName(plan.runId, tenancyCanarySuffixes[1]),
    counter,
  );
  await expectDataApiDeniedWrites(
    serviceRole,
    plan.canaryRestaurantIds[2],
    tenancyFixtureName(plan.runId, tenancyCanarySuffixes[2]),
    counter,
  );

  await assertVisibleIds(authenticated[0].client, "restaurants", plan.restaurantIds, [plan.restaurantIds[0]], counter, "data_api");
  await assertVisibleIds(authenticated[0].client, "branches", plan.branchIds, [plan.branchIds[0], plan.branchIds[1]], counter, "data_api");
  await assertVisibleIds(authenticated[0].client, "memberships", plan.membershipIds, [plan.membershipIds[0], plan.membershipIds[1]], counter, "data_api");
  await assertVisibleIds(authenticated[0].client, "membership_role_grants", plan.grantIds, [plan.grantIds[0], plan.grantIds[1], plan.grantIds[2]], counter, "data_api");
  await assertVisibleIds(authenticated[1].client, "restaurants", plan.restaurantIds, [plan.restaurantIds[1]], counter, "data_api");
  await assertVisibleIds(authenticated[1].client, "branches", plan.branchIds, [plan.branchIds[2], plan.branchIds[3]], counter, "data_api");

  const roles = await authenticated[0].client.schema("app").from("roles").select("code");
  counter.assert("data_api", roles.error === null && Array.isArray(roles.data));
  const roleCodes = Array.isArray(roles.data)
    ? roles.data.map((row) => readStringProperty(row, "code")).filter((value): value is string => value !== undefined).sort()
    : [];
  counter.assert("data_api", arraysEqual(roleCodes, [...expectedRoleCodes]));

  const falsePair = await authenticated[0].client
    .schema("app")
    .from("branches")
    .select("id")
    .eq("restaurant_id", plan.restaurantIds[0])
    .eq("id", plan.branchIds[2]);
  counter.assert("data_api", falsePair.error === null && Array.isArray(falsePair.data) && falsePair.data.length === 0);
}

async function expectDataApiDeniedRead(
  client: SupabaseClient,
  table: AppTable,
  counter: VerificationCounter,
): Promise<void> {
  const result = await client.schema("app").from(table).select("*").limit(1);
  counter.assert("data_api", result.data === null && result.error?.code === "42501");
}

async function expectDataApiDeniedWrites(
  client: SupabaseClient,
  canaryRestaurantId: string,
  canaryName: string,
  counter: VerificationCounter,
): Promise<void> {
  const insert = await client.schema("app").from("restaurants").insert({
    id: canaryRestaurantId,
    name: canaryName,
  }).select("id");
  counter.assert("data_api", insert.data === null && insert.error?.code === "42501");

  const update = await client.schema("app").from("restaurants").update({ name: canaryName }).eq("id", canaryRestaurantId).select("id");
  counter.assert("data_api", update.data === null && update.error?.code === "42501");

  const deletion = await client.schema("app").from("restaurants").delete().eq("id", canaryRestaurantId).select("id");
  counter.assert("data_api", deletion.data === null && deletion.error?.code === "42501");
}

async function assertVisibleIds(
  client: SupabaseClient,
  table: AppTable,
  candidateIds: readonly string[],
  expectedIds: readonly string[],
  counter: VerificationCounter,
  stage: TenancyVerificationStage,
): Promise<void> {
  const result = await client.schema("app").from(table).select("id").in("id", [...candidateIds]);
  counter.assert(stage, result.error === null && Array.isArray(result.data));
  const actualIds = readVisibleIds(result.data);
  counter.assert(stage, arraysEqual(actualIds, [...expectedIds].sort()));
}

async function verifyAppApiSurface(
  appApiPool: Pool,
  counter: VerificationCounter,
  verifyDiningZones: boolean,
  verifyDiningTables: boolean,
): Promise<void> {
  const identity = await appApiPool.query<{ currentUser: string; sessionUser: string }>(
    `select current_user::text as "currentUser", session_user::text as "sessionUser"`,
  );
  counter.assert("app_api", identity.rows.length === 1 && identity.rows[0]?.currentUser === "app_api" && identity.rows[0]?.sessionUser === "app_api");
  await expectPostgresDenied(appApiPool, "select * from app.roles limit 1", [], counter, "app_api");
  await expectPostgresDenied(appApiPool, "insert into app.roles (code) values ('tenancy_canary')", [], counter, "app_api");
  await expectPostgresDenied(appApiPool, "select app_rls.has_active_restaurant_membership($1::uuid)", [randomUUID()], counter, "app_api");
  await assertPrivateDirectory(appApiPool, randomUUID(), [], counter, "app_api");
  if (verifyDiningZones) {
    await expectPostgresDenied(appApiPool, "select * from app.dining_zones limit 1", [], counter, "app_api");
    await expectPostgresDenied(
      appApiPool,
      "select * from app.dining_zone_audit_events limit 1",
      [],
      counter,
      "app_api",
    );
  }
  if (verifyDiningTables) {
    await expectPostgresDenied(appApiPool, "select * from app.dining_tables limit 1", [], counter, "app_api");
    await expectPostgresDenied(appApiPool, "select * from app.dining_table_audit_events limit 1", [], counter, "app_api");
  }
}

async function verifyPrivateLookupBaseline(appApiPool: Pool, plan: FixturePlan, counter: VerificationCounter): Promise<void> {
  const amberId = requireUserId(plan.users[0]);
  const cobaltId = requireUserId(plan.users[1]);
  await assertPrivateLookup(appApiPool, amberId, plan.restaurantIds[0], plan.branchIds[0], ["manager", "waiter"], counter, "app_api");
  await assertPrivateLookup(appApiPool, amberId, plan.restaurantIds[0], plan.branchIds[1], ["viewer"], counter, "app_api");
  await assertPrivateLookup(appApiPool, amberId, plan.restaurantIds[1], plan.branchIds[2], [], counter, "app_api");
  await assertPrivateLookup(appApiPool, amberId, plan.restaurantIds[0], plan.branchIds[2], [], counter, "app_api");
  await assertPrivateDirectory(appApiPool, amberId, expectedDirectory(plan, 0), counter, "app_api");
  await assertPrivateDirectory(appApiPool, cobaltId, expectedDirectory(plan, 1), counter, "app_api");
}

async function assertPrivateDirectory(
  appApiPool: Pool,
  actorId: string,
  expected: readonly BranchMembershipSummaryV1[],
  counter: VerificationCounter,
  stage: TenancyVerificationStage,
): Promise<void> {
  const result = await appApiPool.query<{
    branch_id: unknown;
    branch_name: unknown;
    restaurant_id: unknown;
    restaurant_name: unknown;
    roles: unknown;
  }>(
    `select
       restaurant_id::text,
       restaurant_name,
       branch_id::text,
       branch_name,
       roles
     from app_private.list_active_branch_memberships($1::uuid)
     order by restaurant_id, branch_id`,
    [actorId],
  );
  const parsed = parseBranchMembershipListV1({
    memberships: result.rows.map((row) => ({
      branchName: row.branch_name,
      restaurantName: row.restaurant_name,
      roles: row.roles,
      scope: { branchId: row.branch_id, restaurantId: row.restaurant_id },
    })),
    schemaVersion: BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
  });
  counter.assert(
    stage,
    parsed !== undefined
      && valuesEqual(parsed, { memberships: expected, schemaVersion: BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION }),
  );
}

async function assertPrivateLookup(
  appApiPool: Pool,
  actorId: string,
  restaurantId: string,
  branchId: string,
  expectedRoles: readonly string[],
  counter: VerificationCounter,
  stage: TenancyVerificationStage,
): Promise<void> {
  const result = await appApiPool.query<{ roles: unknown }>(
    `select roles from app_private.find_active_branch_membership($1::uuid, $2::uuid, $3::uuid)`,
    [actorId, restaurantId, branchId],
  );
  if (expectedRoles.length === 0) {
    counter.assert(stage, result.rows.length === 0);
    return;
  }
  counter.assert(stage, result.rows.length === 1 && Array.isArray(result.rows[0]?.roles));
  const roles = Array.isArray(result.rows[0]?.roles) ? result.rows[0].roles : [];
  counter.assert(stage, arraysEqual(roles, expectedRoles));
}

async function verifyHttpBaseline(
  app: INestApplication,
  plan: FixturePlan,
  authenticated: readonly [AuthenticatedFixture, AuthenticatedFixture],
  counter: VerificationCounter,
): Promise<void> {
  const baseUrl = await app.getUrl();
  await assertHttp(baseUrl, "/api/v1/session", undefined, 401, { code: "AUTHENTICATION_REQUIRED" }, counter);
  await assertHttp(baseUrl, "/api/v1/session", "invalid-access-token-value", 401, { code: "AUTHENTICATION_REQUIRED" }, counter);
  await assertHttp(baseUrl, "/api/v1/session", authenticated[0].accessToken, 200, { actorId: authenticated[0].userId }, counter);
  await assertHttp(baseUrl, "/api/v1/access/memberships", undefined, 401, { code: "AUTHENTICATION_REQUIRED" }, counter);
  await assertMembershipDirectoryHttp(baseUrl, authenticated[0].accessToken, expectedDirectory(plan, 0), counter);
  await assertMembershipDirectoryHttp(baseUrl, authenticated[1].accessToken, expectedDirectory(plan, 1), counter);
  // Branch selection intentionally accepts every known membership role. Its
  // 403 evidence is exact-scope/membership denial, not an action-specific RBAC
  // denial; that belongs to the first product route with a narrower role set.
  await assertBranchHttp(baseUrl, authenticated[0].accessToken, plan.restaurantIds[0], plan.branchIds[0], 200, ["manager", "waiter"], counter);
  await assertBranchHttp(baseUrl, authenticated[0].accessToken, plan.restaurantIds[0], plan.branchIds[1], 200, ["viewer"], counter);
  await assertBranchHttp(baseUrl, authenticated[0].accessToken, plan.restaurantIds[1], plan.branchIds[2], 403, undefined, counter);
  await assertBranchHttp(baseUrl, authenticated[0].accessToken, plan.restaurantIds[0], plan.branchIds[2], 403, undefined, counter);
  await assertBranchHttp(baseUrl, authenticated[1].accessToken, plan.restaurantIds[1], plan.branchIds[2], 200, ["cashier"], counter);
  await assertBranchHttp(baseUrl, authenticated[1].accessToken, plan.restaurantIds[1], plan.branchIds[3], 200, ["kitchen"], counter);
}

async function verifyDiningZonesBaseline(
  adminPool: Pool,
  app: INestApplication,
  plan: FixturePlan,
  authenticated: readonly [AuthenticatedFixture, AuthenticatedFixture],
  counter: VerificationCounter,
): Promise<void> {
  const baseUrl = await app.getUrl();
  const managerCommand = diningZoneCommand(plan, 0, plan.restaurantIds[0], plan.branchIds[0]);

  await assertDiningZoneError(baseUrl, undefined, managerCommand, 401, "AUTHENTICATION_REQUIRED", counter);
  await assertDiningZonePersistence(adminPool, plan, undefined, counter);

  const created = await assertDiningZoneSuccess(
    baseUrl,
    authenticated[0].accessToken,
    managerCommand,
    false,
    authenticated[0].userId,
    counter,
  );
  plan.diningZoneCreated = true;
  await assertDiningZonePersistence(adminPool, plan, created, counter);

  const replayed = await assertDiningZoneSuccess(
    baseUrl,
    authenticated[0].accessToken,
    managerCommand,
    true,
    authenticated[0].userId,
    counter,
  );
  counter.assert("dining_zones", replayed.createdAt === created.createdAt);
  await assertDiningZonePersistence(adminPool, plan, created, counter);

  const conflictCommand = {
    ...diningZoneCommand(plan, 1, plan.restaurantIds[0], plan.branchIds[0]),
    idempotencyKey: managerCommand.idempotencyKey,
  } satisfies CreateDiningZoneCommandV1;
  await assertDiningZoneError(
    baseUrl,
    authenticated[0].accessToken,
    conflictCommand,
    409,
    "DINING_ZONE_CONFLICT",
    counter,
  );
  await assertDiningZonePersistence(adminPool, plan, created, counter);

  const viewerCommand = diningZoneCommand(plan, 2, plan.restaurantIds[0], plan.branchIds[1]);
  await assertDiningZoneError(
    baseUrl,
    authenticated[0].accessToken,
    viewerCommand,
    403,
    "ACTION_NOT_AUTHORIZED",
    counter,
  );
  await assertDiningZonePersistence(adminPool, plan, created, counter);

  const falsePairCommand = diningZoneCommand(plan, 3, plan.restaurantIds[0], plan.branchIds[2]);
  await assertDiningZoneError(
    baseUrl,
    authenticated[0].accessToken,
    falsePairCommand,
    403,
    "ACTION_NOT_AUTHORIZED",
    counter,
  );
  await assertDiningZonePersistence(adminPool, plan, created, counter);
}

async function verifyDiningZoneAfterRevocation(
  adminPool: Pool,
  app: INestApplication,
  plan: FixturePlan,
  authenticated: AuthenticatedFixture,
  counter: VerificationCounter,
): Promise<void> {
  const baseUrl = await app.getUrl();
  const command = diningZoneCommand(plan, 4, plan.restaurantIds[0], plan.branchIds[0]);
  await assertDiningZoneError(
    baseUrl,
    authenticated.accessToken,
    command,
    403,
    "ACTION_NOT_AUTHORIZED",
    counter,
  );
  await assertDiningZonePersistence(adminPool, plan, undefined, counter, true);
}

function diningZoneCommand(
  plan: FixturePlan,
  commandIndex: 0 | 1 | 2 | 3 | 4,
  restaurantId: string,
  branchId: string,
): CreateDiningZoneCommandV1 {
  const fixture = plan.diningZones.commands[commandIndex];
  const command = parseCreateDiningZoneCommandV1({
    deviceId: plan.diningZones.deviceId,
    eventId: fixture.eventId,
    idempotencyKey: fixture.idempotencyKey,
    name: fixture.name,
    occurredAt: plan.diningZones.occurredAt,
    schemaVersion: DINING_ZONE_SCHEMA_VERSION,
    scope: { branchId, restaurantId },
    zoneId: fixture.zoneId,
  });
  if (command === undefined) {
    throw new TenancyVerificationError("dining_zones", "TENANCY_VERIFICATION_DINING_ZONES_FAILED");
  }
  return command;
}

async function assertDiningZoneSuccess(
  baseUrl: string,
  accessToken: string,
  command: CreateDiningZoneCommandV1,
  expectedReplay: boolean,
  actorId: string,
  counter: VerificationCounter,
): Promise<DiningZoneV1> {
  const response = await postDiningZone(baseUrl, accessToken, command);
  const parsed = parseDiningZoneV1(await response.json());
  counter.assert(
    "dining_zones",
    response.status === 201
      && response.headers.get("cache-control") === "private, no-store"
      && parsed !== undefined
      && parsed.createdBy === actorId
      && parsed.name === command.name
      && parsed.replayed === expectedReplay
      && parsed.schemaVersion === DINING_ZONE_SCHEMA_VERSION
      && parsed.scope.branchId === command.scope.branchId
      && parsed.scope.restaurantId === command.scope.restaurantId
      && parsed.version === 1
      && parsed.zoneId === command.zoneId,
  );
  if (parsed === undefined) {
    throw new TenancyVerificationError("dining_zones", "TENANCY_VERIFICATION_DINING_ZONES_FAILED");
  }
  return parsed;
}

async function assertDiningZoneError(
  baseUrl: string,
  accessToken: string | undefined,
  command: CreateDiningZoneCommandV1,
  expectedStatus: number,
  expectedCode: string,
  counter: VerificationCounter,
): Promise<void> {
  const response = await postDiningZone(baseUrl, accessToken, command);
  const body: unknown = await response.json();
  counter.assert(
    "dining_zones",
    response.status === expectedStatus && recordsEqual(body, { code: expectedCode }),
  );
}

async function postDiningZone(
  baseUrl: string,
  accessToken: string | undefined,
  command: CreateDiningZoneCommandV1,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/dining/zones`, {
    body: JSON.stringify(command),
    headers: {
      ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
      "content-type": "application/json",
    },
    method: "POST",
  });
}

async function assertDiningZonePersistence(
  adminPool: Pool,
  plan: FixturePlan,
  created: DiningZoneV1 | undefined,
  counter: VerificationCounter,
  expectCreatedFromPlan = false,
): Promise<void> {
  const zoneIds = plan.diningZones.commands.map((command) => command.zoneId);
  const eventIds = plan.diningZones.commands.map((command) => command.eventId);
  const zones = await adminPool.query<{
    branchId: string;
    createdAt: Date;
    createdBy: string;
    id: string;
    name: string;
    restaurantId: string;
    version: string;
  }>(
    `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId", name,
       version::text, created_at as "createdAt", created_by::text as "createdBy"
     from app.dining_zones where id = any($1::uuid[]) order by id`,
    [[...zoneIds]],
  );
  const audits = await adminPool.query<{
    actorId: string;
    branchId: string;
    deviceId: string;
    eventId: string;
    idempotencyKey: string;
    name: string;
    occurredAt: Date;
    operation: string;
    restaurantId: string;
    zoneId: string;
  }>(
    `select event_id::text as "eventId", idempotency_key::text as "idempotencyKey",
       restaurant_id::text as "restaurantId", branch_id::text as "branchId", zone_id::text as "zoneId",
       actor_id::text as "actorId", device_id::text as "deviceId", operation,
       name_snapshot as name, occurred_at as "occurredAt"
     from app.dining_zone_audit_events where event_id = any($1::uuid[]) order by event_id`,
    [[...eventIds]],
  );

  const expectedCreatedAt = created?.createdAt
    ?? (expectCreatedFromPlan && plan.diningZoneCreated ? zones.rows[0]?.createdAt.toISOString() : undefined);
  if (expectedCreatedAt === undefined) {
    counter.assert("dining_zones", zones.rows.length === 0 && audits.rows.length === 0);
    return;
  }

  const zone = zones.rows[0];
  const audit = audits.rows[0];
  const fixture = plan.diningZones.commands[0];
  counter.assert(
    "dining_zones",
    zones.rows.length === 1
      && audits.rows.length === 1
      && zone !== undefined
      && audit !== undefined
      && zone.id === fixture.zoneId
      && zone.restaurantId === plan.restaurantIds[0]
      && zone.branchId === plan.branchIds[0]
      && zone.name === fixture.name
      && zone.version === "1"
      && zone.createdAt.toISOString() === expectedCreatedAt
      && zone.createdBy === requireUserId(plan.users[0])
      && audit.eventId === fixture.eventId
      && audit.idempotencyKey === fixture.idempotencyKey
      && audit.restaurantId === plan.restaurantIds[0]
      && audit.branchId === plan.branchIds[0]
      && audit.zoneId === fixture.zoneId
      && audit.actorId === requireUserId(plan.users[0])
      && audit.deviceId === plan.diningZones.deviceId
      && audit.operation === "created"
      && audit.name === fixture.name
      && audit.occurredAt.toISOString() === plan.diningZones.occurredAt,
  );
}

async function verifyDiningTablesBaseline(
  adminPool: Pool,
  app: INestApplication,
  plan: FixturePlan,
  authenticated: readonly [AuthenticatedFixture, AuthenticatedFixture],
  counter: VerificationCounter,
): Promise<void> {
  const baseUrl = await app.getUrl();
  const command = diningTableCommand(plan, 0, plan.restaurantIds[0], plan.branchIds[0]);
  await assertDiningTableError(baseUrl, undefined, command, "POST", 401, "AUTHENTICATION_REQUIRED", counter);
  await assertDiningTablePersistence(adminPool, plan, undefined, counter);

  const created = await assertDiningTableSuccess(baseUrl, authenticated[0].accessToken, command, "POST", false, 1, authenticated[0].userId, counter);
  plan.diningTableCreated = true;
  await assertDiningTablePersistence(adminPool, plan, created, counter);
  const replayed = await assertDiningTableSuccess(baseUrl, authenticated[0].accessToken, command, "POST", true, 1, authenticated[0].userId, counter);
  counter.assert("dining_tables", replayed.updatedAt === created.updatedAt);

  const conflict = { ...diningTableCommand(plan, 1, plan.restaurantIds[0], plan.branchIds[0]), idempotencyKey: command.idempotencyKey } satisfies CreateDiningTableCommandV1;
  await assertDiningTableError(baseUrl, authenticated[0].accessToken, conflict, "POST", 409, "DINING_TABLE_CONFLICT", counter);
  await assertDiningTableError(baseUrl, authenticated[0].accessToken, diningTableCommand(plan, 2, plan.restaurantIds[0], plan.branchIds[1]), "POST", 403, "ACTION_NOT_AUTHORIZED", counter);
  await assertDiningTableError(baseUrl, authenticated[0].accessToken, diningTableCommand(plan, 3, plan.restaurantIds[0], plan.branchIds[2]), "POST", 403, "ACTION_NOT_AUTHORIZED", counter);

  const layout = await getDiningLayout(baseUrl, authenticated[0].accessToken, plan.restaurantIds[0], plan.branchIds[0]);
  const parsedLayout = parseDiningLayoutV1(await layout.json());
  counter.assert("dining_tables", layout.status === 200 && layout.headers.get("cache-control") === "private, no-store" && parsedLayout !== undefined && layoutContainsTable(parsedLayout, created));
  const viewerLayout = await getDiningLayout(baseUrl, authenticated[0].accessToken, plan.restaurantIds[0], plan.branchIds[1]);
  counter.assert("dining_tables", viewerLayout.status === 200 && parseDiningLayoutV1(await viewerLayout.json()) !== undefined);

  const update = diningTableUpdateCommand(plan, plan.diningTables.updateEventId, plan.diningTables.updateIdempotencyKey, 1);
  const updated = await assertDiningTableSuccess(baseUrl, authenticated[0].accessToken, update, "PATCH", false, 2, authenticated[0].userId, counter);
  const updateReplay = await assertDiningTableSuccess(baseUrl, authenticated[0].accessToken, update, "PATCH", true, 2, authenticated[0].userId, counter);
  counter.assert("dining_tables", updateReplay.updatedAt === updated.updatedAt);
  const stale = diningTableUpdateCommand(plan, plan.diningTables.staleEventId, plan.diningTables.staleIdempotencyKey, 1);
  await assertDiningTableError(baseUrl, authenticated[0].accessToken, stale, "PATCH", 409, "DINING_TABLE_CONFLICT", counter);
  await assertDiningTablePersistence(adminPool, plan, updated, counter, true);
}

async function verifyDiningTableAfterRevocation(adminPool: Pool, app: INestApplication, plan: FixturePlan, authenticated: AuthenticatedFixture, counter: VerificationCounter): Promise<void> {
  const command = diningTableCommand(plan, 4, plan.restaurantIds[0], plan.branchIds[0]);
  await assertDiningTableError(await app.getUrl(), authenticated.accessToken, command, "POST", 403, "ACTION_NOT_AUTHORIZED", counter);
  await assertDiningTablePersistence(adminPool, plan, undefined, counter, true);
}

function diningTableCommand(plan: FixturePlan, index: 0 | 1 | 2 | 3 | 4, restaurantId: string, branchId: string): CreateDiningTableCommandV1 {
  const fixture = plan.diningTables.commands[index];
  const command = parseCreateDiningTableCommandV1({
    capacity: 4, deviceId: plan.diningTables.deviceId, eventId: fixture.eventId,
    idempotencyKey: fixture.idempotencyKey, layout: { height: 4, width: 4, x: 2, y: 3 },
    name: fixture.name, occurredAt: plan.diningTables.occurredAt, schemaVersion: DINING_LAYOUT_SCHEMA_VERSION,
    scope: { branchId, restaurantId }, shape: "round", tableId: fixture.zoneId,
    zoneId: plan.diningZones.commands[0].zoneId,
  });
  if (command === undefined) throw new TenancyVerificationError("dining_tables", "TENANCY_VERIFICATION_DINING_TABLES_FAILED");
  return command;
}

function diningTableUpdateCommand(plan: FixturePlan, eventId: string, idempotencyKey: string, expectedVersion: number): UpdateDiningTableLayoutCommandV1 {
  const command = parseUpdateDiningTableLayoutCommandV1({
    deviceId: plan.diningTables.deviceId, eventId, expectedVersion, idempotencyKey,
    layout: { height: 4, width: 5, x: 8, y: 6 }, occurredAt: plan.diningTables.updateOccurredAt,
    schemaVersion: DINING_LAYOUT_SCHEMA_VERSION, scope: { branchId: plan.branchIds[0], restaurantId: plan.restaurantIds[0] },
    tableId: plan.diningTables.commands[0].zoneId,
  });
  if (command === undefined) throw new TenancyVerificationError("dining_tables", "TENANCY_VERIFICATION_DINING_TABLES_FAILED");
  return command;
}

async function assertDiningTableSuccess(baseUrl: string, accessToken: string, command: CreateDiningTableCommandV1 | UpdateDiningTableLayoutCommandV1, method: "POST" | "PATCH", replayed: boolean, version: number, actorId: string, counter: VerificationCounter): Promise<DiningTableV1> {
  const response = await mutateDiningTable(baseUrl, accessToken, command, method);
  const parsed = parseDiningTableV1(await response.json());
  counter.assert("dining_tables", response.status === (method === "POST" ? 201 : 200) && response.headers.get("cache-control") === "private, no-store" && parsed !== undefined && parsed.tableId === command.tableId && parsed.replayed === replayed && parsed.version === version && parsed.updatedBy === actorId);
  if (parsed === undefined) throw new TenancyVerificationError("dining_tables", "TENANCY_VERIFICATION_DINING_TABLES_FAILED");
  return parsed;
}

async function assertDiningTableError(baseUrl: string, accessToken: string | undefined, command: CreateDiningTableCommandV1 | UpdateDiningTableLayoutCommandV1, method: "POST" | "PATCH", status: number, code: string, counter: VerificationCounter): Promise<void> {
  const response = await mutateDiningTable(baseUrl, accessToken, command, method);
  counter.assert("dining_tables", response.status === status && recordsEqual(await response.json(), { code }));
}

async function mutateDiningTable(baseUrl: string, accessToken: string | undefined, command: CreateDiningTableCommandV1 | UpdateDiningTableLayoutCommandV1, method: "POST" | "PATCH"): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/dining/tables${method === "PATCH" ? "/layout" : ""}`, { body: JSON.stringify(command), headers: { ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }), "content-type": "application/json" }, method });
}

function getDiningLayout(baseUrl: string, accessToken: string, restaurantId: string, branchId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/dining/layout?restaurantId=${restaurantId}&branchId=${branchId}`, { headers: { authorization: `Bearer ${accessToken}` } });
}

function layoutContainsTable(layout: DiningLayoutV1, table: DiningTableV1): boolean {
  return layout.zones.some((zone) => zone.zoneId === table.zoneId && zone.tables.some((candidate) => valuesEqual(candidate, { ...table, replayed: false })));
}

async function assertDiningTablePersistence(adminPool: Pool, plan: FixturePlan, expected: DiningTableV1 | undefined, counter: VerificationCounter, updated = false): Promise<void> {
  const tableIds = plan.diningTables.commands.map((command) => command.zoneId);
  const eventIds = [...plan.diningTables.commands.map((command) => command.eventId), plan.diningTables.updateEventId, plan.diningTables.staleEventId];
  const tables = await adminPool.query<{ id: string; version: string; x: number; y: number; width: number; height: number }>(`select id::text, version::text, layout_x as x, layout_y as y, layout_width as width, layout_height as height from app.dining_tables where id = any($1::uuid[])`, [[...tableIds]]);
  const audits = await adminPool.query<{ eventId: string; operation: string; resultVersion: string }>(`select event_id::text as "eventId", operation, result_version::text as "resultVersion" from app.dining_table_audit_events where event_id = any($1::uuid[]) order by result_version`, [eventIds]);
  if (!plan.diningTableCreated) {
    counter.assert("dining_tables", tables.rows.length === 0 && audits.rows.length === 0);
    return;
  }
  const table = tables.rows[0];
  const layout = expected?.layout ?? (updated ? { height: 4, width: 5, x: 8, y: 6 } : { height: 4, width: 4, x: 2, y: 3 });
  const version = expected?.version ?? (updated ? 2 : 1);
  counter.assert("dining_tables", tables.rows.length === 1 && table?.id === plan.diningTables.commands[0].zoneId && table.version === String(version) && table.x === layout.x && table.y === layout.y && table.width === layout.width && table.height === layout.height && audits.rows.length === (updated ? 2 : 1) && audits.rows[0]?.eventId === plan.diningTables.commands[0].eventId && audits.rows[0]?.operation === "created" && (!updated || audits.rows[1]?.eventId === plan.diningTables.updateEventId && audits.rows[1]?.operation === "layout_updated"));
}

async function verifyRevocations(
  adminPool: Pool,
  appApiPool: Pool,
  app: INestApplication,
  plan: FixturePlan,
  authenticated: readonly [AuthenticatedFixture, AuthenticatedFixture],
  counter: VerificationCounter,
): Promise<void> {
  const amber = authenticated[0];
  const baseUrl = await app.getUrl();
  await updateExactlyOne(adminPool,
    `update app.membership_role_grants set revoked_at = clock_timestamp(), revoked_by = $2::uuid, revocation_reason = 'tenancy verification' where id = $1::uuid and revoked_at is null`,
    [plan.grantIds[1], amber.userId],
  );
  await assertVisibleIds(amber.client, "membership_role_grants", plan.grantIds, [plan.grantIds[0], plan.grantIds[2]], counter, "revocation");
  await assertPrivateLookup(appApiPool, amber.userId, plan.restaurantIds[0], plan.branchIds[0], ["manager"], counter, "revocation");
  await assertPrivateDirectory(
    appApiPool,
    amber.userId,
    expectedDirectory(plan, 0, [["manager"], ["viewer"]]),
    counter,
    "revocation",
  );
  await assertBranchHttp(baseUrl, amber.accessToken, plan.restaurantIds[0], plan.branchIds[0], 200, ["manager"], counter, "revocation");
  await assertMembershipDirectoryHttp(
    baseUrl,
    amber.accessToken,
    expectedDirectory(plan, 0, [["manager"], ["viewer"]]),
    counter,
    "revocation",
  );

  await updateExactlyOne(adminPool,
    `update app.membership_role_grants set revoked_at = clock_timestamp(), revoked_by = $2::uuid, revocation_reason = 'tenancy verification' where id = $1::uuid and revoked_at is null`,
    [plan.grantIds[2], amber.userId],
  );
  await assertVisibleIds(amber.client, "branches", plan.branchIds, [plan.branchIds[0]], counter, "revocation");
  await assertPrivateLookup(appApiPool, amber.userId, plan.restaurantIds[0], plan.branchIds[1], [], counter, "revocation");
  await assertPrivateDirectory(
    appApiPool,
    amber.userId,
    expectedDirectory(plan, 0, [["manager"], []]),
    counter,
    "revocation",
  );
  await assertBranchHttp(baseUrl, amber.accessToken, plan.restaurantIds[0], plan.branchIds[1], 403, undefined, counter, "revocation");
  await assertMembershipDirectoryHttp(
    baseUrl,
    amber.accessToken,
    expectedDirectory(plan, 0, [["manager"], []]),
    counter,
    "revocation",
  );

  await updateExactlyOne(adminPool,
    `update app.memberships set revoked_at = clock_timestamp(), revoked_by = $2::uuid, revocation_reason = 'tenancy verification' where id = $1::uuid and revoked_at is null`,
    [plan.membershipIds[0], amber.userId],
  );
  await assertVisibleIds(amber.client, "restaurants", plan.restaurantIds, [], counter, "revocation");
  await assertVisibleIds(amber.client, "branches", plan.branchIds, [], counter, "revocation");
  await assertPrivateLookup(appApiPool, amber.userId, plan.restaurantIds[0], plan.branchIds[0], [], counter, "revocation");
  await assertPrivateDirectory(appApiPool, amber.userId, [], counter, "revocation");
  await assertBranchHttp(baseUrl, amber.accessToken, plan.restaurantIds[0], plan.branchIds[0], 403, undefined, counter, "revocation");
  await assertMembershipDirectoryHttp(baseUrl, amber.accessToken, [], counter, "revocation");
  await assertHttp(baseUrl, "/api/v1/session", amber.accessToken, 200, { actorId: amber.userId }, counter, "revocation");

  const cobalt = authenticated[1];
  await updateExactlyOne(
    adminPool,
    `update app.branches
     set disabled_at = clock_timestamp(), disabled_by = $2::uuid, disabled_reason = 'tenancy verification'
     where id = $1::uuid and disabled_at is null`,
    [plan.branchIds[2], cobalt.userId],
  );
  await assertPrivateDirectory(
    appApiPool,
    cobalt.userId,
    expectedDirectory(plan, 1, [[], ["kitchen"]]),
    counter,
    "revocation",
  );
  await assertMembershipDirectoryHttp(
    baseUrl,
    cobalt.accessToken,
    expectedDirectory(plan, 1, [[], ["kitchen"]]),
    counter,
    "revocation",
  );

  await updateExactlyOne(
    adminPool,
    `update app.restaurants
     set disabled_at = clock_timestamp(), disabled_by = $2::uuid, disabled_reason = 'tenancy verification'
     where id = $1::uuid and disabled_at is null`,
    [plan.restaurantIds[1], cobalt.userId],
  );
  await assertPrivateDirectory(appApiPool, cobalt.userId, [], counter, "revocation");
  await assertMembershipDirectoryHttp(baseUrl, cobalt.accessToken, [], counter, "revocation");
}

async function verifyConstraints(adminPool: Pool, plan: FixturePlan, counter: VerificationCounter): Promise<void> {
  const amberId = requireUserId(plan.users[0]);
  const cobaltId = requireUserId(plan.users[1]);
  await expectConstraintFailure(adminPool,
    `insert into app.memberships (id, user_id, restaurant_id, branch_id, granted_by) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`,
    [randomUUID(), cobaltId, plan.restaurantIds[0], plan.branchIds[2], amberId],
    "23503",
    counter,
  );
  await expectConstraintFailure(adminPool,
    `insert into app.memberships (id, user_id, restaurant_id, branch_id, granted_by) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $2::uuid)`,
    [randomUUID(), cobaltId, plan.restaurantIds[1], plan.branchIds[2]],
    "23505",
    counter,
  );
  await expectConstraintFailure(adminPool,
    `insert into app.membership_role_grants (id, membership_id, role_code, granted_by) values ($1::uuid, $2::uuid, 'invented_role', $3::uuid)`,
    [randomUUID(), plan.membershipIds[2], amberId],
    "23503",
    counter,
  );
  await expectConstraintFailure(adminPool,
    `update app.memberships set revoked_at = clock_timestamp() where id = $1::uuid`,
    [plan.membershipIds[2]],
    "23514",
    counter,
  );
}

async function expectConstraintFailure(
  pool: Pool,
  sql: string,
  parameters: readonly unknown[],
  expectedCode: string,
  counter: VerificationCounter,
): Promise<void> {
  const client = await pool.connect();
  let observedCode: string | undefined;
  try {
    await client.query("BEGIN");
    try {
      await client.query(sql, [...parameters]);
    } catch (error: unknown) {
      observedCode = readPostgresCode(error);
    }
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  counter.assert("constraints", observedCode === expectedCode);
}

async function expectPostgresDenied(
  pool: Pool,
  sql: string,
  parameters: readonly unknown[],
  counter: VerificationCounter,
  stage: TenancyVerificationStage,
): Promise<void> {
  let code: string | undefined;
  try {
    await pool.query(sql, [...parameters]);
  } catch (error: unknown) {
    code = readPostgresCode(error);
  }
  counter.assert(stage, code === "42501");
}

async function updateExactlyOne(pool: Pool, sql: string, parameters: readonly unknown[]): Promise<void> {
  const result = await pool.query(sql, [...parameters]);
  if (result.rowCount !== 1) {
    throw new TenancyVerificationError("revocation", "TENANCY_VERIFICATION_REVOCATION_FAILED");
  }
}

async function assertHttp(
  baseUrl: string,
  path: string,
  accessToken: string | undefined,
  expectedStatus: number,
  expectedBody: Readonly<Record<string, unknown>>,
  counter: VerificationCounter,
  stage: TenancyVerificationStage = "http",
): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` },
  });
  const body: unknown = await response.json();
  counter.assert(stage, response.status === expectedStatus && recordsEqual(body, expectedBody));
}

async function assertBranchHttp(
  baseUrl: string,
  accessToken: string,
  restaurantId: string,
  branchId: string,
  expectedStatus: number,
  expectedRoles: readonly string[] | undefined,
  counter: VerificationCounter,
  stage: TenancyVerificationStage = "http",
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/access/branch`, {
    body: JSON.stringify({ branchId, restaurantId }),
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    method: "POST",
  });
  const body: unknown = await response.json();
  if (expectedStatus === 403) {
    counter.assert(stage, response.status === 403 && recordsEqual(body, { code: "SCOPE_AUTHORIZATION_REJECTED" }));
    return;
  }
  counter.assert(stage, response.status === 200 && recordsEqual(body, { branchId, restaurantId, roles: expectedRoles }));
}

async function assertMembershipDirectoryHttp(
  baseUrl: string,
  accessToken: string,
  expectedMemberships: readonly BranchMembershipSummaryV1[],
  counter: VerificationCounter,
  stage: TenancyVerificationStage = "http",
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/access/memberships`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const parsed = parseBranchMembershipListV1(await response.json());
  counter.assert(
    stage,
    response.status === 200
      && response.headers.get("cache-control") === "private, no-store"
      && parsed !== undefined
      && valuesEqual(parsed, {
        memberships: expectedMemberships,
        schemaVersion: BRANCH_MEMBERSHIP_LIST_SCHEMA_VERSION,
      }),
  );
}

function expectedDirectory(
  plan: FixturePlan,
  userIndex: 0 | 1,
  roleSets: readonly [readonly string[], readonly string[]] = userIndex === 0
    ? [["manager", "waiter"], ["viewer"]]
    : [["cashier"], ["kitchen"]],
): readonly BranchMembershipSummaryV1[] {
  const restaurantIndex = userIndex;
  const branchOffset = userIndex * 2;
  return [0, 1]
    .flatMap((localIndex) => {
      const roles = roleSets[localIndex] ?? [];
      if (roles.length === 0) return [];
      const branchIndex = branchOffset + localIndex;
      return [{
        branchName: tenancyFixtureName(plan.runId, userIndex === 0 ? `branch-1${localIndex + 1}` as "branch-11" | "branch-12" : `branch-2${localIndex + 1}` as "branch-21" | "branch-22"),
        restaurantName: tenancyFixtureName(plan.runId, userIndex === 0 ? "restaurant-1" : "restaurant-2"),
        roles: Object.freeze([...roles]) as BranchMembershipSummaryV1["roles"],
        scope: {
          branchId: plan.branchIds[branchIndex] as BranchMembershipSummaryV1["scope"]["branchId"],
          restaurantId: plan.restaurantIds[restaurantIndex] as BranchMembershipSummaryV1["scope"]["restaurantId"],
        },
      }];
    })
    .sort((left, right) => left.scope.branchId < right.scope.branchId ? -1 : left.scope.branchId > right.scope.branchId ? 1 : 0);
}

async function cleanupFixtures(
  serverClient: SupabaseClient,
  adminPool: Pool,
  plan: FixturePlan,
  counter: VerificationCounter,
): Promise<void> {
  const knownUserIds = plan.users.map((user) => user.userId).filter((id): id is string => id !== undefined);
  if (!plan.authCreationAttempted && knownUserIds.length === 0 && !plan.databaseFixturesInserted) return;
  const discoveredUserIds = await discoverMarkedUsers(serverClient, plan.runId);
  const userIds = [...new Set([...discoveredUserIds, ...knownUserIds])];
  if (userIds.length === 0 && !plan.databaseFixturesInserted) return;

  if (plan.databaseFixturesInserted) {
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await verifyFixtureOwnership(client, plan);
      if (plan.diningZonesEnabled) {
        await verifyDiningZoneFixtureOwnership(client, plan);
        if (plan.diningTablesEnabled) {
          await verifyDiningTableFixtureOwnership(client, plan);
          const tableEventIds = [...plan.diningTables.commands.map((command) => command.eventId), plan.diningTables.updateEventId, plan.diningTables.staleEventId];
          await deleteRequiredFixtureRows(
            client,
            "app.dining_table_audit_events",
            tableEventIds,
            plan.diningTableCreated ? [plan.diningTables.commands[0].eventId, plan.diningTables.updateEventId] : [],
            "event_id",
          );
          await deleteRequiredFixtureRows(
            client,
            "app.dining_tables",
            plan.diningTables.commands.map((command) => command.zoneId),
            plan.diningTableCreated ? [plan.diningTables.commands[0].zoneId] : [],
          );
        }
        await deleteRequiredFixtureRows(
          client,
          "app.dining_zone_audit_events",
          plan.diningZones.commands.map((command) => command.eventId),
          plan.diningZoneCreated ? [plan.diningZones.commands[0].eventId] : [],
          "event_id",
        );
        await deleteRequiredFixtureRows(
          client,
          "app.dining_zones",
          plan.diningZones.commands.map((command) => command.zoneId),
          plan.diningZoneCreated ? [plan.diningZones.commands[0].zoneId] : [],
        );
      }
      await deleteRequiredFixtureRows(client, "app.membership_role_grants", plan.grantIds, plan.grantIds);
      await deleteRequiredFixtureRows(client, "app.memberships", plan.membershipIds, plan.membershipIds);
      await deleteRequiredFixtureRows(client, "app.branches", plan.branchIds, plan.branchIds);
      await deleteRequiredFixtureRows(
        client,
        "app.restaurants",
        [...plan.restaurantIds, ...plan.canaryRestaurantIds],
        plan.restaurantIds,
      );
      await client.query("COMMIT");
    } catch {
      await rollbackQuietly(client);
      throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
    } finally {
      client.release();
    }
  }

  for (const userId of userIds) {
    await assertFixtureAuthUser(serverClient, plan, userId);
    const deleted = await serverClient.auth.admin.deleteUser(userId);
    if (deleted.error !== null) throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }

  const residualUsers = await discoverMarkedUsers(serverClient, plan.runId);
  counter.assert("cleanup", residualUsers.length === 0);
  const residualRows = await adminPool.query<{ count: number }>(
    `select (
      (select count(*) from app.membership_role_grants where membership_id = any($1::uuid[]))
      + (select count(*) from app.memberships where id = any($1::uuid[]))
      + (select count(*) from app.branches where id = any($2::uuid[]))
      + (select count(*) from app.restaurants where id = any($3::uuid[]))
    )::integer as count`,
    [[...plan.membershipIds], [...plan.branchIds], [...plan.restaurantIds, ...plan.canaryRestaurantIds]],
  );
  counter.assert("cleanup", residualRows.rows[0]?.count === 0);
  if (plan.diningZonesEnabled) {
    const residualDiningRows = await adminPool.query<{ count: number }>(
      `select (
        (select count(*) from app.dining_zone_audit_events where event_id = any($1::uuid[]))
        + (select count(*) from app.dining_zones where id = any($2::uuid[]))
      )::integer as count`,
      [
        plan.diningZones.commands.map((command) => command.eventId),
        plan.diningZones.commands.map((command) => command.zoneId),
      ],
    );
    counter.assert("cleanup", residualDiningRows.rows[0]?.count === 0);
  }
  if (plan.diningTablesEnabled) {
    const eventIds = [...plan.diningTables.commands.map((command) => command.eventId), plan.diningTables.updateEventId, plan.diningTables.staleEventId];
    const residualDiningTableRows = await adminPool.query<{ count: number }>(
      `select ((select count(*) from app.dining_table_audit_events where event_id = any($1::uuid[])) + (select count(*) from app.dining_tables where id = any($2::uuid[])))::integer as count`,
      [eventIds, plan.diningTables.commands.map((command) => command.zoneId)],
    );
    counter.assert("cleanup", residualDiningTableRows.rows[0]?.count === 0);
  }
}

async function deleteRequiredFixtureRows(
  client: PoolClient,
  table: string,
  allowedIds: readonly string[],
  requiredIds: readonly string[],
  idColumn: "event_id" | "id" = "id",
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `delete from ${table} where ${idColumn} = any($1::uuid[]) returning ${idColumn}::text as id`,
    [[...allowedIds]],
  );
  const returned = new Set(result.rows.map((row) => row.id));
  if (
    result.rowCount !== returned.size
    || [...returned].some((id) => !allowedIds.includes(id))
    || requiredIds.some((id) => !returned.has(id))
  ) throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
}

async function assertFixtureAuthUser(
  serverClient: SupabaseClient,
  plan: FixturePlan,
  userId: string,
): Promise<void> {
  const result = await serverClient.auth.admin.getUserById(userId);
  if (result.error !== null || result.data.user === null) {
    throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }
  const user = result.data.user;
  const marker = readStringProperty(user.app_metadata, tenancyAuthMetadataMarker);
  const runId = readStringProperty(user.app_metadata, "run_id");
  const fixtureKey = readStringProperty(user.app_metadata, "fixture_key");
  const expected = plan.users.find((candidate) => candidate.fixtureKey === fixtureKey);
  if (
    marker !== tenancyAuthMetadataVersion
    || runId !== plan.runId
    || expected === undefined
    || user.email !== expected.credentials.email
    || (expected.userId !== undefined && expected.userId !== userId)
  ) throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
}

async function verifyFixtureOwnership(client: PoolClient, plan: FixturePlan): Promise<void> {
  const restaurantNames = new Map<string, string>([
    [plan.restaurantIds[0], tenancyFixtureName(plan.runId, "restaurant-1")],
    [plan.restaurantIds[1], tenancyFixtureName(plan.runId, "restaurant-2")],
    ...plan.canaryRestaurantIds.map((id, index) => [
      id,
      tenancyFixtureName(plan.runId, tenancyCanarySuffixes[index] as (typeof tenancyCanarySuffixes)[number]),
    ] as const),
  ]);
  const restaurants = await client.query<{ id: string; name: string }>(
    `select id::text, name from app.restaurants where id = any($1::uuid[]) for update`,
    [[...restaurantNames.keys()]],
  );
  for (const row of restaurants.rows) {
    if (restaurantNames.get(row.id) !== row.name) {
      throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
    }
  }
  if (!plan.restaurantIds.every((id) => restaurants.rows.some((row) => row.id === id))) {
    throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }

  const expectedBranches = new Map<string, Readonly<{ name: string; restaurantId: string }>>([
    [plan.branchIds[0], { name: tenancyFixtureName(plan.runId, "branch-11"), restaurantId: plan.restaurantIds[0] }],
    [plan.branchIds[1], { name: tenancyFixtureName(plan.runId, "branch-12"), restaurantId: plan.restaurantIds[0] }],
    [plan.branchIds[2], { name: tenancyFixtureName(plan.runId, "branch-21"), restaurantId: plan.restaurantIds[1] }],
    [plan.branchIds[3], { name: tenancyFixtureName(plan.runId, "branch-22"), restaurantId: plan.restaurantIds[1] }],
  ]);
  const branches = await client.query<{ id: string; name: string; restaurantId: string }>(
    `select id::text, name, restaurant_id::text as "restaurantId"
     from app.branches where id = any($1::uuid[]) for update`,
    [[...expectedBranches.keys()]],
  );
  if (branches.rows.length !== expectedBranches.size) {
    throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }
  for (const row of branches.rows) {
    const expected = expectedBranches.get(row.id);
    if (expected?.name !== row.name || expected.restaurantId !== row.restaurantId) {
      throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
    }
  }
}

async function verifyDiningZoneFixtureOwnership(client: PoolClient, plan: FixturePlan): Promise<void> {
  const amberId = requireUserId(plan.users[0]);
  const expectedZones = new Map<string, Readonly<{ branchId: string; name: string; restaurantId: string }>>(
    plan.diningZones.commands.map((command, index) => [
      command.zoneId,
      {
        branchId: index === 2 ? plan.branchIds[1] : index === 3 ? plan.branchIds[2] : plan.branchIds[0],
        name: command.name,
        restaurantId: plan.restaurantIds[0],
      },
    ]),
  );
  const zones = await client.query<{
    branchId: string;
    createdBy: string;
    id: string;
    name: string;
    restaurantId: string;
  }>(
    `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId",
       name, created_by::text as "createdBy"
     from app.dining_zones where id = any($1::uuid[]) for update`,
    [[...expectedZones.keys()]],
  );
  for (const row of zones.rows) {
    const expected = expectedZones.get(row.id);
    if (
      expected === undefined
      || expected.restaurantId !== row.restaurantId
      || expected.branchId !== row.branchId
      || expected.name !== row.name
      || row.createdBy !== amberId
    ) throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }
  if (plan.diningZoneCreated && !zones.rows.some((row) => row.id === plan.diningZones.commands[0].zoneId)) {
    throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }

  const expectedAudits = new Map<string, Readonly<{
    branchId: string;
    idempotencyKey: string;
    name: string;
    restaurantId: string;
    zoneId: string;
  }>>(
    plan.diningZones.commands.map((command, index) => [
      command.eventId,
      {
        branchId: index === 2 ? plan.branchIds[1] : index === 3 ? plan.branchIds[2] : plan.branchIds[0],
        idempotencyKey: index === 1 ? plan.diningZones.commands[0].idempotencyKey : command.idempotencyKey,
        name: command.name,
        restaurantId: plan.restaurantIds[0],
        zoneId: command.zoneId,
      },
    ]),
  );
  const audits = await client.query<{
    actorId: string;
    branchId: string;
    eventId: string;
    idempotencyKey: string;
    name: string;
    restaurantId: string;
    zoneId: string;
  }>(
    `select event_id::text as "eventId", idempotency_key::text as "idempotencyKey",
       restaurant_id::text as "restaurantId", branch_id::text as "branchId", zone_id::text as "zoneId",
       actor_id::text as "actorId", name_snapshot as name
     from app.dining_zone_audit_events where event_id = any($1::uuid[]) for update`,
    [[...expectedAudits.keys()]],
  );
  for (const row of audits.rows) {
    const expected = expectedAudits.get(row.eventId);
    if (
      expected === undefined
      || expected.restaurantId !== row.restaurantId
      || expected.branchId !== row.branchId
      || expected.zoneId !== row.zoneId
      || expected.idempotencyKey !== row.idempotencyKey
      || expected.name !== row.name
      || row.actorId !== amberId
    ) throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }
  if (plan.diningZoneCreated && !audits.rows.some((row) => row.eventId === plan.diningZones.commands[0].eventId)) {
    throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }
}

async function verifyDiningTableFixtureOwnership(client: PoolClient, plan: FixturePlan): Promise<void> {
  const amberId = requireUserId(plan.users[0]);
  const ids = plan.diningTables.commands.map((command) => command.zoneId);
  const rows = await client.query<{ actorId: string; branchId: string; id: string; name: string; restaurantId: string; zoneId: string }>(
    `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId", zone_id::text as "zoneId", name, updated_by::text as "actorId" from app.dining_tables where id = any($1::uuid[]) for update`,
    [ids],
  );
  for (const row of rows.rows) {
    const command = plan.diningTables.commands.find((candidate) => candidate.zoneId === row.id);
    if (command === undefined || row.restaurantId !== plan.restaurantIds[0] || row.branchId !== plan.branchIds[0] || row.zoneId !== plan.diningZones.commands[0].zoneId || row.name !== command.name || row.actorId !== amberId) {
      throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
    }
  }
  if (plan.diningTableCreated && !rows.rows.some((row) => row.id === plan.diningTables.commands[0].zoneId)) {
    throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }
  const allowedEvents = [...plan.diningTables.commands.map((command) => command.eventId), plan.diningTables.updateEventId, plan.diningTables.staleEventId];
  const audits = await client.query<{ actorId: string; eventId: string; tableId: string }>(
    `select event_id::text as "eventId", table_id::text as "tableId", actor_id::text as "actorId" from app.dining_table_audit_events where event_id = any($1::uuid[]) for update`,
    [allowedEvents],
  );
  if (audits.rows.some((row) => row.actorId !== amberId || row.tableId !== plan.diningTables.commands[0].zoneId || !allowedEvents.includes(row.eventId)) || (plan.diningTableCreated && ![plan.diningTables.commands[0].eventId, plan.diningTables.updateEventId].every((id) => audits.rows.some((row) => row.eventId === id)))) {
    throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
  }
}

async function discoverMarkedUsers(serverClient: SupabaseClient, runId: string): Promise<readonly string[]> {
  const idsByFixture = new Map<FixtureKey, string>();
  for (let page = 1; page <= 100; page += 1) {
    const result = await serverClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error !== null) throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
    for (const user of result.data.users) {
      const marker = readStringProperty(user.app_metadata, tenancyAuthMetadataMarker);
      const markedRunId = readStringProperty(user.app_metadata, "run_id");
      if (marker !== tenancyAuthMetadataVersion || markedRunId !== runId) continue;
      const fixtureKey = readStringProperty(user.app_metadata, "fixture_key");
      if (
        (fixtureKey !== "amber" && fixtureKey !== "cobalt")
        || user.email !== tenancyFixtureEmail(runId, fixtureKey)
        || idsByFixture.has(fixtureKey)
      ) throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
      idsByFixture.set(fixtureKey, user.id);
    }
    if (result.data.nextPage === null) return Object.freeze([...idsByFixture.values()]);
  }
  throw new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The caller converts cleanup/fixture failures to a stable non-sensitive code.
  }
}

async function executeStage<Result>(
  stage: TenancyVerificationStage,
  action: () => Promise<Result>,
): Promise<Result> {
  try {
    return await action();
  } catch (error: unknown) {
    if (error instanceof TenancyVerificationError) throw error;
    throw new TenancyVerificationError(stage, codeForStage(stage));
  }
}

function sanitizeExecutionError(error: unknown): TenancyVerificationError {
  return error instanceof TenancyVerificationError
    ? error
    : new TenancyVerificationError("configuration", "TENANCY_VERIFICATION_CONFIGURATION_REJECTED");
}

function validateRuntimeAuditSql(sql: string, verifyDiningZones: boolean, verifyDiningTables = false): string {
  const requiredMarkers = verifyDiningTables
    ? ["POST_DINING_TABLES_TABLE_SURFACE_REJECTED", "POST_DINING_TABLES_SERVER_TABLE_GRANTS_REJECTED"]
    : verifyDiningZones
    ? ["POST_DINING_RUNTIME_APP_API_ATTRIBUTES_REJECTED", "POST_DINING_RUNTIME_DINING_TABLE_GRANTS_REJECTED"]
    : ["RUNTIME_AUDIT_APP_API_ATTRIBUTES", "RUNTIME_AUDIT_APP_API_TABLE_GRANTS"];
  if (
    typeof sql !== "string"
    || sql.length === 0
    || sql.length > 100_000
    || requiredMarkers.some((marker) => !sql.includes(marker))
  ) {
    throw new TenancyVerificationError("configuration", "TENANCY_VERIFICATION_CONFIGURATION_REJECTED");
  }
  try {
    return validateCatalogAuditSql(sql);
  } catch {
    throw new TenancyVerificationError("configuration", "TENANCY_VERIFICATION_CONFIGURATION_REJECTED");
  }
}

function readApiPort(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 65_535) {
    throw new TenancyVerificationError(
      "configuration",
      "TENANCY_VERIFICATION_CONFIGURATION_REJECTED",
    );
  }
  return value;
}

function requireUserId(user: FixtureUserPlan): string {
  if (user.userId === undefined) {
    throw new TenancyVerificationError("fixtures", "TENANCY_VERIFICATION_FIXTURES_FAILED");
  }
  return user.userId;
}

function readVisibleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => readStringProperty(row, "id")).filter((id): id is string => id !== undefined).sort();
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function readPostgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function recordsEqual(actual: unknown, expected: Readonly<Record<string, unknown>>): boolean {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
  try {
    const actualRecord = actual as Record<string, unknown>;
    const actualKeys = Object.keys(actualRecord).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (!arraysEqual(actualKeys, expectedKeys)) return false;
    return actualKeys.every((key) => valuesEqual(actualRecord[key], expected[key]));
  } catch {
    return false;
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (typeof left === "object" || typeof right === "object") {
    return typeof left === "object"
      && left !== null
      && !Array.isArray(left)
      && typeof right === "object"
      && right !== null
      && !Array.isArray(right)
      && recordsEqual(left, right as Readonly<Record<string, unknown>>);
  }
  return left === right;
}
