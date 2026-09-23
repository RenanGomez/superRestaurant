import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCaptureContinuityRecoverySnapshot,
  type CaptureContinuityRecoverySnapshot,
} from "./capture-continuity-smoke-recovery.js";

const runId = "11111111-1111-4111-8111-111111111111";
const restaurantId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const customerId = "55555555-5555-4555-8555-555555555555";
const contactId = "66666666-6666-4666-8666-666666666666";
const addressId = "77777777-7777-4777-8777-777777777777";
const captureId = "88888888-8888-4888-8888-888888888888";
const partyId = "99999999-9999-4999-8999-999999999999";
const fulfillmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("accepts an empty or profile-only interrupted continuity fixture", () => {
  const empty = snapshot();
  assert.deepEqual(validateCaptureContinuityRecoverySnapshot(empty).customerIds, []);

  const profileOnly = snapshot({
    customerEvents: [customerEvent("customer.profile_saved", customerId, 1, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")],
    customers: [customer()],
    phoneRows: [{ contactId, customerId, displayValue: "+52 644 000 0042", label: "Principal" }],
  });
  const validated = validateCaptureContinuityRecoverySnapshot(profileOnly);
  assert.deepEqual(validated.customerIds, [customerId]);
  assert.deepEqual(validated.captureDraftIds, []);
});

test("accepts the exact six-version browser journey and returns every cleanup identity", () => {
  const full = fullSnapshot();
  const validated = validateCaptureContinuityRecoverySnapshot(full);
  assert.deepEqual(validated.customerIds, [customerId]);
  assert.deepEqual(validated.addressIds, [addressId]);
  assert.deepEqual(validated.captureDraftIds, [captureId]);
  assert.equal(validated.customerEventIds.length, 3);
  assert.equal(validated.captureEventIds.length, 6);
  assert.deepEqual(validated.partySnapshotIds, [partyId]);
  assert.deepEqual(validated.fulfillmentSnapshotIds, [fulfillmentId]);
});

test("rejects confirmed captures, foreign actors, extra rows and non-prefix journals", () => {
  const confirmed = fullSnapshot();
  assert.throws(() => validateCaptureContinuityRecoverySnapshot({
    ...confirmed,
    captures: [{ ...confirmed.captures[0]!, status: "confirmed", confirmedOrderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
  }));
  assert.throws(() => validateCaptureContinuityRecoverySnapshot({
    ...confirmed,
    captureEvents: confirmed.captureEvents.map((event, index) => index === 2 ? { ...event, actorId: contactId } : event),
  }));
  assert.throws(() => validateCaptureContinuityRecoverySnapshot({
    ...confirmed,
    customers: [...confirmed.customers, { ...customer(), id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
  }));
  assert.throws(() => validateCaptureContinuityRecoverySnapshot({
    ...confirmed,
    captureEvents: confirmed.captureEvents.map((event, index) => index === 4 ? { ...event, operation: "capture.held" } : event),
  }));
});

function fullSnapshot(): CaptureContinuityRecoverySnapshot {
  const address = {
    createdBy: actorId,
    customerId,
    deletedAt: null,
    id: addressId,
    label: "Domicilio continuidad",
    streetLine: `Calle Continuidad ${runId.slice(0, 8)} 42`,
    updatedBy: actorId,
    validatedBy: actorId,
    validationBranchId: branchId,
    version: 2,
  };
  const operations = [
    "capture.created",
    "capture.customer_changed",
    "capture.fulfillment_changed",
    "capture.claimed",
    "capture.autosaved",
    "capture.claimed",
  ];
  return snapshot({
    addressRows: [address],
    captureEvents: operations.map((operation, index) => ({
      actorId,
      branchId,
      captureDraftId: captureId,
      eventId: `${(index + 1).toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
      operation,
      restaurantId,
      resultVersion: index + 1,
    })),
    captures: [{
      branchId,
      confirmedOrderId: null,
      createdBy: actorId,
      customerId,
      customerSnapshotId: partyId,
      fulfillmentChannel: "delivery",
      fulfillmentSnapshotId: fulfillmentId,
      id: captureId,
      restaurantId,
      sourceChannel: "whatsapp_manual",
      status: "draft",
      updatedBy: actorId,
      version: 6,
    }],
    customerEvents: [
      customerEvent("customer.profile_saved", customerId, 1, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
      customerEvent("customer.address_saved", addressId, 1, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
      customerEvent("customer.address_validated", addressId, 2, "ffffffff-ffff-4fff-8fff-ffffffffffff"),
    ],
    customers: [customer()],
    fulfillmentSnapshots: [{
      addressId,
      branchId,
      createdBy: actorId,
      customerId,
      id: fulfillmentId,
      label: "Domicilio continuidad",
      partySnapshotId: partyId,
      streetLine: address.streetLine,
      validatedBy: actorId,
    }],
    partySnapshots: [{
      contactId,
      createdBy: actorId,
      customerId,
      displayName: `__tenancy_e2e__${runId}__capture-customer`,
      id: partyId,
      phoneDisplayValue: "+52 644 000 0042",
    }],
    phoneRows: [{ contactId, customerId, displayValue: "+52 644 000 0042", label: "Principal" }],
  });
}

function snapshot(
  overrides: Partial<CaptureContinuityRecoverySnapshot> = {},
): CaptureContinuityRecoverySnapshot {
  return {
    addressRows: [],
    branchId,
    captureEvents: [],
    captures: [],
    customerEvents: [],
    customers: [],
    fulfillmentSnapshots: [],
    partySnapshots: [],
    phoneRows: [],
    primaryUserId: actorId,
    restaurantId,
    runId,
    ...overrides,
  };
}

function customer() {
  return {
    createdBy: actorId,
    deletedAt: null,
    displayName: `__tenancy_e2e__${runId}__capture-customer`,
    id: customerId,
    updatedBy: actorId,
    version: 1,
  } as const;
}

function customerEvent(operation: string, entityId: string, resultVersion: number, eventId: string) {
  return { actorId, branchId, customerId, entityId, eventId, operation, resultVersion } as const;
}
