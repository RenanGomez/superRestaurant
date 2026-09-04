import {
  Money,
  expectedCashBalance,
  refundableAmount,
  type CashMovement,
  type CashMovementSource,
  type CashRegister,
  type Payment,
  type PaymentAuditEvidence,
} from "@super-restaurant/domain";

export const FINANCIAL_PERSISTENCE_SCHEMA_VERSION = 1 as const;

export interface PersistedMoneyV1 {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface PersistedCashRegisterV1 {
  readonly schemaVersion: typeof FINANCIAL_PERSISTENCE_SCHEMA_VERSION;
  readonly cashRegisterId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly registerId: string;
  readonly shiftId: string;
  readonly cashierId: string;
  readonly currency: string;
  readonly status: "open" | "closed";
  readonly openingFloat: PersistedMoneyV1;
  readonly openedByActorId: string;
  readonly openedAt: string;
  readonly openedDeviceId: string;
  readonly movements: readonly PersistedCashMovementV1[];
  readonly closedByActorId?: string;
  readonly closedAt?: string;
  readonly closedDeviceId?: string;
  readonly expectedClosingBalance?: PersistedMoneyV1;
  readonly countedClosingBalance?: PersistedMoneyV1;
  readonly difference?: PersistedMoneyV1;
  readonly closeEventId?: string;
  readonly closeIdempotencyKey?: string;
  readonly closeReason?: string;
}

export interface PersistedCashMovementV1 {
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
  readonly type: CashMovement["type"];
  readonly direction: CashMovement["direction"];
  readonly amount: PersistedMoneyV1;
  readonly source?: CashMovementSource;
  readonly compensatesMovementId?: string;
  readonly reason?: string;
}

export function encodeCashRegisterRecord(register: CashRegister): PersistedCashRegisterV1 {
  expectedCashBalance(register);
  return deepFreeze({
    schemaVersion: FINANCIAL_PERSISTENCE_SCHEMA_VERSION,
    cashRegisterId: register.cashRegisterId,
    restaurantId: register.restaurantId,
    branchId: register.branchId,
    registerId: register.registerId,
    shiftId: register.shiftId,
    cashierId: register.cashierId,
    currency: register.currency,
    status: register.status,
    openingFloat: encodeMoney(register.openingFloat),
    openedByActorId: register.openedByActorId,
    openedAt: register.openedAt,
    openedDeviceId: register.openedDeviceId,
    movements: register.movements.map(encodeMovement),
    ...(register.closedByActorId === undefined ? {} : { closedByActorId: register.closedByActorId }),
    ...(register.closedAt === undefined ? {} : { closedAt: register.closedAt }),
    ...(register.closedDeviceId === undefined ? {} : { closedDeviceId: register.closedDeviceId }),
    ...(register.expectedClosingBalance === undefined ? {} : { expectedClosingBalance: encodeMoney(register.expectedClosingBalance) }),
    ...(register.countedClosingBalance === undefined ? {} : { countedClosingBalance: encodeMoney(register.countedClosingBalance) }),
    ...(register.difference === undefined ? {} : { difference: encodeMoney(register.difference) }),
    ...(register.closeEventId === undefined ? {} : { closeEventId: register.closeEventId }),
    ...(register.closeIdempotencyKey === undefined ? {} : { closeIdempotencyKey: register.closeIdempotencyKey }),
    ...(register.closeReason === undefined ? {} : { closeReason: register.closeReason }),
  });
}

export function decodeCashRegisterRecord(value: unknown): CashRegister {
  const record = exactRecord(value, [
    "schemaVersion", "cashRegisterId", "restaurantId", "branchId", "registerId", "shiftId", "cashierId",
    "currency", "status", "openingFloat", "openedByActorId", "openedAt", "openedDeviceId", "movements",
  ], [
    "closedByActorId", "closedAt", "closedDeviceId", "expectedClosingBalance", "countedClosingBalance",
    "difference", "closeEventId", "closeIdempotencyKey", "closeReason",
  ]);
  if (record.schemaVersion !== 1 || (record.status !== "open" && record.status !== "closed")
    || !Array.isArray(record.movements)) throw invalid();
  const register = deepFreeze({
    cashRegisterId: string(record.cashRegisterId),
    restaurantId: string(record.restaurantId),
    branchId: string(record.branchId),
    registerId: string(record.registerId),
    shiftId: string(record.shiftId),
    cashierId: string(record.cashierId),
    currency: string(record.currency),
    status: record.status,
    openingFloat: decodeMoney(record.openingFloat),
    openedByActorId: string(record.openedByActorId),
    openedAt: string(record.openedAt),
    openedDeviceId: string(record.openedDeviceId),
    movements: record.movements.map(decodeMovement),
    ...optionalString(record, "closedByActorId"),
    ...optionalString(record, "closedAt"),
    ...optionalString(record, "closedDeviceId"),
    ...optionalMoney(record, "expectedClosingBalance"),
    ...optionalMoney(record, "countedClosingBalance"),
    ...optionalMoney(record, "difference"),
    ...optionalString(record, "closeEventId"),
    ...optionalString(record, "closeIdempotencyKey"),
    ...optionalString(record, "closeReason"),
  }) as CashRegister;
  expectedCashBalance(register);
  return register;
}

export function encodePaymentRecord(payment: Payment): Readonly<Record<string, unknown>> {
  refundableAmount(payment);
  return deepFreeze({
    schemaVersion: FINANCIAL_PERSISTENCE_SCHEMA_VERSION,
    paymentId: payment.paymentId,
    eventId: payment.eventId,
    restaurantId: payment.restaurantId,
    branchId: payment.branchId,
    orderId: payment.orderId,
    amount: encodeMoney(payment.amount),
    method: payment.method,
    ...(payment.cardManualEvidence === undefined ? {} : { cardManualEvidence: { ...payment.cardManualEvidence } }),
    idempotencyKey: payment.idempotencyKey,
    state: payment.state,
    transitions: payment.transitions.map((transition) => ({
      eventId: transition.eventId,
      idempotencyKey: transition.idempotencyKey,
      from: transition.from,
      to: transition.to,
      evidence: encodePaymentEvidence(transition.evidence),
    })),
    refunds: payment.refunds.map((refund) => ({
      refundId: refund.refundId,
      eventId: refund.eventId,
      paymentId: refund.paymentId,
      restaurantId: refund.restaurantId,
      branchId: refund.branchId,
      orderId: refund.orderId,
      amount: encodeMoney(refund.amount),
      idempotencyKey: refund.idempotencyKey,
      evidence: encodePaymentEvidence(refund.evidence),
    })),
  });
}

function encodeMovement(movement: CashMovement): PersistedCashMovementV1 {
  return deepFreeze({
    ...movement,
    amount: encodeMoney(movement.amount),
    ...(movement.source === undefined ? {} : { source: { ...movement.source } }),
  });
}

function decodeMovement(value: unknown): CashMovement {
  const record = exactRecord(value, [
    "movementId", "eventId", "idempotencyKey", "restaurantId", "branchId", "cashRegisterId", "registerId",
    "shiftId", "cashierId", "actorId", "deviceId", "localSequence", "occurredAt", "type", "direction", "amount",
  ], ["source", "compensatesMovementId", "reason"]);
  const source = record.source === undefined ? undefined : decodeSource(record.source);
  return deepFreeze({
    movementId: string(record.movementId), eventId: string(record.eventId), idempotencyKey: string(record.idempotencyKey),
    restaurantId: string(record.restaurantId), branchId: string(record.branchId), cashRegisterId: string(record.cashRegisterId),
    registerId: string(record.registerId), shiftId: string(record.shiftId), cashierId: string(record.cashierId),
    actorId: string(record.actorId), deviceId: string(record.deviceId), localSequence: number(record.localSequence),
    occurredAt: string(record.occurredAt), type: record.type as CashMovement["type"],
    direction: record.direction as CashMovement["direction"], amount: decodeMoney(record.amount),
    ...(source === undefined ? {} : { source }),
    ...optionalString(record, "compensatesMovementId"), ...optionalString(record, "reason"),
  });
}

function decodeSource(value: unknown): CashMovementSource {
  const base = exactRecord(value, ["type", "paymentId"], ["refundId"]);
  if (base.type === "payment" && base.refundId === undefined) {
    return deepFreeze({ type: "payment", paymentId: string(base.paymentId) });
  }
  if (base.type === "refund" && base.refundId !== undefined) {
    return deepFreeze({ type: "refund", paymentId: string(base.paymentId), refundId: string(base.refundId) });
  }
  throw invalid();
}

function encodePaymentEvidence(evidence: PaymentAuditEvidence): Readonly<Record<string, unknown>> {
  return deepFreeze({
    actorId: evidence.actorId, branchId: evidence.branchId, deviceId: evidence.deviceId, occurredAt: evidence.occurredAt,
    ...(evidence.reason === undefined ? {} : { reason: evidence.reason }),
    ...(evidence.authorization === undefined ? {} : { authorization: { ...evidence.authorization } }),
  });
}

function encodeMoney(value: Money): PersistedMoneyV1 {
  return Object.freeze({ amountMinor: value.amountMinor, currency: value.currency });
}

function decodeMoney(value: unknown): Money {
  const record = exactRecord(value, ["amountMinor", "currency"], []);
  return new Money(number(record.amountMinor), string(record.currency));
}

function optionalString(record: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, string>> {
  return record[key] === undefined ? Object.freeze({}) : Object.freeze({ [key]: string(record[key]) });
}

function optionalMoney(record: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, Money>> {
  return record[key] === undefined ? Object.freeze({}) : Object.freeze({ [key]: decodeMoney(record[key]) });
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => typeof key !== "string" || !required.includes(key) && !optional.includes(key))) throw invalid();
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw invalid();
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalid();
  return value;
}

function invalid(): Error { return new Error("FINANCIAL_PERSISTENCE_RECORD_INVALID"); }

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
