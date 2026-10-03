import type { BranchScope } from "./index.js";
import {
  parseCaptureDraftSummaryV1,
  type CaptureDraftSummaryV1,
} from "./commercial-capture.js";

export const CAPTURE_TRAY_V2_SCHEMA_VERSION = 2 as const;
export const CAPTURE_LEASE_RENEW_SCHEMA_VERSION = 1 as const;

/** Request for the enriched draft tray; the V1 request/response pair stays unchanged. */
export interface CaptureWorkTrayRequestV2 {
  readonly limit: number;
  readonly schemaVersion: typeof CAPTURE_TRAY_V2_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

/**
 * Customer of a draft as frozen in its party snapshot. Only returned to actors holding
 * `customers.read`; everyone else receives `customer: null` (enforced by the server, never the UI).
 */
export interface CaptureTrayCustomerV2 {
  readonly displayName: string;
  readonly phone: string;
}

/**
 * Draft summary plus the facts the operator needs to recognise a recoverable capture.
 * `totalMinor`/`currency` are server-computed (tax-inclusive items total priced against the
 * published catalog exactly like the workspace projection); both are `null` when the draft has
 * no priced selection (no plan, repeat-order plan, stale catalog) or the actor lacks `catalog.read`.
 * `attentionLeaseExpiresAt` never carries the lease id itself.
 */
export interface CaptureTrayItemV2 extends Omit<CaptureDraftSummaryV1, "schemaVersion"> {
  readonly attentionLeaseExpiresAt: string | null;
  readonly currency: string | null;
  readonly customer: CaptureTrayCustomerV2 | null;
  readonly schemaVersion: typeof CAPTURE_TRAY_V2_SCHEMA_VERSION;
  readonly totalMinor: number | null;
}

export interface CaptureWorkTrayResultV2 {
  readonly items: readonly CaptureTrayItemV2[];
  readonly schemaVersion: typeof CAPTURE_TRAY_V2_SCHEMA_VERSION;
}

/**
 * Heartbeat for the actor's own attention lease. It is naturally idempotent (it only moves the
 * expiry forward from the server clock), does not bump the capture version and therefore never
 * races an autosave's `expectedVersion`.
 */
export interface RenewCaptureLeaseCommandV1 {
  readonly attentionLeaseId: string;
  readonly captureDraftId: string;
  readonly schemaVersion: typeof CAPTURE_LEASE_RENEW_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface RenewCaptureLeaseResultV1 {
  readonly attentionLeaseExpiresAt: string;
  readonly attentionLeaseId: string;
  readonly captureDraftId: string;
  readonly schemaVersion: typeof CAPTURE_LEASE_RENEW_SCHEMA_VERSION;
  readonly version: number;
}

const SUMMARY_KEYS = [
  "scope", "captureDraftId", "folio", "sourceChannel", "fulfillmentChannel",
  "status", "attentionStatus", "ownerMembershipId", "version", "updatedAt",
] as const;
const ITEM_KEYS = [
  "schemaVersion", ...SUMMARY_KEYS, "customer", "totalMinor", "currency", "attentionLeaseExpiresAt",
] as const;

export function parseCaptureWorkTrayRequestV2(value: unknown): CaptureWorkTrayRequestV2 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope", "limit"]);
    if (record === undefined || own(record, "schemaVersion") !== CAPTURE_TRAY_V2_SCHEMA_VERSION) return undefined;
    const scope = parseUuidScope(own(record, "scope"));
    const limit = integer(own(record, "limit"), 1, 50);
    return scope === undefined || limit === undefined
      ? undefined
      : Object.freeze({ limit, schemaVersion: CAPTURE_TRAY_V2_SCHEMA_VERSION, scope });
  });
}

export function parseCaptureTrayItemV2(value: unknown): CaptureTrayItemV2 | undefined {
  return safely(() => {
    const record = exactRecord(value, ITEM_KEYS);
    if (record === undefined || own(record, "schemaVersion") !== CAPTURE_TRAY_V2_SCHEMA_VERSION) return undefined;
    const summaryInput: Record<string, unknown> = { schemaVersion: 1 };
    for (const key of SUMMARY_KEYS) summaryInput[key] = own(record, key);
    const summary = parseCaptureDraftSummaryV1(summaryInput);
    const customer = parseCustomer(own(record, "customer"));
    const totalMinor = own(record, "totalMinor") === null ? null : integer(own(record, "totalMinor"), 0, Number.MAX_SAFE_INTEGER);
    const currency = own(record, "currency") === null ? null : currencyCode(own(record, "currency"));
    const leaseExpiresAt = own(record, "attentionLeaseExpiresAt") === null
      ? null : timestamp(own(record, "attentionLeaseExpiresAt"));
    if (summary === undefined || customer === undefined || totalMinor === undefined || currency === undefined
      || leaseExpiresAt === undefined || (totalMinor === null) !== (currency === null)
      || (summary.attentionStatus === "claimed") !== (leaseExpiresAt !== null)) return undefined;
    return Object.freeze({
      attentionLeaseExpiresAt: leaseExpiresAt,
      attentionStatus: summary.attentionStatus,
      captureDraftId: summary.captureDraftId,
      currency,
      customer,
      folio: summary.folio,
      fulfillmentChannel: summary.fulfillmentChannel,
      ownerMembershipId: summary.ownerMembershipId,
      schemaVersion: CAPTURE_TRAY_V2_SCHEMA_VERSION,
      scope: summary.scope,
      sourceChannel: summary.sourceChannel,
      status: summary.status,
      totalMinor,
      updatedAt: summary.updatedAt,
      version: summary.version,
    });
  });
}

export function parseCaptureWorkTrayResultV2(value: unknown): CaptureWorkTrayResultV2 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "items"]);
    const rawItems = record === undefined ? undefined : own(record, "items");
    if (record === undefined || own(record, "schemaVersion") !== CAPTURE_TRAY_V2_SCHEMA_VERSION
      || !Array.isArray(rawItems) || rawItems.length > 50) return undefined;
    const items = rawItems.map(parseCaptureTrayItemV2);
    return items.some((item) => item === undefined)
      ? undefined
      : Object.freeze({
        items: Object.freeze(items as CaptureTrayItemV2[]),
        schemaVersion: CAPTURE_TRAY_V2_SCHEMA_VERSION,
      });
  });
}

export function parseRenewCaptureLeaseCommandV1(value: unknown): RenewCaptureLeaseCommandV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope", "captureDraftId", "attentionLeaseId"]);
    if (record === undefined || own(record, "schemaVersion") !== CAPTURE_LEASE_RENEW_SCHEMA_VERSION) return undefined;
    const scope = parseUuidScope(own(record, "scope"));
    const captureDraftId = uuid(own(record, "captureDraftId"));
    const attentionLeaseId = uuid(own(record, "attentionLeaseId"));
    return scope === undefined || captureDraftId === undefined || attentionLeaseId === undefined
      ? undefined
      : Object.freeze({ attentionLeaseId, captureDraftId, schemaVersion: CAPTURE_LEASE_RENEW_SCHEMA_VERSION, scope });
  });
}

export function parseRenewCaptureLeaseResultV1(value: unknown): RenewCaptureLeaseResultV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "captureDraftId", "attentionLeaseId", "attentionLeaseExpiresAt", "version",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== CAPTURE_LEASE_RENEW_SCHEMA_VERSION) return undefined;
    const captureDraftId = uuid(own(record, "captureDraftId"));
    const attentionLeaseId = uuid(own(record, "attentionLeaseId"));
    const attentionLeaseExpiresAt = timestamp(own(record, "attentionLeaseExpiresAt"));
    const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
    return captureDraftId === undefined || attentionLeaseId === undefined
      || attentionLeaseExpiresAt === undefined || version === undefined
      ? undefined
      : Object.freeze({
        attentionLeaseExpiresAt, attentionLeaseId, captureDraftId,
        schemaVersion: CAPTURE_LEASE_RENEW_SCHEMA_VERSION, version,
      });
  });
}

function parseCustomer(value: unknown): CaptureTrayCustomerV2 | null | undefined {
  if (value === null) return null;
  const record = exactRecord(value, ["displayName", "phone"]);
  if (record === undefined) return undefined;
  const displayName = text(own(record, "displayName"), 1, 120);
  const phone = text(own(record, "phone"), 1, 80);
  return displayName === undefined || phone === undefined ? undefined : Object.freeze({ displayName, phone });
}

type PlainRecord = Record<string, unknown>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function parseUuidScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined
    : Object.freeze({ restaurantId, branchId }) as BranchScope;
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function own(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function safely<T>(operation: () => T | undefined): T | undefined {
  try { return operation(); } catch { return undefined; }
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value : undefined;
}

function text(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum ? value : undefined;
}

function currencyCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z]{3}$/u.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try {
    return new Date(value).toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}
