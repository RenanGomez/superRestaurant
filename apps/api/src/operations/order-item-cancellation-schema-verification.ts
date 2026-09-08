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
  securityDefinerFunctions: 24,
}) satisfies ExpectedSchemaVerificationSummary;

export interface OrderItemCancellationSchemaVerificationInput {
  readonly baseCatalogAuditSql: string;
  readonly config: SchemaVerificationConfig;
  readonly migrationSql: string;
  readonly targetCatalogAuditSql: string;
}

export interface OrderItemCancellationSchemaVerificationDependencies {
  readonly runReadOnlyAudit?: typeof runReadOnlySchemaAudit;
  readonly runRollbackVerification?: typeof runSchemaVerification;
}

export interface OrderItemCancellationSchemaVerificationResult {
  readonly base: SchemaVerificationSummary;
  readonly migrated: SchemaVerificationSummary;
  readonly postcheck: SchemaVerificationSummary;
}

export async function verifyOrderItemCancellationSchema(
  input: OrderItemCancellationSchemaVerificationInput,
  dependencies: OrderItemCancellationSchemaVerificationDependencies = {},
): Promise<OrderItemCancellationSchemaVerificationResult> {
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
  if (migrated === undefined) throw new Error("ORDER_ITEM_CANCELLATION_SCHEMA_VERIFICATION_INCOMPLETE");
  return Object.freeze({ base, migrated, postcheck });
}
