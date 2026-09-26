import assert from "node:assert/strict";
import test from "node:test";

import {
  driveCaptureContinuityApiSmoke,
  parseCaptureContinuityApiSmokeLease,
} from "./capture-continuity-api-smoke-driver.js";

const leaseValue = Object.freeze({
  addressId: "11111111-1111-4111-8111-111111111111",
  addressLabel: "Casa",
  apiBaseUrl: "http://127.0.0.1:4314",
  assignmentTargetMembershipId: "22222222-2222-4222-8222-222222222222",
  assignmentTargetRole: "waiter",
  branchId: "33333333-3333-4333-8333-333333333333",
  branchName: "Branch",
  captureDraftId: "44444444-4444-4444-8444-444444444444",
  customerId: "55555555-5555-4555-8555-555555555555",
  customerJourneyCaptureDraftId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  customerJourneyDeliveryInstructions: "Tocar dos veces; entregar en el portón lateral",
  displayName: "Customer",
  email: "fixture@example.invalid",
  expectedSourceAfterAutosave: "whatsapp_manual",
  folio: "C-42",
  historicalOrderId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  password: "temporary-password",
  phase: "capture_continuity",
  phoneDisplayValue: "+52 644 000 0042",
  restaurantId: "66666666-6666-4666-8666-666666666666",
  restaurantName: "Restaurant",
  runId: "77777777-7777-4777-8777-777777777777",
  streetLine: "Calle 42",
});

test("accepts only the exact marked lease shape", () => {
  assert.notEqual(parseCaptureContinuityApiSmokeLease(leaseValue), undefined);
  assert.equal(parseCaptureContinuityApiSmokeLease({ ...leaseValue, extra: true }), undefined);
  assert.equal(parseCaptureContinuityApiSmokeLease({ ...leaseValue, apiBaseUrl: "https://example.com" }), undefined);
  assert.equal(parseCaptureContinuityApiSmokeLease({ ...leaseValue, assignmentTargetRole: "manager" }), undefined);
});

test("drives the exact assignment journey and acknowledges only after takeover", async () => {
  const lease = parseCaptureContinuityApiSmokeLease(leaseValue);
  assert.notEqual(lease, undefined);
  const calls: Array<Readonly<{ body: Record<string, unknown>; path: string }>> = [];
  let acknowledged: string | undefined;
  const versions = new Map([
    ["/api/v1/captures/claim:3", 4],
    ["/api/v1/captures/autosave:4", 5],
    ["/api/v1/captures/claim:5", 6],
    ["/api/v1/captures/transfer:6", 7],
    ["/api/v1/captures/takeover:7", 8],
  ]);
  await driveCaptureContinuityApiSmoke(lease!, {
    acknowledge: async (runId) => { acknowledged = runId; },
    postJson: async (path, input) => {
      const body = input as Record<string, unknown>;
      calls.push({ body, path });
      if (path.endsWith("assignment-candidates")) {
        return { schemaVersion: 1, scope: { restaurantId: lease!.restaurantId, branchId: lease!.branchId }, candidates: [{
          schemaVersion: 1, membershipId: lease!.assignmentTargetMembershipId,
          displayLabel: "Operador 22222222", roles: ["waiter"],
        }] };
      }
      const version = versions.get(`${path}:${String(body.expectedVersion)}`);
      assert.notEqual(version, undefined);
      return mutation(version!);
    },
  });
  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/v1/captures/claim", "/api/v1/captures/autosave", "/api/v1/captures/claim",
    "/api/v1/captures/assignment-candidates", "/api/v1/captures/transfer", "/api/v1/captures/takeover",
  ]);
  assert.equal(calls[4]?.body.targetMembershipId, lease!.assignmentTargetMembershipId);
  assert.equal(calls[5]?.body.reason, "Smoke protegido de asignación Capture");
  assert.equal(acknowledged, lease!.runId);
});

test("does not acknowledge an incomplete or hostile journey", async () => {
  const lease = parseCaptureContinuityApiSmokeLease(leaseValue)!;
  let acknowledged = false;
  await assert.rejects(() => driveCaptureContinuityApiSmoke(lease, {
    acknowledge: async () => { acknowledged = true; },
    postJson: async () => ({ hostile: true }),
  }), /CAPTURE_CONTINUITY_API_SMOKE_REJECTED/u);
  assert.equal(acknowledged, false);
});

function mutation(version: number): unknown {
  return {
    schemaVersion: 1,
    replayed: false,
    detail: {
      schemaVersion: 1,
      scope: { restaurantId: leaseValue.restaurantId, branchId: leaseValue.branchId },
      captureDraftId: leaseValue.captureDraftId,
      folio: leaseValue.folio,
      status: "draft",
      attentionStatus: "claimed",
      sourceChannel: version >= 5 ? "whatsapp_manual" : "phone",
      fulfillmentChannel: "delivery",
      ownerMembershipId: "88888888-8888-4888-8888-888888888888",
      attentionLeaseId: "99999999-9999-4999-8999-999999999999",
      attentionLeaseExpiresAt: "2026-09-25T12:05:00.000Z",
      customerSnapshotRef: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      fulfillmentSnapshotRef: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      confirmedOrderId: null,
      updatedAt: "2026-09-25T12:00:00.000Z",
      version,
    },
  };
}
