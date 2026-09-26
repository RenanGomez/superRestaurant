import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import {
  parseCaptureMutationResultV1,
  parseCustomerAddressMutationResultV1,
  parseCustomerProfileMutationResultV1,
  parseOrderMutationSummaryV1,
  parseSetCaptureDeliveryInstructionsResultV1,
  type CaptureMutationResultV1,
} from "@super-restaurant/shared-types";
import { Pool, type PoolClient } from "pg";

import { guardPostgresPool } from "../database.js";
import { cleanupCaptureCustomerJourneyRowsForActiveRun } from "./capture-customer-journey-smoke-recovery.js";
import { cleanupCaptureContinuityRowsForActiveRun } from "./capture-continuity-smoke-recovery.js";
import {
  captureContinuityAssignmentIds,
  captureCustomerJourneyIds,
} from "./capture-continuity-smoke-markers.js";
import { TenancyVerificationError, type TenancyVerificationConfig } from "./tenancy-verification-config.js";
import type { TenancyVerificationLiveFixture, TenancyVerificationLiveFixtureHooks } from "./tenancy-verification.js";

const RUN_OPT_IN = "REMOTE_CAPTURE_CONTINUITY_BROWSER_SMOKE";
const WAIT_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_WAIT_TIMEOUT_MS = 30 * 60 * 1_000;
const POLL_INTERVAL_MS = 250;
const CUSTOMER_JOURNEY_DELIVERY_INSTRUCTIONS = "Tocar dos veces; entregar en el portón lateral";

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
  readonly assignmentTargetGrantId: string;
  readonly assignmentTargetMembershipId: string;
  readonly captureDraftId: string;
  readonly contactId: string;
  readonly customerId: string;
  readonly customerJourneyCaptureDraftId: string;
  readonly deviceId: string;
  readonly displayName: string;
  readonly historicalCaptureDraftId: string;
  readonly historicalOrderId: string;
  readonly historicalOrderItemId: string;
  readonly operationalShiftId: string;
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
    config: TenancyVerificationConfig,
    fixture: TenancyVerificationLiveFixture,
    plan: CaptureContinuityFixturePlan,
  ) => Promise<PreparedCaptureContinuityFixture>;
  readonly retireAssignmentTarget?: (
    config: TenancyVerificationConfig,
    fixture: TenancyVerificationLiveFixture,
    plan: CaptureContinuityFixturePlan,
  ) => Promise<void>;
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
  const retire = dependencies.retireAssignmentTarget ?? retireAssignmentTarget;
  const verify = dependencies.verifyFixture ?? verifyPreparedFixture;
  let plan: CaptureContinuityFixturePlan | undefined;
  let prepared = false;

  const hooks: TenancyVerificationLiveFixtureHooks = Object.freeze({
    afterRevocation: async () => undefined,
    beforeRevocation: async (fixture: TenancyVerificationLiveFixture) => {
      plan = createPlan(fixture.runId);
      const ready = await prepare(config, fixture, plan);
      prepared = true;
      replaceLease(JSON.stringify({
        addressId: ready.addressId,
        addressLabel: ready.addressLabel,
        apiBaseUrl: fixture.apiBaseUrl,
        assignmentTargetMembershipId: ready.assignmentTargetMembershipId,
        assignmentTargetRole: "waiter",
        branchId: fixture.branchId,
        branchName: fixture.branchName,
        captureDraftId: ready.captureDraftId,
        customerId: ready.customerId,
        customerJourneyCaptureDraftId: ready.customerJourneyCaptureDraftId,
        customerJourneyDeliveryInstructions: CUSTOMER_JOURNEY_DELIVERY_INSTRUCTIONS,
        displayName: ready.displayName,
        email: fixture.credentials.email,
        expectedSourceAfterAutosave: "whatsapp_manual",
        folio: ready.folio,
        historicalOrderId: ready.historicalOrderId,
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
      // The transfer target belongs to the secondary tenancy-verification user.
      // Remove only that temporary membership before the base verifier asserts
      // the secondary user's exact directory during its revocation stage.
      await retire(config, fixture, ready);
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
      attentionLeaseId: string | null;
      attentionStatus: string;
      confirmedOrderId: string | null;
      customerSnapshotId: string | null;
      fulfillmentChannel: string | null;
      fulfillmentSnapshotId: string | null;
      ownerUserId: string | null;
      sourceChannel: string;
      version: number;
    }>(
      `select d.version::integer, d.source_channel as "sourceChannel", d.fulfillment_channel as "fulfillmentChannel",
              customer_snapshot_id::text as "customerSnapshotId",
              fulfillment_snapshot_id::text as "fulfillmentSnapshotId",
              confirmed_order_id::text as "confirmedOrderId", d.attention_status as "attentionStatus",
              d.attention_lease_id::text as "attentionLeaseId", m.user_id::text as "ownerUserId"
       from app.capture_drafts d
       left join app.memberships m
         on m.restaurant_id=d.restaurant_id and m.branch_id=d.branch_id and m.id=d.owner_membership_id
       where d.restaurant_id=$1::uuid and d.branch_id=$2::uuid and d.id=$3::uuid`,
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
      "capture.transferred",
      "capture.taken_over",
    ];
    if (
      capture.rows.length !== 1
      || row === undefined
      || row.version !== 8
      || row.sourceChannel !== "whatsapp_manual"
      || row.fulfillmentChannel !== "delivery"
      || row.customerSnapshotId === null
      || row.fulfillmentSnapshotId === null
      || row.confirmedOrderId !== null
      || row.attentionStatus !== "claimed"
      || row.attentionLeaseId === null
      || row.ownerUserId !== fixture.verificationContext?.primaryUserId
      || events.rows.length !== expectedOperations.length
      || events.rows.some((event, index) => (
        event.operation !== expectedOperations[index] || event.resultVersion !== index + 1
      ))
    ) throw smokeError();
    await verifyCustomerJourney(client, fixture, plan);
    await client.query("ROLLBACK");
  } catch {
    await client?.query("ROLLBACK").catch(() => undefined);
    throw smokeError();
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

async function verifyCustomerJourney(
  client: PoolClient,
  fixture: TenancyVerificationLiveFixture,
  plan: PreparedCaptureContinuityFixture,
): Promise<void> {
  const captures = await client.query<{
    confirmedOrderId: string | null;
    deliveryInstructions: string | null;
    id: string;
    status: string;
    version: number;
  }>(
    `select id::text,status,version::integer,confirmed_order_id::text as "confirmedOrderId",
            delivery_instructions as "deliveryInstructions"
     from app.capture_drafts
     where restaurant_id=$1::uuid and branch_id=$2::uuid and id=any($3::uuid[])
     order by id`,
    [
      fixture.restaurantId,
      fixture.branchId,
      [plan.historicalCaptureDraftId, plan.customerJourneyCaptureDraftId],
    ],
  );
  const historical = captures.rows.find((row) => row.id === plan.historicalCaptureDraftId);
  const journey = captures.rows.find((row) => row.id === plan.customerJourneyCaptureDraftId);
  if (
    captures.rows.length !== 2
    || historical?.status !== "confirmed"
    || historical.version !== 5
    || historical.confirmedOrderId !== plan.historicalOrderId
    || historical.deliveryInstructions !== CUSTOMER_JOURNEY_DELIVERY_INSTRUCTIONS
    || journey?.status !== "confirmed"
    || journey.version !== 6
    || journey.confirmedOrderId === null
    || journey.confirmedOrderId === plan.historicalOrderId
    || journey.deliveryInstructions !== CUSTOMER_JOURNEY_DELIVERY_INSTRUCTIONS
  ) throw smokeError();
  const captureEvents = await client.query<{ captureDraftId: string; operation: string; resultVersion: number }>(
    `select capture_draft_id::text as "captureDraftId",operation,result_version::integer as "resultVersion"
     from app.capture_command_events
     where restaurant_id=$1::uuid and branch_id=$2::uuid and capture_draft_id=any($3::uuid[])
     order by capture_draft_id,result_version`,
    [
      fixture.restaurantId,
      fixture.branchId,
      [plan.historicalCaptureDraftId, plan.customerJourneyCaptureDraftId],
    ],
  );
  assertOperations(captureEvents.rows, plan.historicalCaptureDraftId, [
    "capture.created", "capture.customer_changed", "capture.fulfillment_changed",
    "capture.delivery_instructions_changed", "capture.confirmed",
  ]);
  assertOperations(captureEvents.rows, plan.customerJourneyCaptureDraftId, [
    "capture.created", "capture.customer_changed", "capture.fulfillment_changed",
    "capture.delivery_instructions_changed", "capture.order_repeated", "capture.confirmed",
  ]);
  const orders = await client.query<{ aggregate: unknown; id: string; version: number }>(
    `select id::text,version::integer,aggregate from app.orders
     where restaurant_id=$1::uuid and branch_id=$2::uuid and id=any($3::uuid[])`,
    [fixture.restaurantId, fixture.branchId, [plan.historicalOrderId, journey.confirmedOrderId]],
  );
  const sourceOrder = orders.rows.find((order) => order.id === plan.historicalOrderId);
  const repeatedOrder = orders.rows.find((order) => order.id === journey.confirmedOrderId);
  if (
    orders.rows.length !== 2
    || sourceOrder?.version !== 2
    || repeatedOrder?.version !== 1
    || !hasExpectedItem(sourceOrder.aggregate, plan.historicalOrderItemId, fixture.verificationContext?.menuProductId)
    || !hasExpectedItem(repeatedOrder.aggregate, undefined, fixture.verificationContext?.menuProductId)
  ) throw smokeError();
  const frozen = await client.query<{ captureDraftId: string; deliveryInstructions: string | null; orderId: string }>(
    `select order_id::text as "orderId",capture_draft_id::text as "captureDraftId",
            delivery_instructions as "deliveryInstructions"
     from app.order_fulfillment_snapshots
     where restaurant_id=$1::uuid and branch_id=$2::uuid and order_id=any($3::uuid[])`,
    [fixture.restaurantId, fixture.branchId, [plan.historicalOrderId, journey.confirmedOrderId]],
  );
  const links = await client.query<{ orderId: string; shiftId: string }>(
    `select order_id::text as "orderId",shift_id::text as "shiftId"
     from app.order_operational_shifts
     where restaurant_id=$1::uuid and branch_id=$2::uuid and order_id=any($3::uuid[])`,
    [fixture.restaurantId, fixture.branchId, [plan.historicalOrderId, journey.confirmedOrderId]],
  );
  const repeatPlans = await client.query(
    `select capture_draft_id from app.capture_repeat_order_plans
     where restaurant_id=$1::uuid and branch_id=$2::uuid and capture_draft_id=$3::uuid`,
    [fixture.restaurantId, fixture.branchId, plan.customerJourneyCaptureDraftId],
  );
  if (
    frozen.rows.length !== 2
    || frozen.rows.some((row) => row.deliveryInstructions !== CUSTOMER_JOURNEY_DELIVERY_INSTRUCTIONS)
    || links.rows.length !== 2
    || links.rows.some((row) => row.shiftId !== plan.operationalShiftId)
    || repeatPlans.rows.length !== 0
  ) throw smokeError();
}

function assertOperations(
  events: readonly { readonly captureDraftId: string; readonly operation: string; readonly resultVersion: number }[],
  captureDraftId: string,
  operations: readonly string[],
): void {
  const selected = events.filter((event) => event.captureDraftId === captureDraftId);
  if (selected.length !== operations.length || selected.some((event, index) => (
    event.operation !== operations[index] || event.resultVersion !== index + 1
  ))) throw smokeError();
}

function hasExpectedItem(aggregate: unknown, orderItemId: string | undefined, productId: string | undefined): boolean {
  if (productId === undefined || typeof aggregate !== "object" || aggregate === null || Array.isArray(aggregate)) return false;
  const items = (aggregate as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length !== 1) return false;
  const item = items[0];
  if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
  const record = item as Record<string, unknown>;
  const snapshot = record.snapshot;
  return (orderItemId === undefined || record.orderItemId === orderItemId)
    && typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot)
    && (snapshot as Record<string, unknown>).productId === productId;
}

function createPlan(runId: string): CaptureContinuityFixturePlan {
  const assignment = captureContinuityAssignmentIds(runId);
  const journey = captureCustomerJourneyIds(runId);
  return Object.freeze({
    addressId: randomUUID(),
    addressLabel: "Domicilio continuidad",
    assignmentTargetGrantId: assignment.grantId,
    assignmentTargetMembershipId: assignment.membershipId,
    captureDraftId: randomUUID(),
    contactId: randomUUID(),
    customerId: randomUUID(),
    customerJourneyCaptureDraftId: journey.journeyCaptureDraftId,
    deviceId: randomUUID(),
    displayName: `__tenancy_e2e__${runId}__capture-customer`,
    historicalCaptureDraftId: journey.historicalCaptureDraftId,
    historicalOrderId: journey.historicalOrderId,
    historicalOrderItemId: journey.historicalOrderItemId,
    operationalShiftId: journey.operationalShiftId,
    phoneDisplayValue: "+52 644 000 0042",
    streetLine: `Calle Continuidad ${runId.slice(0, 8)} 42`,
  });
}

async function prepareFixture(
  config: TenancyVerificationConfig,
  fixture: TenancyVerificationLiveFixture,
  plan: CaptureContinuityFixturePlan,
): Promise<PreparedCaptureContinuityFixture> {
  const token = fixture.verificationContext?.accessToken;
  const primaryUserId = fixture.verificationContext?.primaryUserId;
  const secondaryUserId = fixture.verificationContext?.secondaryUserId;
  if (token === undefined || primaryUserId === undefined || secondaryUserId === undefined) throw smokeError();
  await prepareAssignmentTarget(config, fixture, plan, primaryUserId, secondaryUserId);
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

  await prepareCustomerJourney(config, fixture, plan, token, primaryUserId, common);

  return Object.freeze({ ...plan, folio: fulfillment.detail.folio });
}

async function prepareCustomerJourney(
  config: TenancyVerificationConfig,
  fixture: TenancyVerificationLiveFixture,
  plan: CaptureContinuityFixturePlan,
  token: string,
  primaryUserId: string,
  common: () => Readonly<Record<string, unknown>>,
): Promise<void> {
  const context = fixture.verificationContext;
  if (context === undefined) throw smokeError();
  await prepareOperationalShift(config, fixture, plan, primaryUserId);
  const scope = { restaurantId: fixture.restaurantId, branchId: fixture.branchId } as const;
  const historical = await prepareDeliveryCapture(
    fixture.apiBaseUrl, token, plan, plan.historicalCaptureDraftId, common,
  );
  const instructions = await postJson(fixture.apiBaseUrl, token, "/api/v1/captures/delivery-instructions", {
    ...common(), captureDraftId: plan.historicalCaptureDraftId, expectedVersion: 3,
    attentionLeaseId: historical.detail.attentionLeaseId,
    deliveryInstructions: CUSTOMER_JOURNEY_DELIVERY_INSTRUCTIONS,
  }, parseSetCaptureDeliveryInstructionsResultV1);
  if (
    instructions.detail.captureDraftId !== plan.historicalCaptureDraftId
    || instructions.detail.version !== 4
    || instructions.detail.attentionLeaseId === null
    || instructions.deliveryInstructions !== CUSTOMER_JOURNEY_DELIVERY_INSTRUCTIONS
  ) throw smokeError();
  const confirmed = await postJson(fixture.apiBaseUrl, token, "/api/v1/captures/confirm", {
    ...common(), schemaVersion: 2, captureDraftId: plan.historicalCaptureDraftId, expectedVersion: 4,
    attentionLeaseId: instructions.detail.attentionLeaseId, orderId: plan.historicalOrderId,
    shiftId: plan.operationalShiftId, tableId: null, currency: context.menuCurrency,
    timeZone: "America/Hermosillo",
  }, parseCaptureMutationResultV1);
  assertCapture(confirmed, plan.historicalCaptureDraftId, 5);
  if (confirmed.detail.status !== "confirmed" || confirmed.detail.confirmedOrderId !== plan.historicalOrderId) {
    throw smokeError();
  }
  const added = await postJson(fixture.apiBaseUrl, token, "/api/v1/orders/items", {
    ...common(), schemaVersion: 1, scope, orderId: plan.historicalOrderId,
    orderItemId: plan.historicalOrderItemId, expectedVersion: 1, productId: context.menuProductId,
    quantity: 1,
    modifierGroups: [{
      groupId: context.menuModifierGroupId,
      selections: [{ optionId: context.menuModifierOptionId, quantity: 1 }],
    }],
  }, parseOrderMutationSummaryV1);
  if (
    added.orderId !== plan.historicalOrderId
    || added.version !== 2
    || added.orderStatus !== "draft"
    || added.kdsEvent?.orderItemId !== plan.historicalOrderItemId
  ) throw smokeError();
  await prepareDeliveryCapture(
    fixture.apiBaseUrl, token, plan, plan.customerJourneyCaptureDraftId, common,
  );
}

async function prepareDeliveryCapture(
  baseUrl: string,
  token: string,
  plan: CaptureContinuityFixturePlan,
  captureDraftId: string,
  common: () => Readonly<Record<string, unknown>>,
): Promise<CaptureMutationResultV1> {
  const created = await postJson(baseUrl, token, "/api/v1/captures", {
    ...common(), captureDraftId, expectedVersion: 0,
    sourceChannel: "phone", fulfillmentChannel: "delivery",
  }, parseCaptureMutationResultV1);
  assertCapture(created, captureDraftId, 1);
  if (created.detail.attentionLeaseId === null) throw smokeError();
  const customer = await postJson(baseUrl, token, "/api/v1/captures/customer", {
    ...common(), captureDraftId, expectedVersion: 1,
    attentionLeaseId: created.detail.attentionLeaseId,
    customerId: plan.customerId, contactId: plan.contactId, expectedCustomerVersion: 1,
  }, parseCaptureMutationResultV1);
  assertCapture(customer, captureDraftId, 2);
  if (customer.detail.attentionLeaseId === null || customer.detail.customerSnapshotRef === null) throw smokeError();
  const fulfillment = await postJson(baseUrl, token, "/api/v1/captures/fulfillment", {
    ...common(), captureDraftId, expectedVersion: 2,
    attentionLeaseId: customer.detail.attentionLeaseId,
    customerSnapshotRef: customer.detail.customerSnapshotRef,
    addressId: plan.addressId, expectedAddressVersion: 2,
  }, parseCaptureMutationResultV1);
  assertCapture(fulfillment, captureDraftId, 3);
  if (fulfillment.detail.attentionLeaseId === null || fulfillment.detail.fulfillmentSnapshotRef === null) {
    throw smokeError();
  }
  return fulfillment;
}

async function prepareOperationalShift(
  config: TenancyVerificationConfig,
  fixture: TenancyVerificationLiveFixture,
  plan: CaptureContinuityFixturePlan,
  primaryUserId: string,
): Promise<void> {
  const pool = createAdminPool(config, "super-restaurant-capture-customer-journey-shift");
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      `insert into app.operational_shifts
        (id,restaurant_id,branch_id,name,status,opened_at,opened_by,closed_at,closed_by)
       values ($1::uuid,$2::uuid,$3::uuid,$4::text,'open',clock_timestamp() - interval '5 minutes',$5::uuid,null,null)`,
      [
        plan.operationalShiftId,
        fixture.restaurantId,
        fixture.branchId,
        `tenancy-capture-customer-journey-v1:${fixture.runId}:shift-open`,
        primaryUserId,
      ],
    );
    await client.query("COMMIT");
  } catch {
    await client?.query("ROLLBACK").catch(() => undefined);
    throw smokeError();
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

async function prepareAssignmentTarget(
  config: TenancyVerificationConfig,
  fixture: TenancyVerificationLiveFixture,
  plan: CaptureContinuityFixturePlan,
  primaryUserId: string,
  secondaryUserId: string,
): Promise<void> {
  const pool = createAdminPool(config, "super-restaurant-capture-continuity-smoke-assignment");
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      `insert into app.memberships (id, user_id, restaurant_id, branch_id, granted_by)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`,
      [plan.assignmentTargetMembershipId, secondaryUserId, fixture.restaurantId, fixture.branchId, primaryUserId],
    );
    await client.query(
      `insert into app.membership_role_grants (id, membership_id, role_code, granted_by)
       values ($1::uuid, $2::uuid, 'waiter', $3::uuid)`,
      [plan.assignmentTargetGrantId, plan.assignmentTargetMembershipId, primaryUserId],
    );
    await client.query("COMMIT");
  } catch {
    await client?.query("ROLLBACK").catch(() => undefined);
    throw smokeError();
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

async function retireAssignmentTarget(
  config: TenancyVerificationConfig,
  fixture: TenancyVerificationLiveFixture,
  plan: CaptureContinuityFixturePlan,
): Promise<void> {
  const primaryUserId = fixture.verificationContext?.primaryUserId;
  const secondaryUserId = fixture.verificationContext?.secondaryUserId;
  if (primaryUserId === undefined || secondaryUserId === undefined) throw smokeError();
  const pool = createAdminPool(config, "super-restaurant-capture-continuity-smoke-retire-assignment");
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const target = await client.query(
      `select m.id
       from app.memberships m
       join app.membership_role_grants g on g.membership_id=m.id
       where m.id=$1::uuid and g.id=$2::uuid
         and m.restaurant_id=$3::uuid and m.branch_id=$4::uuid
         and m.user_id=$5::uuid and m.granted_by=$6::uuid
         and m.revoked_at is null and g.role_code='waiter'
         and g.granted_by=$6::uuid and g.revoked_at is null
       for update of m,g`,
      [
        plan.assignmentTargetMembershipId,
        plan.assignmentTargetGrantId,
        fixture.restaurantId,
        fixture.branchId,
        secondaryUserId,
        primaryUserId,
      ],
    );
    if (target.rows.length !== 1) throw smokeError();
    const grant = await client.query(
      "delete from app.membership_role_grants where id=$1::uuid and membership_id=$2::uuid",
      [plan.assignmentTargetGrantId, plan.assignmentTargetMembershipId],
    );
    const membership = await client.query(
      "delete from app.memberships where id=$1::uuid and user_id=$2::uuid",
      [plan.assignmentTargetMembershipId, secondaryUserId],
    );
    if (grant.rowCount !== 1 || membership.rowCount !== 1) throw smokeError();
    await client.query("COMMIT");
  } catch {
    await client?.query("ROLLBACK").catch(() => undefined);
    throw smokeError();
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
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
): Promise<void> {
  try {
    await cleanupCaptureCustomerJourneyRowsForActiveRun({
      adminDatabase: config.adminDatabase,
      runId: fixture.runId,
    });
    await cleanupCaptureContinuityRowsForActiveRun({
      adminDatabase: config.adminDatabase,
      runId: fixture.runId,
    });
  } catch {
    throw cleanupError();
  }
}

function createAdminPool(config: TenancyVerificationConfig, applicationName: string): Pool {
  return guardPostgresPool(new Pool({
    application_name: applicationName,
    connectionString: config.adminDatabase.connectionString,
    connectionTimeoutMillis: 15_000,
    max: 1,
    query_timeout: 15_000,
    ssl: { ca: config.adminDatabase.caCertificate, rejectUnauthorized: true },
    statement_timeout: 15_000,
  }));
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
