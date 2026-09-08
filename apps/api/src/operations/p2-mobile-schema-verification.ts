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
  securityDefinerFunctions: 30,
}) satisfies ExpectedSchemaVerificationSummary;

export interface P2MobileSchemaVerificationInput {
  readonly baseCatalogAuditSql: string;
  readonly config: SchemaVerificationConfig;
  readonly migrationSqls: readonly [string, string, string, string, string];
  readonly targetCatalogAuditSql: string;
}

export interface P2MobileSchemaVerificationDependencies {
  readonly runReadOnlyAudit?: typeof runReadOnlySchemaAudit;
  readonly runRollbackVerification?: typeof runSchemaVerification;
}

export interface P2MobileSchemaVerificationResult {
  readonly base: SchemaVerificationSummary;
  readonly migrated: SchemaVerificationSummary;
  readonly postcheck: SchemaVerificationSummary;
}

export async function verifyP2MobileSchema(
  input: P2MobileSchemaVerificationInput,
  dependencies: P2MobileSchemaVerificationDependencies = {},
): Promise<P2MobileSchemaVerificationResult> {
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
      migrationSql: `begin;\n${input.migrationSqls.map(extractMigrationBody).join("\n")}\ncommit;`,
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
  if (migrated === undefined) throw new Error("P2_MOBILE_SCHEMA_VERIFICATION_INCOMPLETE");
  return Object.freeze({ base, migrated, postcheck });
}
