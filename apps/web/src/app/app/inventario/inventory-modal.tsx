"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { trapFocusIndex } from "../../../lib/focus-trap";

/**
 * In-app dialog shared by the inventory screens: Escape closes it, Tab stays inside, focus returns to
 * the opener on close and the page behind it cannot scroll while it is open.
 */
export function InventoryModal({ children, onClose, title }: {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly title: string;
}): ReactNode {
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => { opener?.focus(); };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || dialogRef.current === null) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0);
      const target = trapFocusIndex(
        focusable.length,
        focusable.indexOf(document.activeElement as HTMLElement),
        event.shiftKey,
      );
      if (target !== null) {
        event.preventDefault();
        focusable[target]?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[oklch(10%_0.02_250_/_0.45)] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div ref={dialogRef} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-4 sm:p-5">
        <h2 id={headingId} className="font-heading text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
