import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";

import type { TenancyVerificationLiveFixture } from "./tenancy-verification.js";
import {
  createWebProtectedSmokeCoordinator,
  WEB_PROTECTED_SMOKE_ACK_PATH,
  WEB_PROTECTED_SMOKE_LEASE_PATH,
} from "./web-protected-smoke-coordinator.js";

const PROJECT_REF = "abcdefghijklmnopqrst";
const fixture: TenancyVerificationLiveFixture = Object.freeze({
  apiBaseUrl: "http://127.0.0.1:4311",
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

test("requires exact opt-ins and refuses stale coordination artifacts", () => {
  clearArtifacts();
  assert.throws(() => createWebProtectedSmokeCoordinator({}, PROJECT_REF, () => undefined));

  writeFileSync(WEB_PROTECTED_SMOKE_LEASE_PATH, "stale", "utf8");
  try {
    assert.throws(() => createWebProtectedSmokeCoordinator(validEnvironment(), PROJECT_REF, () => undefined));
  } finally {
    clearArtifacts();
  }
});

test("publishes the marked selection fixture, accepts an exact ack and removes all artifacts", async () => {
  clearArtifacts();
  const phases: string[] = [];
  const coordinator = createWebProtectedSmokeCoordinator(
    validEnvironment(),
    PROJECT_REF,
    (phase) => phases.push(phase),
  );
  writeAcknowledgement("selection");

  try {
    await coordinator.hooks.beforeRevocation(fixture);
    const lease = JSON.parse(readFileSync(WEB_PROTECTED_SMOKE_LEASE_PATH, "utf8")) as Record<string, unknown>;
    assert.deepEqual(phases, ["selection"]);
    assert.equal(lease.phase, "selection");
    assert.equal(lease.runId, fixture.runId);
    assert.equal(lease.email, fixture.credentials.email);
    assert.equal(lease.password, fixture.credentials.password);
    assert.equal(lease.restaurantId, fixture.restaurantId);
    assert.equal(lease.branchId, fixture.branchId);
    assert.equal(lease.apiBaseUrl, fixture.apiBaseUrl);
  } finally {
    coordinator.cleanup();
  }
  assert.equal(exists(WEB_PROTECTED_SMOKE_LEASE_PATH), false);
  assert.equal(exists(WEB_PROTECTED_SMOKE_ACK_PATH), false);
});

test("revocation phase never republishes credentials", async () => {
  clearArtifacts();
  const coordinator = createWebProtectedSmokeCoordinator(
    validEnvironment(),
    PROJECT_REF,
    () => undefined,
  );
  writeAcknowledgement("revoked");

  try {
    await coordinator.hooks.afterRevocation(fixture);
    const lease = JSON.parse(readFileSync(WEB_PROTECTED_SMOKE_LEASE_PATH, "utf8")) as Record<string, unknown>;
    assert.deepEqual(lease, { phase: "revoked", runId: fixture.runId });
    assert.equal(JSON.stringify(lease).includes(fixture.credentials.password), false);
  } finally {
    coordinator.cleanup();
  }
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    WEB_PROTECTED_SMOKE_CONFIRM_PROJECT_REF: PROJECT_REF,
    WEB_PROTECTED_SMOKE_RUN: "REMOTE_BROWSER_SMOKE",
  };
}

function writeAcknowledgement(phase: "revoked" | "selection"): void {
  writeFileSync(
    WEB_PROTECTED_SMOKE_ACK_PATH,
    JSON.stringify({ phase, runId: fixture.runId }),
    "utf8",
  );
}

function clearArtifacts(): void {
  rmSync(WEB_PROTECTED_SMOKE_LEASE_PATH, { force: true });
  rmSync(WEB_PROTECTED_SMOKE_ACK_PATH, { force: true });
}

function exists(path: URL): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
