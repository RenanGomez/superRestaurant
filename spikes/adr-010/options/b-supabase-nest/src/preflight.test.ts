import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { runAdr010CloseAttempt, SupabaseNestAdr010Adapter, type CriticalOrderWritePort } from "./adapter.js";
import { SupabaseAccessTokenRejectedError, SupabaseAuthPrincipalVerifier } from "./auth-principal.js";
import { Adr010BAuthBootstrapError, adr010BAuthBootstrapPlan, serializeJsonbArrayParameter, summarizeSafePostgresDiagnostic, toAuthMembershipBootstrapRows } from "./auth-bootstrap.js";
import {
  readSupabaseAdr010ServerConfig,
  readSupabaseAdr010ClientCheckConfig,
  readSupabaseAdr010Config,
  requireSupabaseDestructiveServerOptIn,
  requireSupabaseGateIntegrationOptIn,
  requireSupabaseIntegrationOptIn,
  SupabaseAdr010ConfigurationError,
} from "./config.js";
import { SupabaseAdr010CriticalFinancialService, SupabaseAdr010CriticalOrderService, SupabaseNestAdr010Module, type SupabaseCreateOrderRequest } from "./nest-boundary.js";
import type { CashPaymentRecord, CashRefundRecord, CriticalFinancialWritePort, SupabaseCreateCashPaymentRequest, SupabaseCreateCashRefundRequest } from "./financial-contract.js";
import { freshRemotePushMigrationVersions, requireFreshRemotePushOptIn, runFreshRemotePush } from "./fresh-remote-push.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asBranchScope, type OrderRecord } from "../../../src/model.js";

type AssertFalse<T extends false> = T;
type AssertTrue<T extends true> = T;
type ExternalRefundHasCallerAuthorization = "authorization" extends keyof SupabaseCreateCashRefundRequest ? true : false;
type ExternalRefundHasSupervisorToken = "supervisorAccessToken" extends keyof SupabaseCreateCashRefundRequest ? true : false;
const externalRefundContractShape: {
  noCallerAuthorization: AssertFalse<ExternalRefundHasCallerAuthorization>;
  requiresSupervisorToken: AssertTrue<ExternalRefundHasSupervisorToken>;
} = { noCallerAuthorization: false, requiresSupervisorToken: true };
void externalRefundContractShape;

const optionRoot = path.resolve(process.cwd(), "options", "b-supabase-nest");
const migrationsRoot = path.join(optionRoot, "supabase", "migrations");
const migrationPath = path.join(migrationsRoot, "20260825000100_adr010_b_thin_slice.sql");
const readOnlyHardeningMigrationPath = path.join(migrationsRoot, "20260826000100_adr010_c_read_only_hardening.sql");
const bootstrapRlsHardeningMigrationPath = path.join(migrationsRoot, "20260827000100_adr010_b_bootstrap_rls_hardening.sql");
const financialMigrationPath = path.join(migrationsRoot, "20260828000100_adr010_b_financial_write_boundary.sql");
const financialConflictFixMigrationPath = path.join(migrationsRoot, "20260829000100_adr010_b_financial_conflict_fix.sql");
const remoteSchemaAuditPath = path.join(optionRoot, "evidence", "remote-schema-audit.sql");
const adapterPath = path.join(optionRoot, "src", "adapter.ts");
const financialContractPath = path.join(optionRoot, "src", "financial-contract.ts");
const financialGatesPath = path.join(optionRoot, "src", "financial-gates.ts");
const integrationRunnerPath = path.join(optionRoot, "src", "run-integration.ts");
const freshRemotePushPath = path.join(optionRoot, "src", "fresh-remote-push.ts");
const freshRemotePushRunnerPath = path.join(optionRoot, "src", "run-fresh-remote-push.ts");
const bootstrapPath = path.join(optionRoot, "src", "auth-bootstrap.ts");
const rlsReadProbePath = path.join(optionRoot, "src", "run-rls-read-probe.ts");

test("[preflight/non-evidence] adapter close keeps cleanup retryable and ends the pool only after success", async () => {
  let resetAttempts = 0;
  let cleanupAttempts = 0;
  let poolEndAttempts = 0;
  let cleanupReady = false;
  await assert.rejects(
    () => runAdr010CloseAttempt({
      reset: async () => { resetAttempts += 1; },
      cleanup: async () => { cleanupAttempts += 1; if (!cleanupReady) throw new Error("cleanup temporarily unavailable"); },
      endPool: async () => { poolEndAttempts += 1; },
    }),
    /cleanup temporarily unavailable/u,
  );
  assert.equal(poolEndAttempts, 0, "failed cleanup must not terminate the pool");
  cleanupReady = true;
  await runAdr010CloseAttempt({
    reset: async () => { resetAttempts += 1; },
    cleanup: async () => { cleanupAttempts += 1; },
    endPool: async () => { poolEndAttempts += 1; },
  });
  assert.equal(resetAttempts, 2, "retry must rerun reset against the live pool");
  assert.equal(cleanupAttempts, 2, "retry must rerun cleanup");
  assert.equal(poolEndAttempts, 1, "pool ends only after cleanup succeeds");
});

test("[preflight/non-evidence] adapter close preserves reset and cleanup failures together", async () => {
  const resetError = new Error("reset failed");
  const cleanupError = new Error("cleanup failed");
  let poolEndAttempts = 0;
  await assert.rejects(
    () => runAdr010CloseAttempt({
      reset: async () => { throw resetError; },
      cleanup: async () => { throw cleanupError; },
      endPool: async () => { poolEndAttempts += 1; },
    }),
    (error: unknown) => error instanceof AggregateError && error.errors.includes(resetError) && error.errors.includes(cleanupError),
  );
  assert.equal(poolEndAttempts, 0);
});

test("[preflight/non-evidence] configuration validation has no network side effects and rejects missing server secrets", () => {
  assert.throws(
    () => readSupabaseAdr010Config({ ADR010_SUPABASE_URL: "https://example.supabase.co" }),
    SupabaseAdr010ConfigurationError,
  );
  const config = readSupabaseAdr010Config({
    ADR010_SUPABASE_URL: "https://example.supabase.co",
    ADR010_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
    ADR010_SUPABASE_SECRET_KEY: "sb_secret_placeholder",
    ADR010_DATABASE_URL: "postgresql://user:password@example.supabase.co:5432/postgres",
  });
  assert.equal(config.url, "https://example.supabase.co");
  const serverConfig = SupabaseAdr010CriticalOrderService.validateEnvironment({
    ADR010_SUPABASE_URL: "https://example.supabase.co",
    ADR010_SUPABASE_SECRET_KEY: "sb_secret_placeholder",
    ADR010_DATABASE_URL: "postgresql://user:password@example.supabase.co:5432/postgres",
  });
  assert.deepEqual(serverConfig, {
    url: "https://example.supabase.co",
    secretKey: "sb_secret_placeholder",
    databaseUrl: "postgresql://user:password@example.supabase.co:5432/postgres",
  });
  assert.deepEqual(readSupabaseAdr010ClientCheckConfig({
    ADR010_SUPABASE_URL: "https://example.supabase.co",
    ADR010_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
  }), { url: "https://example.supabase.co", publishableKey: "sb_publishable_placeholder" });
});

test("[preflight/non-evidence] server-only configuration rejects legacy or non-modern secret settings without echoing a value", () => {
  assert.throws(
    () => readSupabaseAdr010ServerConfig({
      ADR010_SUPABASE_URL: "https://example.supabase.co",
      ADR010_SUPABASE_SECRET_KEY: "service-role-placeholder",
      ADR010_DATABASE_URL: "postgresql://user:password@example.supabase.co:5432/postgres",
    }),
    SupabaseAdr010ConfigurationError,
  );
  assert.throws(
    () => readSupabaseAdr010ServerConfig({
      ADR010_SUPABASE_URL: "https://example.supabase.co",
      ADR010_SUPABASE_SECRET_KEY: "sb_secret_placeholder",
      ADR010_DATABASE_URL: "postgresql://user:password@example.supabase.co:5432/postgres",
      ADR010_SUPABASE_SERVICE_ROLE_KEY: "legacy-value-must-not-be-echoed",
    }),
    (error: unknown) => error instanceof SupabaseAdr010ConfigurationError && !error.message.includes("legacy-value-must-not-be-echoed"),
  );
});

test("[preflight/non-evidence] the remote runner cannot be used without explicit opt-in", () => {
  assert.throws(
    () => requireSupabaseIntegrationOptIn({
      ADR010_SUPABASE_URL: "https://example.supabase.co",
      ADR010_SUPABASE_SECRET_KEY: "sb_secret_placeholder",
      ADR010_DATABASE_URL: "postgresql://user:password@example.supabase.co:5432/postgres",
    }),
    SupabaseAdr010ConfigurationError,
  );
});

test("[preflight/non-evidence] fresh remote push requires an independent opt-in and exact project identity", () => {
  const base = {
    ADR010_RUN_SUPABASE: "1",
    ADR010_CONFIRM_ISOLATED_PROJECT: "abcdefghijklmnopqrst",
    ADR010_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    ADR010_SUPABASE_SECRET_KEY: "sb_secret_placeholder",
    ADR010_DATABASE_URL: "postgresql://postgres.abcdefghijklmnopqrst:password@aws.pooler.supabase.com:6543/postgres?sslmode=require",
  };
  assert.throws(() => requireFreshRemotePushOptIn(base), /ADR010_FRESH_PUSH_DISABLED/u);
  assert.throws(
    () => requireFreshRemotePushOptIn({ ...base, ADR010_RUN_SUPABASE_FRESH_PUSH: "1", ADR010_CONFIRM_ISOLATED_PROJECT: "different" }),
    SupabaseAdr010ConfigurationError,
  );
  const config = requireFreshRemotePushOptIn({ ...base, ADR010_RUN_SUPABASE_FRESH_PUSH: "1" });
  assert.equal(config.confirmedIsolatedProjectRef, "abcdefghijklmnopqrst");
});

test("[preflight/non-evidence] fresh remote push checks emptiness, dry-runs first, and never creates projects", async () => {
  const source = await readFile(freshRemotePushPath, "utf8");
  const runnerSource = await readFile(freshRemotePushRunnerPath, "utf8");
  assert.deepEqual(freshRemotePushMigrationVersions, [
    "20260825000100",
    "20260826000100",
    "20260827000100",
    "20260828000100",
    "20260829000100",
  ]);
  assert.ok(source.includes("assertFreshRemoteTarget"));
  assert.ok(source.includes('"supabase", ".temp", "project-ref"'));
  assert.ok(source.includes("ADR010_FRESH_PUSH_LINKED_PROJECT_MISMATCH"));
  assert.ok(source.includes("supabase_migrations.schema_migrations"));
  assert.ok(source.includes("auth.users"));
  assert.ok(source.includes("storage.objects"));
  assert.ok(source.includes("storage.buckets"));
  assert.ok(source.includes("relation.relkind in ('r','p','v','m','f','S')"));
  assert.ok(source.includes('"db", "push", "--linked", "--dry-run", "--yes"'));
  assert.ok(source.includes('environment.ADR010_RUN_SUPABASE_FRESH_PUSH !== "1"'));
  assert.ok(source.indexOf("--dry-run") < source.indexOf('if (!options.apply)'));
  assert.ok(source.indexOf('if (!options.apply)') < source.lastIndexOf('"db", "push", "--linked", "--yes"'));
  assert.equal(/supabase\s+(?:projects\s+(?:create|delete)|link)/iu.test(source), false);
  assert.equal(/console\.(?:log|warn|error)[\s\S]*(?:databaseUrl|secretKey)/u.test(source), false);
  assert.ok(runnerSource.includes("requireFreshRemotePushOptIn(process.env)"));
  assert.ok(runnerSource.includes("ADR010_APPLY_FRESH_REMOTE_PUSH"));
  assert.equal(source.includes("supabase.cmd"), false);
});

test("[preflight/non-evidence] fresh remote push fake runner is dry-run by default and applies only when requested", async () => {
  const commands: string[][] = [];
  const config = {
    url: "https://abcdefghijklmnopqrst.supabase.co",
    secretKey: "not-used",
    databaseUrl: "postgresql://not-used",
    confirmedIsolatedProjectRef: "abcdefghijklmnopqrst",
  };
  const dryRun = await runFreshRemotePush({
    config,
    cwd: "C:\\fresh-push-test",
    apply: false,
    assertLinkedProjectRef: async () => {},
    assertFreshRemoteTarget: async () => {},
    assertFreshRemoteMigrationSeriesApplied: async () => { throw new Error("must not verify before push"); },
    runCommand: async (args) => { commands.push([...args]); },
  });
  assert.equal(dryRun.pushApplied, false);
  assert.deepEqual(commands, [["db", "push", "--linked", "--dry-run", "--yes"]]);

  commands.length = 0;
  const appliedEvents: string[] = [];
  const applied = await runFreshRemotePush({
    config,
    cwd: "C:\\fresh-push-test",
    apply: true,
    assertLinkedProjectRef: async () => { appliedEvents.push("linked"); },
    assertFreshRemoteTarget: async () => { appliedEvents.push("fresh"); },
    assertFreshRemoteMigrationSeriesApplied: async () => { appliedEvents.push("migration-check"); },
    runCommand: async (args) => {
      commands.push([...args]);
      appliedEvents.push(args.includes("--dry-run") ? "dry-run" : "apply");
    },
  });
  assert.equal(applied.pushApplied, true);
  assert.deepEqual(commands, [["db", "push", "--linked", "--dry-run", "--yes"], ["db", "push", "--linked", "--yes"]]);
  assert.deepEqual(appliedEvents, ["linked", "fresh", "dry-run", "linked", "fresh", "apply", "migration-check"]);

  const retryCommands: string[][] = [];
  let freshnessChecks = 0;
  await assert.rejects(
    runFreshRemotePush({
      config,
      cwd: "C:\\fresh-push-test",
      apply: true,
      assertLinkedProjectRef: async () => {},
      assertFreshRemoteTarget: async () => {
        freshnessChecks += 1;
        if (freshnessChecks === 2) throw new Error("second freshness check failed");
      },
      assertFreshRemoteMigrationSeriesApplied: async () => {},
      runCommand: async (args) => { retryCommands.push([...args]); },
    }),
    /second freshness check failed/u,
  );
  assert.deepEqual(retryCommands, [["db", "push", "--linked", "--dry-run", "--yes"]]);
});

test("[preflight/non-evidence] the option-B adapter exposes every common-gate capability without bypassing Nest/Auth", async () => {
  assert.equal(SupabaseNestAdr010Adapter.prototype.option, undefined);
  for (const capability of ["migrateFromEmpty", "resetToEmpty", "issueSession", "revokeSession", "proveRefreshTokenRotation", "createOrder", "createCashPayment", "refundCashPayment", "readFinancialArtifacts", "getOrder", "countOrders", "findOrderIdsByIdempotency", "readOrderArtifacts", "writeFrontierInspection", "recoverKds", "backup", "restore", "clientExposedEnvironmentNames", "reproducibilityEvidence"]) {
    assert.equal(typeof (SupabaseNestAdr010Adapter.prototype as unknown as Record<string, unknown>)[capability], "function", `missing ${capability}`);
  }
  assert.equal(typeof SupabaseNestAdr010Module.register, "function");

  const adapterSource = await readFile(adapterPath, "utf8");
  assert.ok(adapterSource.includes("new Pool({ connectionString: config.databaseUrl })"));
  assert.ok(adapterSource.includes("auth.admin.createUser"));
  assert.ok(adapterSource.includes("signInWithPassword"));
  assert.ok(adapterSource.includes("refreshToken: string"));
  assert.ok(adapterSource.includes("auth.refreshSession({ refresh_token: previousRefreshToken })"));
  assert.ok(adapterSource.includes('data.session.token_type === "bearer"'));
  assert.ok(adapterSource.includes("data.session.user.id === session.userId"));
  assert.ok(adapterSource.includes("ADR010_B_REVOKED_REFRESH_TOKEN_ACCEPTED"));
  assert.ok(adapterSource.includes("this.#sessions.clear()"));
  assert.ok(adapterSource.includes("this.#revokedSessionIds.clear()"));
  assert.equal(/console\.(?:log|warn|error)[\s\S]*refreshToken/u.test(adapterSource), false, "refresh tokens must never be logged");
  assert.ok(adapterSource.includes("SupabaseAdr010CriticalOrderService"));
  assert.ok(adapterSource.includes("SupabaseAuthPrincipalVerifier"));
  assert.ok(adapterSource.includes("adr010_b_private.adr010_b_create_order"));
  assert.ok(adapterSource.includes("adr010_b_private.adr010_b_create_cash_payment"));
  assert.ok(adapterSource.includes("adr010_b_private.adr010_b_refund_cash_payment"));
  assert.ok(adapterSource.includes('.schema("adr010_b").from("orders")'));
  assert.ok(adapterSource.includes('.schema("adr010_b").from("kds_events")'));
  assert.equal(/\.from\([^)]*\)\.(?:insert|update|delete|upsert)\(/u.test(adapterSource), false, "Data API must stay read-only");
  assert.equal(/\.rpc\(/u.test(adapterSource), false, "private mutation must not use Data API RPC");
});

test("[preflight/non-evidence] destructive common gates require an exact project-ref confirmation and matching database identity", () => {
  const projectRef = "abcdefghijklmnopqrst";
  const base = {
    ADR010_RUN_SUPABASE: "1",
    ADR010_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    ADR010_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
    ADR010_SUPABASE_SECRET_KEY: "sb_secret_placeholder",
    ADR010_DATABASE_URL: `postgresql://postgres.${projectRef}:password@aws.pooler.supabase.com:6543/postgres?sslmode=require`,
  };
  assert.throws(() => requireSupabaseGateIntegrationOptIn(base), SupabaseAdr010ConfigurationError);
  assert.equal(requireSupabaseGateIntegrationOptIn({ ...base, ADR010_CONFIRM_ISOLATED_PROJECT: projectRef }).confirmedIsolatedProjectRef, projectRef);
  assert.throws(() => requireSupabaseGateIntegrationOptIn({ ...base, ADR010_CONFIRM_ISOLATED_PROJECT: "different" }), SupabaseAdr010ConfigurationError);
  assert.throws(() => requireSupabaseGateIntegrationOptIn({ ...base, ADR010_DATABASE_URL: `postgresql://postgres.other-${projectRef}:password@aws.pooler.supabase.com:6543/postgres?sslmode=require`, ADR010_CONFIRM_ISOLATED_PROJECT: projectRef }), SupabaseAdr010ConfigurationError);
  assert.throws(() => requireSupabaseGateIntegrationOptIn({ ...base, ADR010_DATABASE_URL: `postgresql://postgres.${projectRef}:password@attacker-pooler.supabase.com.evil.test:6543/postgres?sslmode=require`, ADR010_CONFIRM_ISOLATED_PROJECT: projectRef }), SupabaseAdr010ConfigurationError);
  assert.throws(() => requireSupabaseGateIntegrationOptIn({ ...base, ADR010_DATABASE_URL: `postgresql://postgres.${projectRef}:password@aws.pooler.supabase.com:6543/other?sslmode=require`, ADR010_CONFIRM_ISOLATED_PROJECT: projectRef }), SupabaseAdr010ConfigurationError);
  assert.throws(() => requireSupabaseGateIntegrationOptIn({ ...base, ADR010_DATABASE_URL: `postgresql://postgres.${projectRef}:password@aws.pooler.supabase.com:6543/postgres?sslmode=disable`, ADR010_CONFIRM_ISOLATED_PROJECT: projectRef }), SupabaseAdr010ConfigurationError);
  assert.throws(() => requireSupabaseGateIntegrationOptIn({ ...base, ADR010_SUPABASE_URL: `https://${projectRef}.supabase.co.evil.test`, ADR010_CONFIRM_ISOLATED_PROJECT: projectRef }), SupabaseAdr010ConfigurationError);
  assert.throws(() => requireSupabaseGateIntegrationOptIn({ ...base, ADR010_SUPABASE_URL: `http://${projectRef}.supabase.co`, ADR010_CONFIRM_ISOLATED_PROJECT: projectRef }), SupabaseAdr010ConfigurationError);
  const serverOnlyBase = {
    ADR010_RUN_SUPABASE: base.ADR010_RUN_SUPABASE,
    ADR010_SUPABASE_URL: base.ADR010_SUPABASE_URL,
    ADR010_SUPABASE_SECRET_KEY: base.ADR010_SUPABASE_SECRET_KEY,
    ADR010_DATABASE_URL: base.ADR010_DATABASE_URL,
  };
  assert.equal(requireSupabaseDestructiveServerOptIn({ ...serverOnlyBase, ADR010_CONFIRM_ISOLATED_PROJECT: projectRef }).confirmedIsolatedProjectRef, projectRef);
});

test("[preflight/non-evidence] the Auth boundary verifies through getUser and derives the principal subject", async () => {
  let receivedToken = "";
  const fakeAuthClient = {
    auth: {
      getUser: async (token: string) => {
        receivedToken = token;
        return { data: { user: { id: "00000000-0000-4000-8000-0000000000c1" } }, error: null };
      },
    },
  } as unknown as Pick<SupabaseClient, "auth">;
  const verifier = new SupabaseAuthPrincipalVerifier(
    { url: "https://example.supabase.co", secretKey: "sb_secret_placeholder", databaseUrl: "postgresql://user:password@example.supabase.co:5432/postgres" },
    fakeAuthClient,
  );

  assert.deepEqual(await verifier.verifyAccessToken("signed-access-token"), { actorId: "00000000-0000-4000-8000-0000000000c1" });
  assert.equal(receivedToken, "signed-access-token");

  const invalidAuthClient = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: new Error("invalid") }),
    },
  } as unknown as Pick<SupabaseClient, "auth">;
  const invalidVerifier = new SupabaseAuthPrincipalVerifier(
    { url: "https://example.supabase.co", secretKey: "sb_secret_placeholder", databaseUrl: "postgresql://user:password@example.supabase.co:5432/postgres" },
    invalidAuthClient,
  );
  await assert.rejects(() => invalidVerifier.verifyAccessToken("bad-token"), SupabaseAccessTokenRejectedError);
});

test("[preflight/non-evidence] invalid Auth never reaches the write port and verified actor is the only actor forwarded", async () => {
  const request = {
    accessToken: "access-token",
    restaurantId: "restaurant-amber",
    branchId: "branch-amber-north",
    idempotencyKey: "idempotency-1",
    lines: [{ menuItemId: "menu-1", quantity: 1, snapshot: { name: "Item", unitAmountMinor: 100, currency: "MXN" } }],
  } satisfies SupabaseCreateOrderRequest;
  const order: OrderRecord = {
    id: "order-1",
    idempotencyKey: request.idempotencyKey,
    scope: asBranchScope(request.restaurantId, request.branchId),
    lines: request.lines,
    audit: { actorId: "verified-actor", branchId: request.branchId, action: "ORDER_CREATED" as const },
  };
  let writes = 0;
  const writePort: CriticalOrderWritePort = {
    createOrder: async (command) => {
      writes += 1;
      assert.equal(command.principal.actorId, "verified-actor");
      return order;
    },
  };
  const verifiedService = new SupabaseAdr010CriticalOrderService(writePort, {
    verifyAccessToken: async () => ({ actorId: "verified-actor" }),
  });
  await verifiedService.createOrder({ ...request, actorId: "forged-actor" } as SupabaseCreateOrderRequest);
  assert.equal(writes, 1);

  const rejectedService = new SupabaseAdr010CriticalOrderService(writePort, {
    verifyAccessToken: async () => { throw new SupabaseAccessTokenRejectedError(); },
  });
  await assert.rejects(() => rejectedService.createOrder(request), SupabaseAccessTokenRejectedError);
  assert.equal(writes, 1);
});

test("[preflight/non-evidence] financial Nest boundary validates amounts and derives refund approval from a second verified token", async () => {
  const restaurantId = "00000000-0000-4000-8000-0000000000a1";
  const branchId = "00000000-0000-4000-8000-0000000000a2";
  const orderId = "00000000-0000-4000-8000-0000000000b1";
  const paymentId = "00000000-0000-4000-8000-0000000000b2";
  const cashierId = "00000000-0000-4000-8000-0000000000c1";
  const supervisorId = "00000000-0000-4000-8000-0000000000c2";
  const payment: CashPaymentRecord = {
    id: paymentId, orderId, idempotencyKey: "payment-1", amountMinor: 100,
    currency: "MXN", cashMovementId: "movement-1", localSequence: 1,
  };
  const refund: CashRefundRecord = {
    id: "refund-1", paymentId: payment.id, idempotencyKey: "refund-1", amountMinor: 100,
    currency: "MXN", cashMovementId: "movement-2", localSequence: 2,
  };
  const paymentRequest = {
    accessToken: "cashier-token", restaurantId, branchId, orderId: payment.orderId,
    idempotencyKey: payment.idempotencyKey, amountMinor: 100, currency: payment.currency, deviceId: "device-1",
    localSequence: 1, occurredAt: "2026-08-28T00:00:00.000Z",
  };
  const refundRequest = {
    accessToken: "cashier-token", supervisorAccessToken: "supervisor-token", restaurantId, branchId,
    orderId: payment.orderId, paymentId: payment.id, idempotencyKey: refund.idempotencyKey, amountMinor: 100,
    currency: refund.currency, deviceId: "device-1", localSequence: 2, occurredAt: "2026-08-28T00:01:00.000Z", reason: "approved correction",
  } satisfies SupabaseCreateCashRefundRequest;
  let paymentWrites = 0;
  let refundWrites = 0;
  const writePort: CriticalFinancialWritePort = {
    createCashPayment: async (command) => {
      paymentWrites += 1;
      assert.equal(command.principal.actorId, cashierId);
      assert.equal("accessToken" in command, false);
      return payment;
    },
    refundCashPayment: async (command) => {
      refundWrites += 1;
      assert.equal(command.principal.actorId, cashierId);
      assert.deepEqual(command.authorization, { approved: true, actorId: supervisorId });
      assert.equal("supervisorAccessToken" in command, false);
      assert.equal("authorization" in command, true);
      return refund;
    },
  };
  const verifier = {
    verifyAccessToken: async (token: string) => {
      if (token === "cashier-token") return { actorId: cashierId };
      if (token === "supervisor-token") return { actorId: supervisorId };
      if (token === "empty-supervisor-token") return { actorId: "   " };
      throw new SupabaseAccessTokenRejectedError();
    },
  };
  const service = new SupabaseAdr010CriticalFinancialService(writePort, verifier);
  await service.createCashPayment(paymentRequest);
  await service.refundCashPayment(refundRequest);
  assert.equal(paymentWrites, 1);
  assert.equal(refundWrites, 1);
  await assert.rejects(
    () => service.createCashPayment({ ...paymentRequest, amountMinor: 1.5 }),
    /ADR010_INVALID_CASH_PAYMENT_AMOUNT/u,
  );
  await assert.rejects(
    () => service.refundCashPayment({ ...refundRequest, supervisorAccessToken: "invalid-supervisor-token" }),
    SupabaseAccessTokenRejectedError,
  );
  await assert.rejects(
    () => service.refundCashPayment({ ...refundRequest, supervisorAccessToken: "empty-supervisor-token" }),
    /ADR010_REFUND_AUTHORIZATION_REQUIRED/u,
  );
  assert.equal(paymentWrites, 1, "invalid amount must be rejected before the payment port");
  assert.equal(refundWrites, 1, "invalid supervisor identity must be rejected before the refund port");
});

test("[preflight/non-evidence] financial Nest boundary rejects malformed runtime requests before Auth or SQL", async () => {
  const validPayment: SupabaseCreateCashPaymentRequest = {
    accessToken: "cashier-token",
    restaurantId: "00000000-0000-4000-8000-0000000000a1",
    branchId: "00000000-0000-4000-8000-0000000000a2",
    orderId: "00000000-0000-4000-8000-0000000000b1",
    idempotencyKey: "payment-key",
    amountMinor: 100,
    currency: "MXN",
    deviceId: "device-1",
    localSequence: 1,
    occurredAt: "2026-08-28T00:00:00.000Z",
  };
  const validRefund: SupabaseCreateCashRefundRequest = {
    ...validPayment,
    supervisorAccessToken: "supervisor-token",
    paymentId: "00000000-0000-4000-8000-0000000000b2",
    idempotencyKey: "refund-key",
    occurredAt: "2026-08-28T00:01:00.000Z",
    reason: "approved correction",
  };
  let verifierCalls = 0;
  let writeCalls = 0;
  const service = new SupabaseAdr010CriticalFinancialService({
    createCashPayment: async () => { writeCalls += 1; throw new Error("unexpected payment write"); },
    refundCashPayment: async () => { writeCalls += 1; throw new Error("unexpected refund write"); },
  }, {
    verifyAccessToken: async () => { verifierCalls += 1; return { actorId: "00000000-0000-4000-8000-0000000000c1" }; },
  });

  await assert.rejects(() => service.createCashPayment({ ...validPayment, accessToken: "" }), (error: unknown) => error instanceof Error && error.message === "SUPABASE_ACCESS_TOKEN_REJECTED");
  await assert.rejects(() => service.refundCashPayment({ ...validRefund, supervisorAccessToken: "   " }), (error: unknown) => error instanceof Error && error.message === "SUPABASE_ACCESS_TOKEN_REJECTED");
  for (const field of ["restaurantId", "branchId", "orderId"] as const) {
    await assert.rejects(() => service.createCashPayment({ ...validPayment, [field]: "not-a-uuid" }), (error: unknown) => error instanceof Error && error.message === "ADR010_INVALID_CASH_PAYMENT_INPUT");
  }
  await assert.rejects(() => service.refundCashPayment({ ...validRefund, paymentId: "not-a-uuid" }), (error: unknown) => error instanceof Error && error.message === "ADR010_INVALID_CASH_REFUND_INPUT");
  await assert.rejects(() => service.createCashPayment({ ...validPayment, idempotencyKey: "   " }), (error: unknown) => error instanceof Error && error.message === "ADR010_INVALID_CASH_PAYMENT_INPUT");
  await assert.rejects(() => service.createCashPayment({ ...validPayment, deviceId: "" }), (error: unknown) => error instanceof Error && error.message === "ADR010_INVALID_CASH_PAYMENT_INPUT");
  await assert.rejects(() => service.createCashPayment({ ...validPayment, currency: "mxn" }), (error: unknown) => error instanceof Error && error.message === "ADR010_INVALID_CASH_PAYMENT_INPUT");
  await assert.rejects(() => service.createCashPayment({ ...validPayment, occurredAt: "not-a-timestamp" }), (error: unknown) => error instanceof Error && error.message === "ADR010_INVALID_CASH_PAYMENT_INPUT");
  await assert.rejects(() => service.refundCashPayment({ ...validRefund, reason: "   " }), (error: unknown) => error instanceof Error && error.message === "ADR010_INVALID_CASH_REFUND_INPUT");
  await assert.rejects(() => service.createCashPayment({ ...validPayment, amountMinor: Number.MAX_SAFE_INTEGER + 1 }), /ADR010_INVALID_CASH_PAYMENT_AMOUNT/u);
  await assert.rejects(() => service.refundCashPayment({ ...validRefund, amountMinor: Number.NaN }), /ADR010_INVALID_CASH_REFUND_AMOUNT/u);
  await assert.rejects(() => service.createCashPayment({ ...validPayment, localSequence: 0 }), /ADR010_INVALID_FINANCIAL_LOCAL_SEQUENCE/u);
  await assert.rejects(() => service.refundCashPayment({ ...validRefund, localSequence: 1.5 }), /ADR010_INVALID_FINANCIAL_LOCAL_SEQUENCE/u);
  await assert.rejects(() => service.createCashPayment(null as unknown as SupabaseCreateCashPaymentRequest), /ADR010_INVALID_CASH_PAYMENT_INPUT/u);
  await assert.rejects(() => service.refundCashPayment(null as unknown as SupabaseCreateCashRefundRequest), /ADR010_INVALID_CASH_REFUND_INPUT/u);
  const malformedPrincipalService = new SupabaseAdr010CriticalFinancialService({
    createCashPayment: async () => { throw new Error("unexpected payment write"); },
    refundCashPayment: async () => { throw new Error("unexpected refund write"); },
  }, { verifyAccessToken: async () => ({ actorId: "not-a-uuid" }) });
  await assert.rejects(() => malformedPrincipalService.createCashPayment(validPayment), (error: unknown) => error instanceof Error && error.message === "SUPABASE_ACCESS_TOKEN_REJECTED");
  assert.equal(verifierCalls, 0, "malformed requests must be rejected before Auth verification");
  assert.equal(writeCalls, 0, "malformed requests must not reach the financial write port");
});

test("[preflight/non-evidence] Auth principal verification rejects non-string tokens and malformed Auth subjects safely", async () => {
  const rejected = new SupabaseAuthPrincipalVerifier({
    url: "https://example.supabase.co",
    secretKey: "sb_secret_test",
    databaseUrl: "postgresql://postgres:password@example.test/postgres?sslmode=require",
  }, { auth: { getUser: async () => ({ data: { user: { id: "not-a-uuid" } }, error: null }) } } as never);
  await assert.rejects(() => rejected.verifyAccessToken(undefined as unknown as string), SupabaseAccessTokenRejectedError);
  await assert.rejects(() => rejected.verifyAccessToken("valid-looking-token"), SupabaseAccessTokenRejectedError);
});

test("[preflight/non-evidence] SQL text declares tenant constraints, read RLS, and a server-only write RPC", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const requiredInvariant of [
    "create schema if not exists adr010_b",
    "references auth.users(id) on delete restrict",
    "unique (restaurant_id, branch_id, idempotency_key)",
    "request_payload jsonb not null",
    "v_order.request_payload is distinct from v_request_payload",
    "ADR010_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    "foreign key (restaurant_id, branch_id, order_id)",
    "enable row level security",
    "force row level security",
    "for select to authenticated",
    "revoke all on all tables in schema adr010_b from anon, authenticated, service_role",
    "revoke all on all sequences in schema adr010_b from anon, authenticated, service_role",
    "revoke all on schema adr010_b_private from anon, authenticated, service_role",
    "grant select on table",
    "references auth.users(id) on delete cascade",
    "bootstrap_run_id uuid not null",
    "unique (bootstrap_run_id, fixture_key)",
    "create or replace function adr010_b_private.adr010_b_bootstrap_auth_memberships(p_users jsonb)",
    "create or replace function adr010_b_private.adr010_b_revoke_bootstrap_membership(p_user_id uuid, p_branch_id uuid)",
    "create or replace function adr010_b_private.adr010_b_cleanup_auth_bootstrap(p_user_ids jsonb)",
    "revoke all on function adr010_b_private.adr010_b_bootstrap_auth_memberships(jsonb) from public, anon, authenticated, service_role",
    "revoke all on function adr010_b_private.adr010_b_revoke_bootstrap_membership(uuid, uuid) from public, anon, authenticated, service_role",
    "revoke all on function adr010_b_private.adr010_b_cleanup_auth_bootstrap(jsonb) from public, anon, authenticated, service_role",
    "revoke all on function adr010_b_private.adr010_b_create_order(jsonb) from public, anon, authenticated, service_role",
    "security definer",
    "set search_path = ''",
    "jsonb_typeof(p_payload -> 'lines') is distinct from 'array'",
    "ADR010_INDUCED_FAILURE_AFTER_ORDER",
  ]) {
    assert.ok(sql.includes(requiredInvariant), `missing SQL invariant: ${requiredInvariant}`);
  }
  assert.equal(/create or replace function adr010_b\./i.test(sql), false, "SECURITY DEFINER functions must not live in the exposed schema");
  assert.equal(sql.includes("grant select on all tables"), false, "authenticated reads must use an explicit RLS-table allowlist");
  assert.equal(/grant select on table[\s\S]*?bootstrap_users[\s\S]*?to authenticated;/iu.test(sql), false, "bootstrap markers must not be readable through Data API");
  assert.equal(sql.includes("grant execute on function adr010_b_private"), false, "private functions must not gain role execution grants");
  assert.equal(sql.includes("grant usage on schema adr010_b_private"), false, "private schema must not gain Data API role usage");
});

test("[preflight/non-evidence] logical backup is snapshot-consistent and restore refuses a non-empty target", async () => {
  const adapterSource = await readFile(adapterPath, "utf8");
  assert.ok(adapterSource.includes("set transaction isolation level repeatable read read only"));
  assert.ok(adapterSource.includes("assertRestoreTargetEmpty(client)"));
  assert.ok(adapterSource.includes("ADR010_B_RESTORE_TARGET_NOT_EMPTY"));
  assert.equal(/restore\(backup:[\s\S]*?#resetWithClient\(client\)/u.test(adapterSource), false);
  assert.ok(adapterSource.includes("idempotency_key,request_payload,status"));
  assert.ok(adapterSource.includes("adr010_b_private.device_sequences"));
  assert.ok(adapterSource.includes("deviceSequences"));
  for (const financialTable of ["payments", "refunds", "cash_movements", "financial_audit_log"]) {
    assert.match(adapterSource, new RegExp(`backupTables = [\\s\\S]*${financialTable}`, "u"));
    assert.match(adapterSource, new RegExp(`#resetWithClient[\\s\\S]*${financialTable}`, "u"));
  }
});

test("[preflight/non-evidence] financial gates prove scoped rejection, revocation, and complete restore", async () => {
  const adapterSource = await readFile(adapterPath, "utf8");
  const gatesSource = await readFile(financialGatesPath, "utf8");
  const contractSource = await readFile(financialContractPath, "utf8");
  assert.ok(adapterSource.includes("readFinancialArtifactSnapshot"));
  assert.match(gatesSource, /otherRestaurantScope[\s\S]*cross-restaurant/u);
  assert.match(gatesSource, /revokeSession\(session\.id\)/u);
  assert.match(gatesSource, /financial-payment-revoked/u);
  assert.match(gatesSource, /financial-refund-revoked/u);
  assert.ok(gatesSource.includes("financial-gate-supervisor"));
  assert.ok(gatesSource.includes('"manager"'));
  assert.match(gatesSource, /invalid-supervisor-token/u);
  assert.match(gatesSource, /financial-refund-cashier-supervisor/u);
  assert.match(gatesSource, /replayedPayment[\s\S]*cashMovementId/u);
  assert.match(gatesSource, /ADR010_FINANCIAL_LOCAL_SEQUENCE_GAP/u);
  assert.match(gatesSource, /financial-payment-scope-reuse/u);
  assert.match(gatesSource, /readFinancialArtifactSnapshot\(fixtures\.primaryScope\)[\s\S]*assert\.deepEqual/u);
  assert.match(contractSource, /Omit<VerifiedCashRefundCommand, "principal" \| "authorization">/u);
  assert.match(contractSource, /supervisorAccessToken/u);
});

test("[preflight/non-evidence] remote rejection evidence checks the exact server message", async () => {
  const runnerSource = await readFile(integrationRunnerPath, "utf8");
  assert.ok(runnerSource.includes('"ADR010_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"'));
  assert.ok(runnerSource.includes('"ADR010_B_RESTORE_TARGET_NOT_EMPTY"'));
  assert.match(runnerSource, /const message = error instanceof Error \? error\.message : String\(error\);/u);
  assert.match(runnerSource, /if \(message !== code\) throw new Error/u);
  assert.match(runnerSource, /throw new Error\(`Expected remote rejection \$\{code\}`\)/u);
});

test("[preflight/non-evidence] remote Auth evidence proves rotation, refreshed writes, and global refresh revocation without token output", async () => {
  const runnerSource = await readFile(integrationRunnerPath, "utf8");
  assert.ok(runnerSource.includes("refreshTokenEvidence"));
  assert.ok(runnerSource.includes("adapter.proveRefreshTokenRotation"));
  assert.ok(runnerSource.includes('"refresh-token-rotation-revocation"'));
  assert.equal(runnerSource.includes('"refresh-token rotation"'), false);
  assert.equal(/console\.log\(JSON\.stringify\([\s\S]*(?:accessToken|refreshToken)\s*:/iu.test(runnerSource), false);
});

test("[preflight/non-evidence] remote report separates spike GO blockers from physical recovery evidence", async () => {
  const runnerSource = await readFile(integrationRunnerPath, "utf8");
  const eligibilityStart = runnerSource.indexOf("const adr010GoEligibility");
  const eligibilityEnd = runnerSource.indexOf("const config =", eligibilityStart);
  const eligibilitySource = runnerSource.slice(eligibilityStart, eligibilityEnd);
  assert.ok(eligibilitySource.includes('"human write-frontier inspection (gate 4)"'));
  assert.ok(eligibilitySource.includes('"complete five-migration application from a second fresh remote project/CI (gate 7)"'));
  assert.ok(eligibilitySource.includes('"physical disaster recovery with production RPO/RTO"'));
  const spikeBlockers = /spikeBlockingEvidence: Object\.freeze\(\[([\s\S]*?)\]\),\s*operationalEvidencePending/u.exec(eligibilitySource)?.[1];
  assert.notEqual(spikeBlockers, undefined);
  assert.equal(spikeBlockers?.includes("physical disaster"), false);
  assert.ok(runnerSource.includes("goEligibility: adr010GoEligibility"));
  assert.ok(runnerSource.includes("eligibleForAdr010Go: adr010GoEligibility.eligibleForAdr010Go"));
});

test("[preflight/non-evidence] B/C migrations have one ordered authority and repeatable read-only hardening", async () => {
  const migrationNames = (await readdir(migrationsRoot))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.deepEqual(migrationNames, [
    "20260825000100_adr010_b_thin_slice.sql",
    "20260826000100_adr010_c_read_only_hardening.sql",
    "20260827000100_adr010_b_bootstrap_rls_hardening.sql",
    "20260828000100_adr010_b_financial_write_boundary.sql",
    "20260829000100_adr010_b_financial_conflict_fix.sql",
  ]);

  const hardening = await readFile(readOnlyHardeningMigrationPath, "utf8");
  for (const invariant of [
    "revoke all privileges on all tables in schema adr010_b from anon, authenticated, service_role",
    "revoke all privileges on all functions in schema adr010_b_private from public, anon, authenticated, service_role",
    "revoke all privileges on function adr010_b_private.adr010_b_create_order(jsonb)",
    "grant select on table",
  ]) {
    assert.ok(hardening.includes(invariant), `missing hardening invariant: ${invariant}`);
  }
  assert.equal(hardening.includes("adr010_b.adr010_b_create_order"), false, "critical function reference must use the private schema");
  assert.equal(hardening.includes("grant select on all tables"), false, "administrative and future tables must remain closed");
  assert.equal(/grant select on table[\s\S]*?bootstrap_users[\s\S]*?to authenticated;/iu.test(hardening), false, "hardening must not expose bootstrap markers");
  assert.equal(/grant\s+(?:insert|update|delete|truncate|execute)/iu.test(hardening), false);

  const statements = hardening
    .replace(/^\s*--.*$/gmu, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(statements.every((statement) => /^(?:revoke|grant select|grant usage|alter default privileges)\b/iu.test(statement)), true);

  const bootstrapHardening = await readFile(bootstrapRlsHardeningMigrationPath, "utf8");
  for (const invariant of [
    "alter table adr010_b.bootstrap_users enable row level security",
    "alter table adr010_b.bootstrap_users force row level security",
    "drop policy %I on adr010_b.bootstrap_users",
    "revoke all privileges on table adr010_b.bootstrap_users",
    "revoke all privileges on all sequences in schema adr010_b",
    "revoke all privileges on all functions in schema adr010_b_private",
  ]) {
    assert.ok(bootstrapHardening.includes(invariant), `missing bootstrap hardening invariant: ${invariant}`);
  }
  assert.equal(/create\s+policy/iu.test(bootstrapHardening), false, "bootstrap marker must remain policy-free");
  assert.equal(/grant\s+/iu.test(bootstrapHardening), false, "bootstrap hardening must not grant privileges");

  const config = await readFile(path.join(optionRoot, "supabase", "config.toml"), "utf8");
  assert.ok(config.includes('schemas = ["public", "graphql_public", "adr010_b"]'));
  assert.equal(/project[_-]?ref|supabase\.co/iu.test(config), false, "local CLI config must not version a remote project reference");
});

test("[preflight/non-evidence] the financial slice has private idempotent cash writes, immutable compensation, RLS, and no Data API grants", async () => {
  const sql = await readFile(financialMigrationPath, "utf8");
  for (const invariant of [
    "create table if not exists adr010_b.payments", "create table if not exists adr010_b.refunds", "create table if not exists adr010_b.cash_movements", "create table if not exists adr010_b.financial_audit_log",
    "amount_minor bigint not null", "method text not null check (method = 'cash')", "request_payload jsonb not null", "unique (restaurant_id, branch_id, idempotency_key)",
    "ADR010_FINANCIAL_IDEMPOTENCY_KEY_REUSED", "ADR010_REFUND_EXCEEDS_CAPTURED_AMOUNT", "ADR010_FINANCIAL_LEDGER_IMMUTABLE",
    "adr010_b_create_cash_payment(p_payload jsonb)", "adr010_b_refund_cash_payment(p_payload jsonb)", "security definer", "set search_path = ''", "ADR010_MEMBERSHIP_NOT_ACTIVE",
    "revoke all on table adr010_b.payments, adr010_b.refunds, adr010_b.cash_movements, adr010_b.financial_audit_log", "before update or delete on adr010_b.payments", "before update or delete on adr010_b.cash_movements",
    "unique (restaurant_id, branch_id, id, order_id)",
    "foreign key (restaurant_id, branch_id, payment_id, order_id) references adr010_b.payments",
    "foreign key (restaurant_id, branch_id, cash_movement_id) references adr010_b.cash_movements",
    "unique (restaurant_id, branch_id, id)",
    "create unique index if not exists cash_movements_payment_capture_uidx",
    "where source_type = 'cash_payment'",
    "create unique index if not exists cash_movements_refund_uidx",
    "where source_type = 'cash_refund'",
    "'idempotencyKey',v_key",
    "local_sequence bigint not null",
    "authorization_approved boolean not null",
    "authorization_actor_id uuid not null",
    "create table if not exists adr010_b_private.device_sequences",
    "last_sequence bigint not null default 0",
    "alter table adr010_b_private.device_sequences enable row level security",
    "revoke all on table adr010_b_private.device_sequences",
    "adr010_b_claim_device_sequence(p_device_id text, p_requested bigint)",
    "ADR010_REFUND_AUTHORIZATION_REQUIRED",
    "ADR010_REFUND_AUTHORIZATION_NOT_SUPERVISOR",
    "ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED",
    "ADR010_FINANCIAL_LOCAL_SEQUENCE_GAP",
    "ADR010_FINANCIAL_LOCAL_SEQUENCE_EXHAUSTED",
    "'localSequence',v_local_sequence",
    "'authorization',jsonb_build_object",
    "select id into v_movement_id from adr010_b.cash_movements where payment_id=v_payment.id and source_type='cash_payment'",
    "v_refunded > v_payment.amount_minor - v_amount",
  ]) assert.ok(sql.includes(invariant), `missing financial invariant: ${invariant}`);
  assert.equal(/,\s*unique \(payment_id\)/u.test(sql), false, "a payment must support both its capture and refund movements");
  assert.equal(/create unique index if not exists cash_movements_payment_capture_uidx[\s\S]*where source_type = 'cash_payment'/u.test(sql), true);
  const cashMovementDefinition = sql.slice(sql.indexOf("create table if not exists adr010_b.cash_movements"), sql.indexOf("create table if not exists adr010_b.financial_audit_log"));
  assert.match(cashMovementDefinition, /unique \(restaurant_id, branch_id, id\)/u, "cash movement FK target must have a scoped unique key");
  const cleanupDeletes = [...sql.slice(sql.indexOf("create or replace function adr010_b_private.adr010_b_cleanup_auth_bootstrap")).matchAll(/delete from adr010_b\.([a-z_]+)/gu)].map((match) => match[1]);
  assert.deepEqual(cleanupDeletes.slice(0, 4), ["financial_audit_log", "cash_movements", "refunds", "payments"], "cleanup must delete financial dependents before their principals");
  assert.ok(sql.includes("delete from adr010_b_private.device_sequences"), "cleanup must account for disposable device cursors");
  assert.equal(/grant\s+(?:insert|update|delete|execute)/iu.test(sql), false, "financial migration must not grant write or RPC access");
  assert.equal(/create\s+policy/iu.test(sql), false, "financial rows require no Data API policy because clients receive no grants");
});

test("[preflight/non-evidence] financial conflict fix uses the global device sequence invariant", async () => {
  const correction = await readFile(financialConflictFixMigrationPath, "utf8");
  assert.ok(correction.includes("create unique index if not exists cash_movements_device_sequence_global_uidx"));
  assert.ok(correction.includes("on adr010_b.cash_movements(device_id, local_sequence)"));
  const globalConflictTarget = "on conflict (device_id,local_sequence) do nothing returning id into v_movement_id";
  assert.equal(correction.split(globalConflictTarget).length - 1, 2);
  assert.equal(correction.includes("on conflict (restaurant_id,branch_id,actor_id,device_id,local_sequence)"), false);
  assert.ok(correction.includes("revoke all on function adr010_b_private.adr010_b_create_cash_payment(jsonb)"));
  assert.ok(correction.includes("revoke all on function adr010_b_private.adr010_b_refund_cash_payment(jsonb)"));
});

test("[preflight/non-evidence] remote schema audit is catalog-only and avoids reserved catalog aliases", async () => {
  const audit = await readFile(remoteSchemaAuditPath, "utf8");
  assert.ok(audit.includes("begin transaction isolation level repeatable read read only"));
  assert.ok(audit.includes("select check_name, passed, observed_count, expected_count"));
  assert.ok(audit.includes("'20260825000100', '20260826000100', '20260827000100', '20260828000100', '20260829000100'"));
  assert.ok(audit.includes("cash_movements_device_sequence_global_uidx"));
  assert.ok(audit.includes("'cash_movements_global_device_sequence_unique_index_present'"));
  assert.ok(audit.includes("('refunds', array['restaurant_id', 'branch_id', 'payment_id', 'order_id'], 'payments', array['restaurant_id', 'branch_id', 'id', 'order_id'])"));
  assert.equal(audit.includes("('refunds', array['restaurant_id', 'branch_id', 'payment_id'], 'payments', array['restaurant_id', 'branch_id', 'id'])"), false, "refunds must retain payment/order identity in the expected FK");
  assert.match(audit, /\nrollback;\s*$/u);
  assert.equal(/\b(?:from|join)\s+adr010_b(?:_private)?\./iu.test(audit), false, "audit must not read business rows");
  assert.equal(/^\s*(?:insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|copy|call|do|vacuum|analyze)\b/imu.test(audit), false, "audit must not mutate the linked project");
  for (const reservedAlias of ["constraint", "function", "key", "policy", "procedure", "role", "type"]) {
    assert.equal(new RegExp(`\\bpg_[a-z_]+\\s+${reservedAlias}\\b`, "iu").test(audit), false, `reserved catalog alias: ${reservedAlias}`);
  }
});

test("[preflight/non-evidence] Auth bootstrap has deterministic fixture mapping, orphan discovery, retry-safe cleanup ordering, and no secret output", async () => {
  const plan = adr010BAuthBootstrapPlan();
  assert.deepEqual(plan.assignments.map((assignment) => assignment.fixtureKey), ["amber", "cobalt"]);
  assert.deepEqual(plan.assignments.map((assignment) => assignment.branchIds.length), [2, 2]);
  assert.equal(plan.assignments.every((assignment) => assignment.role === "cashier"), true);
  assert.match(plan.cleanup[0] ?? "", /artifacts and memberships/);
  assert.match(plan.cleanup[1] ?? "", /Admin API/);
  assert.match(plan.cleanup[2] ?? "", /retry cleanup/);

  const source = await readFile(bootstrapPath, "utf8");
  for (const prohibitedOutput of ["console.", "process.stdout", "process.stderr"]) {
    assert.equal(source.includes(prohibitedOutput), false, `bootstrap must not print through ${prohibitedOutput}`);
  }
  assert.ok(source.includes("randomBytes(32)"));
  assert.ok(source.includes("createUser({"));
  assert.ok(source.includes("[authBootstrapMetadataKey]: authBootstrapMetadataValue"));
  assert.ok(source.includes("bootstrap_run_id: bootstrapRunId"));
  assert.ok(source.includes("listUsers({ page, perPage: 1000 })"));
  assert.ok(source.includes("cleanupTrackedAndMarkedAuthUsers"));
  assert.ok(source.includes("created.map((user) => user.userId)"));
  assert.ok(source.includes("deleteUser(userId)"));
  assert.ok(source.includes("adr010_b_cleanup_auth_bootstrap"));
  assert.equal(source.includes("return credentials"), false);
});

test("[preflight/non-evidence] Auth bootstrap serializes membership and cleanup arrays as JSONB parameters", () => {
  const userIds = ["9e92c3e8-29a5-4f6f-8bdb-84cbf0d5ea95", "64c1d4b2-5a2f-46cf-a152-1657cd5a8f24"] as const;
  const membershipRows = [{ fixtureKey: "amber", userId: userIds[0], bootstrapRunId: "6f84f1ca-9bfc-48a9-8e58-9188d96e1a26" }];
  const sqlMembershipRows = toAuthMembershipBootstrapRows(membershipRows);
  const sqlMembershipRow = sqlMembershipRows[0];
  const cleanupParameter = serializeJsonbArrayParameter(userIds);
  const membershipParameter = serializeJsonbArrayParameter(sqlMembershipRows);

  assert.equal(typeof cleanupParameter, "string");
  assert.deepEqual(JSON.parse(cleanupParameter), userIds);
  assert.deepEqual(JSON.parse(membershipParameter), [{
    fixture_key: "amber",
    user_id: userIds[0],
    bootstrap_run_id: "6f84f1ca-9bfc-48a9-8e58-9188d96e1a26",
  }]);
  if (sqlMembershipRow === undefined) throw new Error("expected one mapped SQL membership row");
  assert.equal("fixtureKey" in sqlMembershipRow, false, "jsonb_to_recordset cannot consume camelCase field names");
  assert.equal("userId" in sqlMembershipRow, false, "jsonb_to_recordset cannot consume camelCase field names");
  assert.equal("bootstrapRunId" in sqlMembershipRow, false, "jsonb_to_recordset cannot consume camelCase field names");
  assert.notEqual(cleanupParameter, `{${userIds.join(",")}}`, "must not use PostgreSQL array syntax for a jsonb argument");
});

test("[preflight/non-evidence] Auth bootstrap exposes only redacted PostgreSQL diagnostics", () => {
  const safe = summarizeSafePostgresDiagnostic({ code: "22P02", message: "Expected ':' but found ','." });
  assert.deepEqual(safe, { code: "22P02", message: "Expected ':' but found ','." });

  const unsafe = new Adr010BAuthBootstrapError("Supabase could not attach deterministic ADR-010 memberships.", {
    code: "28P01",
    message: "password=do-not-log token=do-not-log postgresql://postgres:do-not-log@example.test/postgres",
    connectionString: "postgresql://postgres:do-not-log@example.test/postgres",
    query: "select do_not_log",
    stack: "do-not-log",
  });
  assert.deepEqual(unsafe.diagnostic, { code: "28P01", message: "database error details redacted" });
  assert.match(unsafe.message, /28P01/u);
  for (const forbidden of ["do-not-log", "connectionString", "select do_not_log", "postgresql://"]) {
    assert.equal(JSON.stringify(unsafe).includes(forbidden), false);
    assert.equal(unsafe.message.includes(forbidden), false);
  }
});

test("[preflight/non-evidence] standalone RLS read probe prepares structural fixtures and always closes its adapter", async () => {
  const source = await readFile(rlsReadProbePath, "utf8");
  assert.ok(source.includes('import { SupabaseNestAdr010Adapter } from "./adapter.js";'));
  assert.ok(source.includes("const adapter = new SupabaseNestAdr010Adapter(config);"));
  assert.match(source, /try\s*\{[\s\S]*?await adapter\.migrateFromEmpty\(\);[\s\S]*?await withAdr010BAuthenticatedFixtures\(/u);
  assert.match(source, /finally\s*\{\s*await adapter\.close\(\);\s*\}/u);
});

test("[preflight/non-evidence] adapter cleanup passes tracked user IDs as a JSONB parameter", async () => {
  const source = await readFile(adapterPath, "utf8");
  assert.ok(source.includes('import { serializeJsonbArrayParameter } from "./auth-bootstrap.js";'));
  assert.match(source, /adr010_b_cleanup_auth_bootstrap\(\$1::jsonb\)[\s\S]*?\[serializeJsonbArrayParameter\(userIds\)\]/u);
});

test("[preflight/non-evidence] structural fixtures do not forge Auth identities or critical artifacts", async () => {
  const fixtures = await readFile(path.join(optionRoot, "supabase", "fixtures", "adr010-b-structural-fixtures.sql"), "utf8");
  for (const table of ["restaurants", "branches"]) {
    assert.ok(fixtures.includes(`adr010_b.${table}`), `structural fixture omits ${table}`);
  }
  for (const prohibitedTable of ["memberships", "orders", "order_lines", "order_line_snapshots", "order_idempotency", "audit_log", "kds_events", "auth.users"]) {
    assert.equal(fixtures.includes(`insert into adr010_b.${prohibitedTable}`) || fixtures.includes(`insert into ${prohibitedTable}`), false);
  }
  assert.equal((fixtures.match(/Amber (North|South)/g) ?? []).length, 2);
  assert.equal((fixtures.match(/Cobalt (North|South)/g) ?? []).length, 2);
});
