import { types as nodeTypes } from "node:util";
import {
  parseBranchScope,
  parseCaptureDraftDetailV1,
  parseCaptureRecoveryPolicyV1,
  parseCaptureWorkspaceV1,
  parseCaptureWorkspaceV2,
  parseCaptureWorkspaceV3,
  parseCaptureWorkspaceV4,
  parseCaptureWorkspaceV5,
  type BranchScope,
  type CaptureDraftDetailV1,
  type CaptureRecoveryPolicyV1,
  type CaptureWorkspaceV1,
  type CaptureWorkspaceV2,
  type CaptureWorkspaceV3,
  type CaptureWorkspaceV4,
  type CaptureWorkspaceV5,
} from "@super-restaurant/shared-types";

export interface PersistedCaptureRecordV1 {
  readonly schemaVersion: 1;
  readonly detail: CaptureDraftDetailV1;
  readonly recoveryPolicy: CaptureRecoveryPolicyV1;
}

export class CapturePersistenceCodecError extends Error {
  public constructor() {
    super("CAPTURE_PERSISTENCE_RECORD_REJECTED");
    this.name = "CapturePersistenceCodecError";
  }
}

/** Decode only in the already authorized scope; this is not an authorization substitute. */
export function decodeCaptureRecord(value: unknown, authorizedScope: BranchScope): PersistedCaptureRecordV1 {
  const scope = parseBranchScope(authorizedScope);
  const record = readRecord(value);
  if (scope === undefined || record === undefined || record.schemaVersion !== 1) throw rejected();
  const detail = parseCaptureDraftDetailV1(record.detail);
  const recoveryPolicy = parseCaptureRecoveryPolicyV1(record.recoveryPolicy);
  if (detail === undefined || recoveryPolicy === undefined
    || detail.scope.restaurantId !== scope.restaurantId || detail.scope.branchId !== scope.branchId) throw rejected();
  return Object.freeze({ schemaVersion: 1, detail, recoveryPolicy });
}

/** Detached, deeply immutable JSON-compatible storage facts, never live client objects. */
export function encodeCaptureRecord(value: PersistedCaptureRecordV1, authorizedScope: BranchScope): PersistedCaptureRecordV1 {
  return decodeCaptureRecord(value, authorizedScope);
}

export function decodeCaptureWorkspace(value: unknown, authorizedScope: BranchScope): CaptureWorkspaceV1 {
  const scope = parseBranchScope(authorizedScope);
  const workspace = parseCaptureWorkspaceV1(value);
  if (scope === undefined || workspace === undefined || workspace.detail.scope.restaurantId !== scope.restaurantId
    || workspace.detail.scope.branchId !== scope.branchId) throw rejected();
  return workspace;
}

export function decodeCaptureWorkspaceV2(value: unknown, authorizedScope: BranchScope): CaptureWorkspaceV2 {
  const scope = parseBranchScope(authorizedScope);
  const workspace = parseCaptureWorkspaceV2(value);
  if (scope === undefined || workspace === undefined || workspace.detail.scope.restaurantId !== scope.restaurantId
    || workspace.detail.scope.branchId !== scope.branchId) throw rejected();
  return workspace;
}

export function decodeCaptureWorkspaceV3(value: unknown, authorizedScope: BranchScope): CaptureWorkspaceV3 {
  const scope = parseBranchScope(authorizedScope);
  const workspace = parseCaptureWorkspaceV3(value);
  if (scope === undefined || workspace === undefined || workspace.detail.scope.restaurantId !== scope.restaurantId
    || workspace.detail.scope.branchId !== scope.branchId) throw rejected();
  return workspace;
}

/**
 * `app_private.read_capture_workspace_v4` never returns `selectionProjection`:
 * that field is computed by the API from the live catalog, not stored. This
 * decode augments the raw row with `selectionProjection: null` before
 * validating the rest of the V4 shape; callers that need a priced
 * projection replace it afterward via `withCaptureSelectionProjection`.
 */
export function decodeCaptureWorkspaceV4(value: unknown, authorizedScope: BranchScope): CaptureWorkspaceV4 {
  const scope = parseBranchScope(authorizedScope);
  const augmented = withSelectionProjectionKey(value);
  const workspace = parseCaptureWorkspaceV4(augmented);
  if (scope === undefined || workspace === undefined || workspace.detail.scope.restaurantId !== scope.restaurantId
    || workspace.detail.scope.branchId !== scope.branchId) throw rejected();
  return workspace;
}

function withSelectionProjectionKey(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return value;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const keys = Reflect.ownKeys(value);
    if (keys.includes("selectionProjection")) return value;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") return value;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return value;
      result[key] = descriptor.value;
    }
    result.selectionProjection = null;
    return result;
  } catch {
    return value;
  }
}

/** Replaces `selectionProjection` with an API-computed, catalog-priced projection. */
export function withCaptureSelectionProjection(
  workspace: CaptureWorkspaceV4,
  selectionProjection: CaptureWorkspaceV4["selectionProjection"],
): CaptureWorkspaceV4 {
  return Object.freeze({ ...workspace, selectionProjection });
}

export interface DecodedCaptureWorkspaceV5 {
  readonly workspace: CaptureWorkspaceV5;
  /** Server-only facts `read_capture_workspace_v5` returns alongside the public shape; used
   * exclusively by the API to decide `paymentProjection.status`, never re-exposed verbatim. */
  readonly paymentIntentAppliedCaptureVersion: number | null;
  readonly paymentIntentBasisFingerprint: string | null;
}

/**
 * `app_private.read_capture_workspace_v5` returns V4 plus raw `deliveryQuote`/`paymentIntent`
 * facts and two server-only staleness facts (`paymentIntentAppliedCaptureVersion`,
 * `paymentIntentBasisFingerprint`) that are not part of the public `CaptureWorkspaceV5` contract.
 * This strips those two extra keys before validating the public shape (augmented with
 * `selectionProjection`/`paymentProjection: null`, both API-computed), and returns them
 * separately for the caller's own staleness computation.
 */
export function decodeCaptureWorkspaceV5(value: unknown, authorizedScope: BranchScope): DecodedCaptureWorkspaceV5 {
  const scope = parseBranchScope(authorizedScope);
  const extracted = extractPaymentIntentStalenessFacts(value);
  if (extracted === undefined) throw rejected();
  const augmented = withSelectionProjectionKey(withPaymentProjectionKey(extracted.rest));
  const workspace = parseCaptureWorkspaceV5(augmented);
  if (scope === undefined || workspace === undefined || workspace.detail.scope.restaurantId !== scope.restaurantId
    || workspace.detail.scope.branchId !== scope.branchId) throw rejected();
  return Object.freeze({
    workspace,
    paymentIntentAppliedCaptureVersion: extracted.paymentIntentAppliedCaptureVersion,
    paymentIntentBasisFingerprint: extracted.paymentIntentBasisFingerprint,
  });
}

function extractPaymentIntentStalenessFacts(value: unknown): {
  readonly rest: unknown;
  readonly paymentIntentAppliedCaptureVersion: number | null;
  readonly paymentIntentBasisFingerprint: string | null;
} | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (!keys.includes("paymentIntentAppliedCaptureVersion") || !keys.includes("paymentIntentBasisFingerprint")) return undefined;
    const rest: Record<string, unknown> = {};
    let rawVersion: unknown;
    let rawFingerprint: unknown;
    for (const key of keys) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      if (key === "paymentIntentAppliedCaptureVersion") { rawVersion = descriptor.value; continue; }
      if (key === "paymentIntentBasisFingerprint") { rawFingerprint = descriptor.value; continue; }
      rest[key] = descriptor.value;
    }
    const paymentIntentAppliedCaptureVersion = rawVersion === null ? null
      : typeof rawVersion === "number" && Number.isSafeInteger(rawVersion) && rawVersion > 0 ? rawVersion : undefined;
    const paymentIntentBasisFingerprint = rawFingerprint === null ? null
      : typeof rawFingerprint === "string" && /^[0-9a-f]{64}$/u.test(rawFingerprint) ? rawFingerprint : undefined;
    if (paymentIntentAppliedCaptureVersion === undefined || paymentIntentBasisFingerprint === undefined
      || (paymentIntentAppliedCaptureVersion === null) !== (paymentIntentBasisFingerprint === null)) return undefined;
    return { rest, paymentIntentAppliedCaptureVersion, paymentIntentBasisFingerprint };
  } catch {
    return undefined;
  }
}

function withPaymentProjectionKey(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return value;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const keys = Reflect.ownKeys(value);
    if (keys.includes("paymentProjection")) return value;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") return value;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return value;
      result[key] = descriptor.value;
    }
    result.paymentProjection = null;
    return result;
  } catch {
    return value;
  }
}

/** Replaces `paymentProjection` with an API-computed projection. */
export function withCapturePaymentProjection(
  workspace: CaptureWorkspaceV5,
  paymentProjection: CaptureWorkspaceV5["paymentProjection"],
): CaptureWorkspaceV5 {
  return Object.freeze({ ...workspace, paymentProjection });
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = ["schemaVersion", "detail", "recoveryPolicy"];
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) return undefined;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

function rejected(): CapturePersistenceCodecError {
  return new CapturePersistenceCodecError();
}
