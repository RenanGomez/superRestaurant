"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ariaKeyShortcut, dispatchShortcut, type ShortcutTable } from "../../lib/shortcut-dispatch";
import { hasUnsavedChanges } from "../../lib/unsaved-changes";
import { uiButton } from "../../lib/ui-classes";

const CAPTURE_HREF = "/app/capture?focus=customer";
const button = uiButton();
const shortcuts: ShortcutTable = { capture: ariaKeyShortcut("capture") };

/**
 * App-wide Alt+N: from any page it opens Capture with the customer search focused; already in
 * Capture it only moves the focus there. When the current page reports unsaved edits, its own
 * in-app dialog asks first — never `window.confirm`.
 */
export function GlobalShortcuts(): ReactNode {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string>();
  const stayRef = useRef<HTMLButtonElement>(null);
  const inCapture = pathname === "/app/capture" || pathname.startsWith("/app/capture/");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      const id = dispatchShortcut({ key: event.key, code: event.code, ctrlKey: event.ctrlKey,
        metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, targetTag: target?.tagName,
        targetIsEditable: target instanceof HTMLElement && target.isContentEditable }, shortcuts);
      if (id !== "capture") return;
      event.preventDefault();
      if (inCapture) {
        // Never pull the caret out of an open modal or product sheet.
        if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;
        document.querySelector<HTMLInputElement>("[data-capture-customer-search]")?.focus();
        return;
      }
      if (hasUnsavedChanges()) { setPendingHref(CAPTURE_HREF); return; }
      router.push(CAPTURE_HREF);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inCapture, router]);

  useEffect(() => {
    if (pendingHref === undefined) return;
    stayRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") { event.preventDefault(); setPendingHref(undefined); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingHref]);

  useEffect(() => { setPendingHref(undefined); }, [pathname]);

  if (pendingHref === undefined) return null;
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[oklch(10%_0.02_250_/_.45)] sm:items-center"
    role="dialog" aria-modal="true" aria-labelledby="unsaved-changes-title"
    onClick={(event) => { if (event.target === event.currentTarget) setPendingHref(undefined); }}>
    <div className="grid w-full max-w-md gap-3 rounded-t-2xl bg-surface p-4 sm:rounded-2xl">
      <h2 id="unsaved-changes-title" className="font-heading text-lg font-semibold">Hay cambios sin guardar</h2>
      <p className="text-sm text-text-muted">Si sales a Captura ahora, se perderán los cambios de esta página. Guarda o cancela primero.</p>
      <div className="flex justify-end gap-2">
        <button ref={stayRef} type="button" className={button} onClick={() => setPendingHref(undefined)}>Quedarme</button>
        <button type="button" className={button} onClick={() => {
          const href = pendingHref;
          setPendingHref(undefined);
          if (href !== undefined) router.push(href);
        }}>Salir</button>
      </div>
    </div>
  </div>;
}
