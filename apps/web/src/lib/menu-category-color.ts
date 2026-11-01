import { MENU_CATEGORY_COLORS, type MenuCategoryColorV1 } from "@super-restaurant/shared-types";

export interface MenuCategoryColorClasses {
  /** Category card in the menu editor. */
  readonly card: string;
  /** Category tab in the capture menu, not selected. */
  readonly tab: string;
  /** Category tab in the capture menu, selected (the accent border keeps the selection visible). */
  readonly tabActive: string;
  /** Colour swatch button in the editor. */
  readonly swatch: string;
}

/** Spanish names for the palette; they label the swatch buttons for assistive technology. */
export const MENU_CATEGORY_COLOR_LABELS: Readonly<Record<MenuCategoryColorV1, string>> = Object.freeze({
  rose: "Rosa",
  peach: "Durazno",
  sand: "Arena",
  mint: "Menta",
  sky: "Cielo",
  lilac: "Lila",
  butter: "Mantequilla",
  sage: "Salvia",
});

// Literal class names so Tailwind can see them; the palette tokens themselves live in shared-types.
const CLASSES: Readonly<Record<MenuCategoryColorV1, MenuCategoryColorClasses>> = Object.freeze({
  rose: Object.freeze({
    card: "border-[oklch(82%_0.09_20)] bg-[oklch(94%_0.05_20)]",
    tab: "border-transparent bg-[oklch(94%_0.05_20)] hover:bg-[oklch(89%_0.075_20)]",
    tabActive: "border-accent bg-[oklch(89%_0.075_20)]",
    swatch: "border-[oklch(82%_0.09_20)] bg-[oklch(89%_0.075_20)]",
  }),
  peach: Object.freeze({
    card: "border-[oklch(82%_0.09_55)] bg-[oklch(94%_0.05_55)]",
    tab: "border-transparent bg-[oklch(94%_0.05_55)] hover:bg-[oklch(89%_0.075_55)]",
    tabActive: "border-accent bg-[oklch(89%_0.075_55)]",
    swatch: "border-[oklch(82%_0.09_55)] bg-[oklch(89%_0.075_55)]",
  }),
  sand: Object.freeze({
    card: "border-[oklch(82%_0.045_80)] bg-[oklch(94%_0.025_80)]",
    tab: "border-transparent bg-[oklch(94%_0.025_80)] hover:bg-[oklch(89%_0.038_80)]",
    tabActive: "border-accent bg-[oklch(89%_0.038_80)]",
    swatch: "border-[oklch(82%_0.045_80)] bg-[oklch(89%_0.038_80)]",
  }),
  mint: Object.freeze({
    card: "border-[oklch(82%_0.081_180)] bg-[oklch(94%_0.045_180)]",
    tab: "border-transparent bg-[oklch(94%_0.045_180)] hover:bg-[oklch(89%_0.068_180)]",
    tabActive: "border-accent bg-[oklch(89%_0.068_180)]",
    swatch: "border-[oklch(82%_0.081_180)] bg-[oklch(89%_0.068_180)]",
  }),
  sky: Object.freeze({
    card: "border-[oklch(82%_0.081_225)] bg-[oklch(94%_0.045_225)]",
    tab: "border-transparent bg-[oklch(94%_0.045_225)] hover:bg-[oklch(89%_0.068_225)]",
    tabActive: "border-accent bg-[oklch(89%_0.068_225)]",
    swatch: "border-[oklch(82%_0.081_225)] bg-[oklch(89%_0.068_225)]",
  }),
  lilac: Object.freeze({
    card: "border-[oklch(82%_0.081_285)] bg-[oklch(94%_0.045_285)]",
    tab: "border-transparent bg-[oklch(94%_0.045_285)] hover:bg-[oklch(89%_0.068_285)]",
    tabActive: "border-accent bg-[oklch(89%_0.068_285)]",
    swatch: "border-[oklch(82%_0.081_285)] bg-[oklch(89%_0.068_285)]",
  }),
  butter: Object.freeze({
    card: "border-[oklch(82%_0.108_100)] bg-[oklch(94%_0.06_100)]",
    tab: "border-transparent bg-[oklch(94%_0.06_100)] hover:bg-[oklch(89%_0.09_100)]",
    tabActive: "border-accent bg-[oklch(89%_0.09_100)]",
    swatch: "border-[oklch(82%_0.108_100)] bg-[oklch(89%_0.09_100)]",
  }),
  sage: Object.freeze({
    card: "border-[oklch(82%_0.081_140)] bg-[oklch(94%_0.045_140)]",
    tab: "border-transparent bg-[oklch(94%_0.045_140)] hover:bg-[oklch(89%_0.068_140)]",
    tabActive: "border-accent bg-[oklch(89%_0.068_140)]",
    swatch: "border-[oklch(82%_0.081_140)] bg-[oklch(89%_0.068_140)]",
  }),
});

/** Classes for a stored colour token; `undefined` for no colour, so callers use their automatic fallback. */
export function menuCategoryColorClasses(color: string | null | undefined): MenuCategoryColorClasses | undefined {
  return (MENU_CATEGORY_COLORS as readonly string[]).includes(color ?? "") ? CLASSES[color as MenuCategoryColorV1] : undefined;
}
