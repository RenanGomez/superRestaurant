"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { BranchScope } from "@super-restaurant/shared-types";

import {
  describeOfflinePosNotice,
  getOfflinePosPort,
  OFFLINE_POS_STATE_CHANGED_EVENT,
  type OfflinePosNotice,
  type OfflinePosSnapshot,
} from "../../../lib/offline-pos";
import { WEB_SYNC_STATE_CHANGED_EVENT } from "../../../lib/sync-ui";

const TONE_CLASSES: Readonly<Record<OfflinePosNotice["tone"], string>> = {
  error: "border-error bg-error-bg text-error",
  info: "border-selected bg-accent-soft text-text",
  warning: "border-border bg-surface text-text",
};

/**
 * Persistent Web POS offline banner. It reads the local offline bridge (registered by
 * `m2-web-local-storage-crypto`) and stays honest when no cached snapshots exist: it never
 * advertises offline reads or local orders that this device cannot actually perform. When online
 * with a ready bridge it renders nothing, keeping the operational area clear.
 */
export function OfflinePosNotice({ scope }: { readonly scope: BranchScope }): ReactNode {
  const [browserOnline, setBrowserOnline] = useState(true);
  const [snapshot, setSnapshot] = useState<OfflinePosSnapshot | null>(null);

  useEffect(() => {
    const refresh = (): void => {
      setBrowserOnline(typeof navigator === "undefined" ? true : navigator.onLine);
      const port = getOfflinePosPort();
      setSnapshot(port === undefined ? null : port.getSnapshot(scope));
    };
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener(WEB_SYNC_STATE_CHANGED_EVENT, refresh);
    window.addEventListener(OFFLINE_POS_STATE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(WEB_SYNC_STATE_CHANGED_EVENT, refresh);
      window.removeEventListener(OFFLINE_POS_STATE_CHANGED_EVENT, refresh);
    };
  }, [scope]);

  const notice = describeOfflinePosNotice({ browserOnline, snapshot });
  if (notice === null) return null;

  return (
    <section
      role="status"
      aria-live="polite"
      className={`rounded-xl border p-4 text-sm ${TONE_CLASSES[notice.tone]}`}
    >
      <p className="font-semibold">{notice.title}</p>
      <p className="mt-1 break-words">{notice.message}</p>
      {notice.snapshots.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
          {notice.snapshots.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {notice.allowed.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
          {notice.allowed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-[13px] font-medium underline-offset-2 hover:underline">
          Operaciones que siguen bloqueadas sin conexión
        </summary>
        <ul className="mt-2 space-y-1 text-[13px]">
          {notice.blocked.map((operation) => (
            <li key={operation.id}>
              <span className="font-medium">{operation.label}:</span> {operation.message}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
