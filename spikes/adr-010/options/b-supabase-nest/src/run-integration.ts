import { runCommonGates } from "../../../src/index.js";
import { asBranchScope, asRestaurantId, type SpikeFixtures } from "../../../src/model.js";
import { SupabaseNestAdr010Adapter, type RefreshTokenRotationEvidence } from "./adapter.js";
import { requireSupabaseGateIntegrationOptIn } from "./config.js";
import { runOptionBFinancialGates } from "./financial-gates.js";

const primaryScope = asBranchScope("00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2");
const otherBranchScope = asBranchScope("00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a3");
const otherRestaurantScope = asBranchScope("00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000b2");
const secondRestaurantSecondBranchScope = asBranchScope("00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000b3");
const remoteFixtures: SpikeFixtures = {
  restaurants: [asRestaurantId(primaryScope.restaurantId), asRestaurantId(otherRestaurantScope.restaurantId)],
  branches: [primaryScope, otherBranchScope, otherRestaurantScope, secondRestaurantSecondBranchScope],
  primaryScope,
  otherBranchScope,
  otherRestaurantScope,
  secondRestaurantSecondBranchScope,
};

const adr010GoEligibility = Object.freeze({
  eligibleForAdr010Go: true,
  spikeBlockingEvidence: Object.freeze([]),
  externalEvidenceDemonstrated: Object.freeze([
    "human write-frontier ACCEPT by Emmanuel on 2026-08-29 (gate 4)",
    "complete five-migration application from a second fresh remote project/CI (gate 7)",
  ]),
  operationalEvidencePending: Object.freeze([
    "physical disaster recovery with production RPO/RTO",
  ]),
});

/**
 * Explicit remote runner. It creates disposable real Auth users, executes the
 * common gates and cleans them up. Gates 4 and 7 are recorded as separately
 * demonstrated external evidence, so the spike is eligible for ADR scoring.
 * Physical disaster recovery remains separate operational production evidence.
 */
const config = requireSupabaseGateIntegrationOptIn(process.env);
const adapter = new SupabaseNestAdr010Adapter(config);
try {
  // The destructive confirmation belongs to config; start from a known clean
  // option-B business state so fixed idempotency keys cannot reuse stale rows.
  await adapter.migrateFromEmpty();
  await adapter.resetToEmpty();
  const report = await runCommonGates(adapter, remoteFixtures);
  const refreshTokenEvidence = await verifyOptionBGuards(adapter);
  await runOptionBFinancialGates(adapter, remoteFixtures);
  console.log(JSON.stringify({
    option: adapter.option,
    projectRef: config.confirmedIsolatedProjectRef,
    gatesExecuted: true,
    report,
    refreshTokenEvidence,
    verifiedAgainstRemoteSupabase: ["auth-principal", "refresh-token-rotation-revocation", "isolation", "transaction", "idempotency", "idempotency-payload-binding", "cash-payment-idempotency", "cash-refund-compensation", "cash-ledger-audit", "kds-cursor-recovery", "scope-revocation", "migration-preservation", "logical-backup-restore", "restore-empty-target-guard", "client-secret-surface"],
    notDemonstrated: ["physical disaster restore"],
    goEligibility: adr010GoEligibility,
    eligibleForAdr010Go: adr010GoEligibility.eligibleForAdr010Go,
  }));
} finally {
  await adapter.close();
}

async function verifyOptionBGuards(adapter: SupabaseNestAdr010Adapter): Promise<RefreshTokenRotationEvidence> {
  const first = await adapter.issueSession("ignored-b-guard-actor-a", remoteFixtures.primaryScope);
  const second = await adapter.issueSession("ignored-b-guard-actor-b", remoteFixtures.primaryScope);
  const input = {
    idempotencyKey: "option-b-payload-binding",
    scope: remoteFixtures.primaryScope,
    sessionId: first.id,
    lines: [{ menuItemId: "menu-coffee", quantity: 1, snapshot: { name: "Coffee", unitAmountMinor: 3500, currency: "MXN" } }],
  } as const;
  await adapter.createOrder(input);
  await expectRemoteReject(adapter.createOrder({
    ...input,
    lines: [{ menuItemId: "menu-coffee", quantity: 2, snapshot: { name: "Coffee", unitAmountMinor: 3500, currency: "MXN" } }],
  }), "ADR010_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
  await expectRemoteReject(adapter.createOrder({ ...input, sessionId: second.id }), "ADR010_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");

  const backup = await adapter.backup();
  await expectRemoteReject(adapter.restore(backup), "ADR010_B_RESTORE_TARGET_NOT_EMPTY");

  const refreshSession = await adapter.issueSession("ignored-b-refresh-actor", remoteFixtures.primaryScope);
  return adapter.proveRefreshTokenRotation(refreshSession.id);
}

async function expectRemoteReject(operation: Promise<unknown>, code: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== code) throw new Error(`Expected remote rejection ${code}, received ${message}`);
    return;
  }
  throw new Error(`Expected remote rejection ${code}`);
}
