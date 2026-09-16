import {
  runReadOnlySchemaAudit,
  runSchemaVerification,
  type ExpectedSchemaVerificationSummary,
  type SchemaVerificationConfig,
} from "./schema-verification.js";

export interface CaptureSchemaVerificationInput {
  readonly config: SchemaVerificationConfig;
  readonly migrationSql: string;
  readonly baseCatalogAuditSql: string;
  readonly targetCatalogAuditSql: string;
  /** Must come from the exact audited baseline, including administrative bootstrap. */
  readonly baseSummary: ExpectedSchemaVerificationSummary;
}

export interface CaptureSchemaVerificationDependencies {
  readonly runReadOnlyAudit?: typeof runReadOnlySchemaAudit;
  readonly runRollbackVerification?: typeof runSchemaVerification;
}

/** Schema foundation adds one table and no functions/policies. Always re-audit after rollback. */
export async function verifyCaptureSchema(
  input: CaptureSchemaVerificationInput,
  dependencies: CaptureSchemaVerificationDependencies = {},
) {
  const read = dependencies.runReadOnlyAudit ?? runReadOnlySchemaAudit;
  const rollback = dependencies.runRollbackVerification ?? runSchemaVerification;
  const base = await read({ config: input.config, catalogAuditSql: input.baseCatalogAuditSql, expectedSummary: input.baseSummary });
  let failed = false;
  let failure: unknown;
  let migrated: ExpectedSchemaVerificationSummary | undefined;
  try {
    migrated = await rollback({
      config: input.config,
      migrationSql: input.migrationSql,
      catalogAuditSql: input.targetCatalogAuditSql,
      expectedSummary: { ...input.baseSummary, securedTables: input.baseSummary.securedTables + 1 },
    });
  } catch (error: unknown) {
    failed = true;
    failure = error;
  }
  const postcheck = await read({ config: input.config, catalogAuditSql: input.baseCatalogAuditSql, expectedSummary: input.baseSummary });
  if (failed) throw failure;
  if (migrated === undefined) throw new Error("CAPTURE_SCHEMA_VERIFICATION_INCOMPLETE");
  return Object.freeze({ base, migrated, postcheck });
}
