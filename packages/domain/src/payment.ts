import { Money } from "./money.js";
import {
  DuplicateRefundIdError,
  InvalidPaymentFieldError,
  InvalidPaymentMethodError,
  InvalidPaymentTransitionError,
  PaymentAmountMustBePositiveError,
  PaymentAuditEvidenceRequiredError,
  PaymentAuthorizationRequiredError,
  PaymentIdempotencyConflictError,
  PaymentNotCapturedError,
  PaymentTransitionIdempotencyConflictError,
  RefundExceedsRemainingAmountError,
  RefundIdempotencyConflictError,
  RefundPaymentMismatchError,
} from "./errors.js";

/** States are provider-neutral; provider adapters map their own details at the boundary. */
export type PaymentState = "initiated" | "authorized" | "captured" | "failed" | "voided" | "refunded";

/** Intentionally contains no card number, CVV, token, or provider secret. */
export type PaymentMethod = "cash" | "card_manual" | "card_terminal" | "transfer" | "other";

/** Snapshot of an externally confirmed manual-card payment; never contains cardholder data. */
export interface CardManualEvidence {
  readonly externalConfirmed: true;
  readonly provider: string;
  readonly terminalId: string;
  readonly reference?: string;
}

export interface PaymentAuthorization {
  readonly approved: true;
  readonly actorId: string;
}

/** Evidence retained with every sensitive financial mutation. */
export interface PaymentAuditEvidence {
  readonly actorId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly reason?: string;
  readonly authorization?: PaymentAuthorization;
}

export interface PaymentTransition {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly from: PaymentState | null;
  readonly to: PaymentState;
  readonly evidence: PaymentAuditEvidence;
}

export interface Payment {
  readonly paymentId: string;
  /** Immutable event that initiated this logical payment attempt. */
  readonly eventId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly cardManualEvidence?: CardManualEvidence;
  readonly idempotencyKey: string;
  readonly state: PaymentState;
  readonly transitions: readonly PaymentTransition[];
  readonly refunds: readonly Refund[];
}

export interface Refund {
  readonly refundId: string;
  /** Immutable event that created this compensating refund. */
  readonly eventId: string;
  readonly paymentId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly evidence: PaymentAuditEvidence;
}

export interface CreatePaymentInput {
  readonly paymentId: string;
  readonly eventId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly cardManualEvidence?: CardManualEvidence;
  readonly idempotencyKey: string;
  readonly evidence: PaymentAuditEvidence;
}

export interface CreateRefundInput {
  readonly refundId: string;
  readonly eventId: string;
  readonly paymentId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly evidence: PaymentAuditEvidence;
}

export interface TransitionPaymentInput {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly to: PaymentState;
  readonly evidence: PaymentAuditEvidence;
}

export interface PaymentMutation {
  readonly payment: Payment;
  readonly evidence: PaymentAuditEvidence;
}

export interface PaymentIdempotencyResult extends PaymentMutation {
  readonly outcome: "created" | "replayed";
}

export interface RefundMutation extends PaymentMutation {
  readonly refund: Refund;
  readonly outcome: "created" | "replayed";
}

export interface PaymentTransitionMutation extends PaymentMutation {
  readonly outcome: "created" | "replayed";
}

const methods: ReadonlySet<string> = new Set(["cash", "card_manual", "card_terminal", "transfer", "other"]);
const states: ReadonlySet<string> = new Set(["initiated", "authorized", "captured", "failed", "voided", "refunded"]);

const transitions: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  initiated: ["authorized", "failed", "voided"],
  authorized: ["captured", "failed", "voided"],
  captured: [],
  failed: [],
  voided: [],
  refunded: [],
};

/** Creates an immutable initiated payment and its immutable initiation evidence. */
export function createPayment(input: CreatePaymentInput): PaymentMutation {
  input = snapshotCreatePaymentInput(input);
  assertPaymentInput(input);
  const evidence = freezeEvidence(input.evidence);
  const payment = freezePayment({
    paymentId: input.paymentId,
    eventId: input.eventId,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    orderId: input.orderId,
    amount: input.amount,
    method: input.method,
    ...(input.cardManualEvidence === undefined ? {} : { cardManualEvidence: input.cardManualEvidence }),
    idempotencyKey: input.idempotencyKey,
    state: "initiated",
    transitions: [Object.freeze({ eventId: input.eventId, idempotencyKey: input.idempotencyKey, from: null, to: "initiated" as const, evidence })],
    refunds: [],
  });

  return Object.freeze({ payment, evidence });
}

/**
 * Resolves a retry after the caller has found an earlier attempt by idempotency
 * key. This module deliberately performs no lookup or persistence itself.
 */
export function createOrReplayPayment(
  input: CreatePaymentInput,
  priorAttempt?: Payment,
): PaymentIdempotencyResult {
  input = snapshotCreatePaymentInput(input);
  assertPaymentInput(input);
  if (priorAttempt === undefined) {
    const created = createPayment(input);
    return Object.freeze({ ...created, outcome: "created" as const });
  }

  const stablePriorAttempt = snapshotPayment(priorAttempt);
  assertPaymentIntegrity(stablePriorAttempt);
  assertSamePaymentAttempt(stablePriorAttempt, input);
  const initiationTransition = stablePriorAttempt.transitions[0];
  if (initiationTransition === undefined) {
    throw new InvalidPaymentFieldError("payment.transitions");
  }
  return Object.freeze({
    payment: stablePriorAttempt,
    evidence: initiationTransition.evidence,
    outcome: "replayed" as const,
  });
}

/** Returns a new payment; the original payment and its history remain unchanged. */
export function transitionPayment(
  payment: Payment,
  input: TransitionPaymentInput,
): PaymentTransitionMutation {
  payment = snapshotPayment(payment);
  input = snapshotTransitionPaymentInput(input);
  assertPaymentIntegrity(payment);
  const existingByEvent = payment.transitions.find((transition) => transition.eventId === input.eventId);
  const existingByKey = payment.transitions.find((transition) => transition.idempotencyKey === input.idempotencyKey);
  const existing = existingByEvent ?? existingByKey;
  if (existing !== undefined) {
    if (!sameTransitionAttempt(existing, input)) {
      throw new PaymentTransitionIdempotencyConflictError(input.idempotencyKey);
    }
    return Object.freeze({ payment, evidence: existing.evidence, outcome: "replayed" as const });
  }
  if (!transitions[payment.state].includes(input.to)) {
    throw new InvalidPaymentTransitionError(payment.state, input.to);
  }

  const frozenEvidence = assertTransitionEvidence(input.to, input.evidence, payment.branchId);
  const next = freezePayment({
    ...payment,
    state: input.to,
    transitions: [...payment.transitions, Object.freeze({ eventId: input.eventId, idempotencyKey: input.idempotencyKey, from: payment.state, to: input.to, evidence: frozenEvidence })],
  });

  return Object.freeze({ payment: next, evidence: frozenEvidence, outcome: "created" as const });
}

/**
 * Applies one immutable compensating refund. A payment remains `captured` while
 * it has a refundable balance and becomes `refunded` only after the captured
 * amount is exhausted; every refund carries its own immutable audit evidence.
 */
export function refundPayment(payment: Payment, input: CreateRefundInput): RefundMutation {
  payment = snapshotPayment(payment);
  input = snapshotCreateRefundInput(input);
  assertPaymentIntegrity(payment);
  assertRefundInput(input);

  const existingByEvent = payment.refunds.find((refund) => refund.eventId === input.eventId);
  const existingByKey = payment.refunds.find((refund) => refund.idempotencyKey === input.idempotencyKey);
  const existing = existingByEvent ?? existingByKey;
  if (existing !== undefined) {
    if (!sameRefundAttempt(existing, input)) {
      throw new RefundIdempotencyConflictError(input.idempotencyKey);
    }
    return Object.freeze({ payment, refund: existing, evidence: existing.evidence, outcome: "replayed" as const });
  }

  assertRefundBelongsToPayment(payment, input);

  if (payment.transitions.some((transition) => transition.eventId === input.eventId || transition.idempotencyKey === input.idempotencyKey)) {
    throw new RefundIdempotencyConflictError(input.idempotencyKey);
  }

  if (payment.refunds.some((refund) => refund.refundId === input.refundId)) {
    throw new DuplicateRefundIdError(input.refundId);
  }
  if (payment.state !== "captured" && payment.state !== "refunded") {
    throw new PaymentNotCapturedError(payment.state);
  }
  const remaining = calculateRefundableAmount(payment);
  if (input.amount.compare(remaining) > 0) {
    throw new RefundExceedsRemainingAmountError();
  }

  const evidence = assertRefundEvidence(input.evidence, payment.branchId);
  const refund = freezeRefund({
    refundId: input.refundId,
    eventId: input.eventId,
    paymentId: input.paymentId,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    orderId: input.orderId,
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    evidence,
  });
  const nextState = input.amount.compare(remaining) === 0 ? "refunded" : "captured";
  const next = freezePayment({ ...payment, state: nextState, refunds: [...payment.refunds, refund] });

  return Object.freeze({ payment: next, refund, evidence, outcome: "created" as const });
}

export function refundableAmount(payment: Payment): Money {
  payment = snapshotPayment(payment);
  assertPaymentIntegrity(payment);
  return calculateRefundableAmount(payment);
}

function assertPaymentIntegrity(payment: Payment): void {
  if (payment === null || typeof payment !== "object" || !Object.isFrozen(payment)) {
    throw new InvalidPaymentFieldError("payment");
  }
  for (const [field, value] of Object.entries({
    paymentId: payment.paymentId,
    eventId: payment.eventId,
    restaurantId: payment.restaurantId,
    branchId: payment.branchId,
    orderId: payment.orderId,
    idempotencyKey: payment.idempotencyKey,
  })) {
    assertText(`payment.${field}`, value);
  }
  assertPositiveAmount(payment.amount, "payment");
  if (!methods.has(payment.method)) {
    throw new InvalidPaymentMethodError(payment.method);
  }
  assertCardManualEvidence(payment.method, payment.cardManualEvidence, "payment.cardManualEvidence", true);
  if (!states.has(payment.state)) {
    throw new InvalidPaymentFieldError("payment.state");
  }
  if (!Array.isArray(payment.transitions) || !Object.isFrozen(payment.transitions) || payment.transitions.length === 0) {
    throw new InvalidPaymentFieldError("payment.transitions");
  }

  let previousState: PaymentState | null = null;
  const transitionEventIds = new Set<string>();
  const transitionIdempotencyKeys = new Set<string>();
  for (const [index, transition] of payment.transitions.entries()) {
    if (!isFrozenPlainDataObject(transition) ||
      !states.has(transition.to) || (transition.from !== null && !states.has(transition.from))) {
      throw new InvalidPaymentFieldError(`payment.transitions[${index}]`);
    }
    assertText(`payment.transitions[${index}].eventId`, transition.eventId);
    assertText(`payment.transitions[${index}].idempotencyKey`, transition.idempotencyKey);
    if (transitionEventIds.has(transition.eventId) || transitionIdempotencyKeys.has(transition.idempotencyKey)) {
      throw new PaymentTransitionIdempotencyConflictError(transition.idempotencyKey);
    }
    transitionEventIds.add(transition.eventId);
    transitionIdempotencyKeys.add(transition.idempotencyKey);
    if (transition.from !== previousState || (index === 0 && transition.to !== "initiated") ||
      (index > 0 && (previousState === null || !transitions[previousState].includes(transition.to)))) {
      throw new InvalidPaymentFieldError("payment.transitions");
    }
    assertFrozenEvidence(transition.evidence, `payment.transitions[${index}].evidence`, payment.branchId);
    if (index === 0 && (transition.eventId !== payment.eventId || transition.idempotencyKey !== payment.idempotencyKey)) {
      throw new InvalidPaymentFieldError("payment.transitions");
    }
    if (transition.to === "failed" || transition.to === "voided") {
      assertReason(transition.evidence);
    }
    if (transition.to === "voided") {
      assertAuthorization(transition.evidence, "void");
    }
    previousState = transition.to;
  }

  if (!Array.isArray(payment.refunds) || !Object.isFrozen(payment.refunds)) {
    throw new InvalidPaymentFieldError("payment.refunds");
  }
  const refundIds = new Set<string>();
  const refundEventIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  let refundedMinor = 0n;
  for (const [index, refund] of payment.refunds.entries()) {
    if (!isFrozenPlainDataObject(refund)) {
      throw new InvalidPaymentFieldError(`payment.refunds[${index}]`);
    }
    for (const [field, value] of Object.entries({
      refundId: refund.refundId,
      eventId: refund.eventId,
      paymentId: refund.paymentId,
      restaurantId: refund.restaurantId,
      branchId: refund.branchId,
      orderId: refund.orderId,
      idempotencyKey: refund.idempotencyKey,
    })) {
      assertText(`payment.refunds[${index}].${field}`, value);
    }
    assertPositiveAmount(refund.amount, "refund");
    if (refund.paymentId !== payment.paymentId || refund.restaurantId !== payment.restaurantId ||
      refund.branchId !== payment.branchId || refund.orderId !== payment.orderId ||
      refund.amount.currency !== payment.amount.currency) {
      throw new RefundPaymentMismatchError();
    }
    if (refundIds.has(refund.refundId)) {
      throw new DuplicateRefundIdError(refund.refundId);
    }
    refundIds.add(refund.refundId);
    if (
      transitionEventIds.has(refund.eventId) || refundEventIds.has(refund.eventId) ||
      transitionIdempotencyKeys.has(refund.idempotencyKey) || idempotencyKeys.has(refund.idempotencyKey)
    ) {
      throw new RefundIdempotencyConflictError(refund.idempotencyKey);
    }
    refundEventIds.add(refund.eventId);
    idempotencyKeys.add(refund.idempotencyKey);
    assertFrozenEvidence(refund.evidence, `payment.refunds[${index}].evidence`, payment.branchId);
    assertReason(refund.evidence);
    assertAuthorization(refund.evidence, "refund");
    refundedMinor += BigInt(refund.amount.amountMinor);
    if (refundedMinor > BigInt(payment.amount.amountMinor)) {
      throw new RefundExceedsRemainingAmountError();
    }
  }

  const expectedState = payment.refunds.length === 0
    ? previousState
    : refundedMinor === BigInt(payment.amount.amountMinor) ? "refunded" : "captured";
  if ((payment.refunds.length > 0 && previousState !== "captured") || payment.state !== expectedState) {
    throw new InvalidPaymentFieldError("payment.state");
  }
}

function calculateRefundableAmount(payment: Payment): Money {
  const refundedMinor = payment.refunds.reduce((total, refund) => total + BigInt(refund.amount.amountMinor), 0n);
  return new Money(payment.amount.amountMinor - Number(refundedMinor), payment.amount.currency);
}

function assertPaymentInput(input: CreatePaymentInput): void {
  if (input === null || typeof input !== "object") {
    throw new InvalidPaymentFieldError("payment");
  }
  for (const [field, value] of Object.entries({
    paymentId: input.paymentId,
    eventId: input.eventId,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    orderId: input.orderId,
    idempotencyKey: input.idempotencyKey,
  })) {
    assertText(field, value);
  }
  assertPositiveAmount(input.amount, "payment");
  if (!methods.has(input.method)) {
    throw new InvalidPaymentMethodError(input.method);
  }
  assertCardManualEvidence(input.method, input.cardManualEvidence, "cardManualEvidence", true);
  assertEvidence(input.evidence, input.branchId);
}

function assertRefundInput(input: CreateRefundInput): void {
  for (const [field, value] of Object.entries({
    refundId: input.refundId,
    eventId: input.eventId,
    paymentId: input.paymentId,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    orderId: input.orderId,
    idempotencyKey: input.idempotencyKey,
  })) {
    assertText(field, value);
  }
  assertPositiveAmount(input.amount, "refund");
  assertEvidence(input.evidence, input.branchId);
}

function assertTransitionPaymentInput(input: TransitionPaymentInput): void {
  assertText("transition.eventId", input.eventId);
  assertText("transition.idempotencyKey", input.idempotencyKey);
  if (!states.has(input.to)) {
    throw new InvalidPaymentFieldError("transition.to");
  }
  assertEvidence(input.evidence);
}

function assertSamePaymentAttempt(payment: Payment, input: CreatePaymentInput): void {
  if (
    payment.idempotencyKey !== input.idempotencyKey ||
    payment.paymentId !== input.paymentId ||
    payment.eventId !== input.eventId ||
    payment.restaurantId !== input.restaurantId ||
    payment.branchId !== input.branchId ||
    payment.orderId !== input.orderId ||
    !payment.amount.equals(input.amount) ||
    payment.method !== input.method ||
    !sameCardManualEvidence(payment.cardManualEvidence, input.cardManualEvidence) ||
    !sameEvidence(payment.transitions[0]?.evidence, input.evidence)
  ) {
    throw new PaymentIdempotencyConflictError(input.idempotencyKey);
  }
}

function assertRefundBelongsToPayment(payment: Payment, input: CreateRefundInput): void {
  if (
    payment.paymentId !== input.paymentId ||
    payment.restaurantId !== input.restaurantId ||
    payment.branchId !== input.branchId ||
    payment.orderId !== input.orderId ||
    payment.amount.currency !== input.amount.currency
  ) {
    throw new RefundPaymentMismatchError();
  }
}

function sameRefundAttempt(refund: Refund, input: CreateRefundInput): boolean {
  return (
    refund.refundId === input.refundId &&
    refund.eventId === input.eventId &&
    refund.paymentId === input.paymentId &&
    refund.restaurantId === input.restaurantId &&
    refund.branchId === input.branchId &&
    refund.orderId === input.orderId &&
    refund.amount.equals(input.amount) &&
    refund.idempotencyKey === input.idempotencyKey &&
    sameEvidence(refund.evidence, input.evidence)
  );
}

function sameTransitionAttempt(transition: PaymentTransition, input: TransitionPaymentInput): boolean {
  return transition.eventId === input.eventId && transition.idempotencyKey === input.idempotencyKey &&
    transition.to === input.to && sameEvidence(transition.evidence, input.evidence);
}

function assertTransitionEvidence(to: PaymentState, evidence: PaymentAuditEvidence, expectedBranchId: string): PaymentAuditEvidence {
  assertEvidence(evidence, expectedBranchId);
  if (to === "failed" || to === "voided") {
    assertReason(evidence);
  }
  if (to === "voided") {
    assertAuthorization(evidence, "void");
  }
  return freezeEvidence(evidence);
}

function assertRefundEvidence(evidence: PaymentAuditEvidence, expectedBranchId: string): PaymentAuditEvidence {
  assertEvidence(evidence, expectedBranchId);
  assertReason(evidence);
  assertAuthorization(evidence, "refund");
  return freezeEvidence(evidence);
}

function assertEvidence(evidence: PaymentAuditEvidence, expectedBranchId?: string): void {
  if (evidence === null || typeof evidence !== "object") {
    throw new PaymentAuditEvidenceRequiredError("evidence");
  }
  assertText("actorId", evidence.actorId, true);
  assertText("branchId", evidence.branchId, true);
  assertText("deviceId", evidence.deviceId, true);
  assertText("occurredAt", evidence.occurredAt, true);
  if (expectedBranchId !== undefined && evidence.branchId !== expectedBranchId) {
    throw new PaymentAuditEvidenceRequiredError("branchId");
  }
  if (evidence.authorization !== undefined &&
    (evidence.authorization === null || typeof evidence.authorization !== "object" ||
      evidence.authorization.approved !== true || !hasText(evidence.authorization.actorId))) {
    throw new InvalidPaymentFieldError("evidence.authorization");
  }
}

function assertFrozenEvidence(evidence: PaymentAuditEvidence, field: string, expectedBranchId?: string): void {
  if (!isFrozenPlainDataObject(evidence) ||
    (evidence.authorization !== undefined && !isFrozenPlainDataObject(evidence.authorization))) {
    throw new InvalidPaymentFieldError(field);
  }
  assertEvidence(evidence, expectedBranchId);
}

function assertReason(evidence: PaymentAuditEvidence): void {
  if (!hasText(evidence.reason)) {
    throw new PaymentAuditEvidenceRequiredError("reason");
  }
}

function assertAuthorization(evidence: PaymentAuditEvidence, action: "void" | "refund"): void {
  if (evidence.authorization?.approved !== true || !hasText(evidence.authorization.actorId)) {
    throw new PaymentAuthorizationRequiredError(action);
  }
}

function assertPositiveAmount(amount: Money, kind: "payment" | "refund"): void {
  if (!(amount instanceof Money) || !isFrozenDataObject(amount, Money.prototype) || !Number.isSafeInteger(amount.amountMinor) ||
    !/^[A-Z]{3}$/u.test(amount.currency)) {
    throw new InvalidPaymentFieldError(`${kind}.amount`);
  }
  if (amount.amountMinor <= 0) {
    throw new PaymentAmountMustBePositiveError(kind);
  }
}

function assertText(field: string, value: string, audit = false): void {
  if (!hasText(value)) {
    if (audit) {
      throw new PaymentAuditEvidenceRequiredError(field);
    }
    throw new InvalidPaymentFieldError(field);
  }
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameEvidence(left: PaymentAuditEvidence | undefined, right: PaymentAuditEvidence): boolean {
  return (
    left !== undefined &&
    left.actorId === right.actorId &&
    left.branchId === right.branchId &&
    left.deviceId === right.deviceId &&
    left.occurredAt === right.occurredAt &&
    left.reason === right.reason &&
    left.authorization?.approved === right.authorization?.approved &&
    left.authorization?.actorId === right.authorization?.actorId
  );
}

function sameCardManualEvidence(left: CardManualEvidence | undefined, right: CardManualEvidence | undefined): boolean {
  return left?.externalConfirmed === right?.externalConfirmed
    && left?.provider === right?.provider
    && left?.terminalId === right?.terminalId
    && left?.reference === right?.reference;
}

function assertCardManualEvidence(
  method: PaymentMethod,
  value: CardManualEvidence | undefined,
  field: string,
  frozen: boolean,
): void {
  if (method !== "card_manual") {
    if (value !== undefined) throw new InvalidPaymentFieldError(field);
    return;
  }
  const record = readPlainDataRecord(value, field, frozen);
  const keys = Reflect.ownKeys(record);
  const allowed = record.reference === undefined
    ? ["externalConfirmed", "provider", "terminalId"]
    : ["externalConfirmed", "provider", "terminalId", "reference"];
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))
    || record.externalConfirmed !== true || !hasText(record.provider as string)
    || !hasText(record.terminalId as string)
    || (record.reference !== undefined && !hasText(record.reference as string))) {
    throw new InvalidPaymentFieldError(field);
  }
}

function freezePayment(payment: Payment): Payment {
  return Object.freeze({
    ...payment,
    ...(payment.cardManualEvidence === undefined
      ? {}
      : { cardManualEvidence: Object.freeze({ ...payment.cardManualEvidence }) }),
    transitions: Object.freeze(payment.transitions.map((transition) => Object.freeze({ ...transition, evidence: freezeEvidence(transition.evidence) }))),
    refunds: Object.freeze(payment.refunds.map(freezeRefund)),
  });
}

function freezeRefund(refund: Refund): Refund {
  return Object.freeze({ ...refund, evidence: freezeEvidence(refund.evidence) });
}

function freezeEvidence(evidence: PaymentAuditEvidence): PaymentAuditEvidence {
  const authorization = evidence.authorization;
  if (authorization === undefined) {
    return Object.freeze({ ...evidence });
  }
  return Object.freeze({ ...evidence, authorization: Object.freeze({ ...authorization }) });
}

function snapshotCreatePaymentInput(input: CreatePaymentInput): CreatePaymentInput {
  const record = readPlainDataRecord(input, "payment");
  return Object.freeze({
    paymentId: record.paymentId as string,
    eventId: record.eventId as string,
    restaurantId: record.restaurantId as string,
    branchId: record.branchId as string,
    orderId: record.orderId as string,
    amount: record.amount as Money,
    method: record.method as PaymentMethod,
    ...(record.cardManualEvidence === undefined
      ? {}
      : { cardManualEvidence: snapshotCardManualEvidence(record.cardManualEvidence, "cardManualEvidence", false) }),
    idempotencyKey: record.idempotencyKey as string,
    evidence: snapshotEvidence(record.evidence, "evidence", false),
  });
}

function snapshotCreateRefundInput(input: CreateRefundInput): CreateRefundInput {
  const record = readPlainDataRecord(input, "refund");
  return Object.freeze({
    refundId: record.refundId as string,
    eventId: record.eventId as string,
    paymentId: record.paymentId as string,
    restaurantId: record.restaurantId as string,
    branchId: record.branchId as string,
    orderId: record.orderId as string,
    amount: record.amount as Money,
    idempotencyKey: record.idempotencyKey as string,
    evidence: snapshotEvidence(record.evidence, "evidence", false),
  });
}

function snapshotTransitionPaymentInput(input: TransitionPaymentInput): TransitionPaymentInput {
  const record = readPlainDataRecord(input, "transition");
  const stable = Object.freeze({
    eventId: record.eventId as string,
    idempotencyKey: record.idempotencyKey as string,
    to: record.to as PaymentState,
    evidence: snapshotEvidence(record.evidence, "evidence", false),
  });
  assertTransitionPaymentInput(stable);
  return stable;
}

function snapshotPayment(payment: Payment): Payment {
  const record = readPlainDataRecord(payment, "payment", true);
  if (record.cardManualEvidence !== undefined) {
    snapshotCardManualEvidence(record.cardManualEvidence, "payment.cardManualEvidence", true);
  }
  const transitionsValue = readFrozenDataArray(record.transitions, "payment.transitions");
  const refundsValue = readFrozenDataArray(record.refunds, "payment.refunds");
  transitionsValue.forEach((transition, index) => { snapshotTransition(transition, index); });
  refundsValue.forEach((refund, index) => { snapshotRefund(refund, index); });
  return payment;
}

function snapshotCardManualEvidence(value: unknown, field: string, frozen: boolean): CardManualEvidence {
  const record = readPlainDataRecord(value, field, frozen);
  assertCardManualEvidence("card_manual", record as unknown as CardManualEvidence, field, frozen);
  const snapshot = Object.freeze({
    externalConfirmed: record.externalConfirmed as true,
    provider: record.provider as string,
    terminalId: record.terminalId as string,
    ...(record.reference === undefined ? {} : { reference: record.reference as string }),
  });
  return snapshot;
}

function snapshotTransition(value: unknown, index: number): PaymentTransition {
  const record = readPlainDataRecord(value, `payment.transitions[${index}]`, true);
  return Object.freeze({
    eventId: record.eventId as string,
    idempotencyKey: record.idempotencyKey as string,
    from: record.from as PaymentState | null,
    to: record.to as PaymentState,
    evidence: snapshotEvidence(record.evidence, `payment.transitions[${index}].evidence`, true),
  });
}

function snapshotRefund(value: unknown, index: number): Refund {
  const record = readPlainDataRecord(value, `payment.refunds[${index}]`, true);
  return Object.freeze({
    refundId: record.refundId as string,
    eventId: record.eventId as string,
    paymentId: record.paymentId as string,
    restaurantId: record.restaurantId as string,
    branchId: record.branchId as string,
    orderId: record.orderId as string,
    amount: record.amount as Money,
    idempotencyKey: record.idempotencyKey as string,
    evidence: snapshotEvidence(record.evidence, `payment.refunds[${index}].evidence`, true),
  });
}

function snapshotEvidence(value: unknown, field: string, frozen: boolean): PaymentAuditEvidence {
  const record = readPlainDataRecord(value, field, frozen);
  const authorization = record.authorization === undefined
    ? undefined
    : Object.freeze({
      approved: readPlainDataRecord(record.authorization, `${field}.authorization`, frozen).approved as true,
      actorId: readPlainDataRecord(record.authorization, `${field}.authorization`, frozen).actorId as string,
    });
  return Object.freeze({
    actorId: record.actorId as string,
    branchId: record.branchId as string,
    deviceId: record.deviceId as string,
    occurredAt: record.occurredAt as string,
    ...(record.reason === undefined ? {} : { reason: record.reason as string }),
    ...(authorization === undefined ? {} : { authorization }),
  });
}

function readPlainDataRecord(value: unknown, field: string, frozen = false): Record<string, unknown> {
  if (!isPlainDataObject(value, frozen)) {
    throw new InvalidPaymentFieldError(field);
  }
  return value as Record<string, unknown>;
}

function readFrozenDataArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || !Object.isFrozen(value) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some((descriptor) => !("value" in descriptor))) {
    throw new InvalidPaymentFieldError(field);
  }
  return value;
}

function isFrozenPlainDataObject(value: unknown): boolean {
  return isPlainDataObject(value, true);
}

function isFrozenDataObject(value: unknown, prototype: object): boolean {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === prototype && Object.isFrozen(value) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => "value" in descriptor);
}

function isPlainDataObject(value: unknown, frozen: boolean): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    (!frozen || Object.isFrozen(value)) && Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => "value" in descriptor);
}
