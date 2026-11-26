"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BranchScope, SyncConnectivityStateV1 } from "@super-restaurant/shared-types";

import { checkSyncConnectivityAction } from "../app/app/sync/actions";
import { getSyncFollowerNotice } from "../lib/offline/runtime-sync-runner";
import {
  deriveConnectivityState,
  EMPTY_WEB_SYNC_SNAPSHOT,
  formatSyncTime,
  getConnectivityPresentation,
  getWebSyncBridge,
  normalizeScopedSyncSnapshot,
  summarizeSyncEvents,
  WEB_SYNC_STATE_CHANGED_EVENT,
  type WebSyncUiSnapshot,
} from "../lib/sync-ui";

const PROBE_THROTTLE_MS = 30_000;

const BADGE_CLASSES: Readonly<Record<SyncConnectivityStateV1, string>> = {
  degraded: "inline-flex items-center gap-2 rounded-full border border-selected bg-accent-soft px-2.5 py-1 text-xs font-semibold text-text",
  offline: "inline-flex items-center gap-2 rounded-full border border-border bg-bg px-2.5 py-1 text-xs font-semibold text-text",
  online: "inline-flex items-center gap-2 rounded-full border border-success bg-success-bg px-2.5 py-1 text-xs font-semibold text-text",
  reconnecting: "inline-flex items-center gap-2 rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-xs font-semibold text-text",
  sync_blocked: "inline-flex items-center gap-2 rounded-full border border-error bg-error-bg px-2.5 py-1 text-xs font-semibold text-error",
};

const DOT_CLASSES: Readonly<Record<SyncConnectivityStateV1, string>> = {
  degraded: "h-2.5 w-2.5 shrink-0 rounded-full bg-selected",
  offline: "h-2.5 w-2.5 shrink-0 rounded-full bg-text-muted",
  online: "h-2.5 w-2.5 shrink-0 rounded-full bg-success",
  reconnecting: "h-2.5 w-2.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse",
  sync_blocked: "h-2.5 w-2.5 shrink-0 rounded-full bg-error",
};

export interface SyncStatusBarProps {
  readonly branchName?: string | undefined;
  readonly scope?: BranchScope | undefined;
  readonly initialServerReachable?: boolean | null | undefined;
  readonly initialConfirmedAt: string | null;
  readonly timeZone?: string | undefined;
}

/**
 * Persistent authenticated-shell bar displaying real connectivity state, active branch,
 * pending sync count, and last confirmed sync time without overlapping the operational area.
 */
export function SyncStatusBar({
  branchName,
  scope,
  initialServerReachable,
  initialConfirmedAt,
  timeZone,
}: SyncStatusBarProps): ReactNode {
  const [browserOnline, setBrowserOnline] = useState(true);
  const [serverReachable, setServerReachable] = useState<boolean | null>(
    initialServerReachable ?? (initialConfirmedAt !== null ? true : null),
  );
  const [reconnecting, setReconnecting] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(initialConfirmedAt);
  const [openReviewCount, setOpenReviewCount] = useState<number>(0);
  const [snapshot, setSnapshot] = useState<WebSyncUiSnapshot>(EMPTY_WEB_SYNC_SNAPSHOT);
  const [followerNotice, setFollowerNotice] = useState<string | null>(() => getSyncFollowerNotice());

  const lastProbeAtRef = useRef(0);
  const probingRef = useRef(false);

  const readBridgeSnapshot = useCallback((): void => {
    setFollowerNotice(getSyncFollowerNotice());
    if (scope === undefined) {
      setSnapshot(EMPTY_WEB_SYNC_SNAPSHOT);
      return;
    }
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

  const runServerProbe = useCallback(async (force: boolean): Promise<void> => {
    if (scope === undefined || probingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setBrowserOnline(false);
      setServerReachable(false);
      setReconnecting(false);
      return;
    }
    const now = Date.now();
    if (!force && now - lastProbeAtRef.current < PROBE_THROTTLE_MS) return;

    probingRef.current = true;
    lastProbeAtRef.current = now;
    try {
      const result = await checkSyncConnectivityAction();
      if (result.ok) {
        setServerReachable(true);
        if (result.syncConfirmedAt !== null) {
          setConfirmedAt(result.syncConfirmedAt);
        }
        if (result.openManualReviewCount !== null) {
          setOpenReviewCount(result.openManualReviewCount);
        }
      } else if (result.reason === "unavailable") {
        setServerReachable(false);
      }
    } catch {
      setServerReachable(false);
    } finally {
      probingRef.current = false;
      setReconnecting(false);
    }
  }, [scope]);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setBrowserOnline(navigator.onLine);
    }
    readBridgeSnapshot();
    void runServerProbe(false);

    const bridge = getWebSyncBridge();
    const unsubscribeBridge = bridge?.subscribe?.(() => {
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
      void runServerProbe(true);
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") {
        readBridgeSnapshot();
        void runServerProbe(false);
      }
    };

    window.addEventListener(WEB_SYNC_STATE_CHANGED_EVENT, handleBridgeEvent);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      unsubscribeBridge?.();
      window.removeEventListener(WEB_SYNC_STATE_CHANGED_EVENT, handleBridgeEvent);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [readBridgeSnapshot, runServerProbe]);

  const counts = summarizeSyncEvents(snapshot.events);
  const localOpenReviews = (snapshot.localManualReviewCases ?? []).filter((item) => item.status === "open").length;
  const totalOpenReviews = Math.max(openReviewCount, localOpenReviews);

  const connectivityState = deriveConnectivityState({
    blockedEventCount: counts.blockedCount,
    browserOnline,
    openManualReviewCount: totalOpenReviews,
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
  const formattedTime = formatSyncTime(effectiveConfirmedAt, timeZone);
  const attentionTotal =
    counts.rejectedCount + counts.conflictCount + Math.max(counts.manualReviewCount, totalOpenReviews);

  return (
    <section
      aria-label="Estado de conexión y sincronización"
      data-connectivity-state={connectivityState}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-bg px-3 py-1.5 sm:px-8"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          role="status"
          aria-live="polite"
          className={BADGE_CLASSES[connectivityState]}
        >
          <span aria-hidden="true" className={DOT_CLASSES[connectivityState]} />
          <span>{presentation.label}</span>
        </span>

        <span className="min-w-0 truncate text-xs text-text-muted">
          <span className="font-semibold text-text">
            {branchName !== undefined && branchName.trim() !== "" ? branchName : "Sin sucursal"}
          </span>
        </span>

        <span className="text-xs text-text-muted">
          {counts.pendingCount > 0 ? (
            <span className="font-semibold text-text">Pendientes: {counts.pendingCount}</span>
          ) : (
            <span>Sin pendientes</span>
          )}
        </span>

        {attentionTotal > 0 && (
          <span className="rounded-full border border-error bg-error-bg px-2 py-0.5 text-xs font-semibold text-error">
            Requiere revisión: {attentionTotal}
          </span>
        )}

        <span className="text-xs text-text-muted">
          {formattedTime !== null ? `Última confirmación: ${formattedTime}` : "Última confirmación: sin confirmar"}
        </span>

        {followerNotice !== null && (
          <span role="note" className="text-xs text-text-muted">
            {followerNotice}
          </span>
        )}
      </div>

      <Link
        href="/app/sync"
        className="link-text inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border bg-surface px-3 text-xs font-semibold transition-colors motion-reduce:transition-none hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Ver sincronización
      </Link>
    </section>
  );
}
