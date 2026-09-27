import {
  runReadOnlySchemaAudit,
  runSchemaVerification,
  type ExpectedSchemaVerificationSummary,
  type RunSchemaVerificationOptions,
  type SchemaVerificationConfig,
  type SchemaVerificationSummary,
} from "./schema-verification.js";

/** Exact catalog counts on the 39 prior migrations, before the delivery-zones candidate applies. */
export const DELIVERY_ZONES_BASE_SUMMARY = Object.freeze({
  policies: 5,
  securedTables: 37,
  securityDefinerFunctions: 58,
}) satisfies ExpectedSchemaVerificationSummary;

/** Exact catalog counts with the delivery-zones candidate applied: +3 tables, +3 security-definer functions, 0 new policies. */
export const DELIVERY_ZONES_TARGET_SUMMARY = Object.freeze({
  policies: 5,
  securedTables: 40,
  securityDefinerFunctions: 61,
}) satisfies ExpectedSchemaVerificationSummary;

export interface DeliveryZonesSchemaVerificationInput {
  readonly baseCatalogAuditSql: string;
  readonly config: SchemaVerificationConfig;
  readonly migrationSql: string;
  readonly targetCatalogAuditSql: string;
  readonly verifyWithinTransaction?: RunSchemaVerificationOptions["verifyWithinTransaction"];
}

export interface DeliveryZonesSchemaVerificationDependencies {
  readonly runReadOnlyAudit?: typeof runReadOnlySchemaAudit;
  readonly runRollbackVerification?: typeof runSchemaVerification;
}

export interface DeliveryZonesSchemaVerificationResult {
  readonly base: SchemaVerificationSummary;
  readonly migrated: SchemaVerificationSummary;
  readonly postcheck: SchemaVerificationSummary;
}

/**
 * Orchestrates a rollback-only verification of the delivery-zones migration:
 * 1) read-only audit of the exact pre-migration baseline;
 * 2) BEGIN, apply the candidate migration, exercise fixtures/invariants, audit the target
 *    catalog shape, then ROLLBACK unconditionally (success or failure);
 * 3) read-only audit that the baseline is restored with zero residual state.
 *
 * The postcheck always runs, even when step 2 fails, so a caller can tell "migration broke
 * something" apart from "rollback left residue" -- both are failures, but the second is worse.
 */
export async function verifyDeliveryZonesSchema(
  input: DeliveryZonesSchemaVerificationInput,
  dependencies: DeliveryZonesSchemaVerificationDependencies = {},
): Promise<DeliveryZonesSchemaVerificationResult> {
  const readOnlyAudit = dependencies.runReadOnlyAudit ?? runReadOnlySchemaAudit;
  const rollbackVerification = dependencies.runRollbackVerification ?? runSchemaVerification;

  const base = await readOnlyAudit({
    catalogAuditSql: input.baseCatalogAuditSql,
    config: input.config,
    expectedSummary: DELIVERY_ZONES_BASE_SUMMARY,
  });

  let migrated: SchemaVerificationSummary | undefined;
  let migrationFailure: unknown;
  try {
    migrated = await rollbackVerification({
      catalogAuditSql: input.targetCatalogAuditSql,
      config: input.config,
      expectedSummary: DELIVERY_ZONES_TARGET_SUMMARY,
      migrationSql: input.migrationSql,
      ...(input.verifyWithinTransaction === undefined ? {} : { verifyWithinTransaction: input.verifyWithinTransaction }),
    });
  } catch (error: unknown) {
    migrationFailure = error;
  }

  const postcheck = await readOnlyAudit({
    catalogAuditSql: input.baseCatalogAuditSql,
    config: input.config,
    expectedSummary: DELIVERY_ZONES_BASE_SUMMARY,
  });

  if (migrationFailure !== undefined) throw migrationFailure;
  if (migrated === undefined) throw new Error("DELIVERY_ZONES_SCHEMA_VERIFICATION_INCOMPLETE");
  return Object.freeze({ base, migrated, postcheck });
}
