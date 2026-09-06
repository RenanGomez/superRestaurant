import {
  extractMigrationBody,
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
  securedTables: 25,
  securityDefinerFunctions: 25,
}) satisfies ExpectedSchemaVerificationSummary;

export interface OperationalOrderShiftSchemaVerificationInput {
  readonly baseCatalogAuditSql: string;
  readonly config: SchemaVerificationConfig;
  readonly operationalOrderMigrationSql: string;
  readonly operationalShiftMigrationSql: string;
  readonly targetCatalogAuditSql: string;
}

export interface OperationalOrderShiftSchemaVerificationDependencies {
  readonly runReadOnlyAudit?: typeof runReadOnlySchemaAudit;
  readonly runRollbackVerification?: typeof runSchemaVerification;
}

export interface OperationalOrderShiftSchemaVerificationResult {
  readonly base: SchemaVerificationSummary;
  readonly migrated: SchemaVerificationSummary;
  readonly postcheck: SchemaVerificationSummary;
}

export async function verifyOperationalOrderShiftSchema(
  input: OperationalOrderShiftSchemaVerificationInput,
  dependencies: OperationalOrderShiftSchemaVerificationDependencies = {},
): Promise<OperationalOrderShiftSchemaVerificationResult> {
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
      migrationSql: `begin;\n${extractMigrationBody(input.operationalShiftMigrationSql)}\n${extractMigrationBody(input.operationalOrderMigrationSql)}\ncommit;`,
    });
  } catch (error: unknown) {
    migrationFailure = error;
  }

  let postcheck: SchemaVerificationSummary;
  try {
    postcheck = await readOnlyAudit({
      catalogAuditSql: input.baseCatalogAuditSql,
      config: input.config,
      expectedSummary: BASE_SUMMARY,
    });
  } catch (error: unknown) {
    throw error;
  }

  if (migrationFailure !== undefined) throw migrationFailure;
  if (migrated === undefined) throw new Error("OPERATIONAL_ORDER_SHIFT_SCHEMA_VERIFICATION_INCOMPLETE");
  return Object.freeze({ base, migrated, postcheck });
}
