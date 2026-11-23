import {
  isSyncEntityOperationAllowedV1,
  isSyncFinancialEntityTypeV1,
  isSyncId,
  MANUAL_REVIEW_CASE_SCHEMA_VERSION,
  parseManualReviewCaseV1,
  parseResolveManualReviewCaseCommandV1,
  parseSyncScopeV1,
  SYNC_OUTBOX_STATES,
  type BranchScope,
  type ManualReviewCaseStatusV1,
  type ManualReviewCaseV1,
  type ResolveManualReviewCaseCommandV1,
  type SyncConnectivityStateV1,
  type SyncEntityTypeV1,
  type SyncOperationV1,
  type SyncOutboxStateV1,
} from "@super-restaurant/shared-types";

import { currencyFractionDigits } from "./money-scale";

/** Custom DOM event dispatched by a local offline adapter whenever outbox/sync state changes. */
export const WEB_SYNC_STATE_CHANGED_EVENT = "sr:sync-state-changed";

/** Custom DOM event listened to by `PwaRegister` when a schema/app update is required. */
export const WEB_SCHEMA_UPDATE_EVENT = "sr:schema-update-available";

/** UI hint only — the server always enforces `sync.manual_review.resolve`. */
export const SYNC_SUPERVISOR_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "manager",
  "supervisor",
]);

/** Canonical §2.3 messages from OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX.md. */
export const SYNC_MATRIX_MESSAGES = Object.freeze({
  offlineSavedLocally:
    "Sin conexión. Este cambio se guardó en este dispositivo; no está disponible en otros equipos todavía.",
  pendingQueue: (count: number): string =>
    `Pendientes de sincronizar: ${Math.max(0, Math.trunc(count))}. Puedes continuar con operaciones permitidas.`,
  retryPreserved:
    "No se confirmó la respuesta. Conservamos el cambio y lo reintentaremos sin duplicarlo.",
  permissionRejected:
    "La autorización no fue válida en el servidor. El cambio no se aplicó.",
  nonFinancialConflict:
    "Otro cambio usa una versión distinta. Conservamos ambas evidencias; revisa antes de continuar.",
  financialConflict:
    "Operación financiera pendiente de revisión. No se fusionó ni se cobró de nuevo.",
  kdsLocalOnly:
    "Estado guardado en este KDS; otras estaciones lo verán al sincronizar.",
  reconciliationComplete: (formattedTime: string): string =>
    `Sincronización confirmada a las ${formattedTime}. No hay pendientes.`,
  schemaOutdated:
    "Esta versión de la app debe actualizarse antes de sincronizar esta operación.",
} as const);

export interface SyncUiEventItem {
  readonly eventId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly entityType: SyncEntityTypeV1;
  readonly operation: SyncOperationV1;
  readonly localSequence: number;
  readonly localState: SyncOutboxStateV1;
  readonly retryCount: number;
  readonly lastErrorCode: string | null;
  readonly occurredAt: string;
  readonly updatedAt: string | null;
  readonly financial: boolean;
  readonly schemaOutdated: boolean;
  readonly summaryLabel: string | null;
}

export interface WebSyncUiSnapshot {
  readonly storageReady: boolean;
  readonly storageQuarantined: boolean;
  readonly scopeRevoked: boolean;
  readonly resyncRequired: boolean;
  readonly schemaOutdated: boolean;
  readonly syncing: boolean;
  readonly lastConfirmedSyncAt: string | null;
  readonly events: readonly SyncUiEventItem[];
  readonly localManualReviewCases?: readonly ManualReviewCaseV1[];
}

export interface WebSyncBridgeActionResult {
  readonly ok: boolean;
  readonly code?: string | null;
  readonly confirmedAt?: string | null;
}

/**
 * Runtime integration seam for `apps/web/src/lib/offline` (`m2-web-local-storage-crypto`).
 * Until that module registers a concrete IndexedDB + DeviceSyncEngine bridge, the UI operates
 * honestly in online-first mode with an empty local queue and real server reachability checks.
 */
export interface WebSyncBridge {
  readonly getSnapshot: (scope: BranchScope) => WebSyncUiSnapshot;
  readonly subscribe?: (listener: () => void) => () => void;
  readonly retryPending?: (scope: BranchScope, eventId?: string) => Promise<WebSyncBridgeActionResult>;
  readonly requestResync?: (scope: BranchScope) => Promise<WebSyncBridgeActionResult>;
}

interface GlobalWithSyncBridge {
  __srSyncBridge?: WebSyncBridge;
}

export function registerWebSyncBridge(bridge: WebSyncBridge | undefined): void {
  if (typeof globalThis === "undefined") return;
  const host = globalThis as unknown as GlobalWithSyncBridge;
  if (bridge === undefined) {
    delete host.__srSyncBridge;
  } else {
    host.__srSyncBridge = bridge;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WEB_SYNC_STATE_CHANGED_EVENT));
  }
}

export function getWebSyncBridge(): WebSyncBridge | undefined {
  if (typeof globalThis === "undefined") return undefined;
  const candidate = (globalThis as unknown as GlobalWithSyncBridge).__srSyncBridge;
  return candidate !== undefined && typeof candidate.getSnapshot === "function" ? candidate : undefined;
}

export const EMPTY_WEB_SYNC_SNAPSHOT: WebSyncUiSnapshot = Object.freeze({
  events: Object.freeze([]),
  lastConfirmedSyncAt: null,
  resyncRequired: false,
  schemaOutdated: false,
  scopeRevoked: false,
  storageQuarantined: false,
  storageReady: false,
  syncing: false,
});

export interface DeriveConnectivityInput {
  readonly browserOnline: boolean;
  readonly serverReachable: boolean | null;
  readonly reconnecting: boolean;
  readonly pendingCount: number;
  readonly retryWaitCount: number;
  readonly blockedEventCount: number;
  readonly openManualReviewCount: number;
  readonly schemaOutdated: boolean;
  readonly storageQuarantined: boolean;
  readonly scopeRevoked: boolean;
  readonly resyncRequired: boolean;
}

/**
 * Derives the single operational connectivity state from OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §1.1.
 * Priority is conservative and fail-closed:
 * 1. `offline` when the browser reports no network.
 * 2. `sync_blocked` when blocked events, open manual reviews, schema mismatch, revocation, or storage quarantine exist.
 * 3. `reconnecting` when recovering connectivity or reconciling a queued backlog.
 * 4. `degraded` when the browser reports network, but the API is unreachable or events are waiting to retry.
 * 5. `online` otherwise.
 */
export function deriveConnectivityState(input: DeriveConnectivityInput): SyncConnectivityStateV1 {
  if (!input.browserOnline) {
    return "offline";
  }
  if (
    input.storageQuarantined
    || input.scopeRevoked
    || input.schemaOutdated
    || input.blockedEventCount > 0
    || input.openManualReviewCount > 0
  ) {
    return "sync_blocked";
  }
  if (input.reconnecting) {
    return "reconnecting";
  }
  if (input.serverReachable === false || input.retryWaitCount > 0 || input.resyncRequired) {
    return "degraded";
  }
  return "online";
}

export interface SyncStatusCounts {
  readonly total: number;
  readonly pendingCount: number;
  readonly sendingCount: number;
  readonly retryWaitCount: number;
  readonly confirmedCount: number;
  readonly rejectedCount: number;
  readonly conflictCount: number;
  readonly manualReviewCount: number;
  readonly blockedCount: number;
  readonly hasRetryable: boolean;
  readonly hasFinancialBlocked: boolean;
  readonly hasSchemaOutdated: boolean;
}

export function summarizeSyncEvents(events: readonly SyncUiEventItem[]): SyncStatusCounts {
  let pendingCount = 0;
  let sendingCount = 0;
  let retryWaitCount = 0;
  let confirmedCount = 0;
  let rejectedCount = 0;
  let conflictCount = 0;
  let manualReviewCount = 0;
  let hasFinancialBlocked = false;
  let hasSchemaOutdated = false;

  for (const item of events) {
    if (item.schemaOutdated || isSchemaOutdatedCode(item.lastErrorCode)) {
      hasSchemaOutdated = true;
    }
    switch (item.localState) {
      case "pending":
        pendingCount += 1;
        break;
      case "sending":
        sendingCount += 1;
        break;
      case "retry_wait":
        retryWaitCount += 1;
        break;
      case "accepted":
      case "duplicate":
        confirmedCount += 1;
        break;
      case "rejected":
        rejectedCount += 1;
        if (item.financial) hasFinancialBlocked = true;
        break;
      case "conflict":
        conflictCount += 1;
        if (item.financial) hasFinancialBlocked = true;
        break;
      case "manual_review":
        manualReviewCount += 1;
        if (item.financial) hasFinancialBlocked = true;
        break;
    }
  }

  const awaitingPush = pendingCount + sendingCount + retryWaitCount;
  const blockedCount = rejectedCount + conflictCount + manualReviewCount;
  return Object.freeze({
    blockedCount,
    confirmedCount,
    conflictCount,
    hasFinancialBlocked,
    hasRetryable: pendingCount + retryWaitCount > 0,
    hasSchemaOutdated,
    manualReviewCount,
    pendingCount: awaitingPush,
    rejectedCount,
    retryWaitCount,
    sendingCount,
    total: events.length,
  });
}

export interface ConnectivityPresentation {
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly tone: "success" | "warning" | "neutral" | "info" | "error";
}

const CONNECTIVITY_PRESENTATIONS: Readonly<Record<SyncConnectivityStateV1, ConnectivityPresentation>> = Object.freeze({
  degraded: Object.freeze({
    description: SYNC_MATRIX_MESSAGES.retryPreserved,
    label: "Conexión inestable",
    shortLabel: "Inestable",
    tone: "warning",
  }),
  offline: Object.freeze({
    description: SYNC_MATRIX_MESSAGES.offlineSavedLocally,
    label: "Sin conexión",
    shortLabel: "Sin conexión",
    tone: "neutral",
  }),
  online: Object.freeze({
    description: "Conectado con el servidor de la sucursal.",
    label: "En línea",
    shortLabel: "En línea",
    tone: "success",
  }),
  reconnecting: Object.freeze({
    description: "Recuperando conexión y verificando cambios pendientes antes de confirmar.",
    label: "Reconectando…",
    shortLabel: "Reconectando",
    tone: "info",
  }),
  sync_blocked: Object.freeze({
    description: "Hay cambios retenidos que requieren revisión antes de continuar.",
    label: "Sincronización bloqueada",
    shortLabel: "Bloqueada",
    tone: "error",
  }),
});

export function getConnectivityPresentation(state: SyncConnectivityStateV1): ConnectivityPresentation {
  return CONNECTIVITY_PRESENTATIONS[state];
}

const ENTITY_LABELS: Readonly<Record<SyncEntityTypeV1, string>> = Object.freeze({
  CaptureDraft: "Captura telefónica",
  CashMovement: "Movimiento de caja",
  CashRegisterSession: "Sesión de caja",
  Customer: "Cliente",
  DiningTable: "Mesa",
  KdsTicket: "Comanda de cocina",
  MenuCatalog: "Menú",
  Order: "Orden",
  OrderDiscount: "Descuento o cortesía",
  OrderItem: "Platillo de orden",
  Payment: "Cobro",
  Refund: "Devolución",
});

export function formatEntityTypeLabel(entityType: SyncEntityTypeV1): string {
  return ENTITY_LABELS[entityType];
}

const OPERATION_LABELS: Readonly<Record<SyncOperationV1, string>> = Object.freeze({
  compensate: "Ajuste compensatorio",
  create: "Registrar",
  delete: "Quitar",
  transition: "Cambiar estado",
  update: "Actualizar",
});

export function formatOperationLabel(operation: SyncOperationV1): string {
  return OPERATION_LABELS[operation];
}

const OUTBOX_STATE_LABELS: Readonly<Record<SyncOutboxStateV1, string>> = Object.freeze({
  accepted: "Confirmado",
  conflict: "En conflicto",
  duplicate: "Ya confirmado",
  manual_review: "Pendiente de revisión",
  pending: "Pendiente de envío",
  rejected: "No aplicado",
  retry_wait: "En espera de reintento",
  sending: "Enviando…",
});

export function formatOutboxStateLabel(state: SyncOutboxStateV1): string {
  return OUTBOX_STATE_LABELS[state];
}

const MANUAL_REVIEW_STATUS_LABELS: Readonly<Record<ManualReviewCaseStatusV1, string>> = Object.freeze({
  open: "Pendiente de revisión",
  resolved_compensated: "Resuelto con ajuste",
  resolved_rejected: "Descartado por supervisor",
});

export function formatManualReviewStatusLabel(status: ManualReviewCaseStatusV1): string {
  return MANUAL_REVIEW_STATUS_LABELS[status];
}

const PERMISSION_CODES = new Set([
  "AUTH_REVOKED",
  "DEVICE_REVOKED",
  "DEVICE_COMPROMISED",
  "UNAUTHORIZED_SCOPE",
  "FORBIDDEN",
  "PERMISSION_DENIED",
  "SUPERVISOR_REQUIRED",
]);

const SCHEMA_OUTDATED_CODES = new Set([
  "SCHEMA_VERSION_UNSUPPORTED",
  "SCHEMA_OUTDATED",
  "SCHEMA_RETIRED",
  "SCHEMA_MIGRATION_REQUIRED",
]);

const RETRYABLE_NETWORK_CODES = new Set([
  "TRANSPORT_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "SERVICE_UNAVAILABLE",
  "RATE_LIMITED",
  "GATEWAY_TIMEOUT",
]);

const CURSOR_RESYNC_CODES = new Set([
  "CURSOR_INVALID",
  "CURSOR_EXPIRED",
  "CURSOR_SCOPE_MISMATCH",
  "RESYNC_REQUIRED",
]);

const STORAGE_BLOCK_CODES = new Set([
  "STORAGE_QUOTA_EXCEEDED",
  "STORAGE_CORRUPT",
  "STORAGE_COMMIT_FAILED",
  "SEQUENCE_REGRESSION",
  "ENCRYPTION_UNAVAILABLE",
]);

export function isSchemaOutdatedCode(code: string | null | undefined): boolean {
  if (typeof code !== "string" || code.trim() === "") return false;
  return SCHEMA_OUTDATED_CODES.has(code.trim().toUpperCase());
}

/**
 * Translates any internal sync status / reason code into plain operational Spanish aligned with
 * OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §2.3. Never leaks raw codes or UUIDs to the operator.
 */
export function describeSyncOutcomeForOperator(input: {
  readonly code: string | null | undefined;
  readonly entityType?: SyncEntityTypeV1;
  readonly financial?: boolean;
  readonly localState?: SyncOutboxStateV1;
}): string {
  const normalizedCode = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const financial = input.financial === true || (input.entityType !== undefined && isSyncFinancialEntityTypeV1(input.entityType));

  if (normalizedCode !== "" && SCHEMA_OUTDATED_CODES.has(normalizedCode)) {
    return SYNC_MATRIX_MESSAGES.schemaOutdated;
  }
  if (normalizedCode !== "" && PERMISSION_CODES.has(normalizedCode)) {
    return SYNC_MATRIX_MESSAGES.permissionRejected;
  }
  if (normalizedCode !== "" && CURSOR_RESYNC_CODES.has(normalizedCode)) {
    return "Los datos de este equipo están desactualizados. Usa «Volver a sincronizar» para ponerlos al día.";
  }
  if (normalizedCode !== "" && STORAGE_BLOCK_CODES.has(normalizedCode)) {
    return "El almacenamiento local de este dispositivo requiere atención antes de guardar nuevos cambios sin conexión.";
  }
  if (normalizedCode !== "" && RETRYABLE_NETWORK_CODES.has(normalizedCode)) {
    return SYNC_MATRIX_MESSAGES.retryPreserved;
  }

  if (input.localState === "manual_review" || input.localState === "conflict") {
    return financial ? SYNC_MATRIX_MESSAGES.financialConflict : SYNC_MATRIX_MESSAGES.nonFinancialConflict;
  }
  if (input.localState === "rejected") {
    return SYNC_MATRIX_MESSAGES.permissionRejected;
  }
  if (input.localState === "retry_wait") {
    return SYNC_MATRIX_MESSAGES.retryPreserved;
  }
  if (input.localState === "pending" || input.localState === "sending") {
    if (input.entityType === "KdsTicket") {
      return SYNC_MATRIX_MESSAGES.kdsLocalOnly;
    }
    return SYNC_MATRIX_MESSAGES.offlineSavedLocally;
  }
  if (input.localState === "accepted" || input.localState === "duplicate") {
    return "Cambio confirmado por el servidor.";
  }

  if (normalizedCode !== "") {
    if (
      financial
      || normalizedCode.startsWith("PAYMENT_")
      || normalizedCode.startsWith("CASH_")
      || normalizedCode.includes("DISCOUNT")
      || normalizedCode.includes("PRICE_OVERRIDE")
      || normalizedCode.includes("IDEMPOTENCY")
    ) {
      return SYNC_MATRIX_MESSAGES.financialConflict;
    }
    if (
      normalizedCode.includes("CONFLICT")
      || normalizedCode.includes("VERSION")
      || normalizedCode.includes("STALE")
      || normalizedCode.includes("TOMBSTONE")
    ) {
      return SYNC_MATRIX_MESSAGES.nonFinancialConflict;
    }
    return "No se pudo completar el envío por ahora. Conservamos el cambio para revisión.";
  }

  return financial ? SYNC_MATRIX_MESSAGES.financialConflict : SYNC_MATRIX_MESSAGES.nonFinancialConflict;
}

/** Builds the primary operator banner message for `/app/sync` using §2.3 copy. */
export function buildSyncBannerMessage(input: {
  readonly state: SyncConnectivityStateV1;
  readonly counts: SyncStatusCounts;
  readonly openManualReviewCount: number;
  readonly hasFinancialReview: boolean;
  readonly lastConfirmedSyncAt: string | null;
  readonly timeZone?: string | undefined;
  readonly schemaOutdated: boolean;
  readonly scopeRevoked: boolean;
  readonly storageQuarantined: boolean;
}): string {
  if (input.state === "offline") {
    if (input.counts.pendingCount > 0) {
      return `${SYNC_MATRIX_MESSAGES.offlineSavedLocally} ${SYNC_MATRIX_MESSAGES.pendingQueue(input.counts.pendingCount)}`;
    }
    return SYNC_MATRIX_MESSAGES.offlineSavedLocally;
  }

  if (input.state === "sync_blocked") {
    if (input.schemaOutdated || input.counts.hasSchemaOutdated) {
      return SYNC_MATRIX_MESSAGES.schemaOutdated;
    }
    if (input.scopeRevoked) {
      return SYNC_MATRIX_MESSAGES.permissionRejected;
    }
    if (input.storageQuarantined) {
      return "El almacenamiento local de este dispositivo está protegido por seguridad. Pide apoyo a supervisión para volver a sincronizar.";
    }
    if (input.counts.hasFinancialBlocked || input.hasFinancialReview) {
      return SYNC_MATRIX_MESSAGES.financialConflict;
    }
    if (input.counts.conflictCount > 0 || input.counts.manualReviewCount > 0 || input.openManualReviewCount > 0) {
      return SYNC_MATRIX_MESSAGES.nonFinancialConflict;
    }
    return SYNC_MATRIX_MESSAGES.permissionRejected;
  }

  if (input.state === "reconnecting" || input.state === "degraded") {
    return SYNC_MATRIX_MESSAGES.retryPreserved;
  }

  if (input.counts.pendingCount > 0) {
    return SYNC_MATRIX_MESSAGES.pendingQueue(input.counts.pendingCount);
  }

  const formattedTime = formatSyncTime(input.lastConfirmedSyncAt, input.timeZone);
  if (formattedTime !== null) {
    return SYNC_MATRIX_MESSAGES.reconciliationComplete(formattedTime);
  }

  return "Conectado con el servidor. No hay cambios pendientes en este dispositivo.";
}

/** Formats an ISO timestamp as local HH:mm (es-MX) without exposing raw UTC strings. */
export function formatSyncTime(isoTimestamp: string | null | undefined, timeZone?: string | undefined): string | null {
  if (typeof isoTimestamp !== "string" || isoTimestamp.trim() === "") return null;
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return null;

  try {
    return new Intl.DateTimeFormat("es-MX", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      ...(timeZone !== undefined && timeZone.trim() !== "" ? { timeZone } : {}),
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat("es-MX", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
    }).format(parsed);
  }
}

/** Formats an ISO timestamp with day/month and HH:mm in es-MX for event and review cards. */
export function formatSyncDateTime(isoTimestamp: string | null | undefined, timeZone?: string | undefined): string {
  if (typeof isoTimestamp !== "string" || isoTimestamp.trim() === "") return "Hora no disponible";
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return "Hora no disponible";

  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "short",
      ...(timeZone !== undefined && timeZone.trim() !== "" ? { timeZone } : {}),
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "short",
    }).format(parsed);
  }
}

/**
 * Display-only formatter for server-provided minor-unit integers (zero floats, zero math).
 * Returns null if amountMinor is null, not a safe integer, or currency scale is unsupported.
 */
export function formatSyncAmountMinor(amountMinor: number | null, currency: string | null): string | null {
  if (amountMinor === null || currency === null) return null;
  if (!Number.isSafeInteger(amountMinor)) return null;
  const digits = currencyFractionDigits(currency);
  if (digits === null) return null;

  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);
  const scale = 10 ** digits;
  const whole = Math.floor(absolute / scale);
  const fraction = absolute % scale;
  const formattedWhole = whole.toLocaleString("es-MX");
  const sign = negative ? "-" : "";
  if (digits === 0) {
    return `${sign}$${formattedWhole}`;
  }
  const paddedFraction = String(fraction).padStart(digits, "0");
  return `${sign}$${formattedWhole}.${paddedFraction}`;
}

/** Human-friendly event title combining entity and action, never showing raw UUIDs. */
export function formatSyncEventTitle(event: Pick<SyncUiEventItem, "entityType" | "operation" | "summaryLabel">): string {
  const base = `${formatEntityTypeLabel(event.entityType)} · ${formatOperationLabel(event.operation)}`;
  const summary = sanitizeOperatorSummary(event.summaryLabel);
  return summary === null ? base : `${base} (${summary})`;
}

const UUID_SUBSTRING_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

/** Strips control characters and refuses strings that embed raw UUIDs. */
export function sanitizeOperatorSummary(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim();
  if (cleaned === "" || UUID_SUBSTRING_PATTERN.test(cleaned)) return null;
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}

export type SyncEventFilter = "all" | "pending" | "attention" | "confirmed";

export function filterSyncEvents(
  events: readonly SyncUiEventItem[],
  filter: SyncEventFilter,
): readonly SyncUiEventItem[] {
  const sorted = [...events].sort((left, right) => right.localSequence - left.localSequence);
  switch (filter) {
    case "all":
      return sorted;
    case "pending":
      return sorted.filter(
        (item) => item.localState === "pending" || item.localState === "sending" || item.localState === "retry_wait",
      );
    case "attention":
      return sorted.filter(
        (item) => item.localState === "conflict" || item.localState === "manual_review" || item.localState === "rejected",
      );
    case "confirmed":
      return sorted.filter(
        (item) => item.localState === "accepted" || item.localState === "duplicate",
      );
  }
}

export function canRetrySyncEvent(event: Pick<SyncUiEventItem, "localState" | "schemaOutdated" | "lastErrorCode">): boolean {
  if (event.schemaOutdated || isSchemaOutdatedCode(event.lastErrorCode)) return false;
  return event.localState === "pending" || event.localState === "retry_wait";
}

export function isSupervisorRoleList(roles: readonly string[]): boolean {
  return roles.some((role) => SYNC_SUPERVISOR_ROLES.has(role));
}

/**
 * Validates and scopes an untrusted snapshot returned by a runtime bridge so events from another
 * restaurant/branch or malformed entries never leak into the active UI.
 */
export function normalizeScopedSyncSnapshot(
  raw: unknown,
  activeScope: BranchScope,
): WebSyncUiSnapshot {
  if (typeof raw !== "object" || raw === null) return EMPTY_WEB_SYNC_SNAPSHOT;
  const record = raw as Partial<WebSyncUiSnapshot>;
  const rawEvents = Array.isArray(record.events) ? record.events : [];
  const validEvents: SyncUiEventItem[] = [];

  for (const candidate of rawEvents) {
    const parsed = normalizeScopedSyncEvent(candidate, activeScope);
    if (parsed !== undefined) {
      validEvents.push(parsed);
    }
  }

  const rawLocalCases = Array.isArray(record.localManualReviewCases) ? record.localManualReviewCases : [];
  const validLocalCases: ManualReviewCaseV1[] = [];
  for (const candidate of rawLocalCases) {
    const parsedCase = parseManualReviewCaseV1(candidate);
    if (
      parsedCase !== undefined
      && parsedCase.scope.restaurantId === activeScope.restaurantId
      && parsedCase.scope.branchId === activeScope.branchId
    ) {
      validLocalCases.push(parsedCase);
    }
  }

  const lastConfirmedSyncAt =
    typeof record.lastConfirmedSyncAt === "string" && formatSyncTime(record.lastConfirmedSyncAt) !== null
      ? record.lastConfirmedSyncAt
      : null;

  return Object.freeze({
    events: Object.freeze(validEvents),
    lastConfirmedSyncAt,
    ...(validLocalCases.length > 0 ? { localManualReviewCases: Object.freeze(validLocalCases) } : {}),
    resyncRequired: record.resyncRequired === true,
    schemaOutdated: record.schemaOutdated === true,
    scopeRevoked: record.scopeRevoked === true,
    storageQuarantined: record.storageQuarantined === true,
    storageReady: record.storageReady === true,
    syncing: record.syncing === true,
  });
}

function normalizeScopedSyncEvent(raw: unknown, activeScope: BranchScope): SyncUiEventItem | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const item = raw as Partial<SyncUiEventItem>;
  const scope = parseSyncScopeV1({ branchId: item.branchId, restaurantId: item.restaurantId });
  if (scope === undefined || scope.restaurantId !== activeScope.restaurantId || scope.branchId !== activeScope.branchId) {
    return undefined;
  }
  if (
    !isSyncId(item.eventId)
    || typeof item.entityType !== "string"
    || typeof item.operation !== "string"
    || !isSyncEntityOperationAllowedV1(item.entityType, item.operation)
    || typeof item.localSequence !== "number"
    || !Number.isSafeInteger(item.localSequence)
    || item.localSequence < 1
    || typeof item.localState !== "string"
    || !(SYNC_OUTBOX_STATES as readonly string[]).includes(item.localState)
    || typeof item.retryCount !== "number"
    || !Number.isSafeInteger(item.retryCount)
    || item.retryCount < 0
    || typeof item.occurredAt !== "string"
    || formatSyncTime(item.occurredAt) === null
  ) {
    return undefined;
  }

  const entityType = item.entityType as SyncEntityTypeV1;
  const lastErrorCode = typeof item.lastErrorCode === "string" && item.lastErrorCode.trim() !== ""
    ? item.lastErrorCode.trim()
    : null;
  const updatedAt = typeof item.updatedAt === "string" && formatSyncTime(item.updatedAt) !== null
    ? item.updatedAt
    : null;

  return Object.freeze({
    branchId: scope.branchId,
    entityType,
    eventId: item.eventId,
    financial: item.financial === true || isSyncFinancialEntityTypeV1(entityType),
    lastErrorCode,
    localSequence: item.localSequence,
    localState: item.localState as SyncOutboxStateV1,
    occurredAt: item.occurredAt,
    operation: item.operation as SyncOperationV1,
    restaurantId: scope.restaurantId,
    retryCount: item.retryCount,
    schemaOutdated: item.schemaOutdated === true || isSchemaOutdatedCode(lastErrorCode),
    summaryLabel: sanitizeOperatorSummary(item.summaryLabel),
    updatedAt,
  });
}

export interface ManualReviewFormValidation {
  readonly ok: true;
  readonly decision: "compensate" | "reject";
  readonly reason: string;
}

export interface ManualReviewFormValidationError {
  readonly ok: false;
  readonly message: string;
}

const CONTROL_CHAR_PATTERN = /[\p{Cc}\p{Cf}]/u;

export function validateManualReviewResolutionForm(input: {
  readonly decision: string;
  readonly reason: string;
}): ManualReviewFormValidation | ManualReviewFormValidationError {
  if (input.decision !== "compensate" && input.decision !== "reject") {
    return { message: "Elige una decisión antes de confirmar la resolución.", ok: false };
  }
  const trimmed = input.reason.trim();
  if (trimmed.length < 3) {
    return { message: "Escribe un motivo claro de al menos 3 caracteres para la auditoría.", ok: false };
  }
  if (trimmed.length > 500) {
    return { message: "El motivo no puede superar 500 caracteres.", ok: false };
  }
  if (CONTROL_CHAR_PATTERN.test(trimmed)) {
    return { message: "El motivo contiene caracteres no permitidos. Usa solo texto legible.", ok: false };
  }
  return { decision: input.decision, ok: true, reason: trimmed };
}

/**
 * Builds and validates a `ResolveManualReviewCaseCommandV1` using the canonical parser in
 * `@super-restaurant/shared-types`. Returns undefined if any field fails runtime contract checks.
 */
export function buildResolveManualReviewCommand(input: {
  readonly scope: BranchScope;
  readonly caseId: string;
  readonly decision: "compensate" | "reject";
  readonly reason: string;
  readonly compensatingEventId: string | null;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly occurredAt: string;
}): ResolveManualReviewCaseCommandV1 | undefined {
  return parseResolveManualReviewCaseCommandV1({
    caseId: input.caseId,
    compensatingEventId: input.decision === "compensate" ? input.compensatingEventId : null,
    decision: input.decision,
    deviceId: input.deviceId,
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt,
    reason: input.reason.trim(),
    schemaVersion: MANUAL_REVIEW_CASE_SCHEMA_VERSION,
    scope: input.scope,
  });
}

/**
 * Parses a server manual review list response fail-closed, rejecting cross-scope items.
 * Accepts either `{ cases: [...] }` or a bare array of `ManualReviewCaseV1`.
 */
export function parseScopedManualReviewList(
  body: unknown,
  activeScope: BranchScope,
): readonly ManualReviewCaseV1[] | undefined {
  let rawList: unknown;
  if (Array.isArray(body)) {
    rawList = body;
  } else if (typeof body === "object" && body !== null && "cases" in body) {
    rawList = (body as { readonly cases?: unknown }).cases;
  } else {
    return undefined;
  }
  if (!Array.isArray(rawList)) return undefined;

  const parsed: ManualReviewCaseV1[] = [];
  for (const entry of rawList) {
    const item = parseManualReviewCaseV1(entry);
    if (item === undefined) return undefined;
    if (
      item.scope.restaurantId !== activeScope.restaurantId
      || item.scope.branchId !== activeScope.branchId
    ) {
      return undefined;
    }
    parsed.push(item);
  }
  return Object.freeze(parsed);
}
