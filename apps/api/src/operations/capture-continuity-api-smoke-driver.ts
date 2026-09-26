import { randomUUID } from "node:crypto";

import {
  parseCaptureAssignmentDirectoryV1,
  parseCaptureMutationResultV1,
  type CaptureMutationResultV1,
} from "@super-restaurant/shared-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LEASE_KEYS = Object.freeze([
  "addressId", "addressLabel", "apiBaseUrl", "assignmentTargetMembershipId", "assignmentTargetRole",
  "branchId", "branchName", "captureDraftId", "customerId", "customerJourneyCaptureDraftId",
  "customerJourneyDeliveryInstructions", "displayName", "email", "expectedSourceAfterAutosave", "folio",
  "historicalOrderId", "password", "phase", "phoneDisplayValue", "restaurantId",
  "restaurantName", "runId", "streetLine",
] as const);

export interface CaptureContinuityApiSmokeLease {
  readonly apiBaseUrl: "http://127.0.0.1:4314";
  readonly assignmentTargetMembershipId: string;
  readonly assignmentTargetRole: "waiter";
  readonly branchId: string;
  readonly captureDraftId: string;
  readonly customerJourneyCaptureDraftId: string;
  readonly customerJourneyDeliveryInstructions: string;
  readonly email: string;
  readonly expectedSourceAfterAutosave: "whatsapp_manual";
  readonly historicalOrderId: string;
  readonly password: string;
  readonly phase: "capture_continuity";
  readonly restaurantId: string;
  readonly runId: string;
}

export interface CaptureContinuityApiSmokeDependencies {
  readonly acknowledge: (runId: string) => Promise<void>;
  readonly postJson: (path: string, body: unknown) => Promise<unknown>;
}

export function parseCaptureContinuityApiSmokeLease(value: unknown): CaptureContinuityApiSmokeLease | undefined {
  if (!isPlainRecord(value) || !hasExactKeys(value, LEASE_KEYS)) return undefined;
  const uuidKeys = [
    "assignmentTargetMembershipId", "branchId", "captureDraftId", "customerId",
    "customerJourneyCaptureDraftId", "historicalOrderId", "restaurantId", "runId",
  ];
  if (uuidKeys.some((key) => typeof value[key] !== "string" || !UUID.test(value[key]))) return undefined;
  if (
    value.apiBaseUrl !== "http://127.0.0.1:4314"
    || value.assignmentTargetRole !== "waiter"
    || value.expectedSourceAfterAutosave !== "whatsapp_manual"
    || value.phase !== "capture_continuity"
    || !boundedText(value.email, 320)
    || !boundedText(value.password, 1_024)
    || !boundedText(value.customerJourneyDeliveryInstructions, 500)
  ) return undefined;
  return Object.freeze({
    apiBaseUrl: value.apiBaseUrl,
    assignmentTargetMembershipId: value.assignmentTargetMembershipId as string,
    assignmentTargetRole: value.assignmentTargetRole,
    branchId: value.branchId as string,
    captureDraftId: value.captureDraftId as string,
    customerJourneyCaptureDraftId: value.customerJourneyCaptureDraftId as string,
    customerJourneyDeliveryInstructions: value.customerJourneyDeliveryInstructions,
    email: value.email,
    expectedSourceAfterAutosave: value.expectedSourceAfterAutosave,
    historicalOrderId: value.historicalOrderId as string,
    password: value.password,
    phase: value.phase,
    restaurantId: value.restaurantId as string,
    runId: value.runId as string,
  });
}

export async function driveCaptureContinuityApiSmoke(
  lease: CaptureContinuityApiSmokeLease,
  dependencies: CaptureContinuityApiSmokeDependencies,
): Promise<void> {
  const scope = Object.freeze({ restaurantId: lease.restaurantId, branchId: lease.branchId });
  const command = (expectedVersion: number) => ({
    schemaVersion: 1 as const,
    scope,
    captureDraftId: lease.captureDraftId,
    deviceId: randomUUID(),
    eventId: randomUUID(),
    expectedVersion,
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
  });

  const claimed = parseMutation(await dependencies.postJson("/api/v1/captures/claim", command(3)), lease, 4);
  if (claimed.detail.attentionLeaseId === null) throw smokeError();
  const autosaved = parseMutation(await dependencies.postJson("/api/v1/captures/autosave", {
    ...command(4),
    attentionLeaseId: claimed.detail.attentionLeaseId,
    customerSnapshotRef: claimed.detail.customerSnapshotRef,
    fulfillmentChannel: "delivery",
    fulfillmentSnapshotRef: claimed.detail.fulfillmentSnapshotRef,
    sourceChannel: lease.expectedSourceAfterAutosave,
  }), lease, 5);
  if (autosaved.detail.attentionLeaseId === null) throw smokeError();
  const reclaimed = parseMutation(await dependencies.postJson("/api/v1/captures/claim", command(5)), lease, 6);
  if (reclaimed.detail.attentionLeaseId === null) throw smokeError();

  const directory = parseCaptureAssignmentDirectoryV1(await dependencies.postJson(
    "/api/v1/captures/assignment-candidates",
    { schemaVersion: 1, scope },
  ));
  const target = directory?.candidates.find(({ membershipId }) => membershipId === lease.assignmentTargetMembershipId);
  if (
    directory === undefined
    || directory.scope.restaurantId !== lease.restaurantId
    || directory.scope.branchId !== lease.branchId
    || target === undefined
    || !target.roles.includes(lease.assignmentTargetRole)
  ) throw smokeError();

  parseMutation(await dependencies.postJson("/api/v1/captures/transfer", {
    ...command(6),
    attentionLeaseId: reclaimed.detail.attentionLeaseId,
    targetMembershipId: lease.assignmentTargetMembershipId,
  }), lease, 7);
  const takenOver = parseMutation(await dependencies.postJson("/api/v1/captures/takeover", {
    ...command(7),
    reason: "Smoke protegido de asignación Capture",
  }), lease, 8);
  if (takenOver.detail.attentionLeaseId === null) throw smokeError();
  await dependencies.acknowledge(lease.runId);
}

function parseMutation(
  value: unknown,
  lease: CaptureContinuityApiSmokeLease,
  expectedVersion: number,
): CaptureMutationResultV1 {
  const result = parseCaptureMutationResultV1(value);
  if (
    result === undefined
    || result.detail.captureDraftId !== lease.captureDraftId
    || result.detail.scope.restaurantId !== lease.restaurantId
    || result.detail.scope.branchId !== lease.branchId
    || result.detail.version !== expectedVersion
  ) throw smokeError();
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === "string" && expected.includes(key));
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value;
}

function smokeError(): Error {
  return new Error("CAPTURE_CONTINUITY_API_SMOKE_REJECTED");
}
