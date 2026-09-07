import {
  runReadOnlySchemaAudit,
  runSchemaVerification,
  type ExpectedSchemaVerificationSummary,
  type SchemaVerificationConfig,
  type SchemaVerificationSummary,
} from "./schema-verification.js";

const SUMMARY = Object.freeze({
  policies: 5,
  securedTables: 23,
  securityDefinerFunctions: 22,
}) satisfies ExpectedSchemaVerificationSummary;

export interface MenuOrderabilitySchemaVerificationInput {
  readonly baseCatalogAuditSql: string;
  readonly config: SchemaVerificationConfig;
  readonly migrationSql: string;
  readonly targetCatalogAuditSql: string;
}

export interface MenuOrderabilitySchemaVerificationDependencies {
  readonly runReadOnlyAudit?: typeof runReadOnlySchemaAudit;
  readonly runRollbackVerification?: typeof runSchemaVerification;
}

export interface MenuOrderabilitySchemaVerificationResult {
  readonly base: SchemaVerificationSummary;
  readonly migrated: SchemaVerificationSummary;
  readonly postcheck: SchemaVerificationSummary;
}

export async function verifyMenuOrderabilitySchema(
  input: MenuOrderabilitySchemaVerificationInput,
  dependencies: MenuOrderabilitySchemaVerificationDependencies = {},
): Promise<MenuOrderabilitySchemaVerificationResult> {
  const readOnlyAudit = dependencies.runReadOnlyAudit ?? runReadOnlySchemaAudit;
  const rollbackVerification = dependencies.runRollbackVerification ?? runSchemaVerification;
  const base = await readOnlyAudit({
    catalogAuditSql: input.baseCatalogAuditSql,
    config: input.config,
    expectedSummary: SUMMARY,
  });

  let migrated: SchemaVerificationSummary | undefined;
  let migrationFailure: unknown;
  try {
    migrated = await rollbackVerification({
      catalogAuditSql: input.targetCatalogAuditSql,
      config: input.config,
      expectedSummary: SUMMARY,
      migrationSql: input.migrationSql,
    });
  } catch (error: unknown) {
    migrationFailure = error;
  }

  const postcheck = await readOnlyAudit({
    catalogAuditSql: input.baseCatalogAuditSql,
    config: input.config,
    expectedSummary: SUMMARY,
  });
  if (migrationFailure !== undefined) throw migrationFailure;
  if (migrated === undefined) throw new Error("MENU_ORDERABILITY_SCHEMA_VERIFICATION_INCOMPLETE");
  return Object.freeze({ base, migrated, postcheck });
}
