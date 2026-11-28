"use client";

import { useState, type ReactNode } from "react";

import {
  exportButtonLabel,
  exportErrorMessage,
  parseExportFilename,
} from "../../../../lib/report-export";

interface ReportExportButtonProps {
  readonly date: string;
}

export function ReportExportButton({ date }: ReportExportButtonProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleExport(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/reports/day-summary/export?date=${encodeURIComponent(date)}`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        setError(exportErrorMessage(response.status) ?? exportErrorMessage(0));
        return;
      }
      const blob = await response.blob();
      const filename = parseExportFilename(response.headers.get("content-disposition"));
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        link.click();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      setError(exportErrorMessage(0));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => { void handleExport(); }}
        className="min-h-11 rounded-xl border border-border bg-surface px-4 text-[14px] font-semibold text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {exportButtonLabel(busy ? "busy" : "idle")}
      </button>
      {error !== undefined && (
        <p role="alert" className="rounded-xl border border-border bg-error-bg px-3 py-2 text-[13px] text-text">
          {error}
        </p>
      )}
    </div>
  );
}
