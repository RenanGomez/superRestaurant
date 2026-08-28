import assert from "node:assert/strict";

import type { SpikeFixtures } from "../../../src/model.js";
import type { SupabaseNestAdr010Adapter } from "./adapter.js";

/**
 * Option-B-specific evidence. It is deliberately separate from common A/C
 * gates: it proves the B financial write frontier without claiming parity for
 * either of the other architecture options.
 */
export async function runOptionBFinancialGates(adapter: SupabaseNestAdr010Adapter, fixtures: SpikeFixtures): Promise<void> {
  const session = await adapter.issueSession("financial-gate", fixtures.primaryScope);
  const supervisorSession = await adapter.issueSession("financial-gate-supervisor", fixtures.primaryScope, "manager");
  const order = await adapter.createOrder({
    sessionId: session.id,
    scope: fixtures.primaryScope,
    idempotencyKey: "financial-order",
    lines: [{ menuItemId: "cash-gate-item", quantity: 1, snapshot: { name: "Cash gate", unitAmountMinor: 3500, currency: "MXN" } }],
  });
  const paymentInput = {
    accessToken: adapter.accessTokenForGate(session.id),
    restaurantId: fixtures.primaryScope.restaurantId,
    branchId: fixtures.primaryScope.branchId,
    orderId: order.id,
    idempotencyKey: "financial-payment",
    amountMinor: 3500,
    currency: "MXN",
    deviceId: "financial-gate-device",
    localSequence: 1,
    occurredAt: "2026-08-28T00:00:00.000Z",
  } as const;
  const beforeCrossRestaurant = {
    primary: await adapter.readFinancialArtifacts(fixtures.primaryScope),
    otherRestaurant: await adapter.readFinancialArtifacts(fixtures.otherRestaurantScope),
  };
  await assert.rejects(
    () => adapter.createCashPayment({ ...paymentInput, restaurantId: fixtures.otherRestaurantScope.restaurantId, branchId: fixtures.otherRestaurantScope.branchId, idempotencyKey: "financial-payment-cross-restaurant" }),
    /ADR010_MEMBERSHIP_NOT_ACTIVE/u,
    "a verified actor cannot write another restaurant",
  );
  assert.deepEqual({
    primary: await adapter.readFinancialArtifacts(fixtures.primaryScope),
    otherRestaurant: await adapter.readFinancialArtifacts(fixtures.otherRestaurantScope),
  }, beforeCrossRestaurant, "cross-restaurant payment rejection must leave both scopes unchanged");
  const payments = await Promise.all(Array.from({ length: 20 }, () => adapter.createCashPayment(paymentInput)));
  assert.equal(new Set(payments.map((payment) => payment.id)).size, 1, "retries must create one cash payment");
  assert.equal(new Set(payments.map((payment) => payment.cashMovementId)).size, 1, "retries must create one cash movement");
  await assert.rejects(() => adapter.createCashPayment({ ...paymentInput, amountMinor: 3501 }), /ADR010_FINANCIAL_IDEMPOTENCY_KEY_REUSED/u);
  await assert.rejects(() => adapter.createCashPayment({ ...paymentInput, localSequence: 3 }), /ADR010_FINANCIAL_IDEMPOTENCY_KEY_REUSED/u);
  const beforePaymentSequenceReuse = await adapter.readFinancialArtifacts(fixtures.primaryScope);
  await assert.rejects(
    () => adapter.createCashPayment({ ...paymentInput, idempotencyKey: "financial-payment-sequence-reused" }),
    /ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED/u,
    "a new payload cannot reuse an actor/device local sequence",
  );
  assert.deepEqual(await adapter.readFinancialArtifacts(fixtures.primaryScope), beforePaymentSequenceReuse, "sequence reuse must roll back its payment row");
  const refundInput = {
    accessToken: paymentInput.accessToken,
    supervisorAccessToken: adapter.accessTokenForGate(supervisorSession.id),
    restaurantId: fixtures.primaryScope.restaurantId,
    branchId: fixtures.primaryScope.branchId,
    orderId: order.id,
    paymentId: payments[0]!.id,
    idempotencyKey: "financial-refund",
    amountMinor: 3500,
    currency: "MXN",
    deviceId: "financial-gate-device",
    localSequence: 2,
    occurredAt: "2026-08-28T00:01:00.000Z",
    reason: "gate refund compensation",
  } as const;
  const beforeInvalidSupervisor = {
    primary: await adapter.readFinancialArtifacts(fixtures.primaryScope),
    otherRestaurant: await adapter.readFinancialArtifacts(fixtures.otherRestaurantScope),
  };
  await assert.rejects(
    () => adapter.refundCashPayment({ ...refundInput, supervisorAccessToken: paymentInput.accessToken, idempotencyKey: "financial-refund-cashier-supervisor" }),
    /ADR010_REFUND_AUTHORIZATION_NOT_SUPERVISOR/u,
    "a cashier token cannot approve a refund",
  );
  await assert.rejects(
    () => adapter.refundCashPayment({ ...refundInput, supervisorAccessToken: "invalid-supervisor-token", idempotencyKey: "financial-refund-invalid-supervisor" }),
    /SUPABASE_ACCESS_TOKEN_REJECTED/u,
    "an invalid supervisor token cannot approve a refund",
  );
  assert.deepEqual({
    primary: await adapter.readFinancialArtifacts(fixtures.primaryScope),
    otherRestaurant: await adapter.readFinancialArtifacts(fixtures.otherRestaurantScope),
  }, beforeInvalidSupervisor, "invalid supervisor authorization must leave artifacts unchanged");
  const beforeCrossRestaurantRefund = {
    primary: await adapter.readFinancialArtifacts(fixtures.primaryScope),
    otherRestaurant: await adapter.readFinancialArtifacts(fixtures.otherRestaurantScope),
  };
  await assert.rejects(
    () => adapter.refundCashPayment({ ...refundInput, restaurantId: fixtures.otherRestaurantScope.restaurantId, branchId: fixtures.otherRestaurantScope.branchId, idempotencyKey: "financial-refund-cross-restaurant" }),
    /ADR010_MEMBERSHIP_NOT_ACTIVE/u,
    "a verified actor cannot refund in another restaurant",
  );
  assert.deepEqual({
    primary: await adapter.readFinancialArtifacts(fixtures.primaryScope),
    otherRestaurant: await adapter.readFinancialArtifacts(fixtures.otherRestaurantScope),
  }, beforeCrossRestaurantRefund, "cross-restaurant refund rejection must leave both scopes unchanged");
  await assert.rejects(
    () => adapter.refundCashPayment({ ...refundInput, idempotencyKey: "financial-refund-sequence-reused", localSequence: 1 }),
    /ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED/u,
    "a new refund payload cannot reuse an actor/device local sequence",
  );
  const refunds = await Promise.all(Array.from({ length: 20 }, () => adapter.refundCashPayment(refundInput)));
  assert.equal(new Set(refunds.map((refund) => refund.id)).size, 1, "retries must create one refund");
  assert.equal(new Set(refunds.map((refund) => refund.cashMovementId)).size, 1, "retries must create one refund cash movement");
  const replayedPayment = await adapter.createCashPayment(paymentInput);
  assert.equal(replayedPayment.cashMovementId, payments[0]!.cashMovementId, "payment replay after refund must return the capture movement");
  await assert.rejects(
    () => adapter.createCashPayment({ ...paymentInput, idempotencyKey: "financial-payment-sequence-gap", localSequence: 4 }),
    /ADR010_FINANCIAL_LOCAL_SEQUENCE_GAP/u,
    "a device sequence gap must be rejected explicitly",
  );
  await assert.rejects(
    () => adapter.createCashPayment({ ...paymentInput, idempotencyKey: "financial-payment-sequence-regression", localSequence: 1 }),
    /ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED/u,
    "a device sequence regression must be rejected explicitly",
  );
  await assert.rejects(
    () => adapter.createCashPayment({ ...paymentInput, accessToken: adapter.accessTokenForGate(supervisorSession.id), idempotencyKey: "financial-payment-actor-reuse", localSequence: 1 }),
    /ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED/u,
    "the cursor must not restart for another actor",
  );
  const otherBranchSession = await adapter.issueSession("financial-gate-other-branch", fixtures.otherBranchScope);
  const otherBranchOrder = await adapter.createOrder({
    sessionId: otherBranchSession.id,
    scope: fixtures.otherBranchScope,
    idempotencyKey: "financial-order-other-branch",
    lines: [{ menuItemId: "cash-gate-other-branch-item", quantity: 1, snapshot: { name: "Other branch cash gate", unitAmountMinor: 100, currency: "MXN" } }],
  });
  await assert.rejects(
    () => adapter.createCashPayment({
      ...paymentInput,
      accessToken: adapter.accessTokenForGate(otherBranchSession.id),
      restaurantId: fixtures.otherBranchScope.restaurantId,
      branchId: fixtures.otherBranchScope.branchId,
      orderId: otherBranchOrder.id,
      idempotencyKey: "financial-payment-scope-reuse",
      localSequence: 1,
    }),
    /ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED/u,
    "the cursor must not restart in another scope",
  );
  await assert.rejects(() => adapter.refundCashPayment({ ...refundInput, idempotencyKey: "financial-refund-over", amountMinor: 1 }), /ADR010_REFUND_EXCEEDS_CAPTURED_AMOUNT/u);

  const artifacts = await adapter.readFinancialArtifacts(fixtures.primaryScope);
  assert.deepEqual(artifacts, { payments: 1, refunds: 1, cashMovements: 2, audits: 2 }, "financial records and audit must be atomic and complete");
  const financialSnapshot = await adapter.readFinancialArtifactSnapshot(fixtures.primaryScope);
  const refundAudit = financialSnapshot.audits.find((audit) => audit.action === "CASH_PAYMENT_REFUNDED");
  assert.equal(financialSnapshot.payments[0]?.local_sequence, "1", "payment local sequence must be persisted as the PostgreSQL bigint text representation");
  assert.equal(financialSnapshot.refunds[0]?.local_sequence, "2", "refund local sequence must be persisted as the PostgreSQL bigint text representation");
  assert.equal(financialSnapshot.refunds[0]?.authorization_approved, true, "refund approval must be persisted");
  assert.equal(financialSnapshot.refunds[0]?.authorization_actor_id, supervisorSession.actorId, "refund approval actor must come from the supervisor token");
  assert.equal(refundAudit?.authorization_approved, true, "refund approval must be audited");
  assert.equal(refundAudit?.authorization_actor_id, supervisorSession.actorId, "audited approval actor must come from the supervisor token");
  const backup = await adapter.backup();
  await adapter.resetToEmpty();
  await adapter.restore(backup);
  assert.deepEqual(await adapter.readFinancialArtifactSnapshot(fixtures.primaryScope), financialSnapshot, "backup/restore must retain complete financial records");

  const beforeRevokedFinancialWrites = await adapter.readFinancialArtifacts(fixtures.primaryScope);
  await adapter.revokeSession(session.id);
  await assert.rejects(
    () => adapter.createCashPayment({ ...paymentInput, idempotencyKey: "financial-payment-revoked" }),
    /SUPABASE_ACCESS_TOKEN_REJECTED|ADR010_MEMBERSHIP_NOT_ACTIVE/u,
    "a revoked session cannot create a payment",
  );
  await assert.rejects(
    () => adapter.refundCashPayment({ ...refundInput, idempotencyKey: "financial-refund-revoked" }),
    /SUPABASE_ACCESS_TOKEN_REJECTED|ADR010_MEMBERSHIP_NOT_ACTIVE/u,
    "a revoked session cannot create a refund",
  );
  assert.deepEqual(await adapter.readFinancialArtifacts(fixtures.primaryScope), beforeRevokedFinancialWrites, "revoked financial writes must leave artifacts unchanged");
}
