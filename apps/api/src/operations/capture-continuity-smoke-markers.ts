import { createHash } from "node:crypto";

export function captureContinuityAssignmentIds(
  runId: string,
): Readonly<{ grantId: string; membershipId: string }> {
  return Object.freeze({
    grantId: deterministicFixtureUuid(runId, "capture-assignment-grant"),
    membershipId: deterministicFixtureUuid(runId, "capture-assignment-membership"),
  });
}

export function captureCustomerJourneyIds(runId: string): Readonly<{
  historicalCaptureDraftId: string;
  historicalOrderId: string;
  historicalOrderItemId: string;
  journeyCaptureDraftId: string;
  operationalShiftId: string;
}> {
  return Object.freeze({
    historicalCaptureDraftId: deterministicFixtureUuid(runId, "capture-customer-journey-history"),
    historicalOrderId: deterministicFixtureUuid(runId, "capture-customer-journey-order"),
    historicalOrderItemId: deterministicFixtureUuid(runId, "capture-customer-journey-item"),
    journeyCaptureDraftId: deterministicFixtureUuid(runId, "capture-customer-journey-target"),
    operationalShiftId: deterministicFixtureUuid(runId, "capture-customer-journey-shift"),
  });
}

function deterministicFixtureUuid(runId: string, suffix: string): string {
  const bytes = createHash("sha256").update(`${runId}:${suffix}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
