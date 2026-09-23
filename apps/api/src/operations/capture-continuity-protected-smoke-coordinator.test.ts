import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";

import type { TenancyVerificationConfig } from "./tenancy-verification-config.js";
import type { TenancyVerificationLiveFixture } from "./tenancy-verification.js";
import {
  CAPTURE_CONTINUITY_SMOKE_ACK_PATH,
  CAPTURE_CONTINUITY_SMOKE_LEASE_PATH,
  createCaptureContinuityProtectedSmokeCoordinator,
  type CaptureContinuityFixturePlan,
} from "./capture-continuity-protected-smoke-coordinator.js";

const PROJECT_REF = "abcdefghijklmnopqrst";
const config = Object.freeze({ expectedProjectRef: PROJECT_REF } as TenancyVerificationConfig);
const fixture: TenancyVerificationLiveFixture = Object.freeze({
  apiBaseUrl: "http://127.0.0.1:4314",
  branchId: "22222222-2222-4222-8222-222222222222",
  branchName: "branch-marker",
  credentials: Object.freeze({ email: "marked-fixture@example.invalid", password: "temporary-password" }),
  restaurantId: "11111111-1111-4111-8111-111111111111",
  restaurantName: "restaurant-marker",
  runId: "33333333-3333-4333-8333-333333333333",
  verificationContext: Object.freeze({
    accessToken: "token",
    diningTableId: "44444444-4444-4444-8444-444444444444",
    menuCurrency: "MXN",
    menuModifierGroupId: "55555555-5555-4555-8555-555555555555",
    menuModifierOptionId: "66666666-6666-4666-8666-666666666666",
    menuProductId: "77777777-7777-4777-8777-777777777777",
    primaryUserId: "88888888-8888-4888-8888-888888888888",
    secondaryAccessToken: "secondary-token",
    secondaryBranchId: "99999999-9999-4999-8999-999999999999",
    secondaryRestaurantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    secondaryUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    viewerBranchId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  }),
});

test("requires exact opt-ins and rejects stale artifacts", () => {
  clearArtifacts();
  assert.throws(() => createCaptureContinuityProtectedSmokeCoordinator({}, config, () => undefined));
  writeFileSync(CAPTURE_CONTINUITY_SMOKE_LEASE_PATH, "stale", "utf8");
  try {
    assert.throws(() => createCaptureContinuityProtectedSmokeCoordinator(validEnvironment(), config, () => undefined));
  } finally {
    clearArtifacts();
  }
});

test("publishes only the marked fixture, accepts an exact ack, and delegates exact cleanup", async () => {
  clearArtifacts();
  const phases: string[] = [];
  let cleanupPlan: CaptureContinuityFixturePlan | undefined;
  let cleanupPrepared: boolean | undefined;
  const coordinator = createCaptureContinuityProtectedSmokeCoordinator(
    validEnvironment(),
    config,
    (runId) => phases.push(runId),
    {
      prepareFixture: async (_fixture, plan) => ({ ...plan, folio: "C-SMOKE" }),
      cleanupFixture: async (_config, _fixture, plan, prepared) => {
        cleanupPlan = plan;
        cleanupPrepared = prepared;
      },
      verifyFixture: async () => undefined,
    },
  );
  writeFileSync(
    CAPTURE_CONTINUITY_SMOKE_ACK_PATH,
    JSON.stringify({ phase: "capture_continuity", runId: fixture.runId }),
    "utf8",
  );
  try {
    await coordinator.hooks.beforeRevocation(fixture);
    const lease = JSON.parse(readFileSync(CAPTURE_CONTINUITY_SMOKE_LEASE_PATH, "utf8")) as Record<string, unknown>;
    assert.deepEqual(phases, [fixture.runId]);
    assert.equal(lease.phase, "capture_continuity");
    assert.equal(lease.runId, fixture.runId);
    assert.equal(lease.email, fixture.credentials.email);
    assert.equal(lease.password, fixture.credentials.password);
    assert.equal(lease.folio, "C-SMOKE");
    assert.equal(lease.expectedSourceAfterAutosave, "whatsapp_manual");
    assert.equal(typeof lease.customerId, "string");
    assert.equal(typeof lease.captureDraftId, "string");
    await coordinator.hooks.afterRevocation(fixture);
    await coordinator.hooks.cleanup?.(fixture);
  } finally {
    coordinator.cleanupArtifacts();
  }
  assert.equal(cleanupPrepared, true);
  assert.equal(cleanupPlan?.displayName.includes(fixture.runId), true);
  assert.equal(exists(CAPTURE_CONTINUITY_SMOKE_LEASE_PATH), false);
  assert.equal(exists(CAPTURE_CONTINUITY_SMOKE_ACK_PATH), false);
});

test("rejects acknowledgements with extra fields and still offers cleanup for the prepared fixture", async () => {
  clearArtifacts();
  let cleaned = false;
  const coordinator = createCaptureContinuityProtectedSmokeCoordinator(
    validEnvironment(),
    config,
    () => undefined,
    {
      prepareFixture: async (_fixture, plan) => ({ ...plan, folio: "C-SMOKE" }),
      cleanupFixture: async () => { cleaned = true; },
      verifyFixture: async () => undefined,
    },
    250,
  );
  writeFileSync(
    CAPTURE_CONTINUITY_SMOKE_ACK_PATH,
    JSON.stringify({ extra: true, phase: "capture_continuity", runId: fixture.runId }),
    "utf8",
  );
  await assert.rejects(() => coordinator.hooks.beforeRevocation(fixture));
  await coordinator.hooks.cleanup?.(fixture);
  assert.equal(cleaned, true);
  assert.equal(exists(CAPTURE_CONTINUITY_SMOKE_LEASE_PATH), false);
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    CAPTURE_CONTINUITY_SMOKE_CONFIRM_PROJECT_REF: PROJECT_REF,
    CAPTURE_CONTINUITY_SMOKE_RUN: "REMOTE_CAPTURE_CONTINUITY_BROWSER_SMOKE",
  };
}

function clearArtifacts(): void {
  rmSync(CAPTURE_CONTINUITY_SMOKE_LEASE_PATH, { force: true });
  rmSync(CAPTURE_CONTINUITY_SMOKE_ACK_PATH, { force: true });
}

function exists(path: URL): boolean {
  try { readFileSync(path); return true; } catch { return false; }
}
