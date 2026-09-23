import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import {
  parseCaptureMutationResultV1,
  parseCustomerAddressMutationResultV1,
  parseCustomerProfileMutationResultV1,
  type CaptureMutationResultV1,
} from "@super-restaurant/shared-types";
import { Pool, type PoolClient } from "pg";

import { TenancyVerificationError, type TenancyVerificationConfig } from "./tenancy-verification-config.js";
import type { TenancyVerificationLiveFixture, TenancyVerificationLiveFixtureHooks } from "./tenancy-verification.js";

const RUN_OPT_IN = "REMOTE_CAPTURE_CONTINUITY_BROWSER_SMOKE";
const WAIT_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_WAIT_TIMEOUT_MS = 30 * 60 * 1_000;
const POLL_INTERVAL_MS = 250;

export const CAPTURE_CONTINUITY_SMOKE_API_PORT = 4_314;
export const CAPTURE_CONTINUITY_SMOKE_WEB_ORIGIN = "http://127.0.0.1:3010";
export const CAPTURE_CONTINUITY_SMOKE_LEASE_PATH = new URL(
  "../../../../.capture-continuity-smoke-lease.tmp",
  import.meta.url,
);
export const CAPTURE_CONTINUITY_SMOKE_ACK_PATH = new URL(
  "../../../../.capture-continuity-smoke-ack.tmp",
  import.meta.url,
);
const WRITING_PATH = new URL("../../../../.capture-continuity-smoke-writing.tmp", import.meta.url);

export interface CaptureContinuityFixturePlan {
  readonly addressId: string;
  readonly addressLabel: string;
  readonly captureDraftId: string;
  readonly contactId: string;
  readonly customerId: string;
  readonly deviceId: string;
  readonly displayName: string;
  readonly phoneDisplayValue: string;
  readonly streetLine: string;
}

interface PreparedCaptureContinuityFixture extends CaptureContinuityFixturePlan {
  readonly folio: string;
}

export interface CaptureContinuitySmokeDependencies {
  readonly cleanupFixture?: (
    config: TenancyVerificationConfig,
    fixture: TenancyVerificationLiveFixture,
    plan: CaptureContinuityFixturePlan,
    prepared: boolean,
  ) => Promise<void>;
  readonly prepareFixture?: (
    fixture: TenancyVerificationLiveFixture,
    plan: CaptureContinuityFixturePlan,
  ) => Promise<PreparedCaptureContinuityFixture>;
  readonly verifyFixture?: (
    config: TenancyVerificationConfig,
    fixture: TenancyVerificationLiveFixture,
    prepared: PreparedCaptureContinuityFixture,
  ) => Promise<void>;
}

export interface CaptureContinuityProtectedSmokeCoordinator {
  readonly cleanupArtifacts: () => void;
  readonly hooks: TenancyVerificationLiveFixtureHooks;
}

export function createCaptureContinuityProtectedSmokeCoordinator(
  environment: NodeJS.ProcessEnv,
  config: TenancyVerificationConfig,
  onPhase: (runId: string) => void,
  dependencies: CaptureContinuitySmokeDependencies = {},
  waitTimeoutMs = WAIT_TIMEOUT_MS,
): CaptureContinuityProtectedSmokeCoordinator {
  if (
    environment.CAPTURE_CONTINUITY_SMOKE_RUN !== RUN_OPT_IN
    || environment.CAPTURE_CONTINUITY_SMOKE_CONFIRM_PROJECT_REF !== config.expectedProjectRef
    || !Number.isSafeInteger(waitTimeoutMs)
    || waitTimeoutMs < POLL_INTERVAL_MS
    || waitTimeoutMs > MAX_WAIT_TIMEOUT_MS
    || [CAPTURE_CONTINUITY_SMOKE_LEASE_PATH, CAPTURE_CONTINUITY_SMOKE_ACK_PATH, WRITING_PATH]
      .some((path) => existsSync(path))
  ) throw configurationError();

  const prepare = dependencies.prepareFixture ?? prepareFixture;
  const cleanup = dependencies.cleanupFixture ?? cleanupFixture;
  const verify = dependencies.verifyFixture ?? verifyPreparedFixture;
  let plan: CaptureContinuityFixturePlan | undefined;
  let prepared = false;

  const hooks: TenancyVerificationLiveFixtureHooks = Object.freeze({
    afterRevocation: async () => undefined,
    beforeRevocation: async (fixture: TenancyVerificationLiveFixture) => {
      plan = createPlan(fixture.runId);
      const ready = await prepare(fixture, plan);
      prepared = true;
      replaceLease(JSON.stringify({
        addressId: ready.addressId,
        addressLabel: ready.addressLabel,
        apiBaseUrl: fixture.apiBaseUrl,
        branchId: fixture.branchId,
        branchName: fixture.branchName,
        captureDraftId: ready.captureDraftId,
        customerId: ready.customerId,
        displayName: ready.displayName,
        email: fixture.credentials.email,
        expectedSourceAfterAutosave: "whatsapp_manual",
        folio: ready.folio,
        password: fixture.credentials.password,
        phase: "capture_continuity",
        phoneDisplayValue: ready.phoneDisplayValue,
        restaurantId: fixture.restaurantId,
        restaurantName: fixture.restaurantName,
        runId: fixture.runId,
        streetLine: ready.streetLine,
      }));
      onPhase(fixture.runId);
      await waitForAck(fixture.runId, waitTimeoutMs);
      await verify(config, fixture, ready);
    },
    cleanup: async (fixture: TenancyVerificationLiveFixture) => {
      try {
        if (plan !== undefined) await cleanup(config, fixture, plan, prepared);
      } finally {
        clearArtifacts();
      }
    },
  });
  return Object.freeze({ cleanupArtifacts: clearArtifacts, hooks });
}

async function verifyPreparedFixture(
  config: TenancyVerificationConfig,
  fixture: TenancyVerificationLiveFixture,
  plan: PreparedCaptureContinuityFixture,
): Promise<void> {
  const pool = createAdminPool(config, "super-restaurant-capture-continuity-smoke-verify");
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    const capture = await client.query<{
      confirmedOrderId: string | null;
      customerSnapshotId: string | null;
      fulfillmentChannel: string | null;
      fulfillmentSnapshotId: string | null;
      sourceChannel: string;
      version: number;
    }>(
      `select version::integer, source_channel as "sourceChannel", fulfillment_channel as "fulfillmentChannel",
              customer_snapshot_id::text as "customerSnapshotId",
              fulfillment_snapshot_id::text as "fulfillmentSnapshotId",
              confirmed_order_id::text as "confirmedOrderId"
       from app.capture_drafts
       where restaurant_id=$1::uuid and branch_id=$2::uuid and id=$3::uuid`,
      [fixture.restaurantId, fixture.branchId, plan.captureDraftId],
    );
    const events = await client.query<{ operation: string; resultVersion: number }>(
      `select operation, result_version::integer as "resultVersion"
       from app.capture_command_events
       where restaurant_id=$1::uuid and branch_id=$2::uuid and capture_draft_id=$3::uuid
       order by result_version`,
      [fixture.restaurantId, fixture.branchId, plan.captureDraftId],
    );
    const row = capture.rows[0];
    const expectedOperations = [
      "capture.created",
      "capture.customer_changed",
      "capture.fulfillment_changed",
      "capture.claimed",
      "capture.autosaved",
      "capture.claimed",
    ];
    if (
      capture.rows.length !== 1
      || row === undefined
      || row.version !== 6
      || row.sourceChannel !== "whatsapp_manual"
      || row.fulfillmentChannel !== "delivery"
      || row.customerSnapshotId === null
      || row.fulfillmentSnapshotId === null
      || row.confirmedOrderId !== null
      || events.rows.length !== expectedOperations.length
      || events.rows.some((event, index) => (
        event.operation !== expectedOperations[index] || event.resultVersion !== index + 1
      ))
    ) throw smokeError();
    await client.query("ROLLBACK");
  } catch {
    await client?.query("ROLLBACK").catch(() => undefined);
    throw smokeError();
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

function createPlan(runId: string): CaptureContinuityFixturePlan {
  return Object.freeze({
    addressId: randomUUID(),
    addressLabel: "Domicilio continuidad",
    captureDraftId: randomUUID(),
    contactId: randomUUID(),
    customerId: randomUUID(),
    deviceId: randomUUID(),
    displayName: `__tenancy_e2e__${runId}__capture-customer`,
    phoneDisplayValue: "+52 644 000 0042",
    streetLine: `Calle Continuidad ${runId.slice(0, 8)} 42`,
  });
}

async function prepareFixture(
  fixture: TenancyVerificationLiveFixture,
  plan: CaptureContinuityFixturePlan,
): Promise<PreparedCaptureContinuityFixture> {
  const token = fixture.verificationContext?.accessToken;
  if (token === undefined) throw smokeError();
  const scope = { restaurantId: fixture.restaurantId, branchId: fixture.branchId } as const;
  const common = () => ({
    schemaVersion: 1 as const,
    scope,
    deviceId: plan.deviceId,
    eventId: randomUUID(),
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
  });

  const profile = await postJson(fixture.apiBaseUrl, token, "/api/v1/customers/profile", {
    ...common(), customerId: plan.customerId, expectedVersion: 0, displayName: plan.displayName,
    phones: [{ contactId: plan.contactId, label: "Principal", displayValue: plan.phoneDisplayValue }],
  }, parseCustomerProfileMutationResultV1);
  if (profile.record.customerId !== plan.customerId || profile.record.version !== 1) throw smokeError();

  const address = await postJson(fixture.apiBaseUrl, token, "/api/v1/customers/address", {
    ...common(), customerId: plan.customerId, expectedVersion: 0, addressId: plan.addressId,
    address: {
      label: plan.addressLabel,
      streetLine: plan.streetLine,
      unit: null,
      neighborhood: "Centro",
      locality: "Navojoa",
      region: "Sonora",
      countryCode: "MX",
      postalCode: "85800",
      references: "Fixture marcada para smoke de continuidad",
      instructions: null,
      coordinates: null,
    },
  }, parseCustomerAddressMutationResultV1);
  if (address.record.addressId !== plan.addressId || address.record.version !== 1) throw smokeError();

  const validated = await postJson(fixture.apiBaseUrl, token, "/api/v1/customers/address/validate", {
    ...common(), customerId: plan.customerId, expectedVersion: 1, addressId: plan.addressId,
  }, parseCustomerAddressMutationResultV1);
  if (
    validated.record.addressId !== plan.addressId
    || validated.record.version !== 2
    || validated.record.validation?.branchId !== fixture.branchId
  ) throw smokeError();

  const created = await postJson(fixture.apiBaseUrl, token, "/api/v1/captures", {
    ...common(), captureDraftId: plan.captureDraftId, expectedVersion: 0,
    sourceChannel: "phone", fulfillmentChannel: "delivery",
  }, parseCaptureMutationResultV1);
  assertCapture(created, plan.captureDraftId, 1);
  if (created.detail.attentionLeaseId === null) throw smokeError();

  const customer = await postJson(fixture.apiBaseUrl, token, "/api/v1/captures/customer", {
    ...common(), captureDraftId: plan.captureDraftId, expectedVersion: 1,
    attentionLeaseId: created.detail.attentionLeaseId,
    customerId: plan.customerId, contactId: plan.contactId, expectedCustomerVersion: 1,
  }, parseCaptureMutationResultV1);
  assertCapture(customer, plan.captureDraftId, 2);
  if (customer.detail.attentionLeaseId === null || customer.detail.customerSnapshotRef === null) throw smokeError();

  const fulfillment = await postJson(fixture.apiBaseUrl, token, "/api/v1/captures/fulfillment", {
    ...common(), captureDraftId: plan.captureDraftId, expectedVersion: 2,
    attentionLeaseId: customer.detail.attentionLeaseId,
    customerSnapshotRef: customer.detail.customerSnapshotRef,
    addressId: plan.addressId, expectedAddressVersion: 2,
  }, parseCaptureMutationResultV1);
  assertCapture(fulfillment, plan.captureDraftId, 3);
  if (fulfillment.detail.fulfillmentSnapshotRef === null) throw smokeError();

  return Object.freeze({ ...plan, folio: fulfillment.detail.folio });
}

async function postJson<T>(
  baseUrl: string,
  token: string,
  path: string,
  body: unknown,
  parse: (value: unknown) => T | undefined,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw smokeError();
  }
  if (!response.ok) throw smokeError();
  const parsed = parse(await response.json());
  if (parsed === undefined) throw smokeError();
  return parsed;
}

function assertCapture(result: CaptureMutationResultV1, captureDraftId: string, version: number): void {
  if (result.detail.captureDraftId !== captureDraftId || result.detail.version !== version) throw smokeError();
}

async function cleanupFixture(
  config: TenancyVerificationConfig,
  fixture: TenancyVerificationLiveFixture,
  plan: CaptureContinuityFixturePlan,
  prepared: boolean,
): Promise<void> {
  const pool = createAdminPool(config, "super-restaurant-capture-continuity-smoke-cleanup");
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await assertOwnedRows(client, fixture, plan, prepared);
    await client.query(
      `delete from app.capture_command_events
       where restaurant_id=$1::uuid and branch_id=$2::uuid and capture_draft_id=$3::uuid`,
      [fixture.restaurantId, fixture.branchId, plan.captureDraftId],
    );
    await client.query(
      `delete from app.capture_drafts
       where restaurant_id=$1::uuid and branch_id=$2::uuid and id=$3::uuid`,
      [fixture.restaurantId, fixture.branchId, plan.captureDraftId],
    );
    for (const table of ["customer_fulfillment_snapshots", "customer_party_snapshots", "customer_command_events",
      "customer_addresses", "customer_phones"] as const) {
      await client.query(`delete from app.${table} where restaurant_id=$1::uuid and customer_id=$2::uuid`, [
        fixture.restaurantId,
        plan.customerId,
      ]);
    }
    await client.query(
      "delete from app.customers where restaurant_id=$1::uuid and id=$2::uuid",
      [fixture.restaurantId, plan.customerId],
    );
    const residual = await client.query<{ count: number }>(
      `select (
        (select count(*) from app.capture_command_events where capture_draft_id=$1::uuid)
        + (select count(*) from app.capture_drafts where id=$1::uuid)
        + (select count(*) from app.customer_fulfillment_snapshots where customer_id=$2::uuid)
        + (select count(*) from app.customer_party_snapshots where customer_id=$2::uuid)
        + (select count(*) from app.customer_command_events where customer_id=$2::uuid)
        + (select count(*) from app.customer_addresses where customer_id=$2::uuid)
        + (select count(*) from app.customer_phones where customer_id=$2::uuid)
        + (select count(*) from app.customers where id=$2::uuid)
      )::integer as count`,
      [plan.captureDraftId, plan.customerId],
    );
    if (residual.rows[0]?.count !== 0) throw cleanupError();
    await client.query("COMMIT");
  } catch {
    await client?.query("ROLLBACK").catch(() => undefined);
    throw cleanupError();
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

function createAdminPool(config: TenancyVerificationConfig, applicationName: string): Pool {
  return new Pool({
    application_name: applicationName,
    connectionString: config.adminDatabase.connectionString,
    connectionTimeoutMillis: 15_000,
    max: 1,
    query_timeout: 15_000,
    ssl: { ca: config.adminDatabase.caCertificate, rejectUnauthorized: true },
    statement_timeout: 15_000,
  });
}

async function assertOwnedRows(
  client: PoolClient,
  fixture: TenancyVerificationLiveFixture,
  plan: CaptureContinuityFixturePlan,
  prepared: boolean,
): Promise<void> {
  const rows = await client.query<{
    addressCount: number;
    captureCount: number;
    captureCreatedBy: string | null;
    captureEventCount: number;
    customerCount: number;
    customerEventCount: number;
    displayName: string | null;
    fulfillmentSnapshotCount: number;
    partySnapshotCount: number;
    phoneCount: number;
  }>(
    `select
      (select count(*)::integer from app.customers where restaurant_id=$1::uuid and id=$4::uuid) as "customerCount",
      (select max(display_name) from app.customers where restaurant_id=$1::uuid and id=$4::uuid) as "displayName",
      (select count(*)::integer from app.customer_phones where restaurant_id=$1::uuid and customer_id=$4::uuid and contact_id=$5::uuid) as "phoneCount",
      (select count(*)::integer from app.customer_addresses where restaurant_id=$1::uuid and customer_id=$4::uuid and id=$6::uuid) as "addressCount",
      (select count(*)::integer from app.customer_command_events where restaurant_id=$1::uuid and customer_id=$4::uuid) as "customerEventCount",
      (select count(*)::integer from app.customer_party_snapshots where restaurant_id=$1::uuid and customer_id=$4::uuid) as "partySnapshotCount",
      (select count(*)::integer from app.customer_fulfillment_snapshots where restaurant_id=$1::uuid and branch_id=$2::uuid and customer_id=$4::uuid) as "fulfillmentSnapshotCount",
      (select count(*)::integer from app.capture_drafts where restaurant_id=$1::uuid and branch_id=$2::uuid and id=$3::uuid) as "captureCount",
      (select max(created_by)::text from app.capture_drafts where restaurant_id=$1::uuid and branch_id=$2::uuid and id=$3::uuid) as "captureCreatedBy",
      (select count(*)::integer from app.capture_command_events where restaurant_id=$1::uuid and branch_id=$2::uuid and capture_draft_id=$3::uuid) as "captureEventCount"`,
    [fixture.restaurantId, fixture.branchId, plan.captureDraftId, plan.customerId, plan.contactId, plan.addressId],
  );
  const row = rows.rows[0];
  if (
    row === undefined
    || (row.customerCount > 0 && row.displayName !== plan.displayName)
    || (row.captureCount > 0 && row.captureCreatedBy !== fixture.verificationContext?.primaryUserId)
    || row.customerCount > 1 || row.phoneCount > 1 || row.addressCount > 1 || row.captureCount > 1
    || (prepared && (
      row.customerCount !== 1 || row.phoneCount !== 1 || row.addressCount !== 1 || row.captureCount !== 1
      || row.customerEventCount !== 3 || row.partySnapshotCount < 1 || row.fulfillmentSnapshotCount < 1
      || row.captureEventCount < 3
    ))
  ) throw cleanupError();
}

async function waitForAck(runId: string, waitTimeoutMs: number): Promise<void> {
  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(CAPTURE_CONTINUITY_SMOKE_ACK_PATH)) {
      await delay(POLL_INTERVAL_MS);
      continue;
    }
    let acknowledgement: unknown;
    try {
      acknowledgement = JSON.parse(readFileSync(CAPTURE_CONTINUITY_SMOKE_ACK_PATH, "utf8"));
    } catch {
      throw smokeError();
    }
    if (!isExactAcknowledgement(acknowledgement, runId)) throw smokeError();
    rmSync(CAPTURE_CONTINUITY_SMOKE_ACK_PATH, { force: true });
    return;
  }
  throw smokeError();
}

function isExactAcknowledgement(value: unknown, runId: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("phase") || !keys.includes("runId")) return false;
  const phase = Object.getOwnPropertyDescriptor(value, "phase");
  const run = Object.getOwnPropertyDescriptor(value, "runId");
  return phase !== undefined && "value" in phase && phase.value === "capture_continuity"
    && run !== undefined && "value" in run && run.value === runId;
}

function replaceLease(contents: string): void {
  try {
    writeFileSync(WRITING_PATH, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    rmSync(CAPTURE_CONTINUITY_SMOKE_LEASE_PATH, { force: true });
    renameSync(WRITING_PATH, CAPTURE_CONTINUITY_SMOKE_LEASE_PATH);
  } catch {
    rmSync(WRITING_PATH, { force: true });
    throw smokeError();
  }
}

function clearArtifacts(): void {
  for (const path of [CAPTURE_CONTINUITY_SMOKE_LEASE_PATH, CAPTURE_CONTINUITY_SMOKE_ACK_PATH, WRITING_PATH]) {
    rmSync(path, { force: true });
  }
}

function configurationError(): TenancyVerificationError {
  return new TenancyVerificationError("configuration", "TENANCY_VERIFICATION_CONFIGURATION_REJECTED");
}

function smokeError(): TenancyVerificationError {
  return new TenancyVerificationError("http", "TENANCY_VERIFICATION_HTTP_FAILED");
}

function cleanupError(): TenancyVerificationError {
  return new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
}
