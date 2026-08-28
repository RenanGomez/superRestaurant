import type { AuthenticatedSupabasePrincipal } from "./auth-principal.js";

export interface CashPaymentRecord {
  readonly id: string;
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly cashMovementId: string;
  readonly localSequence: number;
}

export interface CashRefundRecord {
  readonly id: string;
  readonly paymentId: string;
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly cashMovementId: string;
  readonly localSequence: number;
}

export interface SupervisorRefundAuthorization {
  readonly approved: true;
  readonly actorId: string;
}

/** Internal-only command: actor identity is supplied solely by verified Auth. */
export interface VerifiedCashPaymentCommand {
  readonly principal: AuthenticatedSupabasePrincipal;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly deviceId: string;
  readonly localSequence: number;
  readonly occurredAt: string;
  readonly induceFailureAfterPayment?: boolean;
}

/** A refund is a new immutable compensating record; it never mutates Payment. */
export interface VerifiedCashRefundCommand {
  readonly principal: AuthenticatedSupabasePrincipal;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly deviceId: string;
  readonly localSequence: number;
  readonly occurredAt: string;
  readonly reason: string;
  readonly authorization: SupervisorRefundAuthorization;
  readonly induceFailureAfterRefund?: boolean;
}

/** The only critical Payment/CashMovement port; it must be server PostgreSQL. */
export interface CriticalFinancialWritePort {
  createCashPayment(command: VerifiedCashPaymentCommand): Promise<CashPaymentRecord>;
  refundCashPayment(command: VerifiedCashRefundCommand): Promise<CashRefundRecord>;
}

/** External request shapes intentionally omit actorId and any provider secret. */
export type SupabaseCreateCashPaymentRequest = Omit<VerifiedCashPaymentCommand, "principal"> & { readonly accessToken: string };
export type SupabaseCreateCashRefundRequest = Omit<VerifiedCashRefundCommand, "principal" | "authorization"> & {
  readonly accessToken: string;
  /** A separate bearer token owned by the approving supervisor. */
  readonly supervisorAccessToken: string;
};
