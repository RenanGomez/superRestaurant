/**
 * Class variants for buttons, chips and selectable options.
 *
 * Tailwind does not resolve conflicts by attribute order: when two utilities of the same group
 * (`bg-surface` and `bg-accent`) are present, the one emitted later in the generated stylesheet wins.
 * Composing `${button} bg-accent text-white` on top of a base that already sets `bg-surface` therefore
 * yields white text on a white background. Every variant below is a complete, self-consistent set of
 * color utilities and the shared base carries NO background, border color or text color, so variants
 * never fight each other. Pass only layout utilities (width, alignment, text size) in `extra`.
 *
 * Contrast (WCAG, from the OKLCH tokens in globals.css): text on surface 16.4, white on accent 4.5,
 * white on accent-hover 6.3, error on surface 5.3. Disabled keeps opacity 70% so text stays above 3:1.
 */

const base = "min-h-11 border font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70";

/** Shape, padding and size defaults; each one is dropped when `extra` supplies its own utility of that group. */
const DEFAULTS: readonly (readonly [RegExp, string])[] = [
  [/(^|\s)rounded(-|\s|$)/, "rounded-lg"],
  [/(^|\s)px-/, "px-4"],
  [/(^|\s)py-/, "py-2"],
  [/(^|\s)text-(xs|sm|base|lg|xl|2xl|\[)/, "text-sm"],
];

export const uiVariants = {
  secondary: "border-border bg-surface text-text hover:bg-bg",
  primary: "border-accent bg-accent text-white hover:border-accent-hover hover:bg-accent-hover",
  selected: "border-accent bg-accent text-white hover:border-accent-hover hover:bg-accent-hover",
  danger: "border-error bg-surface text-error hover:bg-error-bg",
  ghost: "border-transparent bg-transparent text-text hover:bg-bg",
} as const;

export type UiVariant = keyof typeof uiVariants;

/** Button classes for a variant plus layout-only extras (no bg/text/border colors). */
export function uiButton(variant: UiVariant = "secondary", extra = ""): string {
  const defaults = DEFAULTS.filter(([overridden]) => !overridden.test(extra)).map(([, fallback]) => fallback).join(" ");
  const tail = extra === "" ? "" : ` ${extra}`;
  return `${base} ${defaults} ${uiVariants[variant]}${tail}`;
}

/** Pill-shaped variant for filters and tabs; `selected` toggles the chosen state. */
export function uiChip(selected: boolean, extra = ""): string {
  return uiButton(selected ? "selected" : "secondary", extra === "" ? "rounded-full" : `rounded-full ${extra}`);
}

/** Choose `selected` or `secondary` for toggle-like options (tables, payment methods, sizes). */
export function uiOption(selected: boolean, extra = ""): string {
  return uiButton(selected ? "selected" : "secondary", extra);
}
