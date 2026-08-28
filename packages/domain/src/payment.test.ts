import assert from "node:assert/strict";
import test from "node:test";

import {
  createOrReplayPayment,
  createPayment,
  DuplicateRefundIdError,
  InvalidPaymentFieldError,
  InvalidPaymentMethodError,
  InvalidPaymentTransitionError,
  Money,
  PaymentAuditEvidenceRequiredError,
  PaymentAmountMustBePositiveError,
  PaymentAuthorizationRequiredError,
  PaymentIdempotencyConflictError,
  PaymentNotCapturedError,
  PaymentTransitionIdempotencyConflictError,
  RefundExceedsRemainingAmountError,
  RefundIdempotencyConflictError,
  RefundPaymentMismatchError,
  refundableAmount,
  refundPayment,
  transitionPayment,
} from "./index.js";
import type { CreatePaymentInput, CreateRefundInput, Payment, PaymentAuditEvidence, Refund } from "./index.js";

test("Payment is immutable, tenant-scoped, and never retains PAN or CVV", () => {
  const input = paymentInput() as CreatePaymentInput & { pan: string; cvv: string };
  input.pan = "4111111111111111";
  input.cvv = "123";
  const { payment, evidence } = createPayment(input);

  assert.equal(payment.state, "initiated");
  assert.equal(payment.restaurantId, "restaurant-1");
  assert.equal(payment.branchId, "branch-1");
  assert.equal(payment.eventId, "payment-create-event-1");
  assert.equal(payment.orderId, "order-1");
  assert.equal(Object.isFrozen(payment), true);
  assert.equal(Object.isFrozen(payment.transitions), true);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal("pan" in payment, false);
  assert.equal("cvv" in payment, false);
});

test("Payment validates positive money and explicit non-sensitive methods", () => {
  assert.throws(() => createPayment(paymentInput({ amount: new Money(0, "MXN") })), PaymentAmountMustBePositiveError);
  assert.throws(() => createPayment(paymentInput({ amount: new Money(-1, "MXN") })), PaymentAmountMustBePositiveError);
  assert.throws(() => createPayment(paymentInput({ method: "card" as never })), InvalidPaymentMethodError);
  assert.throws(() => createPayment(paymentInput({ idempotencyKey: "   " })), InvalidPaymentFieldError);
});

test("Payment state machine allows only declared forward transitions", () => {
  const initiated = createPayment(paymentInput()).payment;
  const authorized = transition(initiated, "authorized", evidence()).payment;
  const captured = transition(authorized, "captured", evidence()).payment;
  const failed = transition(createPayment(paymentInput()).payment, "failed", evidence({ reason: "Declined" })).payment;
  const voided = transition(createPayment(paymentInput()).payment, "voided", supervisorEvidence()).payment;

  assert.equal(authorized.state, "authorized");
  assert.equal(captured.state, "captured");
  assert.equal(failed.state, "failed");
  assert.equal(voided.state, "voided");
  assert.equal(initiated.state, "initiated");
  assert.throws(() => transition(initiated, "captured", evidence()), InvalidPaymentTransitionError);
  assert.throws(() => transition(authorized, "initiated", evidence()), InvalidPaymentTransitionError);
  assert.throws(() => transition(captured, "authorized", evidence()), InvalidPaymentTransitionError);
  assert.throws(() => transition(captured, "refunded", supervisorEvidence()), InvalidPaymentTransitionError);
  assert.throws(() => transition(createPayment(paymentInput()).payment, "voided", evidence({ reason: "Customer left" })), PaymentAuthorizationRequiredError);
});

test("Payment transitions replay the same event and reject divergent event/key reuse", () => {
  const initiated = createPayment(paymentInput()).payment;
  const input = { eventId: "authorization-event", idempotencyKey: "authorization-key", to: "authorized" as const, evidence: evidence() };
  const created = transitionPayment(initiated, input);
  const replayed = transitionPayment(created.payment, input);

  assert.equal(created.outcome, "created");
  assert.equal(replayed.outcome, "replayed");
  assert.equal(replayed.payment.transitions.length, 2);
  assert.throws(
    () => transitionPayment(created.payment, { ...input, to: "failed", evidence: evidence({ reason: "Different payload" }) }),
    PaymentTransitionIdempotencyConflictError,
  );
});

test("Payment retry replays the original attempt and rejects divergent reuse of its key", () => {
  const input = paymentInput();
  const created = createOrReplayPayment(input);
  const replayed = createOrReplayPayment(input, created.payment);

  assert.equal(created.outcome, "created");
  assert.equal(replayed.outcome, "replayed");
  assert.equal(replayed.payment, created.payment);
  assert.throws(() => createOrReplayPayment(paymentInput({ amount: new Money(401, "MXN") }), created.payment), PaymentIdempotencyConflictError);
  assert.throws(() => createOrReplayPayment(paymentInput({ branchId: "branch-2", evidence: evidence({ branchId: "branch-2" }) }), created.payment), PaymentIdempotencyConflictError);
  assert.throws(() => createOrReplayPayment(paymentInput({ eventId: "different-create-event" }), created.payment), PaymentIdempotencyConflictError);
});

test("Payment creation, transitions, and refunds require evidence from the payment branch", () => {
  assert.throws(
    () => createPayment(paymentInput({ evidence: evidence({ branchId: "branch-2" }) })),
    PaymentAuditEvidenceRequiredError,
  );

  const initiated = createPayment(paymentInput()).payment;
  assert.throws(
    () => transitionPayment(initiated, {
      eventId: "wrong-branch-transition",
      idempotencyKey: "wrong-branch-transition-key",
      to: "authorized",
      evidence: evidence({ branchId: "branch-2" }),
    }),
    PaymentAuditEvidenceRequiredError,
  );

  assert.throws(
    () => refundPayment(capturedPayment(), refundInput({ evidence: supervisorEvidence({ branchId: "branch-2" }) })),
    PaymentAuditEvidenceRequiredError,
  );
});

test("Payment replay validates new input and rejects malformed prior aggregates without evidence fallback", () => {
  const input = paymentInput();
  const prior = createPayment(input).payment;

  assert.throws(
    () => createOrReplayPayment(input, { ...prior }),
    InvalidPaymentFieldError,
  );
  assert.throws(
    () => createOrReplayPayment(input, rehydratedPayment(prior, { transitions: Object.freeze([]) })),
    InvalidPaymentFieldError,
  );
  assert.throws(
    () => createOrReplayPayment(null as never, prior),
    InvalidPaymentFieldError,
  );
  assert.throws(
    () => createOrReplayPayment(paymentInput({ amount: Object.freeze({ amountMinor: 500, currency: "MXN" }) as Money }), prior),
    InvalidPaymentFieldError,
  );
});

test("Refunds are immutable, scoped to a captured payment, and support partial then total compensation", () => {
  const captured = capturedPayment(new Money(1_000, "MXN"));
  const first = refundPayment(captured, refundInput({ amount: new Money(400, "MXN") }));
  const second = refundPayment(first.payment, refundInput({ refundId: "refund-2", eventId: "refund-event-2", idempotencyKey: "refund-key-2", amount: new Money(600, "MXN") }));

  assert.equal(first.payment.state, "captured");
  assert.equal(first.payment.refunds.length, 1);
  assert.equal(second.payment.refunds.length, 2);
  assert.equal(second.payment.refunds[0]?.amount.amountMinor, 400);
  assert.equal(second.payment.refunds[1]?.amount.amountMinor, 600);
  assert.equal(second.payment.state, "refunded");
  assert.equal(Object.isFrozen(second.refund), true);
  assert.equal(Object.isFrozen(second.refund.evidence.authorization), true);
  assert.equal(captured.refunds.length, 0);
  assert.throws(() => refundPayment(second.payment, refundInput({ refundId: "refund-3", eventId: "refund-event-3", idempotencyKey: "refund-key-3", amount: new Money(1, "MXN") })), RefundExceedsRemainingAmountError);
});

test("Refund rejects uncaptured, cross-scope, currency, duplicate-id, and idempotency-conflict attempts", () => {
  assert.throws(() => refundPayment(createPayment(paymentInput()).payment, refundInput()), PaymentNotCapturedError);
  const captured = capturedPayment();
  assert.throws(() => refundPayment(captured, refundInput({ restaurantId: "restaurant-2" })), RefundPaymentMismatchError);
  assert.throws(() => refundPayment(captured, refundInput({ amount: new Money(100, "USD") })), RefundPaymentMismatchError);

  const created = refundPayment(captured, refundInput());
  const replayed = refundPayment(created.payment, refundInput());
  assert.equal(replayed.outcome, "replayed");
  assert.equal(replayed.payment, created.payment);
  assert.throws(() => refundPayment(created.payment, refundInput({ amount: new Money(101, "MXN") })), RefundIdempotencyConflictError);
  assert.throws(() => refundPayment(created.payment, refundInput({ eventId: "refund-event-2" })), RefundIdempotencyConflictError);
  assert.throws(() => refundPayment(created.payment, refundInput({ idempotencyKey: "refund-key-2" })), RefundIdempotencyConflictError);
  assert.throws(() => refundPayment(created.payment, refundInput({ eventId: "payment-create-event-1", idempotencyKey: "refund-key-2" })), RefundIdempotencyConflictError);
  assert.throws(
    () => refundPayment(created.payment, refundInput({ branchId: "branch-2", evidence: supervisorEvidence({ branchId: "branch-2" }) })),
    RefundIdempotencyConflictError,
  );
  assert.throws(
    () => refundPayment(created.payment, refundInput({ amount: new Money(100, "USD") })),
    RefundIdempotencyConflictError,
  );
  assert.throws(
    () => refundPayment(created.payment, refundInput({ refundId: "refund-1", eventId: "refund-event-2", idempotencyKey: "refund-key-2" })),
    DuplicateRefundIdError,
  );
});

test("rehydrated payments fail closed before transitions or refundable calculations", () => {
  const captured = capturedPayment();
  assert.throws(() => transition({ ...captured }, "authorized", evidence()), InvalidPaymentFieldError);
  assert.throws(() => refundableAmount(null as never), InvalidPaymentFieldError);
  assert.throws(
    () => refundableAmount(rehydratedPayment(captured, {
      amount: Object.freeze({ amountMinor: 500, currency: "MXN" }) as Money,
    })),
    InvalidPaymentFieldError,
  );

  const last = captured.transitions.at(-1);
  assert.ok(last);
  const brokenHistory = Object.freeze([
    ...captured.transitions.slice(0, -1),
    Object.freeze({ ...last, from: "initiated" as const }),
  ]);
  assert.throws(
    () => transition(rehydratedPayment(captured, { transitions: brokenHistory }), "authorized", evidence()),
    InvalidPaymentFieldError,
  );
});

test("rehydrated refund history enforces immutability, scope, uniqueness, totals, and derived state", () => {
  const partial = refundPayment(capturedPayment(), refundInput()).payment;
  const originalRefund = partial.refunds[0];
  assert.ok(originalRefund);
  assert.equal(refundableAmount(partial).amountMinor, 400);

  assert.throws(
    () => refundableAmount(rehydratedPayment(partial, { refunds: [...partial.refunds] })),
    InvalidPaymentFieldError,
  );
  assert.throws(
    () => refundPayment(rehydratedPayment(partial, {
      refunds: Object.freeze([frozenRefund(originalRefund, { branchId: "branch-2" })]),
    }), refundInput({ refundId: "refund-2", idempotencyKey: "refund-key-2" })),
    RefundPaymentMismatchError,
  );
  assert.throws(
    () => refundableAmount(rehydratedPayment(partial, {
      refunds: Object.freeze([originalRefund, frozenRefund(originalRefund, { refundId: "refund-2" })]),
    })),
    RefundIdempotencyConflictError,
  );
  assert.throws(
    () => refundableAmount(rehydratedPayment(partial, {
      refunds: Object.freeze([
        originalRefund,
        frozenRefund(originalRefund, {
          refundId: "refund-2",
          eventId: "refund-event-2",
          idempotencyKey: "refund-key-2",
          amount: new Money(401, "MXN"),
        }),
      ]),
    })),
    RefundExceedsRemainingAmountError,
  );
  assert.throws(
    () => refundableAmount(rehydratedPayment(partial, {
      refunds: Object.freeze([frozenRefund(originalRefund, { eventId: partial.eventId })]),
    })),
    RefundIdempotencyConflictError,
  );
  assert.throws(
    () => refundableAmount(rehydratedPayment(partial, { state: "refunded" })),
    InvalidPaymentFieldError,
  );
  assert.throws(
    () => refundableAmount(rehydratedPayment(partial, {
      refunds: Object.freeze([Object.freeze({ ...originalRefund, evidence: { ...originalRefund.evidence } })]),
    })),
    InvalidPaymentFieldError,
  );
});

test("rehydrated payments reject alternating accessors before refund replay or native TypeError", () => {
  const captured = capturedPayment();
  let reads = 0;
  const poisoned = { ...captured };
  Object.defineProperty(poisoned, "refunds", {
    enumerable: true,
    get: () => ++reads <= 5 ? Object.freeze([]) : null,
  });
  Object.freeze(poisoned);

  assert.throws(() => refundPayment(poisoned as Payment, refundInput()), InvalidPaymentFieldError);
  assert.equal(reads, 0);
});

function capturedPayment(amount = new Money(500, "MXN")) {
  const initiated = createPayment(paymentInput({ amount })).payment;
  return transition(transition(initiated, "authorized", evidence()).payment, "captured", evidence()).payment;
}

let transitionSequence = 0;

function transition(payment: Payment, to: Payment["state"], mutationEvidence: PaymentAuditEvidence) {
  transitionSequence += 1;
  return transitionPayment(payment, {
    eventId: `payment-event-${transitionSequence}`,
    idempotencyKey: `payment-transition-key-${transitionSequence}`,
    to,
    evidence: mutationEvidence,
  });
}

function paymentInput(overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput {
  return {
    paymentId: "payment-1", eventId: "payment-create-event-1", restaurantId: "restaurant-1", branchId: "branch-1", orderId: "order-1",
    amount: new Money(500, "MXN"), method: "card_manual", idempotencyKey: "payment-key-1", evidence: evidence(), ...overrides,
  };
}

function refundInput(overrides: Partial<CreateRefundInput> = {}): CreateRefundInput {
  return {
    refundId: "refund-1", eventId: "refund-event-1", paymentId: "payment-1", restaurantId: "restaurant-1", branchId: "branch-1", orderId: "order-1",
    amount: new Money(100, "MXN"), idempotencyKey: "refund-key-1", evidence: supervisorEvidence(), ...overrides,
  };
}

function evidence(overrides: Partial<PaymentAuditEvidence> = {}): PaymentAuditEvidence {
  return { actorId: "cashier-1", branchId: "branch-1", deviceId: "device-1", occurredAt: "2026-08-27T12:00:00Z", ...overrides };
}

function supervisorEvidence(overrides: Partial<PaymentAuditEvidence> = {}): PaymentAuditEvidence {
  return { ...evidence(), reason: "Customer requested compensation", authorization: { approved: true, actorId: "supervisor-1" }, ...overrides };
}

function rehydratedPayment(payment: Payment, overrides: Partial<Payment>): Payment {
  return Object.freeze({ ...payment, ...overrides });
}

function frozenRefund(refund: Refund, overrides: Partial<Refund>): Refund {
  return Object.freeze({ ...refund, ...overrides });
}
