import type { DeliveryAddressFacts, DeliveryZone } from "./delivery-zone.js";
import { findDeliveryZone } from "./delivery-zone.js";
import {
  DeliveryManualFeeAuthorizationRequiredError,
  DeliveryManualFeeNotCoveredError,
  DeliveryOverrideReasonRequiredError,
  DeliveryScheduleCutoffError,
  DeliveryScheduleExceedsHorizonError,
  DeliveryScheduleInPastError,
  InvalidDeliveryOverrideWindowError,
  InvalidDeliveryQuoteFieldError,
  InvalidDeliveryTimestampError,
} from "./errors.js";
import { Money } from "./money.js";

/** Congelada en el quote (decisión 8.1.3): siempre 15 minutos exactos. */
const PROMISE_WINDOW_MS = 15 * 60 * 1000;
/** Decisión 8.1.4: cutoff de 30 minutos antes del inicio de la ventana. */
const SCHEDULE_CUTOFF_MS = 30 * 60 * 1000;
/** Tiempo de preparación de un pedido ASAP: la ventana prometida inicia a quotedAt + 30 minutos. */
export const DELIVERY_ASAP_PREPARATION_MS = SCHEDULE_CUTOFF_MS;
/** Vigencia de una cotización ASAP desde quotedAt: 15 minutos (política `asap_ttl`). */
export const DELIVERY_ASAP_QUOTE_TTL_MS = 15 * 60 * 1000;
/** Decisión 8.1.4: horizonte de 7 días para pedidos programados. */
const SCHEDULE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Named expiry policy for §8.1 decisión 3 ("promesa como ventana de 15
 * minutos congelada en el quote"): a quote is authoritative only until its
 * promised window begins. S7.2 may replace this with a `quotedAt + X`
 * policy (a separate quoting TTL, decoupled from the promise window) if
 * Emmanuel decides a quote should also expire before it is ever promised —
 * that would require a distinct named policy, not a silent change here.
 */
export const DELIVERY_QUOTE_EXPIRY_POLICY = "promise_start" as const;
/** Política de expiración de cotizaciones ASAP: quotedAt + 15 minutos (la promesa inicia después). */
export const DELIVERY_ASAP_QUOTE_EXPIRY_POLICY = "quoted_at_ttl" as const;

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type DeliveryQuoteCoverageStatus = "covered" | "not_covered";

export type DeliveryManualFeeRole = "owner" | "admin" | "manager" | "supervisor";

const DELIVERY_MANUAL_FEE_ROLES: readonly string[] = Object.freeze(["owner", "admin", "manager", "supervisor"]);

/**
 * Supervisor-authorized manual fee for a not-covered delivery (Z3, §6.4). It is
 * frozen alongside the as-quoted facts, never replacing them, and records who
 * authorized it, why, and the authorization instant (`overriddenAt`), so
 * re-quoting without changes produces the same quote id.
 */
export interface DeliveryQuoteOverride {
  readonly kind: "manual_fee";
  readonly eventId: string;
  readonly actorId: string;
  readonly role: DeliveryManualFeeRole;
  readonly reason: string;
  readonly feeMinor: Money;
  readonly promiseStart: string;
  readonly promiseEnd: string;
  readonly overriddenAt: string;
}

export interface ApplyDeliveryManualFeeInput {
  readonly eventId: string;
  readonly actorId: string;
  readonly role: string;
  readonly reason: string;
  readonly feeMinor: Money;
  /** Defaults to the quote's own promise window when omitted. */
  readonly promiseStart?: string;
  readonly promiseEnd?: string;
  /** Authorization instant; stable across re-quotes (never the re-quote instant). */
  readonly overriddenAt: string;
}

/**
 * A versioned coverage/promise decision, frozen once calculated. `zoneId` and
 * `feeMinor`/`promiseStart`/`promiseEnd` reflect the as-quoted facts; an
 * `override`, when present, carries the manager-authorized effective values
 * without mutating the original quoted facts (decision 8.1.2/8.1.3).
 */
export interface DeliveryQuote {
  readonly quoteId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly captureDraftId: string;
  readonly addressSnapshotRef: string;
  readonly coverageStatus: DeliveryQuoteCoverageStatus;
  readonly zoneId: string | null;
  readonly feeMinor: Money;
  readonly currency: string;
  readonly promiseStart: string;
  readonly promiseEnd: string;
  readonly timeZone: string;
  readonly quotedAt: string;
  readonly expiresAt: string;
  readonly version: number;
  readonly override: DeliveryQuoteOverride | null;
}

export interface QuoteDeliveryInput {
  readonly quoteId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly captureDraftId: string;
  readonly addressSnapshotRef: string;
  readonly address: DeliveryAddressFacts;
  readonly zones: readonly DeliveryZone[];
  readonly currency: string;
  readonly timeZone: string;
  /** Instant the caller is quoting from; the domain never reads the clock itself. */
  readonly quotedAt: string;
  /** `null` requests the soonest possible window; otherwise the desired window start. */
  readonly scheduledFor: string | null;
  readonly version: number;
}

/**
 * Calculates a delivery coverage/promise quote. Pure: every timestamp is
 * supplied by the caller (never `Date.now`), so the same input always
 * produces the same frozen output (approved decision: idempotent quoting).
 */
export function quoteDelivery(input: QuoteDeliveryInput): DeliveryQuote {
  assertNonEmptyText(input.quoteId, "quoteId");
  assertNonEmptyText(input.restaurantId, "restaurantId");
  assertNonEmptyText(input.branchId, "branchId");
  assertNonEmptyText(input.captureDraftId, "captureDraftId");
  assertNonEmptyText(input.addressSnapshotRef, "addressSnapshotRef");
  if (!Array.isArray(input.zones)) throw new InvalidDeliveryQuoteFieldError("zones");
  for (const zone of input.zones) {
    if (zone.restaurantId !== input.restaurantId || zone.branchId !== input.branchId) {
      throw new InvalidDeliveryQuoteFieldError("zones");
    }
  }
  const currency = new Money(0, input.currency).currency;
  assertTimeZone(input.timeZone);
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new InvalidDeliveryQuoteFieldError("version");
  }

  const quotedAtMs = parseTimestamp(input.quotedAt, "quotedAt");
  const promiseStartMs = resolvePromiseStartMs(quotedAtMs, input.scheduledFor);
  const promiseEndMs = promiseStartMs + PROMISE_WINDOW_MS;
  // ASAP: vigencia propia desde quotedAt; programada: expira cuando inicia la ventana prometida.
  const expiresAtMs = input.scheduledFor === null ? quotedAtMs + DELIVERY_ASAP_QUOTE_TTL_MS : promiseStartMs;

  const zone = findDeliveryZone(input.zones, input.address);
  const coverageStatus: DeliveryQuoteCoverageStatus = zone === undefined ? "not_covered" : "covered";
  const feeMinor = zone === undefined ? new Money(0, currency) : matchCurrency(zone.feeMinor, currency);

  return Object.freeze({
    quoteId: input.quoteId,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    captureDraftId: input.captureDraftId,
    addressSnapshotRef: input.addressSnapshotRef,
    coverageStatus,
    zoneId: zone?.zoneId ?? null,
    feeMinor,
    currency,
    promiseStart: serializeTimestamp(promiseStartMs, "promiseStart"),
    promiseEnd: serializeTimestamp(promiseEndMs, "promiseEnd"),
    timeZone: input.timeZone,
    quotedAt: input.quotedAt,
    // Programada: DELIVERY_QUOTE_EXPIRY_POLICY ("promise_start"); ASAP: DELIVERY_ASAP_QUOTE_EXPIRY_POLICY.
    expiresAt: serializeTimestamp(expiresAtMs, "expiresAt"),
    version: input.version,
    override: null,
  });
}

/**
 * Applies a supervisor-authorized manual fee to a not-covered quote. Never
 * mutates the original quote's `feeMinor`/`promiseStart`/`promiseEnd`; it
 * returns a new frozen quote carrying the authorization alongside the
 * as-quoted facts (Z3, §6.4). Only an owner/admin/manager/supervisor role and
 * a non-empty reason are accepted; the fee window defaults to the quote's own
 * promise window.
 */
export function applyDeliveryManualFee(
  quote: DeliveryQuote,
  input: ApplyDeliveryManualFeeInput,
): DeliveryQuote {
  if (quote.coverageStatus !== "not_covered") {
    throw new DeliveryManualFeeNotCoveredError();
  }
  if (typeof input.role !== "string" || !DELIVERY_MANUAL_FEE_ROLES.includes(input.role)) {
    throw new DeliveryManualFeeAuthorizationRequiredError();
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new DeliveryOverrideReasonRequiredError();
  }
  assertNonEmptyText(input.eventId, "eventId");
  assertNonEmptyText(input.actorId, "actorId");
  const feeMinor = matchCurrency(input.feeMinor, quote.currency);
  const promiseStart = input.promiseStart ?? quote.promiseStart;
  const promiseEnd = input.promiseEnd ?? quote.promiseEnd;
  const startMs = parseTimestamp(promiseStart, "promiseStart");
  const endMs = parseTimestamp(promiseEnd, "promiseEnd");
  if (startMs >= endMs) {
    throw new InvalidDeliveryOverrideWindowError();
  }
  const overriddenAtMs = parseTimestamp(input.overriddenAt, "overriddenAt");

  const override: DeliveryQuoteOverride = Object.freeze({
    kind: "manual_fee",
    eventId: input.eventId,
    actorId: input.actorId,
    role: input.role as DeliveryManualFeeRole,
    reason: input.reason,
    feeMinor,
    promiseStart: serializeTimestamp(startMs, "promiseStart"),
    promiseEnd: serializeTimestamp(endMs, "promiseEnd"),
    overriddenAt: serializeTimestamp(overriddenAtMs, "overriddenAt"),
  });

  return Object.freeze({ ...quote, override });
}

/**
 * The fee the customer is actually charged: the authorized manual fee when
 * present, otherwise the zone fee. Centralized so UI, API and reports agree.
 */
export function deliveryQuoteEffectiveFeeMinor(quote: DeliveryQuote): Money {
  return quote.override?.feeMinor ?? quote.feeMinor;
}

function resolvePromiseStartMs(quotedAtMs: number, scheduledFor: string | null): number {
  if (scheduledFor === null) return quotedAtMs + DELIVERY_ASAP_PREPARATION_MS;

  const scheduledMs = parseTimestamp(scheduledFor, "scheduledFor");
  if (scheduledMs <= quotedAtMs) {
    throw new DeliveryScheduleInPastError();
  }
  if (scheduledMs - quotedAtMs > SCHEDULE_HORIZON_MS) {
    throw new DeliveryScheduleExceedsHorizonError();
  }
  if (scheduledMs - quotedAtMs < SCHEDULE_CUTOFF_MS) {
    throw new DeliveryScheduleCutoffError();
  }
  return scheduledMs;
}

function matchCurrency(money: Money, currency: string): Money {
  if (!(money instanceof Money) || money.currency !== currency) {
    throw new InvalidDeliveryQuoteFieldError("feeMinor");
  }
  return money;
}

function assertNonEmptyText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidDeliveryQuoteFieldError(field);
  }
}

/** Mirrors packages/domain/src/order-totals.ts's IANA time zone validation. */
function assertTimeZone(timeZone: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new InvalidDeliveryQuoteFieldError("timeZone");
  }
}

function parseTimestamp(value: unknown, field: string): number {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) {
    throw new InvalidDeliveryTimestampError(field);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new InvalidDeliveryTimestampError(field);
  }
  return date.getTime();
}

function serializeTimestamp(milliseconds: number, field: string): string {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new InvalidDeliveryTimestampError(field);
  }
  const result = date.toISOString();
  if (!UTC_TIMESTAMP_PATTERN.test(result)) {
    throw new InvalidDeliveryTimestampError(field);
  }
  return result;
}
