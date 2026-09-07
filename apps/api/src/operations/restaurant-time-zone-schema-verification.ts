import {
  runReadOnlySchemaAudit,
  runSchemaVerification,
  type ExpectedSchemaVerificationSummary,
  type SchemaVerificationConfig,
  type SchemaVerificationSummary,
} from "./schema-verification.js";

const BASE_SUMMARY = Object.freeze({
  policies: 5,
  securedTables: 23,
  securityDefinerFunctions: 22,
}) satisfies ExpectedSchemaVerificationSummary;

const MIGRATED_SUMMARY = Object.freeze({
  policies: 5,
  securedTables: 23,
  securityDefinerFunctions: 25,
}) satisfies ExpectedSchemaVerificationSummary;

export interface RestaurantTimeZoneSchemaVerificationInput {
  readonly baseCatalogAuditSql: string;
  readonly config: SchemaVerificationConfig;
  readonly migrationSql: string;
  readonly targetCatalogAuditSql: string;
}

export interface RestaurantTimeZoneSchemaVerificationDependencies {
  readonly runReadOnlyAudit?: typeof runReadOnlySchemaAudit;
  readonly runRollbackVerification?: typeof runSchemaVerification;
}

export interface RestaurantTimeZoneSchemaVerificationResult {
  readonly base: SchemaVerificationSummary;
  readonly migrated: SchemaVerificationSummary;
  readonly postcheck: SchemaVerificationSummary;
}

export async function verifyRestaurantTimeZoneSchema(
  input: RestaurantTimeZoneSchemaVerificationInput,
  dependencies: RestaurantTimeZoneSchemaVerificationDependencies = {},
): Promise<RestaurantTimeZoneSchemaVerificationResult> {
  const readOnlyAudit = dependencies.runReadOnlyAudit ?? runReadOnlySchemaAudit;
  const rollbackVerification = dependencies.runRollbackVerification ?? runSchemaVerification;
  const base = await readOnlyAudit({
    catalogAuditSql: input.baseCatalogAuditSql,
    config: input.config,
    expectedSummary: BASE_SUMMARY,
  });

  let migrated: SchemaVerificationSummary | undefined;
  let migrationFailure: unknown;
  try {
    migrated = await rollbackVerification({
      catalogAuditSql: input.targetCatalogAuditSql,
      config: input.config,
      expectedSummary: MIGRATED_SUMMARY,
      migrationSql: input.migrationSql,
    });
  } catch (error: unknown) {
    migrationFailure = error;
  }

  const postcheck = await readOnlyAudit({
    catalogAuditSql: input.baseCatalogAuditSql,
    config: input.config,
    expectedSummary: BASE_SUMMARY,
  });
  if (migrationFailure !== undefined) throw migrationFailure;
  if (migrated === undefined) throw new Error("RESTAURANT_TIME_ZONE_SCHEMA_VERIFICATION_INCOMPLETE");
  return Object.freeze({ base, migrated, postcheck });
}
