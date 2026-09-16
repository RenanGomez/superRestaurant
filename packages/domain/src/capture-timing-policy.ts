import { DomainError } from "./errors.js";

const EDITING_LEASE_DURATION_MS = 5 * 60 * 1000;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export class InvalidCaptureTimestampError extends DomainError {
  public readonly code = "INVALID_CAPTURE_TIMESTAMP";

  public constructor() {
    super("Capture timing requires a canonical UTC timestamp with millisecond precision.");
  }
}

export class ExpiredCaptureEditingLeaseError extends DomainError {
  public readonly code = "EXPIRED_CAPTURE_EDITING_LEASE";

  public constructor() {
    super("An expired editing lease must be claimed again instead of renewed.");
  }
}

export class InvalidCaptureRecoveryPreferenceError extends DomainError {
  public readonly code = "INVALID_CAPTURE_RECOVERY_PREFERENCE";

  public constructor() {
    super("Automatic recovery renewal must be explicitly selected or deselected.");
  }
}

/** One UTC calendar month of recovery, distinct from retention and editing ownership. */
export function captureRecoveryExpiresAt(startedAt: string): string {
  return addUtcCalendarMonth(parseTimestamp(startedAt));
}

/** A five-minute exclusive editing reservation; persistence mints its opaque lease ID. */
export function captureEditingLeaseExpiresAt(grantedAt: string): string {
  return serializeTimestamp(parseTimestamp(grantedAt).getTime() + EDITING_LEASE_DURATION_MS);
}

/** Expiration is exclusive: equality with the deadline is already expired. */
export function isCaptureDeadlineActive(expiresAt: string, observedAt: string): boolean {
  return parseTimestamp(observedAt).getTime() < parseTimestamp(expiresAt).getTime();
}

/** Successful activity renews an active lease; an expired lease needs a fresh CAS claim. */
export function renewCaptureEditingLease(expiresAt: string, observedAt: string): string {
  if (!isCaptureDeadlineActive(expiresAt, observedAt)) throw new ExpiredCaptureEditingLeaseError();
  const proposed = captureEditingLeaseExpiresAt(observedAt);
  return proposed > expiresAt ? proposed : expiresAt;
}

/** Lazy monthly renewal is allowed only after the current deadline and with explicit opt-in. */
export function renewCaptureRecovery(
  expiresAt: string,
  observedAt: string,
  autoRenewSelected: boolean,
): string {
  const deadline = parseTimestamp(expiresAt);
  const observed = parseTimestamp(observedAt);
  if (typeof autoRenewSelected !== "boolean") throw new InvalidCaptureRecoveryPreferenceError();
  if (!autoRenewSelected || observed.getTime() < deadline.getTime()) return expiresAt;
  return addUtcCalendarMonth(observed);
}

function addUtcCalendarMonth(value: Date): string {
  const day = value.getUTCDate();
  const next = new Date(value.getTime());
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(Math.min(day, daysInUtcMonth(next.getUTCFullYear(), next.getUTCMonth())));
  return serializeTimestamp(next.getTime());
}

function daysInUtcMonth(year: number, zeroBasedMonth: number): number {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  if (zeroBasedMonth !== 1) return days[zeroBasedMonth] ?? 0;
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
}

function parseTimestamp(value: unknown): Date {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) throw new InvalidCaptureTimestampError();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new InvalidCaptureTimestampError();
  return date;
}

function serializeTimestamp(milliseconds: number): string {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new InvalidCaptureTimestampError();
  const result = date.toISOString();
  if (!UTC_TIMESTAMP_PATTERN.test(result)) throw new InvalidCaptureTimestampError();
  return result;
}
