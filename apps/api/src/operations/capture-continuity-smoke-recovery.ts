import { Pool, type PoolClient } from "pg";

import { guardPostgresPool } from "../database.js";
import { recoverCaptureCustomerJourneyRows } from "./capture-customer-journey-smoke-recovery.js";
import { captureContinuityAssignmentIds } from "./capture-continuity-smoke-markers.js";
import { tenancyFixtureAdvisoryLockKey, tenancyFixtureName } from "./tenancy-fixture-markers.js";
import {
  TenancyFixtureRecoveryError,
  type TenancyFixtureRecoveryConfig,
} from "./tenancy-fixture-recovery-config.js";
import { executeTenancyFixtureRecovery, type TenancyFixtureRecoverySummary } from "./tenancy-fixture-recovery.js";

const CUSTOMER_NAME_SUFFIX = "__capture-customer";
const CUSTOMER_PHONE = "+52 644 000 0042";
const ADDRESS_LABEL = "Domicilio continuidad";
const CAPTURE_OPERATIONS = [
  "capture.created",
  "capture.customer_changed",
  "capture.fulfillment_changed",
  "capture.claimed",
  "capture.autosaved",
  "capture.claimed",
  "capture.transferred",
  "capture.taken_over",
] as const;

interface AssignmentMembershipRow {
  readonly branchId: string;
  readonly grantedBy: string;
  readonly id: string;
  readonly restaurantId: string;
  readonly revokedAt: string | null;
  readonly userId: string;
}

interface AssignmentGrantRow {
  readonly grantedBy: string;
  readonly id: string;
  readonly membershipId: string;
  readonly revokedAt: string | null;
  readonly roleCode: string;
}

interface CustomerRow {
  readonly createdBy: string;
  readonly deletedAt: string | null;
  readonly displayName: string;
  readonly id: string;
  readonly updatedBy: string;
  readonly version: number;
}

interface PhoneRow {
  readonly contactId: string;
  readonly customerId: string;
  readonly displayValue: string;
  readonly label: string;
}

interface AddressRow {
  readonly createdBy: string;
  readonly customerId: string;
  readonly deletedAt: string | null;
  readonly id: string;
  readonly label: string;
  readonly streetLine: string | null;
  readonly updatedBy: string;
  readonly validatedBy: string | null;
  readonly validationBranchId: string | null;
  readonly version: number;
}

interface CustomerEventRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly customerId: string;
  readonly entityId: string;
  readonly eventId: string;
  readonly operation: string;
  readonly resultVersion: number;
}

interface PartySnapshotRow {
  readonly contactId: string;
  readonly createdBy: string;
  readonly customerId: string;
  readonly displayName: string;
  readonly id: string;
  readonly phoneDisplayValue: string;
}

interface FulfillmentSnapshotRow {
  readonly addressId: string;
  readonly branchId: string;
  readonly createdBy: string;
  readonly customerId: string;
  readonly id: string;
  readonly label: string;
  readonly partySnapshotId: string;
  readonly streetLine: string;
  readonly validatedBy: string;
}

interface CaptureRow {
  readonly branchId: string;
  readonly confirmedOrderId: string | null;
  readonly createdBy: string;
  readonly customerId: string | null;
  readonly customerSnapshotId: string | null;
  readonly fulfillmentChannel: string | null;
  readonly fulfillmentSnapshotId: string | null;
  readonly id: string;
  readonly restaurantId: string;
  readonly sourceChannel: string;
  readonly status: string;
  readonly updatedBy: string;
  readonly version: number;
}

interface CaptureEventRow {
  readonly actorId: string;
  readonly branchId: string;
  readonly captureDraftId: string;
  readonly eventId: string;
  readonly operation: string;
  readonly restaurantId: string;
  readonly resultVersion: number;
}

export interface CaptureContinuityRecoverySnapshot {
  readonly addressRows: readonly AddressRow[];
  readonly assignmentGrants: readonly AssignmentGrantRow[];
  readonly assignmentMemberships: readonly AssignmentMembershipRow[];
  readonly branchId: string;
  readonly captureEvents: readonly CaptureEventRow[];
  readonly captures: readonly CaptureRow[];
  readonly customerEvents: readonly CustomerEventRow[];
  readonly customers: readonly CustomerRow[];
  readonly fulfillmentSnapshots: readonly FulfillmentSnapshotRow[];
  readonly partySnapshots: readonly PartySnapshotRow[];
  readonly phoneRows: readonly PhoneRow[];
  readonly primaryUserId: string;
  readonly restaurantId: string;
  readonly runId: string;
}

export interface ValidatedCaptureContinuityRecovery {
  readonly addressIds: readonly string[];
  readonly assignmentGrantIds: readonly string[];
  readonly assignmentMembershipIds: readonly string[];
  readonly captureDraftIds: readonly string[];
  readonly captureEventIds: readonly string[];
  readonly contactIds: readonly string[];
  readonly customerEventIds: readonly string[];
  readonly customerIds: readonly string[];
  readonly fulfillmentSnapshotIds: readonly string[];
  readonly partySnapshotIds: readonly string[];
}

export interface CaptureContinuitySmokeRecoverySummary extends TenancyFixtureRecoverySummary {
  readonly captureContinuityRowsRemoved: number;
}

export function validateCaptureContinuityRecoverySnapshot(
  snapshot: CaptureContinuityRecoverySnapshot,
): ValidatedCaptureContinuityRecovery {
  const assignment = validateAssignmentRows(snapshot);
  const expectedName = `__tenancy_e2e__${snapshot.runId}${CUSTOMER_NAME_SUFFIX}`;
  if (snapshot.customers.length > 1 || snapshot.captures.length > 1) throw contaminationError();
  const customer = snapshot.customers[0];
  const capture = snapshot.captures[0];
  if (customer === undefined) {
    if (
      capture !== undefined
      || snapshot.phoneRows.length !== 0
      || snapshot.addressRows.length !== 0
      || snapshot.customerEvents.length !== 0
      || snapshot.partySnapshots.length !== 0
      || snapshot.fulfillmentSnapshots.length !== 0
      || snapshot.captureEvents.length !== 0
    ) throw contaminationError();
    return emptyValidated(assignment);
  }
  if (
    customer.displayName !== expectedName
    || customer.version !== 1
    || customer.createdBy !== snapshot.primaryUserId
    || customer.updatedBy !== snapshot.primaryUserId
    || customer.deletedAt !== null
    || snapshot.phoneRows.length !== 1
  ) throw contaminationError();
  const phone = snapshot.phoneRows[0];
  if (
    phone === undefined
    || phone.customerId !== customer.id
    || phone.label !== "Principal"
    || phone.displayValue !== CUSTOMER_PHONE
  ) throw contaminationError();

  const address = snapshot.addressRows[0];
  if (snapshot.addressRows.length > 1) throw contaminationError();
  const expectedCustomerEvents = address === undefined
    ? ["customer.profile_saved"]
    : address.version === 1
      ? ["customer.profile_saved", "customer.address_saved"]
      : address.version === 2
        ? ["customer.profile_saved", "customer.address_saved", "customer.address_validated"]
        : [];
  if (
    expectedCustomerEvents.length === 0
    || snapshot.customerEvents.length !== expectedCustomerEvents.length
    || expectedCustomerEvents.some((operation) => !snapshot.customerEvents.some((event) => event.operation === operation))
    || snapshot.customerEvents.some((event) => (
      event.actorId !== snapshot.primaryUserId
      || event.branchId !== snapshot.branchId
      || event.customerId !== customer.id
      || (event.operation === "customer.profile_saved" ? event.entityId !== customer.id : event.entityId !== address?.id)
    ))
  ) throw contaminationError();
  if (address !== undefined && (
    address.customerId !== customer.id
    || address.label !== ADDRESS_LABEL
    || address.streetLine !== `Calle Continuidad ${snapshot.runId.slice(0, 8)} 42`
    || address.createdBy !== snapshot.primaryUserId
    || address.updatedBy !== snapshot.primaryUserId
    || address.deletedAt !== null
    || (address.version === 1 && (address.validationBranchId !== null || address.validatedBy !== null))
    || (address.version === 2 && (
      address.validationBranchId !== snapshot.branchId || address.validatedBy !== snapshot.primaryUserId
    ))
  )) throw contaminationError();

  if (capture === undefined) {
    if (
      snapshot.partySnapshots.length !== 0
      || snapshot.fulfillmentSnapshots.length !== 0
      || snapshot.captureEvents.length !== 0
    ) throw contaminationError();
  } else {
    validateCapture(snapshot, customer, address, capture);
  }

  return Object.freeze({
    addressIds: Object.freeze(snapshot.addressRows.map((row) => row.id)),
    assignmentGrantIds: assignment.assignmentGrantIds,
    assignmentMembershipIds: assignment.assignmentMembershipIds,
    captureDraftIds: Object.freeze(snapshot.captures.map((row) => row.id)),
    captureEventIds: Object.freeze(snapshot.captureEvents.map((row) => row.eventId)),
    contactIds: Object.freeze(snapshot.phoneRows.map((row) => row.contactId)),
    customerEventIds: Object.freeze(snapshot.customerEvents.map((row) => row.eventId)),
    customerIds: Object.freeze(snapshot.customers.map((row) => row.id)),
    fulfillmentSnapshotIds: Object.freeze(snapshot.fulfillmentSnapshots.map((row) => row.id)),
    partySnapshotIds: Object.freeze(snapshot.partySnapshots.map((row) => row.id)),
  });
}

function validateAssignmentRows(
  snapshot: CaptureContinuityRecoverySnapshot,
): Readonly<{ assignmentGrantIds: readonly string[]; assignmentMembershipIds: readonly string[] }> {
  const expected = captureContinuityAssignmentIds(snapshot.runId);
  if (snapshot.assignmentMemberships.length > 1 || snapshot.assignmentGrants.length > 1) throw contaminationError();
  const membership = snapshot.assignmentMemberships[0];
  const grant = snapshot.assignmentGrants[0];
  if (membership === undefined) {
    if (grant !== undefined) throw contaminationError();
    return Object.freeze({ assignmentGrantIds: Object.freeze([]), assignmentMembershipIds: Object.freeze([]) });
  }
  if (
    membership.id !== expected.membershipId
    || membership.restaurantId !== snapshot.restaurantId
    || membership.branchId !== snapshot.branchId
    || membership.userId === snapshot.primaryUserId
    || membership.grantedBy !== snapshot.primaryUserId
    || membership.revokedAt !== null
    || (grant !== undefined && (
      grant.id !== expected.grantId
      || grant.membershipId !== membership.id
      || grant.roleCode !== "waiter"
      || grant.grantedBy !== snapshot.primaryUserId
      || grant.revokedAt !== null
    ))
  ) throw contaminationError();
  return Object.freeze({
    assignmentGrantIds: Object.freeze(grant === undefined ? [] : [grant.id]),
    assignmentMembershipIds: Object.freeze([membership.id]),
  });
}

function validateCapture(
  snapshot: CaptureContinuityRecoverySnapshot,
  customer: CustomerRow,
  address: AddressRow | undefined,
  capture: CaptureRow,
): void {
  if (
    address?.version !== 2
    || capture.restaurantId !== snapshot.restaurantId
    || capture.branchId !== snapshot.branchId
    || capture.status !== "draft"
    || capture.confirmedOrderId !== null
    || capture.fulfillmentChannel !== "delivery"
    || capture.createdBy !== snapshot.primaryUserId
    || capture.updatedBy !== snapshot.primaryUserId
    || capture.version < 1
    || capture.version > CAPTURE_OPERATIONS.length
    || snapshot.captureEvents.length !== capture.version
  ) throw contaminationError();
  const expectedOperations = CAPTURE_OPERATIONS.slice(0, capture.version);
  if (snapshot.captureEvents.some((event, index) => (
    event.actorId !== snapshot.primaryUserId
    || event.restaurantId !== snapshot.restaurantId
    || event.branchId !== snapshot.branchId
    || event.captureDraftId !== capture.id
    || event.resultVersion !== index + 1
    || event.operation !== expectedOperations[index]
  ))) throw contaminationError();
  const expectedSource = capture.version >= 5 ? "whatsapp_manual" : "phone";
  if (capture.sourceChannel !== expectedSource) throw contaminationError();

  const party = snapshot.partySnapshots[0];
  const fulfillment = snapshot.fulfillmentSnapshots[0];
  if (capture.version === 1) {
    if (
      capture.customerId !== null || capture.customerSnapshotId !== null || capture.fulfillmentSnapshotId !== null
      || snapshot.partySnapshots.length !== 0 || snapshot.fulfillmentSnapshots.length !== 0
    ) throw contaminationError();
    return;
  }
  if (
    snapshot.partySnapshots.length !== 1
    || party === undefined
    || capture.customerId !== customer.id
    || capture.customerSnapshotId !== party.id
    || party.customerId !== customer.id
    || party.contactId !== snapshot.phoneRows[0]?.contactId
    || party.displayName !== customer.displayName
    || party.phoneDisplayValue !== CUSTOMER_PHONE
    || party.createdBy !== snapshot.primaryUserId
  ) throw contaminationError();
  if (capture.version === 2) {
    if (capture.fulfillmentSnapshotId !== null || snapshot.fulfillmentSnapshots.length !== 0) throw contaminationError();
    return;
  }
  if (
    snapshot.fulfillmentSnapshots.length !== 1
    || fulfillment === undefined
    || capture.fulfillmentSnapshotId !== fulfillment.id
    || fulfillment.branchId !== snapshot.branchId
    || fulfillment.customerId !== customer.id
    || fulfillment.addressId !== address.id
    || fulfillment.partySnapshotId !== party.id
    || fulfillment.label !== ADDRESS_LABEL
    || fulfillment.streetLine !== address.streetLine
    || fulfillment.createdBy !== snapshot.primaryUserId
    || fulfillment.validatedBy !== snapshot.primaryUserId
  ) throw contaminationError();
}

export async function executeCaptureContinuitySmokeRecovery(
  config: TenancyFixtureRecoveryConfig,
): Promise<CaptureContinuitySmokeRecoverySummary> {
  const customerJourneyRowsRemoved = await recoverCaptureCustomerJourneyRows(config);
  const captureContinuityRowsRemoved = customerJourneyRowsRemoved + await deleteCaptureContinuityRows(config, true);
  const base = await executeTenancyFixtureRecovery(config);
  return Object.freeze({ ...base, captureContinuityRowsRemoved });
}

type CaptureContinuityCleanupConfig = Pick<TenancyFixtureRecoveryConfig, "adminDatabase" | "runId">;

export async function cleanupCaptureContinuityRowsForActiveRun(
  config: CaptureContinuityCleanupConfig,
): Promise<number> {
  return deleteCaptureContinuityRows(config, false);
}

async function deleteCaptureContinuityRows(
  config: CaptureContinuityCleanupConfig,
  requireInactiveRun: boolean,
): Promise<number> {
  const pool = guardPostgresPool(new Pool({
    application_name: "super-restaurant-capture-continuity-smoke-recovery",
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
    const snapshot = await loadCaptureContinuitySnapshot(client, config.runId);
    const validated = validateCaptureContinuityRecoverySnapshot(snapshot);
    let removed = 0;
    removed += await deleteExactly(client, "app.capture_command_events", "event_id", validated.captureEventIds);
    removed += await deleteExactly(client, "app.capture_drafts", "id", validated.captureDraftIds);
    removed += await deleteExactly(client, "app.membership_role_grants", "id", validated.assignmentGrantIds);
    removed += await deleteExactly(client, "app.memberships", "id", validated.assignmentMembershipIds);
    removed += await deleteExactly(client, "app.customer_fulfillment_snapshots", "id", validated.fulfillmentSnapshotIds);
    removed += await deleteExactly(client, "app.customer_party_snapshots", "id", validated.partySnapshotIds);
    removed += await deleteExactly(client, "app.customer_command_events", "event_id", validated.customerEventIds);
    removed += await deleteExactly(client, "app.customer_addresses", "id", validated.addressIds);
    removed += await deleteExactly(client, "app.customer_phones", "contact_id", validated.contactIds);
    removed += await deleteExactly(client, "app.customers", "id", validated.customerIds);
    const postcheck = await loadCaptureContinuitySnapshot(client, config.runId);
    const empty = validateCaptureContinuityRecoverySnapshot(postcheck);
    if (Object.values(empty).some((ids) => ids.length !== 0)) throw contaminationError();
    await client.query("COMMIT");
    return removed;
  } catch (error: unknown) {
    await client?.query("ROLLBACK").catch(() => undefined);
    if (error instanceof TenancyFixtureRecoveryError) throw error;
    throw new TenancyFixtureRecoveryError("database", "TENANCY_FIXTURE_RECOVERY_DATABASE_FAILED");
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

async function loadCaptureContinuitySnapshot(
  client: PoolClient,
  runId: string,
): Promise<CaptureContinuityRecoverySnapshot> {
  const restaurantName = tenancyFixtureName(runId, "restaurant-1");
  const branchName = tenancyFixtureName(runId, "branch-11");
  const scope = await client.query<{ branchId: string; primaryUserId: string; restaurantId: string }>(
    `select b.id::text as "branchId", b.restaurant_id::text as "restaurantId", m.user_id::text as "primaryUserId"
     from app.branches b
     join app.restaurants r on r.id=b.restaurant_id
     join app.memberships m on m.restaurant_id=b.restaurant_id and m.branch_id=b.id
     join app.membership_role_grants g on g.membership_id=m.id and g.role_code='manager'
     where r.name=$1::text and b.name=$2::text
     for update of b, r, m, g`,
    [restaurantName, branchName],
  );
  if (scope.rows.length === 0) return emptySnapshot(runId);
  if (scope.rows.length !== 1) throw contaminationError();
  const selected = scope.rows[0];
  if (selected === undefined) throw contaminationError();
  const assignmentIds = captureContinuityAssignmentIds(runId);
  const parameters = [selected.restaurantId, selected.branchId];
  const assignmentMemberships = await client.query<AssignmentMembershipRow>(
    `select id::text, user_id::text as "userId", restaurant_id::text as "restaurantId",
            branch_id::text as "branchId", granted_by::text as "grantedBy", revoked_at::text as "revokedAt"
     from app.memberships where id=$1::uuid for update`,
    [assignmentIds.membershipId],
  );
  const assignmentGrants = await client.query<AssignmentGrantRow>(
    `select id::text, membership_id::text as "membershipId", role_code as "roleCode",
            granted_by::text as "grantedBy", revoked_at::text as "revokedAt"
     from app.membership_role_grants where id=$1::uuid for update`,
    [assignmentIds.grantId],
  );
  const customers = await client.query<CustomerRow>(
    `select id::text, display_name as "displayName", version::integer, created_by::text as "createdBy",
            updated_by::text as "updatedBy", deleted_at::text as "deletedAt"
     from app.customers where restaurant_id=$1::uuid for update`,
    [selected.restaurantId],
  );
  const customerIds = customers.rows.map((row) => row.id);
  const phoneRows = await client.query<PhoneRow>(
    `select customer_id::text as "customerId", contact_id::text as "contactId", label,
            display_value as "displayValue"
     from app.customer_phones where restaurant_id=$1::uuid and customer_id=any($2::uuid[]) for update`,
    [selected.restaurantId, customerIds],
  );
  const addressRows = await client.query<AddressRow>(
    `select id::text, customer_id::text as "customerId", label, street_line as "streetLine", version::integer,
            validation_branch_id::text as "validationBranchId", validated_by::text as "validatedBy",
            created_by::text as "createdBy", updated_by::text as "updatedBy", deleted_at::text as "deletedAt"
     from app.customer_addresses where restaurant_id=$1::uuid and customer_id=any($2::uuid[]) for update`,
    [selected.restaurantId, customerIds],
  );
  const customerEvents = await client.query<CustomerEventRow>(
    `select event_id::text as "eventId", branch_id::text as "branchId", customer_id::text as "customerId",
            entity_id::text as "entityId", actor_id::text as "actorId", operation,
            result_version::integer as "resultVersion"
     from app.customer_command_events where restaurant_id=$1::uuid and customer_id=any($2::uuid[])
     order by received_at for update`,
    [selected.restaurantId, customerIds],
  );
  const partySnapshots = await client.query<PartySnapshotRow>(
    `select id::text, customer_id::text as "customerId", contact_id::text as "contactId",
            display_name as "displayName", phone_display_value as "phoneDisplayValue", created_by::text as "createdBy"
     from app.customer_party_snapshots where restaurant_id=$1::uuid and customer_id=any($2::uuid[]) for update`,
    [selected.restaurantId, customerIds],
  );
  const fulfillmentSnapshots = await client.query<FulfillmentSnapshotRow>(
    `select id::text, branch_id::text as "branchId", customer_id::text as "customerId",
            address_id::text as "addressId", party_snapshot_id::text as "partySnapshotId", label,
            street_line as "streetLine", validated_by::text as "validatedBy", created_by::text as "createdBy"
     from app.customer_fulfillment_snapshots
     where restaurant_id=$1::uuid and branch_id=$2::uuid and customer_id=any($3::uuid[]) for update`,
    [selected.restaurantId, selected.branchId, customerIds],
  );
  const captures = await client.query<CaptureRow>(
    `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId",
            customer_id::text as "customerId", customer_snapshot_id::text as "customerSnapshotId",
            fulfillment_snapshot_id::text as "fulfillmentSnapshotId", source_channel as "sourceChannel",
            fulfillment_channel as "fulfillmentChannel", status, confirmed_order_id::text as "confirmedOrderId",
            version::integer, created_by::text as "createdBy", updated_by::text as "updatedBy"
     from app.capture_drafts where restaurant_id=$1::uuid and branch_id=$2::uuid for update`,
    parameters,
  );
  const captureIds = captures.rows.map((row) => row.id);
  const captureEvents = await client.query<CaptureEventRow>(
    `select event_id::text as "eventId", restaurant_id::text as "restaurantId", branch_id::text as "branchId",
            capture_draft_id::text as "captureDraftId", actor_id::text as "actorId", operation,
            result_version::integer as "resultVersion"
     from app.capture_command_events
     where restaurant_id=$1::uuid and branch_id=$2::uuid and capture_draft_id=any($3::uuid[])
     order by result_version for update`,
    [selected.restaurantId, selected.branchId, captureIds],
  );
  return Object.freeze({
    addressRows: Object.freeze([...addressRows.rows]),
    assignmentGrants: Object.freeze([...assignmentGrants.rows]),
    assignmentMemberships: Object.freeze([...assignmentMemberships.rows]),
    branchId: selected.branchId,
    captureEvents: Object.freeze([...captureEvents.rows]),
    captures: Object.freeze([...captures.rows]),
    customerEvents: Object.freeze([...customerEvents.rows]),
    customers: Object.freeze([...customers.rows]),
    fulfillmentSnapshots: Object.freeze([...fulfillmentSnapshots.rows]),
    partySnapshots: Object.freeze([...partySnapshots.rows]),
    phoneRows: Object.freeze([...phoneRows.rows]),
    primaryUserId: selected.primaryUserId,
    restaurantId: selected.restaurantId,
    runId,
  });
}

async function deleteExactly(
  client: PoolClient,
  table: string,
  column: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await client.query<{ id: string }>(
    `delete from ${table} where ${column}=any($1::uuid[]) returning ${column}::text as id`,
    [[...ids]],
  );
  const returned = new Set(deleted.rows.map((row) => row.id));
  if (deleted.rowCount !== ids.length || returned.size !== ids.length || ids.some((id) => !returned.has(id))) {
    throw contaminationError();
  }
  return ids.length;
}

function emptySnapshot(runId: string): CaptureContinuityRecoverySnapshot {
  return Object.freeze({
    addressRows: Object.freeze([]),
    assignmentGrants: Object.freeze([]),
    assignmentMemberships: Object.freeze([]),
    branchId: "00000000-0000-4000-8000-000000000000",
    captureEvents: Object.freeze([]),
    captures: Object.freeze([]),
    customerEvents: Object.freeze([]),
    customers: Object.freeze([]),
    fulfillmentSnapshots: Object.freeze([]),
    partySnapshots: Object.freeze([]),
    phoneRows: Object.freeze([]),
    primaryUserId: "00000000-0000-4000-8000-000000000000",
    restaurantId: "00000000-0000-4000-8000-000000000000",
    runId,
  });
}

function emptyValidated(
  assignment: Readonly<{ assignmentGrantIds: readonly string[]; assignmentMembershipIds: readonly string[] }> = {
    assignmentGrantIds: Object.freeze([]),
    assignmentMembershipIds: Object.freeze([]),
  },
): ValidatedCaptureContinuityRecovery {
  return Object.freeze({
    addressIds: Object.freeze([]),
    assignmentGrantIds: assignment.assignmentGrantIds,
    assignmentMembershipIds: assignment.assignmentMembershipIds,
    captureDraftIds: Object.freeze([]),
    captureEventIds: Object.freeze([]),
    contactIds: Object.freeze([]),
    customerEventIds: Object.freeze([]),
    customerIds: Object.freeze([]),
    fulfillmentSnapshotIds: Object.freeze([]),
    partySnapshotIds: Object.freeze([]),
  });
}

function contaminationError(): TenancyFixtureRecoveryError {
  return new TenancyFixtureRecoveryError("database", "TENANCY_FIXTURE_RECOVERY_CONTAMINATION_DETECTED");
}
