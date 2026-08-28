import assert from "node:assert/strict";
import test from "node:test";

import {
  createFixtures,
  GateFailure,
  InMemoryReferenceAdapter,
  runCommonGates,
} from "./index.js";
import {
  authScopeRevocationGate,
  backupRestoreGate,
  idempotencyGate,
  isolationGate,
  migrationGate,
  realtimeRecoveryGate,
  reproducibilityGate,
  secretsGate,
  singleWriteFrontierGate,
  transactionGate,
} from "./gates.js";

test("the reference adapter passes executable gates and reports the frontier inspection", async () => {
  const report = await runCommonGates(new InMemoryReferenceAdapter(), createFixtures());
  assert.deepEqual(report.pendingHumanInspection, ["single-write-frontier"]);
  assert.equal(report.singleWriteFrontier.status, "requires-human-inspection");
});

test("fixtures are a deterministic two-restaurant, two-branch matrix", () => {
  const fixtures = createFixtures();
  assert.equal(fixtures.restaurants.length, 2);
  assert.equal(fixtures.branches.length, 4);
  assert.equal(fixtures.branches.filter((scope) => scope.restaurantId === fixtures.primaryScope.restaurantId).length, 2);
  assert.equal(fixtures.branches.filter((scope) => scope.restaurantId === fixtures.otherRestaurantScope.restaurantId).length, 2);
});

test("the harness detects a tenant or branch leak", async () => {
  await assert.rejects(
    isolationGate(new InMemoryReferenceAdapter({ leakTenantRead: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "isolation",
  );
});

test("the harness detects a cross-restaurant or cross-branch write", async () => {
  await assert.rejects(
    isolationGate(new InMemoryReferenceAdapter({ allowCrossScopeWrite: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "isolation",
  );
});

test("the harness detects partial state after an induced failure", async () => {
  await assert.rejects(
    transactionGate(new InMemoryReferenceAdapter({ commitPartialOnFailure: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "transaction",
  );
});

test("the harness detects orphaned line, snapshot, and audit artifacts after an induced failure", async () => {
  await assert.rejects(
    transactionGate(new InMemoryReferenceAdapter({ commitArtifactsWithoutOrderOnFailure: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "transaction",
  );
});

test("the harness detects duplicate business results from concurrent re-sends", async () => {
  await assert.rejects(
    idempotencyGate(new InMemoryReferenceAdapter({ duplicateIdempotency: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "idempotency",
  );
});

test("the harness detects a KDS adapter that cannot recover a missed event", async () => {
  await assert.rejects(
    realtimeRecoveryGate(new InMemoryReferenceAdapter({ loseKdsHistory: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "realtime-recovery",
  );
});

test("the harness detects KDS cursor recovery that leaks another scope", async () => {
  await assert.rejects(
    realtimeRecoveryGate(new InMemoryReferenceAdapter({ leakKdsScope: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "realtime-recovery",
  );
});

test("the harness requires revocation to be revalidated at the critical operation", async () => {
  await assert.rejects(
    authScopeRevocationGate(new InMemoryReferenceAdapter({ skipRevocationCheck: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "auth-scope-revocation",
  );
});

test("the harness detects a migration that destroys persisted identifiers", async () => {
  await assert.rejects(
    migrationGate(new InMemoryReferenceAdapter({ resetOnMigrate: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "migration",
  );
});

test("the harness detects backup restore that loses snapshot or audit identifiers", async () => {
  await assert.rejects(
    backupRestoreGate(new InMemoryReferenceAdapter({ loseBackupArtifacts: true }), createFixtures()),
    (error: unknown) => error instanceof GateFailure && error.gate === "backup-restore",
  );
});

test("the harness allows the Supabase URL and publishable key but rejects privileged or legacy client names", () => {
  secretsGate(new InMemoryReferenceAdapter({ clientExposedEnvironmentNames: ["ADR010_SUPABASE_URL", "ADR010_SUPABASE_PUBLISHABLE_KEY"] }));
  assert.throws(
    () => secretsGate(new InMemoryReferenceAdapter({ clientExposedEnvironmentNames: ["ADR010_SUPABASE_SECRET_KEY"] })),
    (error: unknown) => error instanceof GateFailure && error.gate === "secrets",
  );
  assert.throws(
    () => secretsGate(new InMemoryReferenceAdapter({ clientExposedEnvironmentNames: ["NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"] })),
    (error: unknown) => error instanceof GateFailure && error.gate === "secrets",
  );
  assert.throws(
    () => secretsGate(new InMemoryReferenceAdapter({ clientExposedEnvironmentNames: ["VITE_DATABASE_URL", "EXPO_PUBLIC_API_TOKEN", "EXPO_PUBLIC_PRIVATE_KEY"] })),
    (error: unknown) => error instanceof GateFailure && error.gate === "secrets",
  );
  assert.throws(
    () => secretsGate(new InMemoryReferenceAdapter({ clientExposedEnvironmentNames: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"] })),
    (error: unknown) => error instanceof GateFailure && error.gate === "secrets",
  );
});

test("the harness rejects incomplete reproducibility evidence", () => {
  assert.throws(
    () => reproducibilityGate(new InMemoryReferenceAdapter({ reproducibilityEvidence: {
      lockfile: "pnpm-lock.yaml",
      commands: ["pnpm --filter @super-restaurant/adr-010-spike test"],
      evidenceLocation: "evidence/missing.txt",
    } })),
    (error: unknown) => error instanceof GateFailure && error.gate === "reproducibility",
  );
});

test("the frontier gate requires an inspectable command and exactly one claimed path per critical write", () => {
  assert.throws(
    () => singleWriteFrontierGate(new InMemoryReferenceAdapter({ writeFrontierInspection: {
      status: "requires-human-inspection",
      evidenceLocation: "",
      verificationCommand: "",
      claimedPaths: { Order: ["a", "b"], Payment: ["c"], CashMovement: ["d"] },
    } })),
    (error: unknown) => error instanceof GateFailure && error.gate === "single-write-frontier",
  );
});
