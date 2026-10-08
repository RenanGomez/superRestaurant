"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Small «?» button that explains a form field. The text shows on hover, on keyboard focus and on tap
 * (tap again, blur or Escape closes it) and is exposed to assistive tech through aria-describedby.
 */
export function FieldHint({ text }: { readonly text: string }): ReactNode {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = pinned || hovered || focused;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setPinned(false); setHovered(false); setFocused(false); }
  };
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        type="button"
        aria-label="Ayuda"
        aria-describedby={id}
        aria-expanded={open}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setPinned((current) => !current); }}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setPinned(false); }}
        onKeyDown={onKeyDown}
        className="relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-bold leading-none text-text-muted before:absolute before:-inset-3 before:content-[''] hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >?</button>
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className="absolute left-0 top-full z-40 mt-1.5 w-60 max-w-[70vw] rounded-lg border border-border bg-surface p-2.5 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-text shadow-lg"
      >{text}</span>
    </span>
  );
}

/** Label text followed by its hint; use as the text part of a label so the hint stays a single flex/grid item. */
export function LabelText({ children, hint }: { readonly children: ReactNode; readonly hint: string }): ReactNode {
  return <span className="inline-flex flex-wrap items-center gap-1.5">{children}<FieldHint text={hint} /></span>;
}
