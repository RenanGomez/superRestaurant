import assert from "node:assert/strict";
import test from "node:test";

import {
  appendCashMovement,
  CashMovementCompensationError,
  CashMovementIdempotencyConflictError,
  CashMovementReasonRequiredError,
  CashMovementReferenceError,
  CashMovementScopeMismatchError,
  CashMovementSequenceError,
  CashRegisterAlreadyClosedError,
  CashRegisterCloseIdempotencyConflictError,
  CashRegisterClosedError,
  CashRegisterCountedBalanceError,
  CashRegisterCurrencyMismatchError,
  CashRegisterVarianceReasonRequiredError,
  closeCashRegister,
  expectedCashBalance,
  InvalidCashMovementTypeError,
  InvalidCashRegisterFieldError,
  Money,
  openCashRegister,
} from "./index.js";
import type {
  AppendCashMovementInput,
  CashAuditEvidence,
  CashMovement,
  CashRegister,
  CloseCashRegisterInput,
  OpenCashRegisterInput,
} from "./index.js";

const CASH_COMPENSATION_PROPERTY_SEED = 0xc45c5eed;

test("opens an immutable, tenant-scoped cash register", () => {
  const mutation = openCashRegister(openInput());
  const register = mutation.register;

  assert.equal(register.status, "open");
  assert.equal(register.restaurantId, "restaurant-1");
  assert.equal(register.branchId, "branch-1");
  assert.equal(register.registerId, "till-1");
  assert.equal(register.shiftId, "shift-1");
  assert.equal(register.cashierId, "cashier-1");
  assert.equal(register.openingFloat.amountMinor, 10_000);
  assert.equal(Object.isFrozen(register), true);
  assert.equal(Object.isFrozen(register.movements), true);
  assert.equal(Object.isFrozen(mutation.evidence), true);
  assert.equal(expectedCashBalance(register).amountMinor, 10_000);
});

test("records cash movement types and derives the expected balance", () => {
  let register = openCashRegister(openInput()).register;
  register = append(register, { type: "cash_sale", direction: "in", source: { type: "payment", paymentId: "payment-1" }, amount: 2_500, localSequence: 1 }).register;
  register = append(register, { type: "cash_refund", direction: "out", source: { type: "refund", refundId: "refund-1", paymentId: "payment-1" }, amount: 400, localSequence: 2 }).register;
  register = append(register, { type: "cash_in", direction: "in", amount: 300, localSequence: 3, reason: "Fondo adicional" }).register;
  register = append(register, { type: "cash_out", direction: "out", amount: 200, localSequence: 4, reason: "Compra de cambio" }).register;

  assert.equal(register.movements.length, 4);
  assert.equal(expectedCashBalance(register).amountMinor, 12_200);
  assert.equal(Object.isFrozen(register.movements[0]), true);
  assert.equal(Object.isFrozen(register.movements[0]?.source), true);
});

test("requires matching scope, currency, references, direction, and reasons", () => {
  const register = openCashRegister(openInput()).register;

  assert.throws(() => append(register, { branchId: "branch-2" }), CashMovementScopeMismatchError);
  assert.throws(() => append(register, { amount: 1, currency: "USD" }), CashRegisterCurrencyMismatchError);
  assert.throws(() => append(register, { type: "cash_sale", direction: "out" }), CashMovementReferenceError);
  assert.throws(() => append(register, { type: "cash_refund", direction: "in", source: { type: "refund", refundId: "r", paymentId: "p" } }), CashMovementReferenceError);
  assert.throws(() => append(register, { type: "cash_in", direction: "in" }), CashMovementReasonRequiredError);
  assert.throws(() => append(register, { type: "cash_out", direction: "out", reason: "x", source: { type: "payment", paymentId: "p" } }), CashMovementReferenceError);
  assert.throws(() => append(register, { type: "card_manual" as never, direction: "in", reason: "x" }), InvalidCashMovementTypeError);
});

test("replays the same movement and rejects divergent idempotency reuse", () => {
  const register = openCashRegister(openInput()).register;
  const created = append(register, { type: "cash_sale", direction: "in", source: { type: "payment", paymentId: "payment-1" }, amount: 500, localSequence: 1 });
  const byKey = append(created.register, movementInput({ type: "cash_sale", direction: "in", source: { type: "payment", paymentId: "payment-1" }, amount: 500, localSequence: 1 }));
  assert.equal(byKey.outcome, "replayed");
  assert.equal(byKey.movement, created.movement);
  assert.equal(byKey.register, created.register);
  assert.throws(() => append(created.register, movementInput({ amount: 501, type: "cash_sale", direction: "in", source: { type: "payment", paymentId: "payment-1" }, localSequence: 1 })), CashMovementIdempotencyConflictError);
});

test("requires the authoritative sequence and allows interleaved devices plus non-cash gaps", () => {
  let register = openCashRegister(openInput()).register;
  assert.throws(() => append(register, movementInput({ localSequence: 2, sequenceContext: { deviceId: "device-1", expectedNextSequence: 1 } })), CashMovementSequenceError);
  register = append(register, movementInput({ localSequence: 1 })).register;
  register = append(register, movementInput({ movementId: "movement-2", eventId: "event-2", idempotencyKey: "key-2", localSequence: 1, evidence: evidence({ deviceId: "device-2" }), sequenceContext: { deviceId: "device-2", expectedNextSequence: 1 } })).register;
  register = append(register, movementInput({ movementId: "movement-3", eventId: "event-3", idempotencyKey: "key-3", localSequence: 3 })).register;
  assert.throws(() => append(register, movementInput({ movementId: "movement-4", eventId: "event-4", idempotencyKey: "key-4", localSequence: 2 })), CashMovementSequenceError);
  assert.equal(register.movements.length, 3);
});

test("requires an authoritative device cursor across cash-register sessions", () => {
  const first = openCashRegister(openInput()).register;
  const firstMovement = append(first, movementInput({ localSequence: 1 })).register;
  const second = openCashRegister(openInput({ cashRegisterId: "session-2", shiftId: "shift-2" })).register;

  assert.throws(() => appendCashMovement(second, {
    ...movementInput({
    localSequence: 1,
    sequenceContext: { deviceId: "device-1", expectedNextSequence: 2 },
    }), cashRegisterId: "session-2", shiftId: "shift-2",
  }), CashMovementSequenceError);
  const next = appendCashMovement(second, {
    ...movementInput({
    localSequence: 2,
    sequenceContext: { deviceId: "device-1", expectedNextSequence: 2 },
    }), cashRegisterId: "session-2", shiftId: "shift-2",
  }).register;
  assert.equal(next.movements[0]?.localSequence, 2);
  assert.equal(firstMovement.movements[0]?.localSequence, 1);
});

test("compensation reverses an existing movement without mutating it", () => {
  let register = openCashRegister(openInput()).register;
  const original = append(register, movementInput({ localSequence: 1, amount: 500 })).movement;
  register = append(register, movementInput({ localSequence: 1, amount: 500 })).register;
  const correction = append(register, movementInput({
    movementId: "movement-2",
    eventId: "event-2",
    idempotencyKey: "key-2",
    localSequence: 2,
    type: "cash_adjustment",
    direction: "out",
    amount: 400,
    reason: "Corrección parcial",
    compensatesMovementId: original.movementId,
  }));

  assert.equal(correction.register.movements.length, 2);
  assert.deepEqual(correction.register.movements[0], original);
  assert.equal(expectedCashBalance(correction.register).amountMinor, 10_100);
  const finalCorrection = append(correction.register, movementInput({
    movementId: "movement-3",
    eventId: "event-3",
    idempotencyKey: "key-3",
    localSequence: 3,
    type: "cash_adjustment",
    direction: "out",
    amount: 100,
    reason: "Corrección final",
    compensatesMovementId: original.movementId,
  }));
  assert.equal(expectedCashBalance(finalCorrection.register).amountMinor, 10_000);
  assert.throws(() => append(finalCorrection.register, movementInput({
    movementId: "movement-4",
    eventId: "event-4",
    idempotencyKey: "key-4",
    localSequence: 4,
    type: "cash_adjustment",
    direction: "out",
    amount: 1,
    reason: "Exceso acumulado",
    compensatesMovementId: original.movementId,
  })), CashMovementCompensationError);
  assert.throws(() => append(register, movementInput({ localSequence: 2, type: "cash_adjustment", direction: "in", amount: 1, reason: "x", compensatesMovementId: original.movementId })), CashMovementCompensationError);
  assert.throws(() => append(register, movementInput({ localSequence: 2, type: "cash_adjustment", direction: "out", amount: 501, reason: "x", compensatesMovementId: original.movementId })), CashMovementCompensationError);
  assert.throws(() => append(register, movementInput({ localSequence: 2, type: "cash_adjustment", direction: "out", amount: 1, reason: "x", compensatesMovementId: "missing" })), CashMovementCompensationError);
});

test("cash property: deterministic compensation partitions conserve balances and retries do not create duplicate movements", () => {
  const random = deterministicRandom(CASH_COMPENSATION_PROPERTY_SEED);

  for (let caseIndex = 0; caseIndex < 48; caseIndex += 1) {
    const originalAmount = random.int(4, 2_000);
    const parts = randomPartition(originalAmount, random);
    const opening = 10_000;
    const register = openCashRegister(openInput({ cashRegisterId: `property-register-${caseIndex}` })).register;
    const originalInput = movementInput({
      movementId: `property-${caseIndex}-original`,
      eventId: `property-${caseIndex}-event-original`,
      idempotencyKey: `property-${caseIndex}-key-original`,
      cashRegisterId: register.cashRegisterId,
      localSequence: 1,
      amount: originalAmount,
    });
    const originalMutation = appendCashMovement(register, originalInput);
    const original = originalMutation.movement;
    let candidate = originalMutation.register;
    let compensated = 0;
    let finalInput: AppendCashMovementInput | undefined;

    for (const [partIndex, amount] of parts.entries()) {
      const sequence = partIndex + 2;
      const input = movementInput({
        movementId: `property-${caseIndex}-adjustment-${partIndex}`,
        eventId: `property-${caseIndex}-event-adjustment-${partIndex}`,
        idempotencyKey: `property-${caseIndex}-key-adjustment-${partIndex}`,
        cashRegisterId: candidate.cashRegisterId,
        localSequence: sequence,
        type: "cash_adjustment",
        direction: "out",
        amount,
        reason: "Deterministic compensation",
        compensatesMovementId: original.movementId,
      });
      const created = appendCashMovement(candidate, input);
      const replay = appendCashMovement(created.register, input);
      compensated += amount;

      assert.equal(created.outcome, "created", `created compensation case ${caseIndex}, part ${partIndex}`);
      assert.equal(replay.outcome, "replayed", `replayed compensation case ${caseIndex}, part ${partIndex}`);
      assert.equal(replay.register, created.register, `replay register case ${caseIndex}, part ${partIndex}`);
      assert.equal(replay.movement, created.movement, `replay movement case ${caseIndex}, part ${partIndex}`);
      assert.equal(
        expectedCashBalance(created.register).amountMinor,
        opening + originalAmount - compensated,
        `balance case ${caseIndex}, part ${partIndex}`,
      );
      assert.ok(compensated <= originalAmount, `bounded compensation case ${caseIndex}, part ${partIndex}`);

      candidate = created.register;
      finalInput = input;
    }

    assert.equal(compensated, originalAmount, `full compensation case ${caseIndex}`);
    assert.equal(expectedCashBalance(candidate).amountMinor, opening, `restored balance case ${caseIndex}`);
    assert.equal(originalMutation.register.movements.length, 1, `original remains immutable case ${caseIndex}`);
    assert.deepEqual(originalMutation.register.movements[0], original, `original remains unchanged case ${caseIndex}`);

    const nextSequence = parts.length + 2;
    assert.throws(
      () => appendCashMovement(candidate, movementInput({
        movementId: `property-${caseIndex}-excess`,
        eventId: `property-${caseIndex}-event-excess`,
        idempotencyKey: `property-${caseIndex}-key-excess`,
        cashRegisterId: candidate.cashRegisterId,
        localSequence: nextSequence,
        type: "cash_adjustment",
        direction: "out",
        amount: 1,
        reason: "Intentional excess",
        compensatesMovementId: original.movementId,
      })),
      CashMovementCompensationError,
      `excess compensation case ${caseIndex}`,
    );

    assert.ok(finalInput);
    assert.throws(
      () => appendCashMovement(candidate, { ...finalInput, amount: new Money(finalInput.amount.amountMinor + 1, "MXN") }),
      CashMovementIdempotencyConflictError,
      `payload conflict case ${caseIndex}`,
    );
  }
});

test("rehydrated movement history revalidates type, direction, references, reasons, and money", () => {
  const valid = append(openCashRegister(openInput()).register, movementInput({ localSequence: 1, amount: 500 })).register;
  const movement = valid.movements[0];
  assert.ok(movement);

  assert.throws(
    () => expectedCashBalance(rehydratedRegister(valid, [frozenMovement(movement, { direction: "out" })])),
    CashMovementReferenceError,
  );
  assert.throws(
    () => expectedCashBalance(rehydratedRegister(valid, [frozenMovement(movement, { type: "unknown" as never })])),
    InvalidCashMovementTypeError,
  );
  assert.throws(
    () => expectedCashBalance(rehydratedRegister(valid, [frozenMovement(movement, {
      type: "cash_in", direction: "in", source: undefined, reason: undefined,
    })])),
    CashMovementReasonRequiredError,
  );
  assert.throws(
    () => expectedCashBalance(rehydratedRegister(valid, [frozenMovement(movement, {
      amount: Object.freeze({ amountMinor: 500, currency: "MXN" }) as Money,
    })])),
    InvalidCashRegisterFieldError,
  );
  assert.throws(
    () => expectedCashBalance(rehydratedRegister(valid, [frozenMovement(movement, {
      amount: new Money(500, "USD"),
    })])),
    CashRegisterCurrencyMismatchError,
  );
});

test("rehydrated compensations must reference prior originals and remain cumulatively bounded", () => {
  const seed = append(openCashRegister(openInput()).register, movementInput({ localSequence: 1, amount: 500 })).register;
  const original = seed.movements[0];
  assert.ok(original);
  const futureOriginal = frozenMovement(original, {
    movementId: "movement-future", eventId: "event-future", idempotencyKey: "key-future", localSequence: 2,
  });
  const prematureAdjustment = frozenMovement(original, {
    movementId: "movement-adjustment", eventId: "event-adjustment", idempotencyKey: "key-adjustment",
    localSequence: 1, type: "cash_adjustment", direction: "out", source: undefined,
    compensatesMovementId: futureOriginal.movementId, reason: "Referencia futura",
  });
  assert.throws(
    () => expectedCashBalance(rehydratedRegister(seed, [prematureAdjustment, futureOriginal])),
    CashMovementCompensationError,
  );

  const firstAdjustment = frozenMovement(original, {
    movementId: "movement-2", eventId: "event-2", idempotencyKey: "key-2", localSequence: 2,
    type: "cash_adjustment", direction: "out", source: undefined,
    compensatesMovementId: original.movementId, reason: "Corrección parcial", amount: new Money(400, "MXN"),
  });
  const excessiveAdjustment = frozenMovement(original, {
    movementId: "movement-3", eventId: "event-3", idempotencyKey: "key-3", localSequence: 3,
    type: "cash_adjustment", direction: "out", source: undefined,
    compensatesMovementId: original.movementId, reason: "Corrección excesiva", amount: new Money(101, "MXN"),
  });
  assert.throws(
    () => expectedCashBalance(rehydratedRegister(seed, [original, firstAdjustment, excessiveAdjustment])),
    CashMovementCompensationError,
  );
});

test("closes once with expected, counted, and signed difference", () => {
  let register = openCashRegister(openInput()).register;
  register = append(register, movementInput({ localSequence: 1, amount: 2_500 })).register;
  const closeInputValue = closeInput({ countedClosingBalance: new Money(12_400, "MXN"), evidence: evidence({ reason: "Sobrante contado" }) });
  const closedMutation = closeCashRegister(register, closeInputValue);
  const closed = closedMutation.register;

  assert.equal(closed.status, "closed");
  assert.equal(closed.expectedClosingBalance?.amountMinor, 12_500);
  assert.equal(closed.countedClosingBalance?.amountMinor, 12_400);
  assert.equal(closed.difference?.amountMinor, -100);
  assert.equal(expectedCashBalance(closed).amountMinor, 12_500);
  assert.equal(closeCashRegister(closed, closeInputValue).outcome, "replayed");
  assert.throws(() => closeCashRegister(closed, closeInput({ countedClosingBalance: new Money(12_500, "MXN"), evidence: evidence() })), CashRegisterAlreadyClosedError);
  assert.throws(() => closeCashRegister(closed, { ...closeInputValue, countedClosingBalance: new Money(12_500, "MXN") }), CashRegisterCloseIdempotencyConflictError);
  assert.throws(() => append(closed, movementInput({ localSequence: 2 })), CashRegisterClosedError);
});

test("close rejects event or idempotency keys already used by a cash movement", () => {
  const register = append(openCashRegister(openInput()).register, movementInput({
    eventId: "movement-event", idempotencyKey: "movement-key", localSequence: 1,
  })).register;

  assert.throws(
    () => closeCashRegister(register, closeInput({ eventId: "movement-event" })),
    CashRegisterCloseIdempotencyConflictError,
  );
  assert.throws(
    () => closeCashRegister(register, closeInput({ idempotencyKey: "movement-key" })),
    CashRegisterCloseIdempotencyConflictError,
  );
});

test("rehydrated register state rejects closing fields while open and inconsistent closed balances", () => {
  const open = openCashRegister(openInput()).register;
  assert.throws(
    () => expectedCashBalance(Object.freeze({ ...open, closedAt: "2026-08-27T13:00:00Z" })),
    InvalidCashRegisterFieldError,
  );

  const withSale = append(open, movementInput({ localSequence: 1, amount: 500 })).register;
  const closed = closeCashRegister(withSale, closeInput({
    countedClosingBalance: new Money(10_400, "MXN"),
    evidence: evidence({ reason: "Faltante contado" }),
  })).register;
  const movement = closed.movements[0];
  assert.ok(movement);
  assert.equal(expectedCashBalance(closed).amountMinor, 10_500);
  assert.throws(
    () => expectedCashBalance(Object.freeze({ ...closed, closedByActorId: undefined }) as unknown as CashRegister),
    InvalidCashRegisterFieldError,
  );
  assert.throws(
    () => expectedCashBalance(Object.freeze({ ...closed, expectedClosingBalance: new Money(10_499, "MXN") })),
    InvalidCashRegisterFieldError,
  );
  assert.throws(
    () => expectedCashBalance(Object.freeze({ ...closed, difference: new Money(-99, "MXN") })),
    InvalidCashRegisterFieldError,
  );
  assert.throws(
    () => expectedCashBalance(Object.freeze({ ...closed, countedClosingBalance: new Money(10_400, "USD") })),
    CashRegisterCurrencyMismatchError,
  );
  assert.throws(
    () => expectedCashBalance(Object.freeze({ ...closed, closeReason: undefined }) as unknown as CashRegister),
    CashRegisterVarianceReasonRequiredError,
  );
  assert.throws(
    () => expectedCashBalance(Object.freeze({ ...closed, closeEventId: movement.eventId })),
    CashRegisterCloseIdempotencyConflictError,
  );
  assert.throws(
    () => expectedCashBalance(Object.freeze({ ...closed, closeIdempotencyKey: movement.idempotencyKey })),
    CashRegisterCloseIdempotencyConflictError,
  );
});

test("rehydrated registers reject alternating movement accessors before an invalid register is returned", () => {
  const register = openCashRegister(openInput()).register;
  let reads = 0;
  const poisoned = { ...register };
  Object.defineProperty(poisoned, "movements", {
    enumerable: true,
    get: () => ++reads <= 7 ? Object.freeze([]) : Object.freeze([Object.freeze({})]),
  });
  Object.freeze(poisoned);

  assert.throws(() => appendCashMovement(poisoned as CashRegister, movementInput({ localSequence: 1 })), InvalidCashRegisterFieldError);
  assert.equal(reads, 0);
});

test("requires a reason for non-zero closing differences and preserves accounting identity", () => {
  let register = openCashRegister(openInput()).register;
  register = append(register, movementInput({ localSequence: 1, amount: 1_000 })).register;
  assert.throws(() => closeCashRegister(register, closeInput({ countedClosingBalance: new Money(10_999, "MXN"), evidence: evidence() })), CashRegisterVarianceReasonRequiredError);

  const orders = [
    [1_000, -100, 25],
    [25, 1_000, -100],
    [-100, 25, 1_000],
  ];
  for (const order of orders) {
    let candidate = openCashRegister(openInput({ cashRegisterId: `register-${order[0]}` })).register;
    for (const [index, amount] of order.entries()) {
      candidate = append(candidate, { movementId: `movement-${order[0]}-${index}`, eventId: `event-${order[0]}-${index}`, idempotencyKey: `key-${order[0]}-${index}`, localSequence: index + 1, direction: amount < 0 ? "out" : "in", amount: Math.abs(amount), type: amount < 0 ? "cash_out" : "cash_in", reason: "Prueba contable" }).register;
    }
    assert.equal(expectedCashBalance(candidate).amountMinor, 10_925);
  }
});

test("rejects negative counted balances with the closing-balance error", () => {
  const register = openCashRegister(openInput()).register;
  assert.throws(
    () => closeCashRegister(register, closeInput({ countedClosingBalance: new Money(-1, "MXN"), evidence: evidence() })),
    CashRegisterCountedBalanceError,
  );
});

function openInput(overrides: Partial<OpenCashRegisterInput> = {}): OpenCashRegisterInput {
  return {
    cashRegisterId: "session-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    registerId: "till-1",
    shiftId: "shift-1",
    cashierId: "cashier-1",
    openingFloat: new Money(10_000, "MXN"),
    evidence: evidence(),
    ...overrides,
  };
}

let closeSequence = 0;

function closeInput(overrides: Partial<CloseCashRegisterInput> = {}): CloseCashRegisterInput {
  closeSequence += 1;
  return {
    eventId: `close-event-${closeSequence}`,
    idempotencyKey: `close-key-${closeSequence}`,
    countedClosingBalance: new Money(10_000, "MXN"),
    evidence: evidence(),
    ...overrides,
  };
}

function rehydratedRegister(register: CashRegister, movements: readonly CashMovement[]): CashRegister {
  return Object.freeze({ ...register, movements: Object.freeze(movements) });
}

type RehydratedMovementOverrides = { [Key in keyof CashMovement]?: CashMovement[Key] | undefined };

function frozenMovement(movement: CashMovement, overrides: RehydratedMovementOverrides): CashMovement {
  return Object.freeze({ ...movement, ...overrides }) as unknown as CashMovement;
}

type MovementOverrides = Partial<Omit<AppendCashMovementInput, "amount" | "evidence">> & {
  amount?: number | Money;
  currency?: string;
  reason?: string;
  evidence?: CashAuditEvidence;
};

function movementInput(overrides: MovementOverrides = {}): AppendCashMovementInput {
  const { amount, currency, reason, evidence: overrideEvidence, source: overrideSource, ...rest } = overrides;
  const sequence = overrides.localSequence ?? 1;
  const type = overrides.type ?? "cash_sale";
  const source = overrideSource ?? (type === "cash_sale" ? { type: "payment" as const, paymentId: "payment-1" } : undefined);
  return {
    movementId: `movement-${sequence}`,
    eventId: `event-${sequence}`,
    idempotencyKey: `key-${sequence}`,
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    cashRegisterId: "session-1",
    registerId: "till-1",
    shiftId: "shift-1",
    cashierId: "cashier-1",
    localSequence: 1,
    sequenceContext: { deviceId: "device-1", expectedNextSequence: sequence },
    type,
    direction: "in",
    evidence: evidence({ ...overrideEvidence, ...(reason === undefined ? {} : { reason }) }),
    ...(source === undefined ? {} : { source }),
    ...rest,
    amount: typeof amount === "number" ? new Money(amount, currency ?? "MXN") : (amount ?? new Money(500, "MXN")),
  } as AppendCashMovementInput;
}

function append(register: CashRegister, overrides: MovementOverrides = {}): ReturnType<typeof appendCashMovement> {
  return appendCashMovement(register, movementInput({
    restaurantId: register.restaurantId,
    branchId: register.branchId,
    cashRegisterId: register.cashRegisterId,
    registerId: register.registerId,
    shiftId: register.shiftId,
    cashierId: register.cashierId,
    ...overrides,
  }));
}

function evidence(overrides: Partial<CashAuditEvidence> = {}): CashAuditEvidence {
  return { actorId: "cashier-1", branchId: "branch-1", deviceId: "device-1", occurredAt: "2026-08-27T12:00:00Z", ...overrides };
}

function randomPartition(amount: number, random: ReturnType<typeof deterministicRandom>): number[] {
  const partCount = random.int(2, Math.min(4, amount));
  const parts: number[] = [];
  let remaining = amount;
  for (let index = 0; index < partCount - 1; index += 1) {
    const minimumReserved = partCount - index - 1;
    const part = random.int(1, remaining - minimumReserved);
    parts.push(part);
    remaining -= part;
  }
  parts.push(remaining);
  return parts;
}

function deterministicRandom(seed: number): { int(min: number, max: number): number } {
  let state = seed >>> 0;
  return {
    int(min: number, max: number): number {
      state = (state * 1664525 + 1013904223) >>> 0;
      return min + (state % (max - min + 1));
    },
  };
}
