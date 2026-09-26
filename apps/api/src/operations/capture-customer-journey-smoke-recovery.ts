import { Pool, type PoolClient } from "pg";

import { guardPostgresPool } from "../database.js";
import { captureCustomerJourneyIds } from "./capture-continuity-smoke-markers.js";
import { tenancyFixtureAdvisoryLockKey, tenancyFixtureName } from "./tenancy-fixture-markers.js";
import {
  TenancyFixtureRecoveryError,
  type TenancyFixtureRecoveryConfig,
} from "./tenancy-fixture-recovery-config.js";

const HISTORICAL_OPERATIONS = [
  "capture.created",
  "capture.customer_changed",
  "capture.fulfillment_changed",
  "capture.delivery_instructions_changed",
  "capture.confirmed",
] as const;
const JOURNEY_OPERATIONS = [
  "capture.created",
  "capture.customer_changed",
  "capture.fulfillment_changed",
  "capture.delivery_instructions_changed",
  "capture.order_repeated",
  "capture.confirmed",
] as const;
const DELIVERY_INSTRUCTIONS = "Tocar dos veces; entregar en el portón lateral";

type CleanupConfig = Pick<TenancyFixtureRecoveryConfig, "adminDatabase" | "runId">;

interface ScopeRow { readonly branchId: string; readonly primaryUserId: string; readonly restaurantId: string }
interface CaptureRow {
  readonly confirmedOrderId: string | null;
  readonly createdBy: string;
  readonly customerId: string | null;
  readonly customerSnapshotId: string | null;
  readonly deliveryInstructions: string | null;
  readonly fulfillmentSnapshotId: string | null;
  readonly id: string;
  readonly status: string;
  readonly updatedBy: string;
  readonly version: number;
}
interface CaptureEventRow {
  readonly actorId: string;
  readonly captureDraftId: string;
  readonly eventId: string;
  readonly operation: string;
  readonly resultVersion: number;
}
interface PartyRow { readonly createdBy: string; readonly customerId: string; readonly id: string }
interface FulfillmentRow {
  readonly addressId: string;
  readonly createdBy: string;
  readonly customerId: string;
  readonly id: string;
  readonly partySnapshotId: string;
}
interface OrderRow {
  readonly actorId: string;
  readonly aggregate: unknown;
  readonly id: string;
  readonly status: string;
  readonly updatedBy: string;
  readonly version: number;
}
interface AuditRow {
  readonly actorId: string;
  readonly eventId: string;
  readonly operation: string;
  readonly orderId: string;
  readonly resultVersion: number;
}
interface KdsRow { readonly cursor: number; readonly eventId: string; readonly orderId: string; readonly orderItemId: string }
interface FrozenRow {
  readonly captureDraftId: string;
  readonly customerId: string | null;
  readonly deliveryInstructions: string | null;
  readonly orderId: string;
}
interface LinkRow { readonly linkedBy: string; readonly orderId: string; readonly shiftId: string }
interface ShiftRow { readonly id: string; readonly name: string; readonly openedBy: string; readonly status: string }
interface RepeatRow {
  readonly captureDraftId: string;
  readonly customerId: string;
  readonly sourceOrderId: string;
  readonly updatedBy: string;
}

export async function cleanupCaptureCustomerJourneyRowsForActiveRun(config: CleanupConfig): Promise<number> {
  return cleanupCaptureCustomerJourneyRows(config, false);
}

export async function recoverCaptureCustomerJourneyRows(config: CleanupConfig): Promise<number> {
  return cleanupCaptureCustomerJourneyRows(config, true);
}

async function cleanupCaptureCustomerJourneyRows(config: CleanupConfig, requireInactiveRun: boolean): Promise<number> {
  const pool = guardPostgresPool(new Pool({
    application_name: "super-restaurant-capture-customer-journey-recovery",
    connectionString: config.adminDatabase.connectionString,
    connectionTimeoutMillis: 15_000,
    max: 1,
    query_timeout: 15_000,
    ssl: { ca: config.adminDatabase.caCertificate, rejectUnauthorized: true },
    statement_timeout: 15_000,
  }));
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    if (requireInactiveRun) {
      const lock = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0)) as acquired",
        [tenancyFixtureAdvisoryLockKey(config.runId)],
      );
      if (lock.rows[0]?.acquired !== true) {
        throw new TenancyFixtureRecoveryError("database", "TENANCY_FIXTURE_RECOVERY_RUN_ACTIVE");
      }
    }
    const removed = await validateAndDelete(client, config.runId);
    await client.query("COMMIT");
    return removed;
  } catch (error: unknown) {
    await client?.query("ROLLBACK").catch(() => undefined);
    if (error instanceof TenancyFixtureRecoveryError) throw error;
    throw recoveryError();
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

async function validateAndDelete(client: PoolClient, runId: string): Promise<number> {
  const scopeResult = await client.query<ScopeRow>(
    `select b.id::text as "branchId",b.restaurant_id::text as "restaurantId",m.user_id::text as "primaryUserId"
     from app.branches b join app.restaurants r on r.id=b.restaurant_id
     join app.memberships m on m.restaurant_id=b.restaurant_id and m.branch_id=b.id
     join app.membership_role_grants g on g.membership_id=m.id and g.role_code='manager'
     where r.name=$1::text and b.name=$2::text for update of b,r,m,g`,
    [tenancyFixtureName(runId, "restaurant-1"), tenancyFixtureName(runId, "branch-11")],
  );
  if (scopeResult.rows.length === 0) return 0;
  if (scopeResult.rows.length !== 1 || scopeResult.rows[0] === undefined) throw contaminationError();
  const scope = scopeResult.rows[0];
  const ids = captureCustomerJourneyIds(runId);
  const expectedCaptureIds = [ids.historicalCaptureDraftId, ids.journeyCaptureDraftId];
  const captures = (await client.query<CaptureRow>(
    `select id::text,status,version::integer,customer_id::text as "customerId",
            customer_snapshot_id::text as "customerSnapshotId",fulfillment_snapshot_id::text as "fulfillmentSnapshotId",
            confirmed_order_id::text as "confirmedOrderId",delivery_instructions as "deliveryInstructions",
            created_by::text as "createdBy",updated_by::text as "updatedBy"
     from app.capture_drafts where restaurant_id=$1::uuid and branch_id=$2::uuid and id=any($3::uuid[]) for update`,
    [scope.restaurantId, scope.branchId, expectedCaptureIds],
  )).rows;
  if (captures.some((row) => row.createdBy !== scope.primaryUserId || row.updatedBy !== scope.primaryUserId)) {
    throw contaminationError();
  }
  const captureEvents = (await client.query<CaptureEventRow>(
    `select event_id::text as "eventId",capture_draft_id::text as "captureDraftId",actor_id::text as "actorId",
            operation,result_version::integer as "resultVersion"
     from app.capture_command_events
     where restaurant_id=$1::uuid and branch_id=$2::uuid and capture_draft_id=any($3::uuid[])
     order by capture_draft_id,result_version for update`,
    [scope.restaurantId, scope.branchId, expectedCaptureIds],
  )).rows;
  const historical = captures.find((row) => row.id === ids.historicalCaptureDraftId);
  const journey = captures.find((row) => row.id === ids.journeyCaptureDraftId);
  validateCapture(historical, captureEvents, HISTORICAL_OPERATIONS, scope.primaryUserId, ids.historicalOrderId);
  validateCapture(journey, captureEvents, JOURNEY_OPERATIONS, scope.primaryUserId);

  const snapshotIds = captures.flatMap((row) => [row.customerSnapshotId, row.fulfillmentSnapshotId])
    .filter((value): value is string => value !== null);
  const partyIds = captures.map((row) => row.customerSnapshotId).filter((value): value is string => value !== null);
  const fulfillmentIds = captures.map((row) => row.fulfillmentSnapshotId).filter((value): value is string => value !== null);
  if (new Set(snapshotIds).size !== snapshotIds.length) throw contaminationError();
  const partyRows = (await client.query<PartyRow>(
    `select id::text,customer_id::text as "customerId",created_by::text as "createdBy"
     from app.customer_party_snapshots where restaurant_id=$1::uuid and id=any($2::uuid[]) for update`,
    [scope.restaurantId, partyIds],
  )).rows;
  const fulfillmentRows = (await client.query<FulfillmentRow>(
    `select id::text,customer_id::text as "customerId",address_id::text as "addressId",
            party_snapshot_id::text as "partySnapshotId",created_by::text as "createdBy"
     from app.customer_fulfillment_snapshots where restaurant_id=$1::uuid and branch_id=$2::uuid and id=any($3::uuid[]) for update`,
    [scope.restaurantId, scope.branchId, fulfillmentIds],
  )).rows;
  validateSnapshots(captures, partyRows, fulfillmentRows, scope.primaryUserId);

  const targetOrderId = journey?.confirmedOrderId ?? null;
  const orderIds = [historical?.confirmedOrderId, targetOrderId].filter((value): value is string => value !== null);
  const orders = (await client.query<OrderRow>(
    `select id::text,status,version::integer,aggregate,created_by::text as "actorId",updated_by::text as "updatedBy"
     from app.orders where restaurant_id=$1::uuid and branch_id=$2::uuid and id=any($3::uuid[]) for update`,
    [scope.restaurantId, scope.branchId, orderIds],
  )).rows;
  const audits = (await client.query<AuditRow>(
    `select event_id::text as "eventId",order_id::text as "orderId",actor_id::text as "actorId",operation,
            result_order_version::integer as "resultVersion"
     from app.order_audit_events where restaurant_id=$1::uuid and branch_id=$2::uuid and order_id=any($3::uuid[])
     order by order_id,result_order_version for update`,
    [scope.restaurantId, scope.branchId, orderIds],
  )).rows;
  validateOrders(orders, audits, scope.primaryUserId, historical?.confirmedOrderId ?? null, targetOrderId);
  const kdsRows = (await client.query<KdsRow>(
    `select event_id::text as "eventId",order_id::text as "orderId",order_item_id::text as "orderItemId",cursor::integer
     from app.kds_events where restaurant_id=$1::uuid and branch_id=$2::uuid and order_id=any($3::uuid[]) for update`,
    [scope.restaurantId, scope.branchId, orderIds],
  )).rows;
  if (kdsRows.length > 1 || kdsRows.some((row) => row.orderId !== ids.historicalOrderId
    || row.orderItemId !== ids.historicalOrderItemId || row.cursor !== 1)) throw contaminationError();
  const frozenRows = (await client.query<FrozenRow>(
    `select order_id::text as "orderId",capture_draft_id::text as "captureDraftId",customer_id::text as "customerId",
            delivery_instructions as "deliveryInstructions"
     from app.order_fulfillment_snapshots
     where restaurant_id=$1::uuid and branch_id=$2::uuid and order_id=any($3::uuid[]) for update`,
    [scope.restaurantId, scope.branchId, orderIds],
  )).rows;
  validateFrozenRows(frozenRows, historical, journey);
  const links = (await client.query<LinkRow>(
    `select order_id::text as "orderId",shift_id::text as "shiftId",linked_by::text as "linkedBy"
     from app.order_operational_shifts
     where restaurant_id=$1::uuid and branch_id=$2::uuid and order_id=any($3::uuid[]) for update`,
    [scope.restaurantId, scope.branchId, orderIds],
  )).rows;
  if (links.length !== orders.length || links.some((row) => row.shiftId !== ids.operationalShiftId
    || row.linkedBy !== scope.primaryUserId || !orderIds.includes(row.orderId))) throw contaminationError();
  const shifts = (await client.query<ShiftRow>(
    `select id::text,name,status,opened_by::text as "openedBy" from app.operational_shifts
     where id=$1::uuid for update`, [ids.operationalShiftId],
  )).rows;
  if (shifts.length > 1 || shifts.some((row) => row.name !== `tenancy-capture-customer-journey-v1:${runId}:shift-open`
    || row.status !== "open" || row.openedBy !== scope.primaryUserId)) throw contaminationError();
  const repeats = (await client.query<RepeatRow>(
    `select capture_draft_id::text as "captureDraftId",customer_id::text as "customerId",
            source_order_id::text as "sourceOrderId",updated_by::text as "updatedBy"
     from app.capture_repeat_order_plans
     where restaurant_id=$1::uuid and branch_id=$2::uuid and capture_draft_id=$3::uuid for update`,
    [scope.restaurantId, scope.branchId, ids.journeyCaptureDraftId],
  )).rows;
  if (repeats.length > 1 || repeats.some((row) => row.sourceOrderId !== ids.historicalOrderId
    || row.updatedBy !== scope.primaryUserId || row.captureDraftId !== ids.journeyCaptureDraftId
    || row.customerId !== journey?.customerId)) throw contaminationError();

  let removed = 0;
  removed += await deleteExactly(client, "app.capture_repeat_order_plans", "capture_draft_id", repeats.map((row) => row.captureDraftId));
  removed += await deleteExactly(client, "app.order_fulfillment_snapshots", "order_id", frozenRows.map((row) => row.orderId));
  removed += await deleteExactly(client, "app.capture_command_events", "event_id", captureEvents.map((row) => row.eventId));
  removed += await deleteExactly(client, "app.capture_drafts", "id", captures.map((row) => row.id));
  removed += await deleteExactly(client, "app.kds_events", "event_id", kdsRows.map((row) => row.eventId));
  removed += await deleteExactly(client, "app.order_audit_events", "event_id", audits.map((row) => row.eventId));
  removed += await deleteExactly(client, "app.order_operational_shifts", "order_id", links.map((row) => row.orderId));
  removed += await deleteExactly(client, "app.orders", "id", orders.map((row) => row.id));
  removed += await deleteExactly(client, "app.operational_shifts", "id", shifts.map((row) => row.id));
  if (kdsRows.length > 0) {
    const cursor = await client.query(
      `delete from app_private.kds_branch_cursors
       where restaurant_id=$1::uuid and branch_id=$2::uuid and last_cursor=1 returning restaurant_id`,
      [scope.restaurantId, scope.branchId],
    );
    if (cursor.rowCount !== 1) throw contaminationError();
    removed += 1;
  }
  removed += await deleteExactly(client, "app.customer_fulfillment_snapshots", "id", fulfillmentRows.map((row) => row.id));
  removed += await deleteExactly(client, "app.customer_party_snapshots", "id", partyRows.map((row) => row.id));
  return removed;
}

function validateCapture(
  capture: CaptureRow | undefined,
  allEvents: readonly CaptureEventRow[],
  operations: readonly string[],
  actorId: string,
  fixedOrderId?: string,
): void {
  if (capture === undefined) return;
  const events = allEvents.filter((row) => row.captureDraftId === capture.id);
  const confirmed = capture.version === operations.length;
  if (
    capture.version < 1 || capture.version > operations.length || events.length !== capture.version
    || capture.customerId === null && capture.version >= 2
    || capture.customerSnapshotId === null && capture.version >= 2
    || capture.fulfillmentSnapshotId === null && capture.version >= 3
    || capture.deliveryInstructions !== (capture.version >= 4 ? DELIVERY_INSTRUCTIONS : null)
    || capture.status !== (confirmed ? "confirmed" : "draft")
    || (confirmed ? capture.confirmedOrderId === null : capture.confirmedOrderId !== null)
    || (fixedOrderId !== undefined && confirmed && capture.confirmedOrderId !== fixedOrderId)
    || events.some((event, index) => event.actorId !== actorId
      || event.resultVersion !== index + 1 || event.operation !== operations[index])
  ) throw contaminationError();
}

function validateSnapshots(
  captures: readonly CaptureRow[],
  parties: readonly PartyRow[],
  fulfillments: readonly FulfillmentRow[],
  actorId: string,
): void {
  const expectedParties = captures.filter((row) => row.version >= 2);
  const expectedFulfillments = captures.filter((row) => row.version >= 3);
  if (parties.length !== expectedParties.length || fulfillments.length !== expectedFulfillments.length) {
    throw contaminationError();
  }
  for (const capture of expectedParties) {
    const party = parties.find((row) => row.id === capture.customerSnapshotId);
    if (party === undefined || party.customerId !== capture.customerId || party.createdBy !== actorId) {
      throw contaminationError();
    }
  }
  for (const capture of expectedFulfillments) {
    const fulfillment = fulfillments.find((row) => row.id === capture.fulfillmentSnapshotId);
    if (fulfillment === undefined || fulfillment.customerId !== capture.customerId
      || fulfillment.partySnapshotId !== capture.customerSnapshotId || fulfillment.createdBy !== actorId) {
      throw contaminationError();
    }
  }
}

function validateOrders(
  orders: readonly OrderRow[],
  audits: readonly AuditRow[],
  actorId: string,
  historicalOrderId: string | null,
  targetOrderId: string | null,
): void {
  const expectedIds = [historicalOrderId, targetOrderId].filter((value): value is string => value !== null);
  if (orders.length !== expectedIds.length) throw contaminationError();
  for (const order of orders) {
    const expectedOperations = order.id === historicalOrderId ? ["order.created", "order.item_added"] : ["order.created"];
    const orderAudits = audits.filter((row) => row.orderId === order.id);
    if (!expectedIds.includes(order.id) || order.actorId !== actorId || order.updatedBy !== actorId
      || order.status !== "draft" || order.version < 1 || order.version > expectedOperations.length
      || orderAudits.length !== order.version || orderAudits.some((row, index) => row.actorId !== actorId
        || row.resultVersion !== index + 1 || row.operation !== expectedOperations[index])
      || !validAggregate(order.aggregate, order.id, order.id === historicalOrderId ? order.version === 2 : true)) {
      throw contaminationError();
    }
  }
}

function validAggregate(value: unknown, orderId: string, requiresItem: boolean): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.orderId === orderId && record.channel === "delivery" && record.status === "draft"
    && Array.isArray(record.items) && (!requiresItem || record.items.length === 1);
}

function validateFrozenRows(
  rows: readonly FrozenRow[],
  historical: CaptureRow | undefined,
  journey: CaptureRow | undefined,
): void {
  const confirmed = [historical, journey].filter((row): row is CaptureRow => row?.status === "confirmed");
  if (rows.length !== confirmed.length || rows.some((row) => {
    const capture = confirmed.find((candidate) => candidate.id === row.captureDraftId);
    return capture === undefined || row.orderId !== capture.confirmedOrderId || row.customerId !== capture.customerId
      || row.deliveryInstructions !== DELIVERY_INSTRUCTIONS;
  })) throw contaminationError();
}

async function deleteExactly(client: PoolClient, table: string, column: string, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await client.query<{ id: string }>(
    `delete from ${table} where ${column}=any($1::uuid[]) returning ${column}::text as id`, [[...ids]],
  );
  const returned = new Set(deleted.rows.map((row) => row.id));
  if (deleted.rowCount !== ids.length || returned.size !== ids.length || ids.some((id) => !returned.has(id))) {
    throw contaminationError();
  }
  return ids.length;
}

function contaminationError(): TenancyFixtureRecoveryError {
  return new TenancyFixtureRecoveryError("database", "TENANCY_FIXTURE_RECOVERY_CONTAMINATION_DETECTED");
}

function recoveryError(): TenancyFixtureRecoveryError {
  return new TenancyFixtureRecoveryError("database", "TENANCY_FIXTURE_RECOVERY_DATABASE_FAILED");
}
