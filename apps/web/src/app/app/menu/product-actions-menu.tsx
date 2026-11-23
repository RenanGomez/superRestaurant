"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface ProductAction {
  readonly danger?: boolean;
  readonly label: string;
  readonly onSelect: () => void;
}

/**
 * Three-dot menu for one product. The trigger opens a `menu` with `menuitem` buttons; arrow keys/Home/End move
 * between them (roving tabindex), Escape closes and returns focus to the trigger. Choosing an action closes the
 * menu without restoring focus so the caller can move it to wherever the product went.
 */
export function ProductActionsMenu({ actions, label }: { readonly actions: readonly ProductAction[]; readonly label: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);

  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  };

  useEffect(() => {
    if (open) items.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (container.current !== null && event.target instanceof Node && !container.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const move = (step: number): void => {
    setActiveIndex((current) => (current + step + actions.length) % actions.length);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); move(-1); return; }
    if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); return; }
    if (event.key === "End") { event.preventDefault(); setActiveIndex(actions.length - 1); }
  };

  return (
    <div ref={container} className="relative inline-flex" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => { setActiveIndex(0); setOpen((current) => !current); }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setActiveIndex(event.key === "ArrowUp" ? actions.length - 1 : 0);
          setOpen(true);
        }}
        className="inline-flex size-11 min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface text-[18px] leading-none hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div id={panelId} role="menu" aria-label={label}
          className="absolute right-0 top-full z-40 mt-1 flex min-w-44 flex-col rounded-xl border border-border bg-surface p-1 shadow-xl">
          {actions.map((action, index) => (
            <button
              key={action.label}
              ref={(element) => { items.current[index] = element; }}
              type="button"
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              onFocus={() => setActiveIndex(index)}
              onClick={() => { close(false); action.onSelect(); }}
              className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent ${action.danger === true ? "text-error hover:bg-error-bg" : "hover:bg-bg"}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
