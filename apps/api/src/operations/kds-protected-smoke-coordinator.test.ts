import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";

import type { TenancyVerificationLiveFixture } from "./tenancy-verification.js";
import {
  createKdsProtectedSmokeCoordinator,
  KDS_PROTECTED_SMOKE_ACK_PATH,
  KDS_PROTECTED_SMOKE_LEASE_PATH,
  type KdsSmokePhase,
} from "./kds-protected-smoke-coordinator.js";

const PROJECT_REF = "abcdefghijklmnopqrst";
const fixture: TenancyVerificationLiveFixture = Object.freeze({
  apiBaseUrl: "http://127.0.0.1:4312",
  branchId: "22222222-2222-4222-8222-222222222222",
  branchName: "branch-marker",
  credentials: Object.freeze({
    email: "marked-fixture@example.invalid",
    password: "temporary-browser-smoke-password",
  }),
  restaurantId: "11111111-1111-4111-8111-111111111111",
  restaurantName: "restaurant-marker",
  runId: "33333333-3333-4333-8333-333333333333",
});

test("requires exact KDS opt-ins and refuses stale coordination artifacts", () => {
  clearArtifacts();
  assert.throws(() => createKdsProtectedSmokeCoordinator({}, PROJECT_REF, () => undefined));

  writeFileSync(KDS_PROTECTED_SMOKE_LEASE_PATH, "stale", "utf8");
  try {
    assert.throws(() => createKdsProtectedSmokeCoordinator(validEnvironment(), PROJECT_REF, () => undefined));
  } finally {
    clearArtifacts();
  }
});

test("publishes the marked sent ticket fixture and consumes an exact acknowledgement", async () => {
  clearArtifacts();
  const phases: string[] = [];
  const coordinator = createKdsProtectedSmokeCoordinator(
    validEnvironment(),
    PROJECT_REF,
    (phase) => phases.push(phase),
  );
  writeAcknowledgement("sent");

  try {
    await coordinator.hooks.sent(fixture);
    const lease = readLease();
    assert.deepEqual(phases, ["sent"]);
    assert.equal(lease.phase, "sent");
    assert.equal(lease.runId, fixture.runId);
    assert.equal(lease.email, fixture.credentials.email);
    assert.equal(lease.password, fixture.credentials.password);
    assert.equal(lease.restaurantId, fixture.restaurantId);
    assert.equal(lease.branchId, fixture.branchId);
    assert.equal(lease.apiBaseUrl, fixture.apiBaseUrl);
    assert.equal(lease.stationId, "kitchen");
    assert.equal(lease.expectedProductName, `__tenancy_e2e__${fixture.runId}__menu-product`);
    assert.equal(lease.expectedModifierName, `__tenancy_e2e__${fixture.runId}__menu-option`);
  } finally {
    coordinator.cleanup();
  }
  assert.equal(exists(KDS_PROTECTED_SMOKE_LEASE_PATH), false);
  assert.equal(exists(KDS_PROTECTED_SMOKE_ACK_PATH), false);
});

test("ready and revoked phases never republish credentials", async () => {
  clearArtifacts();
  const coordinator = createKdsProtectedSmokeCoordinator(
    validEnvironment(),
    PROJECT_REF,
    () => undefined,
  );

  try {
    for (const phase of ["ready", "revoked"] as const) {
      writeAcknowledgement(phase);
      await coordinator.hooks[phase === "ready" ? "ready" : "afterRevocation"](fixture);
      const lease = readLease();
      assert.deepEqual(lease, { phase, runId: fixture.runId });
      assert.equal(JSON.stringify(lease).includes(fixture.credentials.password), false);
    }
  } finally {
    coordinator.cleanup();
  }
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    KDS_PROTECTED_SMOKE_CONFIRM_PROJECT_REF: PROJECT_REF,
    KDS_PROTECTED_SMOKE_RUN: "REMOTE_BROWSER_SMOKE",
  };
}

function writeAcknowledgement(phase: KdsSmokePhase): void {
  writeFileSync(
    KDS_PROTECTED_SMOKE_ACK_PATH,
    JSON.stringify({ phase, runId: fixture.runId }),
    "utf8",
  );
}

function readLease(): Record<string, unknown> {
  return JSON.parse(readFileSync(KDS_PROTECTED_SMOKE_LEASE_PATH, "utf8")) as Record<string, unknown>;
}

function clearArtifacts(): void {
  rmSync(KDS_PROTECTED_SMOKE_LEASE_PATH, { force: true });
  rmSync(KDS_PROTECTED_SMOKE_ACK_PATH, { force: true });
}

function exists(path: URL): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
