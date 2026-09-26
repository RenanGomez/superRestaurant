import type { DeliveryAddressFacts, DeliveryZone } from "./delivery-zone.js";
import { findDeliveryZone } from "./delivery-zone.js";
import {
  DeliveryOverrideAuthorizationRequiredError,
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

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type DeliveryQuoteCoverageStatus = "covered" | "not_covered";

/** Manager-authorized correction to a quote's effective fee and/or window (decision 8.1.2). */
export interface DeliveryQuoteOverride {
  readonly actorId: string;
  readonly role: "manager";
  readonly reason: string;
  readonly feeMinor: Money;
  readonly promiseStart: string;
  readonly promiseEnd: string;
  readonly overriddenAt: string;
}

export interface ApplyDeliveryQuoteOverrideInput {
  readonly actorId: string;
  readonly role: string;
  readonly reason: string;
  readonly feeMinor: Money;
  readonly promiseStart: string;
  readonly promiseEnd: string;
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
    // DELIVERY_QUOTE_EXPIRY_POLICY === "promise_start": the quote expires when its promised window begins.
    expiresAt: serializeTimestamp(promiseStartMs, "expiresAt"),
    version: input.version,
    override: null,
  });
}

/**
 * Applies a manager override to a quote's effective fee and promise window.
 * Never mutates the original quote's `feeMinor`/`promiseStart`/`promiseEnd`;
 * it returns a new frozen quote carrying the override alongside the
 * as-quoted facts (decision 8.1.2: override requires role=manager and a
 * non-empty reason; it is auditable and never silent).
 */
export function applyDeliveryQuoteOverride(
  quote: DeliveryQuote,
  input: ApplyDeliveryQuoteOverrideInput,
): DeliveryQuote {
  if (input.role !== "manager") {
    throw new DeliveryOverrideAuthorizationRequiredError();
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new DeliveryOverrideReasonRequiredError();
  }
  assertNonEmptyText(input.actorId, "actorId");
  const feeMinor = matchCurrency(input.feeMinor, quote.currency);
  const startMs = parseTimestamp(input.promiseStart, "promiseStart");
  const endMs = parseTimestamp(input.promiseEnd, "promiseEnd");
  if (startMs >= endMs) {
    throw new InvalidDeliveryOverrideWindowError();
  }
  const overriddenAtMs = parseTimestamp(input.overriddenAt, "overriddenAt");

  const override: DeliveryQuoteOverride = Object.freeze({
    actorId: input.actorId,
    role: "manager",
    reason: input.reason,
    feeMinor,
    promiseStart: serializeTimestamp(startMs, "promiseStart"),
    promiseEnd: serializeTimestamp(endMs, "promiseEnd"),
    overriddenAt: serializeTimestamp(overriddenAtMs, "overriddenAt"),
  });

  return Object.freeze({ ...quote, override });
}

function resolvePromiseStartMs(quotedAtMs: number, scheduledFor: string | null): number {
  if (scheduledFor === null) return quotedAtMs;

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
