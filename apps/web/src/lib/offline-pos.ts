import {
  evaluateOfflineCapability,
  type CapabilityBlockCode,
  type CapabilityDecision,
  type CapabilityPreconditions,
  type SyncCapabilityAction,
} from "@super-restaurant/sync-engine";
import type { BranchScope, SyncConnectivityStateV1 } from "@super-restaurant/shared-types";

import { formatSyncDateTime } from "./sync-ui";
import { PENDING_SYNC_TICKET_MARKER } from "./print-documents";

export { PENDING_SYNC_TICKET_MARKER };

/**
 * Offline POS operation layer for the Web POS (`OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX` §2.1-§2.3).
 *
 * This module never persists anything itself: it decides what an operator may do without WAN and
 * describes the outcome in plain Spanish. The concrete IndexedDB + `DeviceSyncEngine` bridge is
 * registered by `m2-web-local-storage-crypto` through {@link registerOfflinePosPort}. Until that
 * bridge exists, the UI stays honest: read/create/cash actions are reported as unavailable instead
 * of being faked, and confirmed operations are only labelled `local_pending` after the bridge has
 * committed them atomically.
 */

/** Custom DOM event dispatched whenever a local offline POS port registers or changes state. */
export const OFFLINE_POS_STATE_CHANGED_EVENT = "sr:offline-pos-state-changed";

/** Activation of the cash-only offline path requires an open cash register + cashier shift. */
export const OFFLINE_POS_DEFAULT_CASH_LIMIT_MINOR = 200_000;

/** Snapshot freshness window: cached catalog/tables older than this are flagged as stale. */
export const OFFLINE_POS_SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Actions the Web POS evaluates for offline operation. Mirrors the capability matrix rows. */
export const OFFLINE_POS_ACTIONS = Object.freeze([
  "catalog.read_cached",
  "tables.read_cached",
  "order.create_local",
  "order.edit_local_origin",
  "order.edit_remote_origin",
  "discount.apply_standard",
  "discount.apply_supervisor_or_reopen",
  "payment.cash_collect",
  "ticket.print_local",
  "cash_register.close_or_reopen",
  "payment.refund_or_void",
  "fiscal.cfdi_stamp",
  "inventory.adjust_or_receive",
  "payment.gateway_or_terminal_integrated",
] as const satisfies readonly SyncCapabilityAction[]);

export type OfflinePosAction = (typeof OFFLINE_POS_ACTIONS)[number];

const READ_ONLY_ACTIONS: ReadonlySet<OfflinePosAction> = new Set(["catalog.read_cached", "tables.read_cached"]);

export interface CachedSnapshotInfo {
  readonly kind: "menu" | "tables";
  readonly version: number;
  /** ISO timestamp of when the snapshot was captured on this device. */
  readonly capturedAt: string;
}

/**
 * Local state of the Web POS as reported by the registered bridge. `null` means the bridge has not
 * cached anything yet (or is not registered), which the UI treats as "offline storage unavailable".
 */
export interface OfflinePosSnapshot {
  readonly connectivity: SyncConnectivityStateV1;
  readonly deviceId: string;
  readonly catalog: CachedSnapshotInfo | null;
  readonly tables: CachedSnapshotInfo | null;
  readonly cashRegisterOpen: boolean;
  readonly cashierShiftOpen: boolean;
  readonly offlineCashUsedMinor: number;
  readonly offlineCashLimitMinor: number;
  readonly ticketTemplateCached: boolean;
}

export interface OfflinePosPreconditionOverrides {
  readonly originatedOnThisDevice?: boolean;
  readonly requiresSupervisorApproval?: boolean;
  readonly withinLocalRuleLimit?: boolean;
  readonly externalTerminalConfirmed?: boolean;
}

export interface OfflinePosCapabilityResult {
  readonly allowed: boolean;
  readonly decision: CapabilityDecision;
  /** Operator-facing Spanish explanation. Empty string when the action is allowed and online. */
  readonly message: string;
}

/**
 * The atomic commit contract the registered bridge fulfils. `entityType`, `operation`,
 * `entityId`, `payload` and `actorId` are optional so a caller may omit them when the
 * bridge can derive a stable intent; a real screen should pass the exact envelope data
 * so the queued event is the same one the server would have received online.
 */
export interface OfflinePosCommitInput {
  readonly kind: "order_create" | "order_add_line" | "cash_collect" | "ticket_print";
  readonly scope: BranchScope;
  readonly deviceId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly summaryLabel?: string;
  readonly actorId?: string;
  readonly entityType?: string;
  readonly operation?: string;
  readonly entityId?: string;
  readonly payload?: unknown;
  readonly baseVersion?: number | null;
}

export interface OfflinePosCommitOutcome {
  /** True only after the event was durably written to the local outbox. */
  readonly committed: boolean;
  readonly eventId: string | null;
  readonly code: string | null;
  readonly message?: string;
}

export interface OfflinePosPort {
  readonly getSnapshot: (scope: BranchScope) => OfflinePosSnapshot | null;
  readonly commitLocalOperation?: (input: OfflinePosCommitInput) => Promise<OfflinePosCommitOutcome | null>;
}

interface GlobalWithOfflinePosPort {
  __srOfflinePosPort?: OfflinePosPort;
}

export function registerOfflinePosPort(port: OfflinePosPort | undefined): void {
  if (typeof globalThis === "undefined") return;
  const host = globalThis as unknown as GlobalWithOfflinePosPort;
  if (port === undefined) {
    delete host.__srOfflinePosPort;
  } else {
    host.__srOfflinePosPort = port;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OFFLINE_POS_STATE_CHANGED_EVENT));
  }
}

export function getOfflinePosPort(): OfflinePosPort | undefined {
  if (typeof globalThis === "undefined") return undefined;
  const candidate = (globalThis as unknown as GlobalWithOfflinePosPort).__srOfflinePosPort;
  return candidate !== undefined && typeof candidate.getSnapshot === "function" ? candidate : undefined;
}

/** Spanish copy for every capability block code, aligned with `OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX` §2.3. */
export const OFFLINE_BLOCK_EXPLANATIONS: Readonly<Record<CapabilityBlockCode, string>> = Object.freeze({
  CASH_REGISTER_REQUIRED: "Abre una caja y un turno de cajero antes de cobrar sin conexión.",
  CARD_MANUAL_CANNOT_CAPTURE_OFFLINE: "El cobro con tarjeta no puede confirmarse sin conexión. Regístralo cuando vuelva la red.",
  CLIENT_NOT_SUPPORTED: "Esta pantalla no puede realizar esa operación.",
  EXTERNAL_TERMINAL_CONFIRMATION_REQUIRED: "Confirma el cobro en la terminal antes de registrarlo.",
  LOCAL_RULE_LIMIT_EXCEEDED: "El descuento supera el límite permitido sin conexión.",
  OFFLINE_CASH_LIMIT_EXCEEDED: "El efectivo supera el tope permitido sin conexión.",
  OFFLINE_NOT_SUPPORTED: "Esta operación requiere conexión con el servidor.",
  PHASE3_UNSUPPORTED: "Esta operación no está disponible sin conexión en esta versión.",
  PHYSICAL_DELETE_FORBIDDEN: "No se permite borrar registros. Usa un ajuste o cancelación con motivo.",
  REMOTE_ORIGIN_OFFLINE_BLOCKED: "Esta orden se creó en otro dispositivo. Edítala cuando vuelva la conexión.",
  SESSION_REQUIRED: "Tu sesión no es válida para operar sin conexión.",
  SNAPSHOTS_REQUIRED: "Este dispositivo todavía no tiene menú y mesas guardados para operar sin conexión.",
  SUPERVISOR_REQUIRED_ONLINE: "Esta acción requiere autorización de supervisor con conexión.",
  SYNC_BLOCKED_ENTITY: "Hay cambios pendientes de este registro que deben revisarse antes de continuar.",
  TEMPLATE_CACHE_REQUIRED: "Este dispositivo no tiene una plantilla de ticket guardada.",
  TICKET_NOT_RECEIVED_ON_STATION: "Esta comanda no pertenece a la estación de este dispositivo.",
});

export const OFFLINE_POS_MESSAGES = Object.freeze({
  storageUnavailable:
    "Sin conexión. Este dispositivo todavía no tiene menú ni mesas guardados; reconecta para preparar la operación sin conexión.",
  localSavedNotShared:
    "Guardado en este dispositivo. Pendiente de sincronizar (solo este dispositivo); cocina y otros equipos lo verán al reconectar.",
  localPending: PENDING_SYNC_TICKET_MARKER,
  cashAllowed: "Puedes cobrar en efectivo sin conexión; el movimiento queda pendiente en este dispositivo.",
  catalogAllowed: "Puedes consultar el menú y las mesas guardados en este dispositivo.",
});

/** Operations that must stay blocked offline and are never queued. */
export interface ProhibitedOfflineOperation {
  readonly id: string;
  readonly label: string;
  readonly message: string;
}

export const OFFLINE_PROHIBITED_OPERATIONS: readonly ProhibitedOfflineOperation[] = Object.freeze([
  Object.freeze({
    id: "order.edit_remote_origin",
    label: "Editar órdenes de otro dispositivo",
    message: OFFLINE_BLOCK_EXPLANATIONS.REMOTE_ORIGIN_OFFLINE_BLOCKED,
  }),
  Object.freeze({
    id: "discount.apply_supervisor_or_reopen",
    label: "Descuentos, cancelaciones o reaperturas que exigen supervisor",
    message: OFFLINE_BLOCK_EXPLANATIONS.SUPERVISOR_REQUIRED_ONLINE,
  }),
  Object.freeze({
    id: "cash_register.close_or_reopen",
    label: "Cierre o reapertura de caja",
    message: OFFLINE_BLOCK_EXPLANATIONS.OFFLINE_NOT_SUPPORTED,
  }),
  Object.freeze({
    id: "payment.refund_or_void",
    label: "Reembolsos y devoluciones",
    message: OFFLINE_BLOCK_EXPLANATIONS.PHASE3_UNSUPPORTED,
  }),
  Object.freeze({
    id: "fiscal.cfdi_stamp",
    label: "Timbrado de CFDI",
    message: OFFLINE_BLOCK_EXPLANATIONS.PHASE3_UNSUPPORTED,
  }),
  Object.freeze({
    id: "inventory.adjust_or_receive",
    label: "Ajustes o recepción de inventario",
    message: OFFLINE_BLOCK_EXPLANATIONS.PHASE3_UNSUPPORTED,
  }),
  Object.freeze({
    id: "payment.gateway_or_terminal_integrated",
    label: "Cobro con terminal o pasarela integrada",
    message: OFFLINE_BLOCK_EXPLANATIONS.PHASE3_UNSUPPORTED,
  }),
]);

function hasBothSnapshots(snapshot: OfflinePosSnapshot): boolean {
  return snapshot.catalog !== null && snapshot.tables !== null;
}

/** Maps the web POS local snapshot to the capability-guard preconditions. */
export function buildCapabilityPreconditions(
  snapshot: OfflinePosSnapshot,
  overrides: OfflinePosPreconditionOverrides = {},
): CapabilityPreconditions {
  const limit = Number.isSafeInteger(snapshot.offlineCashLimitMinor) && snapshot.offlineCashLimitMinor > 0
    ? snapshot.offlineCashLimitMinor
    : OFFLINE_POS_DEFAULT_CASH_LIMIT_MINOR;
  const used = Number.isSafeInteger(snapshot.offlineCashUsedMinor) ? Math.max(0, snapshot.offlineCashUsedMinor) : 0;
  return {
    cashRegisterOpen: snapshot.cashRegisterOpen,
    cashierShiftOpen: snapshot.cashierShiftOpen,
    externalTerminalConfirmed: overrides.externalTerminalConfirmed === true,
    hasCatalogSnapshots: hasBothSnapshots(snapshot),
    hasValidSession: true,
    ...(overrides.originatedOnThisDevice === undefined ? {} : { originatedOnThisDevice: overrides.originatedOnThisDevice }),
    requiresSupervisorApproval: overrides.requiresSupervisorApproval === true,
    templateCached: snapshot.ticketTemplateCached,
    withinLocalRuleLimit: overrides.withinLocalRuleLimit !== false,
    withinOfflineCashLimit: used < limit,
  };
}

/** Evaluates a Web POS offline action through the shared capability guard (single source of truth). */
export function evaluateOfflinePosAction(
  action: OfflinePosAction,
  snapshot: OfflinePosSnapshot,
  overrides: OfflinePosPreconditionOverrides = {},
): OfflinePosCapabilityResult {
  const decision = evaluateOfflineCapability({
    action,
    clientType: "web_pos",
    connectivity: snapshot.connectivity,
    preconditions: buildCapabilityPreconditions(snapshot, overrides),
  });
  if (!decision.allowed) {
    const reasonCode = decision.reasonCode ?? "OFFLINE_NOT_SUPPORTED";
    return { allowed: false, decision, message: explainOfflineBlock(reasonCode) };
  }
  return {
    allowed: true,
    decision,
    message: decision.localOnlyWarning && !READ_ONLY_ACTIONS.has(action) ? OFFLINE_POS_MESSAGES.localSavedNotShared : "",
  };
}

export function explainOfflineBlock(code: CapabilityBlockCode): string {
  return OFFLINE_BLOCK_EXPLANATIONS[code];
}

export interface SnapshotFreshness {
  readonly stale: boolean;
  readonly label: string;
}

/**
 * Builds an operator-facing freshness label such as
 * `Menú en caché · versión 4 · actualizado 10:25` and flags it when stale.
 */
export function describeCachedSnapshotFreshness(
  snapshot: CachedSnapshotInfo,
  now: Date = new Date(),
  maxAgeMs: number = OFFLINE_POS_SNAPSHOT_MAX_AGE_MS,
): SnapshotFreshness {
  const noun = snapshot.kind === "menu" ? "Menú en caché" : "Mesas en caché";
  const captured = new Date(snapshot.capturedAt);
  const validCaptured = Number.isFinite(captured.getTime());
  const formatted = formatSyncDateTime(snapshot.capturedAt);
  const base = `${noun} · versión ${snapshot.version} · actualizado ${formatted}`;
  const stale = !validCaptured || now.getTime() - captured.getTime() > Math.max(0, maxAgeMs);
  return {
    label: stale ? `${base} · datos posiblemente desactualizados` : base,
    stale,
  };
}

/** Operator-facing summary of what this device can do right now, or `null` when nothing to show. */
export interface OfflinePosNotice {
  readonly tone: "info" | "warning" | "error";
  readonly title: string;
  readonly message: string;
  readonly snapshots: readonly string[];
  readonly allowed: readonly string[];
  readonly blocked: readonly ProhibitedOfflineOperation[];
}

export function describeOfflinePosNotice(input: {
  readonly snapshot: OfflinePosSnapshot | null;
  readonly browserOnline: boolean;
  readonly now?: Date;
}): OfflinePosNotice | null {
  const { snapshot, browserOnline } = input;
  if (browserOnline && (snapshot === null || snapshot.connectivity === "online")) {
    return null;
  }

  if (!browserOnline) {
    if (snapshot === null) {
      return {
        allowed: [],
        blocked: OFFLINE_PROHIBITED_OPERATIONS,
        message: OFFLINE_POS_MESSAGES.storageUnavailable,
        snapshots: [],
        title: "Sin conexión",
        tone: "warning",
      };
    }
    const snapshots: string[] = [];
    if (snapshot.catalog !== null) snapshots.push(describeCachedSnapshotFreshness(snapshot.catalog, input.now).label);
    if (snapshot.tables !== null) snapshots.push(describeCachedSnapshotFreshness(snapshot.tables, input.now).label);

    const allowed: string[] = [];
    if (evaluateOfflinePosAction("catalog.read_cached", snapshot).allowed) allowed.push(OFFLINE_POS_MESSAGES.catalogAllowed);
    if (evaluateOfflinePosAction("order.create_local", snapshot).allowed) {
      allowed.push("Crear órdenes locales y agregar líneas a las órdenes de este dispositivo.");
    }
    if (evaluateOfflinePosAction("payment.cash_collect", snapshot).allowed) allowed.push(OFFLINE_POS_MESSAGES.cashAllowed);

    return {
      allowed,
      blocked: OFFLINE_PROHIBITED_OPERATIONS,
      message: OFFLINE_POS_MESSAGES.localSavedNotShared,
      snapshots,
      title: "Trabajando sin conexión",
      tone: "info",
    };
  }

  // Reaching here means the browser is online, so the first guard already excluded a null snapshot.
  if (snapshot === null) return null;

  return {
    allowed: [],
    blocked: OFFLINE_PROHIBITED_OPERATIONS,
    message: snapshot.catalog === null || snapshot.tables === null
      ? OFFLINE_POS_MESSAGES.storageUnavailable
      : "La sincronización está bloqueada. Revisa /app/sync antes de continuar.",
    snapshots: [],
    title: "Sincronización pendiente",
    tone: snapshot.connectivity === "sync_blocked" ? "error" : "warning",
  };
}

export interface OfflineLocalCommitResult {
  readonly localState: "local_pending" | "unavailable" | "rejected";
  readonly code: string | null;
  readonly eventId: string | null;
  readonly message: string;
}

/**
 * Commits a local operation through the registered bridge. A success is announced **only** when the
 * bridge reports an atomic, durable write; otherwise the result is `unavailable`/`rejected` and the
 * operation is never presented as pending.
 */
export async function commitOfflineOperation(
  input: OfflinePosCommitInput,
  port: OfflinePosPort | undefined = getOfflinePosPort(),
): Promise<OfflineLocalCommitResult> {
  if (port === undefined || typeof port.commitLocalOperation !== "function") {
    return {
      code: "STORAGE_UNAVAILABLE",
      eventId: null,
      localState: "unavailable",
      message: OFFLINE_POS_MESSAGES.storageUnavailable,
    };
  }
  let outcome: OfflinePosCommitOutcome | null;
  try {
    outcome = await port.commitLocalOperation(input);
  } catch {
    return {
      code: "STORAGE_COMMIT_FAILED",
      eventId: null,
      localState: "rejected",
      message: "No se pudo guardar el cambio en este dispositivo. Inténtalo de nuevo.",
    };
  }
  if (outcome === null) {
    return {
      code: "STORAGE_UNAVAILABLE",
      eventId: null,
      localState: "unavailable",
      message: OFFLINE_POS_MESSAGES.storageUnavailable,
    };
  }
  // Never claim `local_pending` without a durable commit and a concrete event id.
  if (outcome.committed === true && typeof outcome.eventId === "string" && outcome.eventId.trim() !== "") {
    return {
      code: null,
      eventId: outcome.eventId,
      localState: "local_pending",
      message: outcome.message?.trim() || OFFLINE_POS_MESSAGES.localSavedNotShared,
    };
  }
  return {
    code: outcome.code ?? "STORAGE_COMMIT_FAILED",
    eventId: null,
    localState: "rejected",
    message: outcome.message?.trim() || "No se pudo guardar el cambio en este dispositivo. Inténtalo de nuevo.",
  };
}
