"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  BranchScope,
  ManualReviewCaseV1,
  SyncConnectivityStateV1,
  SyncOutboxStateV1,
} from "@super-restaurant/shared-types";

import { trapFocusIndex } from "../../../lib/focus-trap";
import {
  buildSyncBannerMessage,
  canRetrySyncEvent,
  deriveConnectivityState,
  describeSyncOutcomeForOperator,
  EMPTY_WEB_SYNC_SNAPSHOT,
  filterSyncEvents,
  formatEntityTypeLabel,
  formatManualReviewStatusLabel,
  formatOperationLabel,
  formatOutboxStateLabel,
  formatSyncAmountMinor,
  formatSyncDateTime,
  formatSyncEventTitle,
  formatSyncTime,
  getConnectivityPresentation,
  getWebSyncBridge,
  isSchemaOutdatedCode,
  normalizeScopedSyncSnapshot,
  summarizeSyncEvents,
  SYNC_MATRIX_MESSAGES,
  validateManualReviewResolutionForm,
  WEB_SCHEMA_UPDATE_EVENT,
  WEB_SYNC_STATE_CHANGED_EVENT,
  type SyncEventFilter,
  type WebSyncUiSnapshot,
} from "../../../lib/sync-ui";
import { uiButton, uiChip, uiOption } from "../../../lib/ui-classes";
import {
  checkSyncConnectivityAction,
  refreshManualReviewCasesAction,
  resolveManualReviewCaseAction,
  type ManualReviewListOutcome,
} from "./actions";

const CONNECTIVITY_PILL_CLASSES: Readonly<Record<SyncConnectivityStateV1, string>> = {
  degraded: "inline-flex items-center gap-2 rounded-full border border-selected bg-accent-soft px-3 py-1 text-xs font-semibold text-text",
  offline: "inline-flex items-center gap-2 rounded-full border border-border bg-bg px-3 py-1 text-xs font-semibold text-text",
  online: "inline-flex items-center gap-2 rounded-full border border-success bg-success-bg px-3 py-1 text-xs font-semibold text-text",
  reconnecting: "inline-flex items-center gap-2 rounded-full border border-accent bg-accent-soft px-3 py-1 text-xs font-semibold text-text",
  sync_blocked: "inline-flex items-center gap-2 rounded-full border border-error bg-error-bg px-3 py-1 text-xs font-semibold text-error",
};

const CONNECTIVITY_DOT_CLASSES: Readonly<Record<SyncConnectivityStateV1, string>> = {
  degraded: "h-2.5 w-2.5 shrink-0 rounded-full bg-selected",
  offline: "h-2.5 w-2.5 shrink-0 rounded-full bg-text-muted",
  online: "h-2.5 w-2.5 shrink-0 rounded-full bg-success",
  reconnecting: "h-2.5 w-2.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse",
  sync_blocked: "h-2.5 w-2.5 shrink-0 rounded-full bg-error",
};

const EVENT_STATE_PILL_CLASSES: Readonly<Record<SyncOutboxStateV1, string>> = {
  accepted: "inline-flex items-center whitespace-nowrap rounded-full border border-success bg-success-bg px-2.5 py-0.5 text-xs font-semibold text-text",
  conflict: "inline-flex items-center whitespace-nowrap rounded-full border border-error bg-error-bg px-2.5 py-0.5 text-xs font-semibold text-error",
  duplicate: "inline-flex items-center whitespace-nowrap rounded-full border border-success bg-success-bg px-2.5 py-0.5 text-xs font-semibold text-text",
  manual_review: "inline-flex items-center whitespace-nowrap rounded-full border border-error bg-error-bg px-2.5 py-0.5 text-xs font-semibold text-error",
  pending: "inline-flex items-center whitespace-nowrap rounded-full border border-border bg-bg px-2.5 py-0.5 text-xs font-semibold text-text",
  rejected: "inline-flex items-center whitespace-nowrap rounded-full border border-error bg-error-bg px-2.5 py-0.5 text-xs font-semibold text-error",
  retry_wait: "inline-flex items-center whitespace-nowrap rounded-full border border-selected bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-text",
  sending: "inline-flex items-center whitespace-nowrap rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-text",
};

const REVIEW_STATUS_PILL_CLASSES: Readonly<Record<ManualReviewCaseV1["status"], string>> = {
  open: "inline-flex items-center whitespace-nowrap rounded-full border border-error bg-error-bg px-2.5 py-0.5 text-xs font-semibold text-error",
  resolved_compensated: "inline-flex items-center whitespace-nowrap rounded-full border border-success bg-success-bg px-2.5 py-0.5 text-xs font-semibold text-text",
  resolved_rejected: "inline-flex items-center whitespace-nowrap rounded-full border border-border bg-bg px-2.5 py-0.5 text-xs font-semibold text-text-muted",
};

const FILTER_OPTIONS: readonly { readonly id: SyncEventFilter; readonly label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Pendientes" },
  { id: "attention", label: "Requieren atención" },
  { id: "confirmed", label: "Confirmados" },
];

interface FeedbackBanner {
  readonly tone: "success" | "error" | "info";
  readonly text: string;
}

interface ResolutionAttempt {
  readonly caseId: string;
  readonly decision: "compensate" | "reject";
  readonly idempotencyKey: string;
  readonly compensatingEventId: string | null;
  readonly occurredAt: string;
}

export interface SyncDashboardProps {
  readonly branchName: string;
  readonly restaurantName: string;
  readonly scope: BranchScope;
  readonly timeZone?: string | undefined;
  readonly canResolveManualReview: boolean;
  readonly initialConfirmedAt: string | null;
  readonly initialReviewOutcome: ManualReviewListOutcome;
}

function createUuid(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-000000000000";
}

export function SyncDashboard({
  branchName,
  restaurantName,
  scope,
  timeZone,
  canResolveManualReview,
  initialConfirmedAt,
  initialReviewOutcome,
}: SyncDashboardProps): ReactNode {
  const [browserOnline, setBrowserOnline] = useState(true);
  const [serverReachable, setServerReachable] = useState<boolean | null>(
    initialReviewOutcome.status === "unavailable" ? false : true,
  );
  const [reconnecting, setReconnecting] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(
    initialReviewOutcome.status === "ok" || initialReviewOutcome.status === "not_deployed"
      ? initialReviewOutcome.confirmedAt
      : initialConfirmedAt,
  );
  const [snapshot, setSnapshot] = useState<WebSyncUiSnapshot>(EMPTY_WEB_SYNC_SNAPSHOT);
  const [reviewCases, setReviewCases] = useState<readonly ManualReviewCaseV1[]>(
    initialReviewOutcome.status === "ok" ? initialReviewOutcome.cases : [],
  );
  const [reviewSourceStatus, setReviewSourceStatus] = useState<ManualReviewListOutcome["status"]>(
    initialReviewOutcome.status,
  );
  const [filter, setFilter] = useState<SyncEventFilter>("all");
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"retry" | "resync" | string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackBanner | null>(null);

  // In-app supervisor resolution modal state (never alert/confirm/prompt).
  const [resolvingCase, setResolvingCase] = useState<ManualReviewCaseV1 | null>(null);
  const [resolutionDecision, setResolutionDecision] = useState<"compensate" | "reject">("compensate");
  const [resolutionReason, setResolutionReason] = useState("");
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolutionSubmitting, setResolutionSubmitting] = useState(false);
  const resolutionAttemptRef = useRef<ResolutionAttempt | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const reviewSectionRef = useRef<HTMLElement | null>(null);

  const readBridgeSnapshot = useCallback((): void => {
    const bridge = getWebSyncBridge();
    if (bridge === undefined) {
      setSnapshot(EMPTY_WEB_SYNC_SNAPSHOT);
      return;
    }
    try {
      const normalized = normalizeScopedSyncSnapshot(bridge.getSnapshot(scope), scope);
      setSnapshot(normalized);
      if (normalized.lastConfirmedSyncAt !== null) {
        setConfirmedAt(normalized.lastConfirmedSyncAt);
      }
    } catch {
      setSnapshot(EMPTY_WEB_SYNC_SNAPSHOT);
    }
  }, [scope]);

  const refreshFromServer = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setBrowserOnline(false);
      setServerReachable(false);
      return false;
    }
    try {
      const outcome = await refreshManualReviewCasesAction();
      setReviewSourceStatus(outcome.status);
      if (outcome.status === "ok") {
        setReviewCases(outcome.cases);
        setConfirmedAt(outcome.confirmedAt);
        setServerReachable(true);
        return true;
      }
      if (outcome.status === "not_deployed") {
        setConfirmedAt(outcome.confirmedAt);
        setServerReachable(true);
        return true;
      }
      if (outcome.status === "denied") {
        const probe = await checkSyncConnectivityAction();
        if (probe.ok) {
          setConfirmedAt(probe.confirmedAt);
          setServerReachable(true);
          return true;
        }
        setServerReachable(false);
        return false;
      }
      setServerReachable(false);
      return false;
    } catch {
      setServerReachable(false);
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setBrowserOnline(navigator.onLine);
    }
    readBridgeSnapshot();

    const bridge = getWebSyncBridge();
    const unsubscribe = bridge?.subscribe?.(() => {
      readBridgeSnapshot();
    });

    const handleBridgeEvent = (): void => {
      readBridgeSnapshot();
    };
    const handleOffline = (): void => {
      setBrowserOnline(false);
      setServerReachable(false);
      setReconnecting(false);
    };
    const handleOnline = (): void => {
      setBrowserOnline(true);
      setReconnecting(true);
      void refreshFromServer().finally(() => {
        readBridgeSnapshot();
        setReconnecting(false);
      });
    };

    window.addEventListener(WEB_SYNC_STATE_CHANGED_EVENT, handleBridgeEvent);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      unsubscribe?.();
      window.removeEventListener(WEB_SYNC_STATE_CHANGED_EVENT, handleBridgeEvent);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [readBridgeSnapshot, refreshFromServer]);

  useEffect(() => {
    if (resolvingCase === null) return;
    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector<HTMLElement>(
      "button:not([disabled]), textarea:not([disabled]), input:not([disabled])",
    );
    firstFocusable?.focus();
  }, [resolvingCase]);

  const combinedReviewCases = mergeManualReviewCases(reviewCases, snapshot.localManualReviewCases ?? []);
  const openReviewCases = combinedReviewCases.filter((item) => item.status === "open");
  const hasFinancialReview = openReviewCases.some((item) => item.financial);
  const counts = summarizeSyncEvents(snapshot.events);

  const connectivityState = deriveConnectivityState({
    blockedEventCount: counts.blockedCount,
    browserOnline,
    openManualReviewCount: openReviewCases.length,
    pendingCount: counts.pendingCount,
    reconnecting: reconnecting || snapshot.syncing,
    resyncRequired: snapshot.resyncRequired,
    retryWaitCount: counts.retryWaitCount,
    schemaOutdated: snapshot.schemaOutdated || counts.hasSchemaOutdated,
    scopeRevoked: snapshot.scopeRevoked,
    serverReachable,
    storageQuarantined: snapshot.storageQuarantined,
  });

  const presentation = getConnectivityPresentation(connectivityState);
  const effectiveConfirmedAt = snapshot.lastConfirmedSyncAt ?? confirmedAt;
  const formattedConfirmTime = formatSyncTime(effectiveConfirmedAt, timeZone);

  const bannerMessage = buildSyncBannerMessage({
    counts,
    hasFinancialReview,
    lastConfirmedSyncAt: effectiveConfirmedAt,
    openManualReviewCount: openReviewCases.length,
    schemaOutdated: snapshot.schemaOutdated || counts.hasSchemaOutdated,
    scopeRevoked: snapshot.scopeRevoked,
    state: connectivityState,
    storageQuarantined: snapshot.storageQuarantined,
    timeZone,
  });

  const visibleEvents = filterSyncEvents(snapshot.events, filter);

  const handleRetryPending = async (eventId?: string): Promise<void> => {
    if (busyAction !== null) return;
    if (!browserOnline) {
      setFeedback({ text: SYNC_MATRIX_MESSAGES.offlineSavedLocally, tone: "info" });
      return;
    }

    setBusyAction(eventId ?? "retry");
    setFeedback(null);
    setReconnecting(true);
    try {
      const bridge = getWebSyncBridge();
      if (bridge?.retryPending !== undefined) {
        const result = await bridge.retryPending(scope, eventId);
        readBridgeSnapshot();
        if (result.confirmedAt !== undefined && result.confirmedAt !== null) {
          setConfirmedAt(result.confirmedAt);
        }
        if (!result.ok) {
          setFeedback({
            text: describeSyncOutcomeForOperator({ code: result.code ?? "TRANSPORT_ERROR", localState: "retry_wait" }),
            tone: "error",
          });
          return;
        }
      }

      const reachable = await refreshFromServer();
      readBridgeSnapshot();
      if (reachable) {
        const latestTime = formatSyncTime(new Date().toISOString(), timeZone);
        setFeedback({
          text: latestTime !== null && counts.pendingCount === 0
            ? SYNC_MATRIX_MESSAGES.reconciliationComplete(latestTime)
            : "Reintento completado sin duplicar cambios.",
          tone: "success",
        });
      } else {
        setFeedback({ text: SYNC_MATRIX_MESSAGES.retryPreserved, tone: "error" });
      }
    } catch {
      setFeedback({ text: SYNC_MATRIX_MESSAGES.retryPreserved, tone: "error" });
    } finally {
      setReconnecting(false);
      setBusyAction(null);
    }
  };

  const handleFullResync = async (): Promise<void> => {
    if (busyAction !== null) return;
    if (!browserOnline) {
      setFeedback({ text: SYNC_MATRIX_MESSAGES.offlineSavedLocally, tone: "info" });
      return;
    }

    setBusyAction("resync");
    setFeedback(null);
    setReconnecting(true);
    try {
      const bridge = getWebSyncBridge();
      if (bridge?.requestResync !== undefined) {
        const result = await bridge.requestResync(scope);
        readBridgeSnapshot();
        if (!result.ok) {
          setFeedback({
            text: describeSyncOutcomeForOperator({ code: result.code ?? "TRANSPORT_ERROR" }),
            tone: "error",
          });
          return;
        }
      }

      const reachable = await refreshFromServer();
      readBridgeSnapshot();
      if (reachable) {
        const latestTime = formatSyncTime(new Date().toISOString(), timeZone);
        setFeedback({
          text: latestTime !== null
            ? SYNC_MATRIX_MESSAGES.reconciliationComplete(latestTime)
            : "Sincronización actualizada con el servidor.",
          tone: "success",
        });
      } else {
        setFeedback({ text: SYNC_MATRIX_MESSAGES.retryPreserved, tone: "error" });
      }
    } catch {
      setFeedback({ text: SYNC_MATRIX_MESSAGES.retryPreserved, tone: "error" });
    } finally {
      setReconnecting(false);
      setBusyAction(null);
    }
  };

  const handleTriggerAppUpdate = (): void => {
    window.dispatchEvent(new Event(WEB_SCHEMA_UPDATE_EVENT));
    setFeedback({
      text: SYNC_MATRIX_MESSAGES.schemaOutdated,
      tone: "info",
    });
  };

  const handleScrollToReviews = (): void => {
    reviewSectionRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  const openResolutionDialog = (reviewCase: ManualReviewCaseV1): void => {
    setResolvingCase(reviewCase);
    setResolutionDecision("compensate");
    setResolutionReason("");
    setResolutionError(null);
    resolutionAttemptRef.current = null;
  };

  const closeResolutionDialog = (): void => {
    if (resolutionSubmitting) return;
    setResolvingCase(null);
    setResolutionError(null);
    resolutionAttemptRef.current = null;
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeResolutionDialog();
      return;
    }
    if (event.key === "Tab" && dialogRef.current !== null) {
      const focusables = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]",
        ),
      ];
      const current = focusables.indexOf(document.activeElement as HTMLElement);
      const next = trapFocusIndex(focusables.length, current, event.shiftKey);
      if (next !== null) {
        event.preventDefault();
        focusables[next]?.focus();
      }
    }
  };

  const handleConfirmResolution = async (): Promise<void> => {
    if (resolvingCase === null || resolutionSubmitting) return;
    if (!browserOnline) {
      setResolutionError("Se requiere conexión con el servidor para registrar la resolución de supervisión.");
      return;
    }

    const validation = validateManualReviewResolutionForm({
      decision: resolutionDecision,
      reason: resolutionReason,
    });
    if (!validation.ok) {
      setResolutionError(validation.message);
      return;
    }

    // Preserve attempt identifiers across transient retries for the same case and decision.
    const existing = resolutionAttemptRef.current;
    const attempt: ResolutionAttempt =
      existing !== null && existing.caseId === resolvingCase.caseId && existing.decision === validation.decision
        ? existing
        : {
            caseId: resolvingCase.caseId,
            compensatingEventId: validation.decision === "compensate" ? createUuid() : null,
            decision: validation.decision,
            idempotencyKey: `mr-resolve-${createUuid()}`,
            occurredAt: new Date().toISOString(),
          };
    resolutionAttemptRef.current = attempt;

    setResolutionSubmitting(true);
    setResolutionError(null);
    try {
      const result = await resolveManualReviewCaseAction({
        caseId: attempt.caseId,
        compensatingEventId: attempt.compensatingEventId,
        decision: attempt.decision,
        idempotencyKey: attempt.idempotencyKey,
        occurredAt: attempt.occurredAt,
        reason: validation.reason,
      });

      if (result.ok) {
        setConfirmedAt(result.confirmedAt);
        setResolvingCase(null);
        resolutionAttemptRef.current = null;
        await refreshFromServer();
        setFeedback({
          text:
            validation.decision === "compensate"
              ? "Resolución registrada: se aplicó el ajuste compensatorio con auditoría."
              : "Resolución registrada: el cambio pendiente fue descartado con auditoría.",
          tone: "success",
        });
        return;
      }

      if (result.error === "denied") {
        setResolutionError(SYNC_MATRIX_MESSAGES.permissionRejected);
      } else if (result.error === "conflict") {
        setResolutionError("Este caso ya cambió o fue resuelto por otro supervisor. Actualiza la lista.");
      } else if (result.error === "not_deployed") {
        setResolutionError("El servicio de revisión de supervisores aún no está activo en este entorno.");
      } else if (result.error === "invalid") {
        setResolutionError("Revisa la decisión y el motivo escrito antes de confirmar.");
      } else {
        setResolutionError(SYNC_MATRIX_MESSAGES.retryPreserved);
      }
    } catch {
      setResolutionError(SYNC_MATRIX_MESSAGES.retryPreserved);
    } finally {
      setResolutionSubmitting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-5 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Sincronización</p>
          <h1 className="break-words font-heading text-2xl font-bold text-text">
            Conexión y pendientes · {branchName}
          </h1>
          <p className="mt-1 text-sm text-text-muted">{restaurantName}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!browserOnline || busyAction !== null}
            onClick={() => {
              void handleRetryPending();
            }}
            className={uiButton("secondary")}
          >
            {busyAction === "retry" ? "Reintentando…" : "Reintentar pendientes"}
          </button>
          <button
            type="button"
            disabled={!browserOnline || busyAction !== null}
            onClick={() => {
              void handleFullResync();
            }}
            className={uiButton("primary")}
          >
            {busyAction === "resync" ? "Sincronizando…" : "Volver a sincronizar"}
          </button>
        </div>
      </header>

      <section
        aria-label="Resumen de conectividad"
        data-connectivity-state={connectivityState}
        className="rounded-2xl border border-border bg-surface p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={CONNECTIVITY_PILL_CLASSES[connectivityState]}>
              <span aria-hidden="true" className={CONNECTIVITY_DOT_CLASSES[connectivityState]} />
              <span>{presentation.label}</span>
            </span>
            <span className="text-xs text-text-muted">
              Sucursal activa: <strong className="font-semibold text-text">{branchName}</strong>
            </span>
          </div>
          <span className="text-xs text-text-muted">
            {formattedConfirmTime !== null
              ? `Última confirmación: ${formattedConfirmTime}`
              : "Aún sin sincronización confirmada"}
          </span>
        </div>

        <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-text">
          {bannerMessage}
        </p>

        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Sin conexión a internet, cada equipo conserva únicamente sus propios cambios; cocina y otros equipos los verán al sincronizar con el servidor.
        </p>

        {!snapshot.storageReady && (
          <p className="mt-2 rounded-xl border border-border bg-bg px-3 py-2 text-xs text-text-muted">
            Modo en línea activo: este navegador aún no tiene cola local persistente activada. Los cambios confirmados se envían directo al servidor.
          </p>
        )}
      </section>

      {feedback !== null && (
        <div
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            feedback.tone === "error"
              ? "rounded-xl border border-error bg-error-bg px-4 py-3 text-sm font-medium text-error"
              : feedback.tone === "success"
                ? "rounded-xl border border-success bg-success-bg px-4 py-3 text-sm font-medium text-text"
                : "rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-text"
          }
        >
          {feedback.text}
        </div>
      )}

      <section aria-label="Indicadores de sincronización" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Pendientes de envío</p>
          <p className="mt-1 font-heading text-2xl font-bold text-text">{counts.pendingCount}</p>
          <p className="mt-1 text-xs text-text-muted">
            {counts.retryWaitCount > 0
              ? `${counts.retryWaitCount} en espera de reintento`
              : "Sin reintentos en espera"}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Requieren atención</p>
          <p className="mt-1 font-heading text-2xl font-bold text-text">{counts.blockedCount}</p>
          <p className="mt-1 text-xs text-text-muted">
            {counts.hasFinancialBlocked
              ? "Incluye operaciones financieras retenidas"
              : "Conflictos o cambios no aplicados"}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Revisión de supervisor</p>
          <p className="mt-1 font-heading text-2xl font-bold text-text">{openReviewCases.length}</p>
          <p className="mt-1 text-xs text-text-muted">
            {openReviewCases.length > 0
              ? "Casos abiertos en esta sucursal"
              : "Sin casos abiertos"}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Última confirmación</p>
          <p className="mt-1 font-heading text-2xl font-bold text-text">
            {formattedConfirmTime ?? "—"}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {formattedConfirmTime !== null ? "Verificada con el servidor" : "Pendiente de verificar"}
          </p>
        </div>
      </section>

      <section aria-label="Eventos en este dispositivo" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-base font-bold text-text">Cambios en este dispositivo</h2>
            <p className="text-xs text-text-muted">
              Cada registro muestra su estado actual, reintentos y la acción segura disponible.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar cambios por estado">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => {
                  setFilter(option.id);
                }}
                className={uiChip(filter === option.id, "px-3 text-xs")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {visibleEvents.length === 0 ? (
          <div className="rounded-xl border border-border bg-bg p-5 text-center">
            <p className="text-sm font-medium text-text">
              {snapshot.events.length === 0
                ? "No hay cambios pendientes en este dispositivo."
                : "No hay cambios que coincidan con este filtro."}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {snapshot.events.length === 0
                ? "Cuando se guarden operaciones sin conexión o en reintento, aparecerán aquí con su estado."
                : "Selecciona otro filtro para revisar el resto de los registros."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {visibleEvents.map((item) => {
              const isExpanded = expandedEventId === item.eventId;
              const operatorMessage = describeSyncOutcomeForOperator({
                code: item.lastErrorCode,
                entityType: item.entityType,
                financial: item.financial,
                localState: item.localState,
              });
              const retryable = canRetrySyncEvent(item);
              const needsSchemaUpdate = item.schemaOutdated || isSchemaOutdatedCode(item.lastErrorCode);
              const needsSupervisor = item.localState === "conflict" || item.localState === "manual_review";

              return (
                <li key={item.eventId} className="rounded-xl border border-border bg-bg p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-heading text-sm font-bold text-text">
                          {formatSyncEventTitle(item)}
                        </span>
                        <span className="text-xs font-medium text-text-muted">
                          Registro #{item.localSequence}
                        </span>
                        {item.financial && (
                          <span className="rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                            Financiero
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                        <span className={EVENT_STATE_PILL_CLASSES[item.localState]}>
                          {formatOutboxStateLabel(item.localState)}
                        </span>
                        <span>Reintentos: {item.retryCount}</span>
                        <span>Registrado: {formatSyncDateTime(item.occurredAt, timeZone)}</span>
                      </div>

                      <p className="mt-2 text-sm text-text">{operatorMessage}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {retryable && (
                        <button
                          type="button"
                          disabled={!browserOnline || busyAction !== null}
                          onClick={() => {
                            void handleRetryPending(item.eventId);
                          }}
                          className={uiButton("primary", "px-3 text-xs")}
                        >
                          {busyAction === item.eventId ? "Reintentando…" : "Reintentar envío"}
                        </button>
                      )}
                      {needsSupervisor && (
                        <button
                          type="button"
                          onClick={handleScrollToReviews}
                          className={uiButton("secondary", "px-3 text-xs")}
                        >
                          Ir a revisión
                        </button>
                      )}
                      {needsSchemaUpdate && (
                        <button
                          type="button"
                          onClick={handleTriggerAppUpdate}
                          className={uiButton("primary", "px-3 text-xs")}
                        >
                          Actualizar aplicación
                        </button>
                      )}
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => {
                          setExpandedEventId(isExpanded ? null : item.eventId);
                        }}
                        className={uiButton("ghost", "px-3 text-xs")}
                      >
                        {isExpanded ? "Ocultar detalle" : "Ver detalle"}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <dl className="mt-3 grid grid-cols-1 gap-2 border-t border-border pt-3 text-xs sm:grid-cols-3">
                      <div>
                        <dt className="font-semibold text-text-muted">Tipo de operación</dt>
                        <dd className="mt-0.5 text-text">
                          {formatEntityTypeLabel(item.entityType)} · {formatOperationLabel(item.operation)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-text-muted">Última actualización</dt>
                        <dd className="mt-0.5 text-text">
                          {item.updatedAt !== null ? formatSyncDateTime(item.updatedAt, timeZone) : "Sin respuesta todavía"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-text-muted">Protección contra duplicados</dt>
                        <dd className="mt-0.5 text-text">
                          Conservado con clave única; reintentar no duplicará el registro.
                        </dd>
                      </div>
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        ref={reviewSectionRef}
        aria-label="Revisión manual de supervisores"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-heading text-base font-bold text-text">Revisión manual de supervisores</h2>
            <p className="text-xs text-text-muted">
              Los conflictos financieros o de versión se resuelven de forma auditada, sin sobrescribir ni cobrar dos veces.
            </p>
          </div>
          {!canResolveManualReview && (
            <span className="rounded-full border border-border bg-bg px-3 py-1 text-xs font-medium text-text-muted">
              Solo supervisión o gerencia puede resolver casos
            </span>
          )}
        </div>

        {reviewSourceStatus === "denied" && (
          <p role="status" className="rounded-xl border border-border bg-bg p-4 text-sm text-text-muted">
            Tu rol actual no tiene permiso para consultar la bandeja de revisión de supervisores en esta sucursal.
          </p>
        )}

        {reviewSourceStatus === "not_deployed" && combinedReviewCases.length === 0 && (
          <p role="status" className="rounded-xl border border-border bg-bg p-4 text-sm text-text-muted">
            No hay casos pendientes de revisión en este momento. Cuando exista un conflicto de sincronización, aparecerá aquí para decisión de supervisión.
          </p>
        )}

        {reviewSourceStatus === "unavailable" && combinedReviewCases.length === 0 && (
          <p role="alert" className="rounded-xl border border-error bg-error-bg p-4 text-sm text-error">
            {SYNC_MATRIX_MESSAGES.retryPreserved}
          </p>
        )}

        {reviewSourceStatus === "ok" && combinedReviewCases.length === 0 && (
          <p role="status" className="rounded-xl border border-border bg-bg p-4 text-sm text-text-muted">
            No hay casos de revisión manual pendientes en {branchName}.
          </p>
        )}

        {combinedReviewCases.length > 0 && (
          <ul className="flex flex-col gap-3">
            {combinedReviewCases.map((reviewCase, index) => {
              const formattedAmount = formatSyncAmountMinor(reviewCase.amountMinor, reviewCase.currency);
              const reasonText = describeSyncOutcomeForOperator({
                code: reviewCase.reasonCode,
                entityType: reviewCase.entityType,
                financial: reviewCase.financial,
                localState: "manual_review",
              });

              return (
                <li key={reviewCase.caseId} className="rounded-xl border border-border bg-bg p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-heading text-sm font-bold text-text">
                          Caso #{index + 1} · {formatEntityTypeLabel(reviewCase.entityType)} · {formatOperationLabel(reviewCase.operation)}
                        </span>
                        {reviewCase.financial && (
                          <span className="rounded-full border border-error bg-error-bg px-2 py-0.5 text-xs font-semibold text-error">
                            Financiero
                          </span>
                        )}
                        {formattedAmount !== null && (
                          <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold text-text">
                            Monto: {formattedAmount}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                        <span className={REVIEW_STATUS_PILL_CLASSES[reviewCase.status]}>
                          {formatManualReviewStatusLabel(reviewCase.status)}
                        </span>
                        <span>Abierto: {formatSyncDateTime(reviewCase.openedAt, timeZone)}</span>
                        {reviewCase.resolvedAt !== null && (
                          <span>Resuelto: {formatSyncDateTime(reviewCase.resolvedAt, timeZone)}</span>
                        )}
                      </div>

                      <p className="mt-2 text-sm text-text">{reasonText}</p>

                      {reviewCase.resolutionReason !== null && (
                        <p className="mt-1.5 text-xs text-text-muted">
                          Motivo registrado: <span className="text-text">{reviewCase.resolutionReason}</span>
                        </p>
                      )}
                    </div>

                    {reviewCase.status === "open" && (
                      <div className="flex shrink-0 items-center">
                        {canResolveManualReview ? (
                          <button
                            type="button"
                            disabled={!browserOnline}
                            onClick={() => {
                              openResolutionDialog(reviewCase);
                            }}
                            className={uiButton("primary", "px-3 text-xs")}
                          >
                            Resolver caso
                          </button>
                        ) : (
                          <span className="text-xs font-medium text-text-muted">
                            Requiere supervisor
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {resolvingCase !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeResolutionDialog();
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-review-dialog-title"
            onKeyDown={handleDialogKeyDown}
            className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                  Decisión de supervisión
                </p>
                <h3 id="manual-review-dialog-title" className="mt-0.5 font-heading text-lg font-bold text-text">
                  Resolver {formatEntityTypeLabel(resolvingCase.entityType).toLowerCase()}
                </h3>
              </div>
              <button
                type="button"
                disabled={resolutionSubmitting}
                aria-label="Cerrar ventana de resolución"
                onClick={closeResolutionDialog}
                className={uiButton("ghost", "min-w-11 px-2")}
              >
                ✕
              </button>
            </div>

            <p className="mt-2 text-sm text-text-muted">
              {describeSyncOutcomeForOperator({
                code: resolvingCase.reasonCode,
                entityType: resolvingCase.entityType,
                financial: resolvingCase.financial,
                localState: "manual_review",
              })}
            </p>

            {formatSyncAmountMinor(resolvingCase.amountMinor, resolvingCase.currency) !== null && (
              <p className="mt-2 text-sm font-semibold text-text">
                Monto involucrado: {formatSyncAmountMinor(resolvingCase.amountMinor, resolvingCase.currency)}
              </p>
            )}

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold text-text">Acción auditada</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={resolutionDecision === "compensate"}
                  disabled={resolutionSubmitting}
                  onClick={() => {
                    setResolutionDecision("compensate");
                    setResolutionError(null);
                  }}
                  className={uiOption(resolutionDecision === "compensate", "w-full text-left")}
                >
                  Aprobar ajuste compensatorio
                </button>
                <button
                  type="button"
                  aria-pressed={resolutionDecision === "reject"}
                  disabled={resolutionSubmitting}
                  onClick={() => {
                    setResolutionDecision("reject");
                    setResolutionError(null);
                  }}
                  className={uiOption(resolutionDecision === "reject", "w-full text-left")}
                >
                  Descartar cambio pendiente
                </button>
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {resolutionDecision === "compensate"
                  ? "Conserva el registro original sin alterarlo y registra un movimiento compensatorio enlazado."
                  : "Marca el cambio pendiente como no aplicado y conserva la evidencia en el historial."}
              </p>
            </fieldset>

            <div className="mt-4 flex flex-col gap-1.5">
              <label htmlFor="manual-review-reason" className="text-xs font-semibold text-text">
                Motivo de la resolución (obligatorio)
              </label>
              <textarea
                id="manual-review-reason"
                rows={3}
                maxLength={500}
                disabled={resolutionSubmitting}
                value={resolutionReason}
                onChange={(event) => {
                  setResolutionReason(event.target.value);
                  if (resolutionError !== null) setResolutionError(null);
                }}
                placeholder="Ej. Se verificó el comprobante de caja y se confirmó que el cobro ya existía."
                className="min-h-24 w-full rounded-xl border border-border bg-bg p-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </div>

            {resolutionError !== null && (
              <p role="alert" className="mt-3 rounded-xl border border-error bg-error-bg px-3 py-2 text-xs font-medium text-error">
                {resolutionError}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={resolutionSubmitting}
                onClick={closeResolutionDialog}
                className={uiButton("secondary")}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={resolutionSubmitting || !browserOnline}
                onClick={() => {
                  void handleConfirmResolution();
                }}
                className={uiButton("primary")}
              >
                {resolutionSubmitting ? "Guardando…" : "Confirmar resolución"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function mergeManualReviewCases(
  serverCases: readonly ManualReviewCaseV1[],
  localCases: readonly ManualReviewCaseV1[],
): readonly ManualReviewCaseV1[] {
  if (localCases.length === 0) return serverCases;
  const byId = new Map<string, ManualReviewCaseV1>();
  for (const item of localCases) {
    byId.set(item.caseId, item);
  }
  for (const item of serverCases) {
    byId.set(item.caseId, item);
  }
  return [...byId.values()];
}
