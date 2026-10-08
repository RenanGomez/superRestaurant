"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

const VIEWPORT_MARGIN = 8;

/**
 * Small «?» button that explains a form field. The text shows on hover, on keyboard focus and on tap
 * (tap again, blur, Escape or a tap anywhere else closes it) and is exposed to assistive tech through
 * aria-describedby. `label` names the field so the button reads «Ayuda sobre <campo>». The tooltip
 * shifts sideways to stay inside the viewport (390 px phones).
 */
export function FieldHint({ label, text }: { readonly label?: string | undefined; readonly text: string }): ReactNode {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [shift, setShift] = useState(0);
  const open = pinned || hovered || focused;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setPinned(false); setHovered(false); setFocused(false); }
  };

  useLayoutEffect(() => {
    const element = tooltip.current;
    if (!open || element === null) return;
    const rect = element.getBoundingClientRect();
    const naturalLeft = rect.left - shift;
    const naturalRight = rect.right - shift;
    const overflow = naturalRight - (window.innerWidth - VIEWPORT_MARGIN);
    let next = overflow > 0 ? -overflow : 0;
    if (naturalLeft + next < VIEWPORT_MARGIN) next = VIEWPORT_MARGIN - naturalLeft;
    if (next !== shift) setShift(next);
  }, [open, shift]);

  useEffect(() => {
    if (!pinned) return;
    // iOS does not focus or blur a tapped button, so a tap elsewhere must close a pinned hint itself.
    const close = (event: PointerEvent): void => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) setPinned(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pinned]);

  return (
    <span ref={root} className="relative inline-flex align-middle" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        type="button"
        aria-label={label === undefined || label.trim() === "" ? "Ayuda" : `Ayuda sobre ${label.trim()}`}
        aria-describedby={id}
        aria-expanded={open}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setPinned((current) => !current); }}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setPinned(false); }}
        onKeyDown={onKeyDown}
        className="relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-bold leading-none text-text-muted before:absolute before:-inset-3 before:content-[''] hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >?</button>
      <span
        ref={tooltip}
        id={id}
        role="tooltip"
        hidden={!open}
        style={{ left: shift }}
        className="absolute top-full z-40 mt-1.5 w-60 max-w-[calc(100vw-16px)] rounded-lg border border-border bg-surface p-2.5 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-text shadow-lg"
      >{text}</span>
    </span>
  );
}

/**
 * Label for a control that lives elsewhere in the markup (`htmlFor` = its id), with the hint beside it,
 * not inside it. Use `Field` when the label and the control are siblings.
 */
export function FieldLabel({ className, hint, htmlFor, label }: {
  readonly className?: string | undefined;
  readonly hint: string;
  readonly htmlFor: string;
  readonly label: string;
}): ReactNode {
  return <span className={`inline-flex flex-wrap items-center gap-1.5${className === undefined ? "" : ` ${className}`}`}><label htmlFor={htmlFor}>{label}</label><FieldHint label={label} text={hint} /></span>;
}

/**
 * A labelled control with its hint beside the label, not inside it: the control's accessible name is
 * just the label text. `children` receives the id to put on the control.
 */
export function Field({ children, className, hint, id: fixedId, label }: {
  readonly children: (id: string) => ReactNode;
  readonly className: string;
  readonly hint?: string | undefined;
  /** Existing control id to keep (tests, aria references); generated when omitted. */
  readonly id?: string | undefined;
  readonly label: string;
}): ReactNode {
  const generatedId = useId();
  const id = fixedId ?? generatedId;
  return <div className={className}>
    <span className="inline-flex flex-wrap items-center gap-1.5"><label htmlFor={id}>{label}</label>{hint === undefined ? null : <FieldHint label={label} text={hint} />}</span>
    {children(id)}
  </div>;
}

/** Checkbox row with its hint outside the label (see `Field`). `children` receives the id of the checkbox. */
export function CheckField({ children, className, hint, label }: {
  readonly children: (id: string) => ReactNode;
  readonly className: string;
  readonly hint: string;
  readonly label: string;
}): ReactNode {
  const id = useId();
  return <span className={className}>
    {children(id)}
    <label htmlFor={id}>{label}</label>
    <FieldHint label={label} text={hint} />
  </span>;
}
