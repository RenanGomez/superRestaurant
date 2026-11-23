import {
  SYNC_ENVELOPE_KEYS,
  SYNC_SCHEMA_VERSION,
  isSyncFinancialEntityTypeV1,
  isSyncSchemaVersionFormat,
  parseSyncEnvelopeV1,
  type SyncEntityTypeV1,
  type SyncEnvelopeV1,
  type SyncJsonObject,
  type SyncOperationV1,
} from "@super-restaurant/shared-types";
import { SyncEngineError } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { asPlainRecord, hasExactKeys } from "./json.js";
import { checkPayload } from "./payload-guard.js";

export const MAX_SCHEMA_MIGRATION_HOPS = 16;

export interface SchemaMigrationPayloadContext {
  readonly entityType: SyncEntityTypeV1;
  readonly operation: SyncOperationV1;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly payload: SyncJsonObject;
}

export interface SchemaMigrationStep {
  readonly fromVersion: string;
  readonly toVersion: string;
  /** Optional allowlist of entities; omitted means every entityType in the catalog. */
  readonly entityTypes?: readonly SyncEntityTypeV1[];
  /** Financial entities refuse any migration step where `safeForFinancial` is not explicitly true. */
  readonly safeForFinancial: boolean;
  readonly migratePayload: (context: SchemaMigrationPayloadContext) => SyncJsonObject;
}

export interface SchemaMigrationRegistry {
  readonly targetVersion: string;
  readonly steps: readonly SchemaMigrationStep[];
}

export type SchemaMigrationResult =
  | {
    readonly ok: true;
    readonly envelope: SyncEnvelopeV1;
    readonly migratedFrom: string | null;
    readonly appliedVersions: readonly string[];
  }
  | {
    readonly ok: false;
    readonly code: "SCHEMA_UNSUPPORTED" | "SCHEMA_MIGRATION_FAILED";
    readonly requiresManualReview: boolean;
    readonly detail: string;
  };

function stepApplies(step: SchemaMigrationStep, entityType: string): boolean {
  return step.entityTypes === undefined || (step.entityTypes as readonly string[]).includes(entityType);
}

/**
 * Creates an immutable, deterministic, acyclic schema migration registry.
 * Rejects duplicate `(fromVersion, entityType)` rules, invalid version strings, and cycles.
 */
export function createSchemaMigrationRegistry(
  targetVersion: string = SYNC_SCHEMA_VERSION,
  steps: readonly SchemaMigrationStep[] = [],
): SchemaMigrationRegistry {
  if (!isSyncSchemaVersionFormat(targetVersion)) {
    throw new SyncEngineError("SCHEMA_MIGRATION_FAILED", "invalid targetVersion");
  }
  const normalizedSteps: SchemaMigrationStep[] = [];
  for (const step of steps) {
    if (
      !isSyncSchemaVersionFormat(step.fromVersion)
      || !isSyncSchemaVersionFormat(step.toVersion)
      || step.fromVersion === step.toVersion
      || typeof step.safeForFinancial !== "boolean"
      || typeof step.migratePayload !== "function"
    ) {
      throw new SyncEngineError("SCHEMA_MIGRATION_FAILED", "invalid migration step");
    }
    normalizedSteps.push(Object.freeze({
      fromVersion: step.fromVersion,
      toVersion: step.toVersion,
      ...(step.entityTypes !== undefined ? { entityTypes: Object.freeze([...step.entityTypes]) } : {}),
      safeForFinancial: step.safeForFinancial,
      migratePayload: step.migratePayload,
    }));
  }

  // Verify determinism (no two steps match the same fromVersion + entityType) and acyclicity.
  for (let leftIndex = 0; leftIndex < normalizedSteps.length; leftIndex += 1) {
    const left = normalizedSteps[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < normalizedSteps.length; rightIndex += 1) {
      const right = normalizedSteps[rightIndex]!;
      if (left.fromVersion !== right.fromVersion) continue;
      const overlaps = left.entityTypes === undefined
        || right.entityTypes === undefined
        || left.entityTypes.some((entity) => right.entityTypes?.includes(entity));
      if (overlaps) {
        throw new SyncEngineError("SCHEMA_MIGRATION_FAILED", `ambiguous migration from ${left.fromVersion}`);
      }
    }
  }

  // Detect cycles across all start versions.
  const allStarts = new Set(normalizedSteps.map((step) => step.fromVersion));
  const entityScope = new Set<string>(["*"]);
  for (const step of normalizedSteps) {
    if (step.entityTypes !== undefined) {
      for (const entity of step.entityTypes) entityScope.add(entity);
    }
  }
  for (const entity of entityScope) {
    for (const start of allStarts) {
      const visited = new Set<string>();
      let cursor = start;
      while (cursor !== targetVersion) {
        if (visited.has(cursor)) {
          throw new SyncEngineError("SCHEMA_MIGRATION_FAILED", `cycle detected at ${cursor}`);
        }
        visited.add(cursor);
        const nextStep = normalizedSteps.find((step) => step.fromVersion === cursor && (entity === "*" ? step.entityTypes === undefined : stepApplies(step, entity)));
        if (nextStep === undefined) break;
        cursor = nextStep.toVersion;
      }
    }
  }

  return Object.freeze({
    targetVersion,
    steps: Object.freeze(normalizedSteps),
  });
}

/**
 * Deterministically migrates a raw sync envelope from an older `schemaVersion` to
 * `registry.targetVersion` BEFORE final validation (OFFLINE_SYNC_CONTRACT §9).
 *
 * Preserves identity (`eventId`, `idempotencyKey`), actor, scope, device, sequence, and timestamps.
 * Never silently transforms financial events on unsafe steps.
 */
export function migrateEnvelopeSchema(
  rawEnvelope: unknown,
  registry: SchemaMigrationRegistry,
): SchemaMigrationResult {
  const record = asPlainRecord(rawEnvelope);
  if (record === undefined || hasExactKeys(record, SYNC_ENVELOPE_KEYS) !== undefined) {
    return Object.freeze({
      ok: false,
      code: "SCHEMA_MIGRATION_FAILED",
      requiresManualReview: false,
      detail: "envelope shape invalid",
    });
  }

  const rawSchemaVersion = record["schemaVersion"];
  const entityType = record["entityType"];
  const operation = record["operation"];
  const financial = typeof entityType === "string" && isSyncFinancialEntityTypeV1(entityType);

  if (!isSyncSchemaVersionFormat(rawSchemaVersion) || typeof entityType !== "string" || typeof operation !== "string") {
    return Object.freeze({
      ok: false,
      code: "SCHEMA_UNSUPPORTED",
      requiresManualReview: financial,
      detail: "invalid schemaVersion or entity",
    });
  }

  if (rawSchemaVersion === registry.targetVersion) {
    const parsed = parseSyncEnvelopeV1(record);
    if (parsed === undefined) {
      return Object.freeze({
        ok: false,
        code: "SCHEMA_MIGRATION_FAILED",
        requiresManualReview: financial,
        detail: "envelope failed target validation",
      });
    }
    return Object.freeze({
      ok: true,
      envelope: parsed,
      migratedFrom: null,
      appliedVersions: Object.freeze([]),
    });
  }

  const initialPayload = checkPayload(record["payload"], "inbound");
  if (!initialPayload.ok) {
    return Object.freeze({
      ok: false,
      code: "SCHEMA_MIGRATION_FAILED",
      requiresManualReview: financial,
      detail: initialPayload.code,
    });
  }

  let currentVersion = rawSchemaVersion;
  let currentPayload: SyncJsonObject = initialPayload.value;
  const appliedVersions: string[] = [];
  const visited = new Set<string>([currentVersion]);

  while (currentVersion !== registry.targetVersion) {
    if (appliedVersions.length >= MAX_SCHEMA_MIGRATION_HOPS) {
      return Object.freeze({
        ok: false,
        code: "SCHEMA_MIGRATION_FAILED",
        requiresManualReview: financial,
        detail: "max migration hops exceeded",
      });
    }
    const matching = registry.steps.filter(
      (step) => step.fromVersion === currentVersion && stepApplies(step, entityType),
    );
    if (matching.length !== 1) {
      return Object.freeze({
        ok: false,
        code: "SCHEMA_UNSUPPORTED",
        requiresManualReview: financial,
        detail: `no deterministic migration path from ${currentVersion} to ${registry.targetVersion}`,
      });
    }
    const step = matching[0]!;
    if (financial && !step.safeForFinancial) {
      return Object.freeze({
        ok: false,
        code: "SCHEMA_UNSUPPORTED",
        requiresManualReview: true,
        detail: `migration ${step.fromVersion}->${step.toVersion} is not safe for financial entity ${entityType}`,
      });
    }
    if (visited.has(step.toVersion)) {
      return Object.freeze({
        ok: false,
        code: "SCHEMA_MIGRATION_FAILED",
        requiresManualReview: financial,
        detail: `cycle detected at ${step.toVersion}`,
      });
    }

    let nextRawPayload: unknown;
    try {
      nextRawPayload = step.migratePayload(Object.freeze({
        entityType: entityType as SyncEntityTypeV1,
        operation: operation as SyncOperationV1,
        fromVersion: step.fromVersion,
        toVersion: step.toVersion,
        payload: deepFreeze(JSON.parse(JSON.stringify(currentPayload)) as SyncJsonObject),
      }));
    } catch {
      return Object.freeze({
        ok: false,
        code: "SCHEMA_MIGRATION_FAILED",
        requiresManualReview: financial,
        detail: `migration step ${step.fromVersion}->${step.toVersion} threw`,
      });
    }

    const checked = checkPayload(nextRawPayload, "strict");
    if (!checked.ok) {
      return Object.freeze({
        ok: false,
        code: "SCHEMA_MIGRATION_FAILED",
        requiresManualReview: financial,
        detail: `migrated payload failed validation (${checked.code})`,
      });
    }

    currentPayload = checked.value;
    currentVersion = step.toVersion;
    visited.add(currentVersion);
    appliedVersions.push(currentVersion);
  }

  // Reconstruct preserving every immutable identity, scope, audit and sequence field verbatim.
  const candidate = {
    eventId: record["eventId"],
    idempotencyKey: record["idempotencyKey"],
    deviceId: record["deviceId"],
    actorId: record["actorId"],
    restaurantId: record["restaurantId"],
    branchId: record["branchId"],
    entityType: record["entityType"],
    entityId: record["entityId"],
    operation: record["operation"],
    schemaVersion: currentVersion,
    localSequence: record["localSequence"],
    baseVersion: record["baseVersion"],
    occurredAt: record["occurredAt"],
    receivedAt: record["receivedAt"],
    payload: currentPayload,
    retryCount: record["retryCount"],
    localState: record["localState"],
  };

  const validated = parseSyncEnvelopeV1(candidate);
  if (validated === undefined) {
    return Object.freeze({
      ok: false,
      code: "SCHEMA_MIGRATION_FAILED",
      requiresManualReview: financial,
      detail: "migrated envelope failed final contract validation",
    });
  }

  return Object.freeze({
    ok: true,
    envelope: validated,
    migratedFrom: rawSchemaVersion,
    appliedVersions: Object.freeze(appliedVersions),
  });
}
