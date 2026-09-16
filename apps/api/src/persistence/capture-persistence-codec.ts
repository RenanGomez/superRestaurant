import { types as nodeTypes } from "node:util";
import {
  parseBranchScope,
  parseCaptureDraftDetailV1,
  parseCaptureRecoveryPolicyV1,
  type BranchScope,
  type CaptureDraftDetailV1,
  type CaptureRecoveryPolicyV1,
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
