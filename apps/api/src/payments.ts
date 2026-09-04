import {
  parseCashRegisterSummaryV1,
  parseCloseCashRegisterCommandV1,
  parseCollectPaymentCommandV1,
  parseOpenCashRegisterCommandV1,
  parsePaymentCollectionSummaryV1,
  type BranchScope,
  type CashRegisterSummaryV1,
  type CloseCashRegisterCommandV1,
  type CollectPaymentCommandV1,
  type OpenCashRegisterCommandV1,
  type PaymentCollectionSummaryV1,
} from "@super-restaurant/shared-types";
import {
  Money,
  appendCashMovement,
  calculateOrderAggregateTotals,
  closeCashRegister,
  createPayment,
  openCashRegister,
  transitionOrderStatus,
  transitionPayment,
  type CashRegister,
  type Order,
  type Payment,
} from "@super-restaurant/domain";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";
import { ORDER_PERSISTENCE_PORT, type OrderPersistencePort } from "./orders.js";
import {
  decodeCashRegisterRecord,
  encodeCashRegisterRecord,
  encodePaymentRecord,
} from "./persistence/financial-persistence-codec.js";
import { encodeOrderRecord } from "./persistence/order-persistence-codec.js";

const readRegisterSql = "select app_private.read_cash_register($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid) as result";
const openRegisterSql = "select app_private.open_cash_register($1::uuid,$2::jsonb,$3::jsonb) as result";
const collectPaymentSql = "select app_private.collect_simple_payment($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::bigint,$7::bigint) as result";
const closeRegisterSql = "select app_private.close_cash_register($1::uuid,$2::jsonb,$3::jsonb) as result";
const replayFinancialCommandSql = "select app_private.replay_financial_command($1::uuid,$2::text,$3::jsonb) as result";

export type FinancialApplicationErrorCode = "authorization" | "conflict" | "not_found" | "request" | "unavailable";

export class FinancialApplicationError extends Error {
  public constructor(public readonly code: FinancialApplicationErrorCode) {
    super(`FINANCIAL_${code.toUpperCase()}`);
    this.name = "FinancialApplicationError";
  }
}

export interface StoredCashRegister {
  readonly capturedAmountMinor: number;
  readonly register: CashRegister;
  readonly version: number;
}

export interface PersistPaymentInput {
  readonly command: CollectPaymentCommandV1;
  readonly order: Order;
  readonly orderTotalMinor: number;
  readonly payment: Payment;
  readonly priorCapturedAmountMinor: number;
  readonly register: CashRegister;
}

export type FinancialMutationResult<T> = T | "conflict" | "forbidden";
export type FinancialReplayResult<T> = FinancialMutationResult<T> | "missing";

export interface FinancialPersistencePort {
  close(actorId: string, command: CloseCashRegisterCommandV1, register: CashRegister): Promise<FinancialMutationResult<CashRegisterSummaryV1>>;
  collect(actorId: string, input: PersistPaymentInput): Promise<FinancialMutationResult<PaymentCollectionSummaryV1>>;
  open(actorId: string, command: OpenCashRegisterCommandV1, register: CashRegister): Promise<FinancialMutationResult<CashRegisterSummaryV1>>;
  read(actorId: string, scope: BranchScope, cashRegisterSessionId: string, orderId?: string): Promise<StoredCashRegister | "missing">;
  replayClose(actorId: string, command: CloseCashRegisterCommandV1): Promise<FinancialReplayResult<CashRegisterSummaryV1>>;
  replayCollect(actorId: string, command: CollectPaymentCommandV1): Promise<FinancialReplayResult<PaymentCollectionSummaryV1>>;
  replayOpen(actorId: string, command: OpenCashRegisterCommandV1): Promise<FinancialReplayResult<CashRegisterSummaryV1>>;
}

export const FINANCIAL_PERSISTENCE_PORT = Symbol("FINANCIAL_PERSISTENCE_PORT");

@Injectable()
export class PostgresFinancialPersistenceAdapter implements FinancialPersistencePort {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClientPort) {}

  public async read(
    actorId: string,
    scope: BranchScope,
    cashRegisterSessionId: string,
    orderId?: string,
  ): Promise<StoredCashRegister | "missing"> {
    const result = await this.database.query(readRegisterSql, [
      actorId, scope.restaurantId, scope.branchId, cashRegisterSessionId, orderId ?? null,
    ]);
    const raw = singleResult(result.rows);
    if (raw === null) return "missing";
    const record = exactRecord(raw, ["schemaVersion", "scope", "register", "version", "capturedAmountMinor"]);
    if (record === undefined || own(record, "schemaVersion") !== 1 || !sameScope(own(record, "scope"), scope)) throw unavailable();
    const version = positiveInteger(own(record, "version"));
    const capturedAmountMinor = nonNegativeInteger(own(record, "capturedAmountMinor"));
    let register: CashRegister;
    try { register = decodeCashRegisterRecord(own(record, "register")); } catch { throw unavailable(); }
    if (version === undefined || capturedAmountMinor === undefined || register.cashRegisterId !== cashRegisterSessionId
      || register.restaurantId !== scope.restaurantId || register.branchId !== scope.branchId) throw unavailable();
    return Object.freeze({ capturedAmountMinor, register, version });
  }

  public async open(
    actorId: string,
    command: OpenCashRegisterCommandV1,
    register: CashRegister,
  ): Promise<FinancialMutationResult<CashRegisterSummaryV1>> {
    const raw = await this.call(openRegisterSql, [actorId, JSON.stringify(command), JSON.stringify(encodeCashRegisterRecord(register))]);
    return parseMutation(raw, parseCashRegisterSummaryV1);
  }

  public async collect(
    actorId: string,
    input: PersistPaymentInput,
  ): Promise<FinancialMutationResult<PaymentCollectionSummaryV1>> {
    const raw = await this.call(collectPaymentSql, [
      actorId,
      JSON.stringify(input.command),
      JSON.stringify(encodePaymentRecord(input.payment)),
      JSON.stringify(encodeOrderRecord(input.order)),
      JSON.stringify(encodeCashRegisterRecord(input.register)),
      input.orderTotalMinor,
      input.priorCapturedAmountMinor,
    ]);
    return parseMutation(raw, parsePaymentCollectionSummaryV1);
  }

  public async close(
    actorId: string,
    command: CloseCashRegisterCommandV1,
    register: CashRegister,
  ): Promise<FinancialMutationResult<CashRegisterSummaryV1>> {
    const raw = await this.call(closeRegisterSql, [actorId, JSON.stringify(command), JSON.stringify(encodeCashRegisterRecord(register))]);
    return parseMutation(raw, parseCashRegisterSummaryV1);
  }

  public replayOpen(actorId: string, command: OpenCashRegisterCommandV1): Promise<FinancialReplayResult<CashRegisterSummaryV1>> {
    return this.replay(actorId, "cash_register.opened", command, parseCashRegisterSummaryV1);
  }

  public replayCollect(actorId: string, command: CollectPaymentCommandV1): Promise<FinancialReplayResult<PaymentCollectionSummaryV1>> {
    return this.replay(actorId, "payment.captured", command, parsePaymentCollectionSummaryV1);
  }

  public replayClose(actorId: string, command: CloseCashRegisterCommandV1): Promise<FinancialReplayResult<CashRegisterSummaryV1>> {
    return this.replay(actorId, "cash_register.closed", command, parseCashRegisterSummaryV1);
  }

  private async replay<T>(
    actorId: string,
    operation: "cash_register.closed" | "cash_register.opened" | "payment.captured",
    command: FinancialAuditCommand,
    parser: (value: unknown) => T | undefined,
  ): Promise<FinancialReplayResult<T>> {
    const raw = await this.call(replayFinancialCommandSql, [actorId, operation, JSON.stringify(command)]);
    if (raw === null) return "missing";
    return parseMutation(raw, parser);
  }

  private async call(sql: string, parameters: readonly unknown[]): Promise<unknown> {
    const result = await this.database.query(sql, parameters);
    return singleResult(result.rows);
  }
}

@Injectable()
export class FinancialService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(FINANCIAL_PERSISTENCE_PORT) private readonly finances: FinancialPersistencePort,
    @Inject(ORDER_PERSISTENCE_PORT) private readonly orders: OrderPersistencePort,
  ) {}

  public async open(principal: AuthenticatedPrincipal, input: unknown): Promise<CashRegisterSummaryV1> {
    const command = parseOpenCashRegisterCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "cash-register.manage");
    const replay = await this.replay(() => this.finances.replayOpen(actorId, command));
    if (replay !== "missing") return replay;
    let register: CashRegister;
    try {
      register = openCashRegister({
        cashRegisterId: command.cashRegisterSessionId,
        restaurantId: command.scope.restaurantId,
        branchId: command.scope.branchId,
        registerId: command.registerId,
        shiftId: command.shiftId,
        cashierId: actorId,
        openingFloat: new Money(command.openingFloatMinor, command.currency),
        evidence: evidence(command, actorId),
      }).register;
    } catch { throw applicationError("request"); }
    return this.mutation(() => this.finances.open(actorId, command, register));
  }

  public async collect(principal: AuthenticatedPrincipal, input: unknown): Promise<PaymentCollectionSummaryV1> {
    const command = parseCollectPaymentCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "payments.collect");
    const replay = await this.replay(() => this.finances.replayCollect(actorId, command));
    if (replay !== "missing") return replay;
    const storedOrder = await this.readOrder(actorId, command);
    const storedRegister = await this.readRegister(actorId, command.scope, command.cashRegisterSessionId, command.orderId);
    if (storedRegister.version !== command.cashRegisterExpectedVersion || storedOrder.version !== command.orderExpectedVersion) {
      throw applicationError("conflict");
    }
    const order = storedOrder.order;
    const register = storedRegister.register;
    if ((order.status !== "open" && order.status !== "partially_paid") || register.status !== "open"
      || register.currency !== order.currency) throw applicationError("conflict");

    let totalMinor: number;
    try { totalMinor = calculateOrderAggregateTotals(order).total.amountMinor; } catch { throw applicationError("request"); }
    const remaining = totalMinor - storedRegister.capturedAmountMinor;
    if (!Number.isSafeInteger(remaining) || remaining <= 0 || command.amountMinor > remaining) throw applicationError("conflict");
    const resultingStatus = command.amountMinor === remaining ? "paid" : "partially_paid";
    const audit = evidence(command, actorId);
    let payment: Payment;
    let resultingOrder: Order;
    let resultingRegister = register;
    try {
      const initiated = createPayment({
        paymentId: command.paymentId,
        eventId: command.eventId,
        restaurantId: command.scope.restaurantId,
        branchId: command.scope.branchId,
        orderId: command.orderId,
        amount: new Money(command.amountMinor, order.currency),
        method: command.method,
        ...(command.cardManualEvidence === null ? {} : {
          cardManualEvidence: {
            externalConfirmed: true,
            provider: command.cardManualEvidence.provider,
            terminalId: command.cardManualEvidence.terminalId,
            ...(command.cardManualEvidence.reference === null ? {} : { reference: command.cardManualEvidence.reference }),
          },
        }),
        idempotencyKey: command.idempotencyKey,
        evidence: audit,
      }).payment;
      const authorized = transitionPayment(initiated, {
        eventId: `${command.eventId}:authorized`, idempotencyKey: `${command.idempotencyKey}:authorized`,
        to: "authorized", evidence: audit,
      }).payment;
      payment = transitionPayment(authorized, {
        eventId: `${command.eventId}:captured`, idempotencyKey: `${command.idempotencyKey}:captured`,
        to: "captured", evidence: audit,
      }).payment;
      resultingOrder = order.status === resultingStatus
        ? order
        : transitionOrderStatus(order, resultingStatus, auditContext(command, actorId)).order;
      if (command.method === "cash") {
        resultingRegister = appendCashMovement(register, {
          movementId: command.paymentId,
          eventId: command.eventId,
          idempotencyKey: command.idempotencyKey,
          restaurantId: register.restaurantId,
          branchId: register.branchId,
          cashRegisterId: register.cashRegisterId,
          registerId: register.registerId,
          shiftId: register.shiftId,
          cashierId: register.cashierId,
          localSequence: command.localSequence,
          type: "cash_sale",
          direction: "in",
          amount: payment.amount,
          evidence: audit,
          sequenceContext: { deviceId: command.deviceId, expectedNextSequence: command.localSequence },
          source: { type: "payment", paymentId: command.paymentId },
        }).register;
      }
    } catch { throw applicationError("request"); }

    return this.mutation(() => this.finances.collect(actorId, {
      command, order: resultingOrder, orderTotalMinor: totalMinor, payment,
      priorCapturedAmountMinor: storedRegister.capturedAmountMinor, register: resultingRegister,
    }));
  }

  public async close(principal: AuthenticatedPrincipal, input: unknown): Promise<CashRegisterSummaryV1> {
    const command = parseCloseCashRegisterCommandV1(input);
    if (command === undefined) throw applicationError("request");
    const actorId = await this.authorize(principal, command.scope, "cash-register.manage");
    const replay = await this.replay(() => this.finances.replayClose(actorId, command));
    if (replay !== "missing") return replay;
    const stored = await this.readRegister(actorId, command.scope, command.cashRegisterSessionId);
    if (stored.version !== command.cashRegisterExpectedVersion) throw applicationError("conflict");
    let register: CashRegister;
    try {
      register = closeCashRegister(stored.register, {
        eventId: command.eventId,
        idempotencyKey: command.idempotencyKey,
        countedClosingBalance: new Money(command.countedClosingBalanceMinor, stored.register.currency),
        evidence: { ...evidence(command, actorId), ...(command.reason === null ? {} : { reason: command.reason }) },
      }).register;
    } catch { throw applicationError("request"); }
    return this.mutation(() => this.finances.close(actorId, command, register));
  }

  private async readOrder(actorId: string, command: CollectPaymentCommandV1) {
    try {
      const stored = await this.orders.read(actorId, command.scope, command.orderId);
      if (stored === "missing") throw applicationError("not_found");
      return stored;
    } catch (error: unknown) {
      if (error instanceof FinancialApplicationError) throw error;
      throw unavailable();
    }
  }

  private async readRegister(actorId: string, scope: BranchScope, id: string, orderId?: string): Promise<StoredCashRegister> {
    try {
      const stored = await this.finances.read(actorId, scope, id, orderId);
      if (stored === "missing") throw applicationError("not_found");
      return stored;
    } catch (error: unknown) {
      if (error instanceof FinancialApplicationError) throw error;
      throw unavailable();
    }
  }

  private async mutation<T>(operation: () => Promise<FinancialMutationResult<T>>): Promise<T> {
    let result: FinancialMutationResult<T>;
    try { result = await operation(); } catch { throw unavailable(); }
    if (result === "forbidden") throw applicationError("authorization");
    if (result === "conflict") throw applicationError("conflict");
    return result;
  }

  private async replay<T>(operation: () => Promise<FinancialReplayResult<T>>): Promise<T | "missing"> {
    let result: FinancialReplayResult<T>;
    try { result = await operation(); } catch { throw unavailable(); }
    if (result === "forbidden") throw applicationError("authorization");
    if (result === "conflict") throw applicationError("conflict");
    return result;
  }

  private async authorize(
    principal: AuthenticatedPrincipal,
    scope: BranchScope,
    permission: "cash-register.manage" | "payments.collect",
  ): Promise<string> {
    try { return (await this.authorization.authorizeBranch(principal, scope, permission)).principal.actorId; }
    catch { throw applicationError("authorization"); }
  }
}

function evidence(command: FinancialAuditCommand, actorId: string) {
  return Object.freeze({ actorId, branchId: command.scope.branchId, deviceId: command.deviceId, occurredAt: command.occurredAt });
}

function auditContext(command: CollectPaymentCommandV1, actorId: string) {
  return Object.freeze({ actorId, deviceId: command.deviceId, eventId: command.eventId, idempotencyKey: command.idempotencyKey, occurredAt: command.occurredAt });
}

type FinancialAuditCommand = OpenCashRegisterCommandV1 | CollectPaymentCommandV1 | CloseCashRegisterCommandV1;

function parseMutation<T>(raw: unknown, parser: (value: unknown) => T | undefined): FinancialMutationResult<T> {
  const minimal = exactRecord(raw, ["status"]);
  if (minimal !== undefined) {
    const status = own(minimal, "status");
    if (status === "conflict" || status === "forbidden") return status;
  }
  const parsed = parser(raw);
  if (parsed === undefined) throw unavailable();
  return parsed;
}

function singleResult(rows: readonly unknown[]): unknown {
  if (rows.length !== 1) throw unavailable();
  const row = exactRecord(rows[0], ["result"]);
  if (row === undefined) throw unavailable();
  return own(row, "result");
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch { return undefined; }
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function sameScope(value: unknown, scope: BranchScope): boolean {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  return record !== undefined && own(record, "restaurantId") === scope.restaurantId && own(record, "branchId") === scope.branchId;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function applicationError(code: FinancialApplicationErrorCode): FinancialApplicationError {
  return new FinancialApplicationError(code);
}

function unavailable(): FinancialApplicationError { return applicationError("unavailable"); }
