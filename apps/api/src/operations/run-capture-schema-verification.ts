import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { parseCaptureVerificationMode } from "./capture-schema-verification-mode.js";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres } from "./local-postgres.js";
import { verifyCaptureSchema } from "./capture-schema-verification.js";
import { verifyCustomerDirectoryAdapters } from "./customer-directory-adapter-verification.js";
import { buildCustomerDirectoryCatalogAudit, buildPostBootstrapCatalogAudit, postBootstrapSummary } from "./post-bootstrap-catalog.js";
import { extractMigrationBody, readSchemaVerificationConfig, SchemaVerificationError, type SchemaVerificationConfig } from "./schema-verification.js";

// Historical Capture verifier. The mode is mandatory and explicit: `--remote-only` keeps the
// original remote rollback-only behaviour; `--local-disposable-only` runs the exact candidate set
// from scratch on a brand-new disposable local PostgreSQL 17 cluster (never Supabase, never a
// shared database). Anything else is rejected before reading configuration or connecting.
const marker = "LOCAL_CAPTURE_SCHEMA_ONLY";
const candidateName = "20260916000100_create_capture_drafts.sql";
const mode = parseCaptureVerificationMode(process.argv.slice(2));

function readVerificationInput(config: SchemaVerificationConfig) {
  const base = readFileSync(new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url), "utf8");
  const supplement = readFileSync(new URL("../../../../supabase/tests/capture_drafts_catalog.sql", import.meta.url), "utf8");
  const directorySupplement = readFileSync(new URL("../../../../supabase/tests/customer_directory_catalog.sql", import.meta.url), "utf8");
  const attentionMigration = extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000400_create_capture_attention_command.sql", import.meta.url), "utf8"));
  return {
    config,
    baseSummary: postBootstrapSummary,
    targetSummary: { securedTables: 35, policies: 5, securityDefinerFunctions: 41 },
    ...(["ROLLBACK_ONLY_APP_API", "ROLLBACK_ONLY_APP_API_HTTP"].includes(process.env.CUSTOMER_ADAPTER_VERIFICATION ?? "")
      ? { verifyWithinTransaction: (session: import("./schema-verification.js").SchemaVerificationSession) => verifyCustomerDirectoryAdapters(session,
        process.env.CUSTOMER_ADAPTER_VERIFICATION === "ROLLBACK_ONLY_APP_API_HTTP") } : {}),
    baseCatalogAuditSql: buildPostBootstrapCatalogAudit(base),
    targetCatalogAuditSql: buildCustomerDirectoryCatalogAudit(base, supplement, directorySupplement),
    // The pinned copy predates 20260917000100, whose incomplete-address behaviour the current
    // customer_directory_invariants.sql requires but this historical migration set does not include.
    migrationSql: `begin;\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000100_create_capture_drafts.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000200_create_capture_command_journal.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000300_create_capture_draft_command.sql", import.meta.url), "utf8"))}\n${attentionMigration}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000500_create_customer_directory.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000600_create_customer_directory_command.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000700_create_customer_directory_search.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000800_create_customer_directory_detail.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260920000100_improve_customer_directory_search.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/tests/historical/customer_directory_invariants_pre_20260917000100.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/tests/capture_drafts_invariants.sql", import.meta.url), "utf8"))}\ncommit;`,
  };
}

async function verifyRemote(): Promise<void> {
  try {
    const result = await verifyCaptureSchema(readVerificationInput(readSchemaVerificationConfig(process.env)));
    process.stdout.write(`${JSON.stringify({ stage: "complete", status: "ok", ...result })}\n`);
  } catch (error: unknown) {
    const failure = error instanceof SchemaVerificationError
      ? error
      : new SchemaVerificationError("configuration", "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
    process.stderr.write(`${JSON.stringify({
      code: failure.code,
      stage: failure.stage,
      status: "failed",
      ...(failure.sqlState === undefined ? {} : { sqlState: failure.sqlState }),
      ...(failure.statementIndex === undefined ? {} : { statementIndex: failure.statementIndex }),
    })}\n`);
    process.exitCode = 1;
  }
}

async function verifyLocal(): Promise<void> {
  const local = new LocalPostgres({ marker, databasePrefix: "superrestaurant_capture_schema", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
  let stage = "configuration";
  let failed = false;
  try {
    assertLocalConfirmation();
    await local.start((next) => { stage = next; });
    const names = listMigrationNames();
    const candidateIndex = names.indexOf(candidateName);
    if (candidateIndex < 1) throw new Error("LOCAL_CANDIDATE_MIGRATION_REJECTED");
    const priorNames = names.slice(0, candidateIndex);
    // Nothing beyond the post-bootstrap base: the 27/5/36 counts and the capture 35/5/41 target
    // depend on stopping exactly before the capture migration set.
    stage = "apply_prior_migrations";
    await local.applyMigrations(priorNames);
    await local.admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-capture-schema@invalid.test')", [randomUUID()]);
    const config: SchemaVerificationConfig = Object.freeze({
      caCertificate: "",
      connectionString: local.adminUrl,
      expectedProjectRef: "local-disposable-cluster",
    });
    stage = "verify";
    const result = await verifyCaptureSchema(readVerificationInput(config));
    process.stdout.write(`${JSON.stringify({
      stage: "capture_schema_rollback", status: "ok", runId: local.runId,
      priorMigrationsApplied: priorNames.length, ...result,
    })}\n`);
  } catch (error: unknown) {
    failed = true;
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const localInvariant = typeof error === "object" && error !== null && "message" in error
      && typeof error.message === "string" && /^[A-Z_0-9]+$/u.test(error.message) ? error.message : undefined;
    const detail = typeof error === "object" && error !== null && "detail" in error ? error.detail : undefined;
    const constraint = typeof error === "object" && error !== null && "constraint" in error ? error.constraint : undefined;
    const message = error instanceof Error ? error.message : undefined;
    process.stderr.write(`${JSON.stringify({ stage, status: "failed", code: "LOCAL_CAPTURE_SCHEMA_FAILED",
      ...(typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? { sqlState: code } : {}),
      ...(localInvariant === undefined ? {} : { invariant: localInvariant }),
      detail, constraint, message })}\n`);
  } finally {
    const cleanup = await local.stop();
    if (cleanup.failed) failed = true;
    process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: failed ? "failed" : "ok",
      stopped: cleanup.stopped, runId: local.runId, marker })}\n`);
    if (failed) process.exitCode = 1;
  }
}

if (mode === undefined) {
  process.stderr.write(`${JSON.stringify({ code: "CAPTURE_VERIFICATION_ARGUMENTS_REJECTED", stage: "arguments", status: "failed" })}\n`);
  process.exitCode = 1;
} else if (mode === "local") await verifyLocal();
else await verifyRemote();
