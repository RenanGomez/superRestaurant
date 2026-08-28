import "reflect-metadata";

import { Inject, Injectable, Module, type DynamicModule } from "@nestjs/common";

import type { OrderRecord } from "../../../src/model.js";
import type { CriticalOrderWritePort, VerifiedSupabaseServerCreateOrderCommand } from "./adapter.js";
import {
  SupabaseAuthPrincipalVerifier,
  type AuthPrincipalVerifierPort,
} from "./auth-principal.js";
import { readSupabaseAdr010ServerConfig, type SupabaseAdr010ServerConfig } from "./config.js";
import type {
  CashPaymentRecord,
  CashRefundRecord,
  CriticalFinancialWritePort,
  SupabaseCreateCashPaymentRequest,
  SupabaseCreateCashRefundRequest,
} from "./financial-contract.js";

export const SUPABASE_ADR010_CRITICAL_WRITE_PORT = Symbol("SUPABASE_ADR010_CRITICAL_WRITE_PORT");
export const SUPABASE_ADR010_AUTH_PRINCIPAL_VERIFIER = Symbol("SUPABASE_ADR010_AUTH_PRINCIPAL_VERIFIER");
export const SUPABASE_ADR010_CRITICAL_FINANCIAL_WRITE_PORT = Symbol("SUPABASE_ADR010_CRITICAL_FINANCIAL_WRITE_PORT");

/** External request shape. It intentionally has no caller-controlled actorId. */
export interface SupabaseCreateOrderRequest {
  readonly accessToken: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly idempotencyKey: string;
  readonly lines: VerifiedSupabaseServerCreateOrderCommand["lines"];
  readonly induceFailureAfterOrder?: boolean;
}

/**
 * The sole application-level entry point scaffolded for the spike's critical
 * Order write. It verifies the bearer token before constructing the internal
 * command, so only the verified Supabase subject can reach the write port.
 */
@Injectable()
export class SupabaseAdr010CriticalOrderService {
  public constructor(
    @Inject(SUPABASE_ADR010_CRITICAL_WRITE_PORT) private readonly criticalWritePort: CriticalOrderWritePort,
    @Inject(SUPABASE_ADR010_AUTH_PRINCIPAL_VERIFIER) private readonly principalVerifier: AuthPrincipalVerifierPort,
  ) {}

  public async createOrder(input: SupabaseCreateOrderRequest): Promise<OrderRecord> {
    if (input.lines.length === 0) throw new Error("A critical order must contain at least one line.");
    const principal = await this.principalVerifier.verifyAccessToken(input.accessToken);
    return this.criticalWritePort.createOrder({
      principal,
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      idempotencyKey: input.idempotencyKey,
      lines: input.lines,
      ...(input.induceFailureAfterOrder === undefined ? {} : { induceFailureAfterOrder: input.induceFailureAfterOrder }),
    });
  }

  public static validateEnvironment(environment: NodeJS.ProcessEnv): SupabaseAdr010ServerConfig {
    return readSupabaseAdr010ServerConfig(environment);
  }
}

/**
 * Sole application entry for cash payment/refund writes. Like Order, every
 * request first becomes a verified Auth principal and then reaches private SQL
 * through an injected server-only PostgreSQL port.
 */
@Injectable()
export class SupabaseAdr010CriticalFinancialService {
  public constructor(
    @Inject(SUPABASE_ADR010_CRITICAL_FINANCIAL_WRITE_PORT) private readonly criticalWritePort: CriticalFinancialWritePort,
    @Inject(SUPABASE_ADR010_AUTH_PRINCIPAL_VERIFIER) private readonly principalVerifier: AuthPrincipalVerifierPort,
  ) {}

  public async createCashPayment(input: SupabaseCreateCashPaymentRequest): Promise<CashPaymentRecord> {
    assertCashPaymentRequest(input);
    const principal = await this.principalVerifier.verifyAccessToken(input.accessToken);
    assertVerifiedPrincipal(principal);
    return this.criticalWritePort.createCashPayment({
      principal,
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      orderId: input.orderId,
      idempotencyKey: input.idempotencyKey,
      amountMinor: input.amountMinor,
      currency: input.currency,
      deviceId: input.deviceId,
      localSequence: input.localSequence,
      occurredAt: input.occurredAt,
      ...(input.induceFailureAfterPayment === undefined ? {} : { induceFailureAfterPayment: input.induceFailureAfterPayment }),
    });
  }

  public async refundCashPayment(input: SupabaseCreateCashRefundRequest): Promise<CashRefundRecord> {
    assertCashRefundRequest(input);
    const principal = await this.principalVerifier.verifyAccessToken(input.accessToken);
    assertVerifiedPrincipal(principal);
    const supervisor = await this.principalVerifier.verifyAccessToken(input.supervisorAccessToken);
    assertVerifiedPrincipal(supervisor, "ADR010_REFUND_AUTHORIZATION_REQUIRED");
    return this.criticalWritePort.refundCashPayment({
      principal,
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      idempotencyKey: input.idempotencyKey,
      amountMinor: input.amountMinor,
      currency: input.currency,
      deviceId: input.deviceId,
      localSequence: input.localSequence,
      occurredAt: input.occurredAt,
      reason: input.reason,
      authorization: { approved: true, actorId: supervisor.actorId },
      ...(input.induceFailureAfterRefund === undefined ? {} : { induceFailureAfterRefund: input.induceFailureAfterRefund }),
    });
  }
}

const assertSafePositiveInteger: (value: unknown, errorCode: string) => asserts value is number = (value, errorCode) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(errorCode);
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function assertRequestObject(value: unknown, errorCode: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(errorCode);
}

function assertNonEmptyBoundedString(value: unknown, min: number, max: number, errorCode: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) throw new Error(errorCode);
}

function assertNonEmptyString(value: unknown, errorCode: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(errorCode);
}

function assertUuid(value: unknown, errorCode: string): asserts value is string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error(errorCode);
}

function assertCurrency(value: unknown, errorCode: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/u.test(value)) throw new Error(errorCode);
}

function assertTimestamp(value: unknown, errorCode: string): asserts value is string {
  if (typeof value !== "string" || !timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(errorCode);
}

const assertOptionalBoolean = (value: unknown, errorCode: string): void => {
  if (value !== undefined && typeof value !== "boolean") throw new Error(errorCode);
};

function assertCashPaymentRequest(value: unknown): asserts value is SupabaseCreateCashPaymentRequest {
  assertRequestObject(value, "ADR010_INVALID_CASH_PAYMENT_INPUT");
  assertNonEmptyString(value.accessToken, "SUPABASE_ACCESS_TOKEN_REJECTED");
  assertSafePositiveInteger(value.amountMinor, "ADR010_INVALID_CASH_PAYMENT_AMOUNT");
  assertSafePositiveInteger(value.localSequence, "ADR010_INVALID_FINANCIAL_LOCAL_SEQUENCE");
  for (const field of ["restaurantId", "branchId", "orderId"] as const) assertUuid(value[field], "ADR010_INVALID_CASH_PAYMENT_INPUT");
  assertNonEmptyBoundedString(value.idempotencyKey, 1, 200, "ADR010_INVALID_CASH_PAYMENT_INPUT");
  assertNonEmptyBoundedString(value.deviceId, 1, 200, "ADR010_INVALID_CASH_PAYMENT_INPUT");
  assertCurrency(value.currency, "ADR010_INVALID_CASH_PAYMENT_INPUT");
  assertTimestamp(value.occurredAt, "ADR010_INVALID_CASH_PAYMENT_INPUT");
  assertOptionalBoolean(value.induceFailureAfterPayment, "ADR010_INVALID_CASH_PAYMENT_INPUT");
}

function assertCashRefundRequest(value: unknown): asserts value is SupabaseCreateCashRefundRequest {
  assertRequestObject(value, "ADR010_INVALID_CASH_REFUND_INPUT");
  assertNonEmptyString(value.accessToken, "SUPABASE_ACCESS_TOKEN_REJECTED");
  assertNonEmptyString(value.supervisorAccessToken, "SUPABASE_ACCESS_TOKEN_REJECTED");
  assertSafePositiveInteger(value.amountMinor, "ADR010_INVALID_CASH_REFUND_AMOUNT");
  assertSafePositiveInteger(value.localSequence, "ADR010_INVALID_FINANCIAL_LOCAL_SEQUENCE");
  for (const field of ["restaurantId", "branchId", "orderId", "paymentId"] as const) assertUuid(value[field], "ADR010_INVALID_CASH_REFUND_INPUT");
  assertNonEmptyBoundedString(value.idempotencyKey, 1, 200, "ADR010_INVALID_CASH_REFUND_INPUT");
  assertNonEmptyBoundedString(value.deviceId, 1, 200, "ADR010_INVALID_CASH_REFUND_INPUT");
  assertCurrency(value.currency, "ADR010_INVALID_CASH_REFUND_INPUT");
  assertTimestamp(value.occurredAt, "ADR010_INVALID_CASH_REFUND_INPUT");
  assertNonEmptyBoundedString(value.reason, 1, 500, "ADR010_INVALID_CASH_REFUND_INPUT");
  assertOptionalBoolean(value.induceFailureAfterRefund, "ADR010_INVALID_CASH_REFUND_INPUT");
}

function assertVerifiedPrincipal(value: unknown, emptyErrorCode = "SUPABASE_ACCESS_TOKEN_REJECTED"): asserts value is { readonly actorId: string } {
  if (!isRecord(value) || typeof value.actorId !== "string" || value.actorId.trim() === "") throw new Error(emptyErrorCode);
  if (!uuidPattern.test(value.actorId)) throw new Error("SUPABASE_ACCESS_TOKEN_REJECTED");
}

@Module({})
export class SupabaseNestAdr010Module {
  public static register(
    config: SupabaseAdr010ServerConfig,
    criticalWritePort: CriticalOrderWritePort,
    criticalFinancialWritePort?: CriticalFinancialWritePort,
    principalVerifier: AuthPrincipalVerifierPort = new SupabaseAuthPrincipalVerifier(config),
  ): DynamicModule {
    return {
      module: SupabaseNestAdr010Module,
      providers: [
        { provide: SUPABASE_ADR010_CRITICAL_WRITE_PORT, useValue: criticalWritePort },
        ...(criticalFinancialWritePort === undefined ? [] : [{ provide: SUPABASE_ADR010_CRITICAL_FINANCIAL_WRITE_PORT, useValue: criticalFinancialWritePort }]),
        { provide: SUPABASE_ADR010_AUTH_PRINCIPAL_VERIFIER, useValue: principalVerifier },
        {
          provide: SupabaseAdr010CriticalOrderService,
          useFactory: (port: CriticalOrderWritePort, verifier: AuthPrincipalVerifierPort) =>
            new SupabaseAdr010CriticalOrderService(port, verifier),
          inject: [SUPABASE_ADR010_CRITICAL_WRITE_PORT, SUPABASE_ADR010_AUTH_PRINCIPAL_VERIFIER],
        },
        ...(criticalFinancialWritePort === undefined ? [] : [{
          provide: SupabaseAdr010CriticalFinancialService,
          useFactory: (port: CriticalFinancialWritePort, verifier: AuthPrincipalVerifierPort) =>
            new SupabaseAdr010CriticalFinancialService(port, verifier),
          inject: [SUPABASE_ADR010_CRITICAL_FINANCIAL_WRITE_PORT, SUPABASE_ADR010_AUTH_PRINCIPAL_VERIFIER],
        }]),
      ],
      exports: [SupabaseAdr010CriticalOrderService, ...(criticalFinancialWritePort === undefined ? [] : [SupabaseAdr010CriticalFinancialService])],
    };
  }
}
