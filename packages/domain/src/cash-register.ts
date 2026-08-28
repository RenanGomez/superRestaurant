import { Money } from "./money.js";
import {
  CashMovementAmountMustBePositiveError,
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
  CashRegisterOpeningAmountError,
  CashRegisterVarianceReasonRequiredError,
  DuplicateCashMovementIdError,
  InvalidCashMovementTypeError,
  InvalidCashRegisterFieldError,
} from "./errors.js";

export type CashRegisterState = "open" | "closed";
export type CashMovementType = "cash_sale" | "cash_refund" | "cash_in" | "cash_out" | "cash_adjustment";
export type CashMovementDirection = "in" | "out";

export interface CashAuditEvidence {
  readonly actorId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly reason?: string;
}

/**
 * Server/device-authoritative cursor for ADR-004's global per-device sequence.
 * A cash-register session only contains a slice of a device's event stream, so
 * the session cannot safely derive the next sequence after a new session opens.
 */
export interface CashMovementSequenceContext {
  readonly deviceId: string;
  readonly expectedNextSequence: number;
}

export type CashMovementSource =
  | { readonly type: "payment"; readonly paymentId: string }
  | { readonly type: "refund"; readonly refundId: string; readonly paymentId: string };

export interface CashMovement {
  readonly movementId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly cashRegisterId: string;
  readonly registerId: string;
  readonly shiftId: string;
  readonly cashierId: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly localSequence: number;
  readonly occurredAt: string;
  readonly type: CashMovementType;
  readonly direction: CashMovementDirection;
  readonly amount: Money;
  readonly source?: CashMovementSource;
  readonly compensatesMovementId?: string;
  readonly reason?: string;
}

export interface CashRegister {
  readonly cashRegisterId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  /** Stable identity of the physical/logical till; cashRegisterId is the session. */
  readonly registerId: string;
  readonly shiftId: string;
  readonly cashierId: string;
  readonly currency: string;
  readonly status: CashRegisterState;
  readonly openingFloat: Money;
  readonly openedByActorId: string;
  readonly openedAt: string;
  readonly openedDeviceId: string;
  readonly movements: readonly CashMovement[];
  readonly closedByActorId?: string;
  readonly closedAt?: string;
  readonly closedDeviceId?: string;
  readonly expectedClosingBalance?: Money;
  readonly countedClosingBalance?: Money;
  /** Positive means overage; negative means shortage. */
  readonly difference?: Money;
  readonly closeEventId?: string;
  readonly closeIdempotencyKey?: string;
  readonly closeReason?: string;
}

export interface OpenCashRegisterInput {
  readonly cashRegisterId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly registerId: string;
  readonly shiftId: string;
  readonly cashierId: string;
  readonly openingFloat: Money;
  readonly evidence: CashAuditEvidence;
}

export interface AppendCashMovementInput {
  readonly movementId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly cashRegisterId: string;
  readonly registerId: string;
  readonly shiftId: string;
  readonly cashierId: string;
  readonly localSequence: number;
  readonly type: CashMovementType;
  readonly direction: CashMovementDirection;
  readonly amount: Money;
  readonly evidence: CashAuditEvidence;
  readonly sequenceContext: CashMovementSequenceContext;
  readonly source?: CashMovementSource;
  readonly compensatesMovementId?: string;
}

export interface CloseCashRegisterInput {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly countedClosingBalance: Money;
  readonly evidence: CashAuditEvidence;
}

export interface CashRegisterMutation {
  readonly register: CashRegister;
  readonly evidence: CashAuditEvidence;
}

export interface CashMovementMutation extends CashRegisterMutation {
  readonly movement: CashMovement;
  readonly outcome: "created" | "replayed";
}

export interface CashRegisterCloseMutation extends CashRegisterMutation {
  readonly outcome: "created" | "replayed";
}

export function openCashRegister(input: OpenCashRegisterInput): CashRegisterMutation {
  input = snapshotOpenInput(input);
  assertTextFields(input, ["cashRegisterId", "restaurantId", "branchId", "registerId", "shiftId", "cashierId"]);
  assertEvidence(input.evidence, input.branchId);
  assertMoney(input.openingFloat, "openingFloat");
  if (input.openingFloat.amountMinor < 0) {
    throw new CashRegisterOpeningAmountError();
  }

  const register = freezeRegister({
    cashRegisterId: input.cashRegisterId,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    registerId: input.registerId,
    shiftId: input.shiftId,
    cashierId: input.cashierId,
    currency: input.openingFloat.currency,
    status: "open",
    openingFloat: input.openingFloat,
    openedByActorId: input.evidence.actorId,
    openedAt: input.evidence.occurredAt,
    openedDeviceId: input.evidence.deviceId,
    movements: [],
  });

  return Object.freeze({ register, evidence: freezeEvidence(input.evidence) });
}

export function expectedCashBalance(register: CashRegister): Money {
  register = snapshotRegister(register);
  assertRegisterIntegrity(register);
  return calculateExpectedCashBalance(register);
}

export function appendCashMovement(
  register: CashRegister,
  input: AppendCashMovementInput,
): CashMovementMutation {
  register = snapshotRegister(register);
  input = snapshotAppendInput(input);
  assertRegisterIntegrity(register);
  assertTextFields(input, [
    "movementId", "eventId", "idempotencyKey", "restaurantId", "branchId", "cashRegisterId",
    "registerId", "shiftId", "cashierId",
  ]);
  assertEvidence(input.evidence, input.branchId);
  assertMoney(input.amount, "amount");

  const existingByEvent = register.movements.find((movement) => movement.eventId === input.eventId);
  const existingByKey = register.movements.find((movement) => movement.idempotencyKey === input.idempotencyKey);
  const existing = existingByEvent ?? existingByKey;
  if (existing !== undefined) {
    if (!sameAttempt(existing, input)) {
      throw new CashMovementIdempotencyConflictError(input.idempotencyKey);
    }
    return Object.freeze({
      register,
      movement: existing,
      evidence: existingEvidence(existing),
      outcome: "replayed" as const,
    });
  }

  if (register.status !== "open") {
    throw new CashRegisterClosedError();
  }
  assertRegisterScope(register, input);
  if (register.movements.some((movement) => movement.movementId === input.movementId)) {
    throw new DuplicateCashMovementIdError(input.movementId);
  }
  if (input.amount.amountMinor <= 0) {
    throw new CashMovementAmountMustBePositiveError();
  }
  if (input.amount.currency !== register.currency) {
    throw new CashRegisterCurrencyMismatchError();
  }
  assertSequence(register, input);
  assertMovementShape(input, register);

  const movement = freezeMovement({
    movementId: input.movementId,
    eventId: input.eventId,
    idempotencyKey: input.idempotencyKey,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    cashRegisterId: input.cashRegisterId,
    registerId: input.registerId,
    shiftId: input.shiftId,
    cashierId: input.cashierId,
    actorId: input.evidence.actorId,
    deviceId: input.evidence.deviceId,
    localSequence: input.localSequence,
    occurredAt: input.evidence.occurredAt,
    type: input.type,
    direction: input.direction,
    amount: input.amount,
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.compensatesMovementId === undefined ? {} : { compensatesMovementId: input.compensatesMovementId }),
    ...(input.evidence.reason === undefined ? {} : { reason: input.evidence.reason }),
  });
  const next = freezeRegister({ ...register, movements: [...register.movements, movement] });
  const persistedMovement = next.movements.at(-1);
  if (persistedMovement === undefined) {
    throw new InvalidCashRegisterFieldError("register.movements");
  }
  return Object.freeze({ register: next, movement: persistedMovement, evidence: existingEvidence(persistedMovement), outcome: "created" as const });
}

export function closeCashRegister(
  register: CashRegister,
  input: CloseCashRegisterInput,
): CashRegisterCloseMutation {
  register = snapshotRegister(register);
  input = snapshotCloseInput(input);
  assertRegisterIntegrity(register);
  assertEvidence(input.evidence, register.branchId);
  if (register.movements.some((movement) =>
    movement.eventId === input.eventId || movement.idempotencyKey === input.idempotencyKey)) {
    throw new CashRegisterCloseIdempotencyConflictError(input.idempotencyKey);
  }
  if (register.status !== "open") {
    if (sameCloseAttempt(register, input)) {
      return Object.freeze({ register, evidence: freezeEvidence(input.evidence), outcome: "replayed" as const });
    }
    if (register.closeEventId === input.eventId || register.closeIdempotencyKey === input.idempotencyKey) {
      throw new CashRegisterCloseIdempotencyConflictError(input.idempotencyKey);
    }
    throw new CashRegisterAlreadyClosedError();
  }
  assertMoney(input.countedClosingBalance, "countedClosingBalance");
  if (input.countedClosingBalance.amountMinor < 0) {
    throw new CashRegisterCountedBalanceError();
  }
  if (input.countedClosingBalance.currency !== register.currency) {
    throw new CashRegisterCurrencyMismatchError();
  }

  const expected = expectedCashBalance(register);
  const difference = input.countedClosingBalance.subtract(expected);
  if (difference.amountMinor !== 0 && !hasText(input.evidence.reason)) {
    throw new CashRegisterVarianceReasonRequiredError();
  }
  const next = freezeRegister({
    ...register,
    status: "closed",
    closedByActorId: input.evidence.actorId,
    closedAt: input.evidence.occurredAt,
    closedDeviceId: input.evidence.deviceId,
    expectedClosingBalance: expected,
    countedClosingBalance: input.countedClosingBalance,
    difference,
    closeEventId: input.eventId,
    closeIdempotencyKey: input.idempotencyKey,
    ...(input.evidence.reason === undefined ? {} : { closeReason: input.evidence.reason }),
  });
  return Object.freeze({ register: next, evidence: freezeEvidence(input.evidence), outcome: "created" as const });
}

function assertMovementShape(input: AppendCashMovementInput, register: CashRegister): void {
  const supported: readonly CashMovementType[] = ["cash_sale", "cash_refund", "cash_in", "cash_out", "cash_adjustment"];
  if (!supported.includes(input.type)) {
    throw new InvalidCashMovementTypeError(input.type);
  }

  if (input.type === "cash_sale") {
    if (input.direction !== "in" || input.compensatesMovementId !== undefined || input.source?.type !== "payment" || !hasText(input.source.paymentId)) {
      throw new CashMovementReferenceError();
    }
  } else if (input.type === "cash_refund") {
    if (input.direction !== "out" || input.compensatesMovementId !== undefined || input.source?.type !== "refund" || !hasText(input.source.refundId) || !hasText(input.source.paymentId)) {
      throw new CashMovementReferenceError();
    }
  } else if (input.type === "cash_in" || input.type === "cash_out") {
    if (!hasText(input.evidence.reason)) {
      throw new CashMovementReasonRequiredError();
    }
    if (input.compensatesMovementId !== undefined || input.source !== undefined) {
      throw new CashMovementReferenceError();
    }
    if ((input.type === "cash_in" && input.direction !== "in") || (input.type === "cash_out" && input.direction !== "out")) {
      throw new CashMovementReferenceError();
    }
  } else {
    assertCompensation(register, input);
  }
}

function assertCompensation(register: CashRegister, input: AppendCashMovementInput): void {
  if (!hasText(input.evidence.reason)) {
    throw new CashMovementReasonRequiredError();
  }
  if (input.source !== undefined || input.compensatesMovementId === undefined) {
    throw new CashMovementCompensationError();
  }
  const original = register.movements.find((movement) => movement.movementId === input.compensatesMovementId);
  if (original === undefined || original.type === "cash_adjustment") {
    throw new CashMovementCompensationError("Compensation must reference an existing non-compensating movement.");
  }
  if (input.direction === original.direction) {
    throw new CashMovementCompensationError("Compensation must reverse the original movement direction.");
  }
  const alreadyCompensated = register.movements
    .filter((movement) => movement.compensatesMovementId === original.movementId)
    .reduce((total, movement) => total + BigInt(movement.amount.amountMinor), 0n);
  const remaining = BigInt(original.amount.amountMinor) - alreadyCompensated;
  if (input.amount.currency !== original.amount.currency || BigInt(input.amount.amountMinor) > remaining) {
    throw new CashMovementCompensationError("Compensation must use the original currency and not exceed its amount.");
  }
}

function assertRegisterScope(register: CashRegister, input: AppendCashMovementInput): void {
  if (
    register.restaurantId !== input.restaurantId || register.branchId !== input.branchId ||
    register.cashRegisterId !== input.cashRegisterId || register.registerId !== input.registerId ||
    register.shiftId !== input.shiftId || register.cashierId !== input.cashierId
  ) {
    throw new CashMovementScopeMismatchError();
  }
}

function assertSequence(register: CashRegister, input: AppendCashMovementInput): void {
  if (!Number.isSafeInteger(input.localSequence) || input.localSequence <= 0) {
    throw new CashMovementSequenceError(input.evidence.deviceId, 1, input.localSequence);
  }
  if (input.sequenceContext === undefined || typeof input.sequenceContext !== "object" ||
    input.sequenceContext.deviceId !== input.evidence.deviceId ||
    !Number.isSafeInteger(input.sequenceContext.expectedNextSequence) || input.sequenceContext.expectedNextSequence <= 0) {
    throw new CashMovementSequenceError(input.evidence.deviceId, 1, input.localSequence);
  }
  // The context is the authoritative cursor across cash-register sessions.
  // The session-local history is only a consistency check for events already
  // observed in this session; it is never used to reset a device's sequence.
  const expected = input.sequenceContext.expectedNextSequence;
  if (input.localSequence !== expected) {
    throw new CashMovementSequenceError(input.evidence.deviceId, expected, input.localSequence);
  }
  const deviceMovements = register.movements.filter((movement) => movement.deviceId === input.evidence.deviceId);
  const last = deviceMovements.at(-1)?.localSequence ?? 0;
  if (deviceMovements.length > 0 && input.localSequence !== last + 1) {
    throw new CashMovementSequenceError(input.evidence.deviceId, last + 1, input.localSequence);
  }
}

function sameAttempt(movement: CashMovement, input: AppendCashMovementInput): boolean {
  return movement.movementId === input.movementId && movement.eventId === input.eventId &&
    movement.idempotencyKey === input.idempotencyKey && movement.restaurantId === input.restaurantId &&
    movement.branchId === input.branchId && movement.cashRegisterId === input.cashRegisterId &&
    movement.registerId === input.registerId && movement.shiftId === input.shiftId &&
    movement.cashierId === input.cashierId && movement.deviceId === input.evidence.deviceId &&
    movement.localSequence === input.localSequence && movement.type === input.type &&
    movement.direction === input.direction && movement.amount.equals(input.amount) &&
    sameSource(movement.source, input.source) && movement.compensatesMovementId === input.compensatesMovementId &&
    movement.actorId === input.evidence.actorId && movement.occurredAt === input.evidence.occurredAt &&
    movement.reason === input.evidence.reason;
}

function sameSource(left: CashMovementSource | undefined, right: CashMovementSource | undefined): boolean {
  return left?.type === right?.type &&
    (left === undefined || right === undefined || (left.type === "payment" && right.type === "payment" && left.paymentId === right.paymentId) ||
      (left.type === "refund" && right.type === "refund" && left.refundId === right.refundId && left.paymentId === right.paymentId));
}

function existingEvidence(movement: Pick<CashMovement, "actorId" | "branchId" | "deviceId" | "occurredAt" | "reason">): CashAuditEvidence {
  return freezeEvidence({
    actorId: movement.actorId,
    branchId: movement.branchId,
    deviceId: movement.deviceId,
    occurredAt: movement.occurredAt,
    ...(movement.reason === undefined ? {} : { reason: movement.reason }),
  });
}

function assertEvidence(evidence: CashAuditEvidence, expectedBranchId?: string): void {
  if (!isPlainDataObject(evidence)) {
    throw new InvalidCashRegisterFieldError("evidence");
  }
  for (const field of ["actorId", "branchId", "deviceId", "occurredAt"] as const) {
    if (!hasText(evidence[field])) {
      throw new InvalidCashRegisterFieldError(`evidence.${field}`);
    }
  }
  if (expectedBranchId !== undefined && evidence.branchId !== expectedBranchId) {
    throw new CashMovementScopeMismatchError();
  }
}

function assertMoney(value: Money, field: string): void {
  if (!(value instanceof Money) || !isFrozenDataObject(value, Money.prototype) || !Number.isSafeInteger(value.amountMinor) ||
    !/^[A-Z]{3}$/u.test(value.currency)) {
    throw new InvalidCashRegisterFieldError(field);
  }
}

function assertRegisterIntegrity(register: CashRegister): void {
  if (!isFrozenPlainDataObject(register)) {
    throw new InvalidCashRegisterFieldError("register");
  }
  assertTextFields(register, [
    "cashRegisterId", "restaurantId", "branchId", "registerId", "shiftId", "cashierId", "currency",
    "openedByActorId", "openedAt", "openedDeviceId",
  ]);
  assertMoney(register.openingFloat, "register.openingFloat");
  if (register.openingFloat.amountMinor < 0) {
    throw new CashRegisterOpeningAmountError();
  }
  if (!/^[A-Z]{3}$/u.test(register.currency) || register.openingFloat.currency !== register.currency ||
    !["open", "closed"].includes(register.status)) {
    throw new InvalidCashRegisterFieldError("register");
  }
  if (!Array.isArray(register.movements) || !Object.isFrozen(register.movements)) {
    throw new InvalidCashRegisterFieldError("register.movements");
  }
  const ids = new Set<string>();
  const eventIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  const lastSequenceByDevice = new Map<string, number>();
  for (const [index, movement] of register.movements.entries()) {
    if (!isFrozenPlainDataObject(movement)) {
      throw new InvalidCashRegisterFieldError("register.movements");
    }
    assertTextFields(movement, ["movementId", "eventId", "idempotencyKey", "restaurantId", "branchId", "cashRegisterId", "registerId", "shiftId", "cashierId", "actorId", "deviceId", "occurredAt"]);
    assertMoney(movement.amount, "register.movements.amount");
    if (ids.has(movement.movementId)) {
      throw new DuplicateCashMovementIdError(movement.movementId);
    }
    ids.add(movement.movementId);
    if (eventIds.has(movement.eventId)) {
      throw new CashMovementIdempotencyConflictError(movement.idempotencyKey);
    }
    eventIds.add(movement.eventId);
    if (idempotencyKeys.has(movement.idempotencyKey)) {
      throw new CashMovementIdempotencyConflictError(movement.idempotencyKey);
    }
    idempotencyKeys.add(movement.idempotencyKey);
    if (!Number.isSafeInteger(movement.localSequence) || movement.localSequence <= 0 ||
      movement.amount.amountMinor <= 0 || !["in", "out"].includes(movement.direction)) {
      throw new InvalidCashRegisterFieldError("register.movements");
    }
    if (movement.source !== undefined &&
      (!isFrozenPlainDataObject(movement.source))) {
      throw new InvalidCashRegisterFieldError("register.movements.source");
    }
    if (movement.restaurantId !== register.restaurantId || movement.branchId !== register.branchId ||
      movement.cashRegisterId !== register.cashRegisterId || movement.registerId !== register.registerId ||
      movement.shiftId !== register.shiftId || movement.cashierId !== register.cashierId) {
      throw new CashMovementScopeMismatchError();
    }
    if (movement.amount.currency !== register.currency) {
      throw new CashRegisterCurrencyMismatchError();
    }
    const previousSequence = lastSequenceByDevice.get(movement.deviceId);
    if (previousSequence !== undefined && movement.localSequence !== previousSequence + 1) {
      throw new CashMovementSequenceError(movement.deviceId, previousSequence + 1, movement.localSequence);
    }
    lastSequenceByDevice.set(movement.deviceId, movement.localSequence);

    const priorRegister: CashRegister = {
      ...register,
      movements: register.movements.slice(0, index),
    };
    const historicalInput: AppendCashMovementInput = {
      ...movement,
      evidence: existingEvidence(movement),
      sequenceContext: {
        deviceId: movement.deviceId,
        expectedNextSequence: movement.localSequence,
      },
    };
    assertMovementShape(historicalInput, priorRegister);
  }

  const closingFields = [
    register.closedByActorId,
    register.closedAt,
    register.closedDeviceId,
    register.expectedClosingBalance,
    register.countedClosingBalance,
    register.difference,
    register.closeEventId,
    register.closeIdempotencyKey,
    register.closeReason,
  ];
  if (register.status === "open") {
    if (closingFields.some((value) => value !== undefined)) {
      throw new InvalidCashRegisterFieldError("register.closing");
    }
    return;
  }

  assertTextFields(register, ["closedByActorId", "closedAt", "closedDeviceId", "closeEventId", "closeIdempotencyKey"]);
  if (register.movements.some((movement) =>
    movement.eventId === register.closeEventId || movement.idempotencyKey === register.closeIdempotencyKey)) {
    throw new CashRegisterCloseIdempotencyConflictError(register.closeIdempotencyKey ?? "");
  }
  if (register.closeReason !== undefined && !hasText(register.closeReason)) {
    throw new InvalidCashRegisterFieldError("register.closeReason");
  }
  const expected = register.expectedClosingBalance;
  const counted = register.countedClosingBalance;
  const difference = register.difference;
  if (expected === undefined || counted === undefined || difference === undefined) {
    throw new InvalidCashRegisterFieldError("register.closing");
  }
  assertMoney(expected, "register.expectedClosingBalance");
  assertMoney(counted, "register.countedClosingBalance");
  assertMoney(difference, "register.difference");
  if (expected.currency !== register.currency || counted.currency !== register.currency ||
    difference.currency !== register.currency) {
    throw new CashRegisterCurrencyMismatchError();
  }
  if (counted.amountMinor < 0) {
    throw new CashRegisterCountedBalanceError();
  }
  const calculatedExpected = calculateExpectedCashBalance(register);
  if (!expected.equals(calculatedExpected) || !difference.equals(counted.subtract(expected))) {
    throw new InvalidCashRegisterFieldError("register.closing");
  }
  if (difference.amountMinor !== 0 && !hasText(register.closeReason)) {
    throw new CashRegisterVarianceReasonRequiredError();
  }
}

function calculateExpectedCashBalance(register: CashRegister): Money {
  return register.movements.reduce(
    (balance, movement) => movement.direction === "in" ? balance.add(movement.amount) : balance.subtract(movement.amount),
    register.openingFloat,
  );
}

function assertTextFields(input: object, fields: readonly string[]): void {
  for (const field of fields) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value !== "string" || !hasText(value)) {
      throw new InvalidCashRegisterFieldError(field);
    }
  }
}

function freezeRegister(register: CashRegister): CashRegister {
  return Object.freeze({
    ...register,
    openingFloat: register.openingFloat,
    movements: Object.freeze(register.movements.map(freezeMovement)),
  });
}

function freezeMovement(movement: CashMovement): CashMovement {
  return Object.freeze({
    ...movement,
    ...(movement.source === undefined ? {} : { source: Object.freeze({ ...movement.source }) }),
  });
}

function freezeEvidence(evidence: CashAuditEvidence): CashAuditEvidence {
  return Object.freeze({ ...evidence });
}

function sameCloseAttempt(register: CashRegister, input: CloseCashRegisterInput): boolean {
  return register.closeEventId === input.eventId && register.closeIdempotencyKey === input.idempotencyKey &&
    register.countedClosingBalance?.equals(input.countedClosingBalance) === true &&
    register.closedByActorId === input.evidence.actorId && register.closedAt === input.evidence.occurredAt &&
    register.closedDeviceId === input.evidence.deviceId && register.closeReason === input.evidence.reason;
}

function snapshotOpenInput(input: OpenCashRegisterInput): OpenCashRegisterInput {
  const record = readPlainDataRecord(input, "openCashRegister");
  return Object.freeze({
    cashRegisterId: record.cashRegisterId as string,
    restaurantId: record.restaurantId as string,
    branchId: record.branchId as string,
    registerId: record.registerId as string,
    shiftId: record.shiftId as string,
    cashierId: record.cashierId as string,
    openingFloat: record.openingFloat as Money,
    evidence: snapshotEvidence(record.evidence, "evidence"),
  });
}

function snapshotAppendInput(input: AppendCashMovementInput): AppendCashMovementInput {
  const record = readPlainDataRecord(input, "cashMovement");
  const sequence = readPlainDataRecord(record.sequenceContext, "sequenceContext");
  const source = record.source === undefined ? undefined : snapshotSource(record.source, "source", false);
  return Object.freeze({
    movementId: record.movementId as string,
    eventId: record.eventId as string,
    idempotencyKey: record.idempotencyKey as string,
    restaurantId: record.restaurantId as string,
    branchId: record.branchId as string,
    cashRegisterId: record.cashRegisterId as string,
    registerId: record.registerId as string,
    shiftId: record.shiftId as string,
    cashierId: record.cashierId as string,
    localSequence: record.localSequence as number,
    type: record.type as CashMovementType,
    direction: record.direction as CashMovementDirection,
    amount: record.amount as Money,
    evidence: snapshotEvidence(record.evidence, "evidence"),
    sequenceContext: Object.freeze({ deviceId: sequence.deviceId as string, expectedNextSequence: sequence.expectedNextSequence as number }),
    ...(source === undefined ? {} : { source }),
    ...(record.compensatesMovementId === undefined ? {} : { compensatesMovementId: record.compensatesMovementId as string }),
  });
}

function snapshotCloseInput(input: CloseCashRegisterInput): CloseCashRegisterInput {
  const record = readPlainDataRecord(input, "closeCashRegister");
  const stable = Object.freeze({
    eventId: record.eventId as string,
    idempotencyKey: record.idempotencyKey as string,
    countedClosingBalance: record.countedClosingBalance as Money,
    evidence: snapshotEvidence(record.evidence, "evidence"),
  });
  assertTextFields(stable, ["eventId", "idempotencyKey"]);
  return stable;
}

function snapshotRegister(register: CashRegister): CashRegister {
  const record = readPlainDataRecord(register, "register", true);
  const movements = readFrozenDataArray(record.movements, "register.movements");
  movements.forEach((movement, index) => { snapshotMovement(movement, index); });
  return register;
}

function snapshotMovement(value: unknown, index: number): CashMovement {
  const record = readPlainDataRecord(value, `register.movements[${index}]`, true);
  if (record.source !== undefined) snapshotSource(record.source, `register.movements[${index}].source`, true);
  return value as CashMovement;
}

function snapshotSource(value: unknown, field: string, frozen: boolean): CashMovementSource {
  const record = readPlainDataRecord(value, field, frozen);
  return record.type === "payment"
    ? Object.freeze({ type: "payment" as const, paymentId: record.paymentId as string })
    : Object.freeze({ type: "refund" as const, refundId: record.refundId as string, paymentId: record.paymentId as string });
}

function snapshotEvidence(value: unknown, field: string): CashAuditEvidence {
  const record = readPlainDataRecord(value, field);
  return Object.freeze({
    actorId: record.actorId as string,
    branchId: record.branchId as string,
    deviceId: record.deviceId as string,
    occurredAt: record.occurredAt as string,
    ...(record.reason === undefined ? {} : { reason: record.reason as string }),
  });
}

function readPlainDataRecord(value: unknown, field: string, frozen = false): Record<string, unknown> {
  if (!isPlainDataObject(value, frozen)) {
    throw new InvalidCashRegisterFieldError(field);
  }
  return value as Record<string, unknown>;
}

function readFrozenDataArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || !Object.isFrozen(value) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some((descriptor) => !("value" in descriptor))) {
    throw new InvalidCashRegisterFieldError(field);
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

function isPlainDataObject(value: unknown, frozen = false): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    (!frozen || Object.isFrozen(value)) && Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => "value" in descriptor);
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
