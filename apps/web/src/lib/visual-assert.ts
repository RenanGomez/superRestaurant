export const MIN_TARGET_PX = 44;

export interface VisualControl {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
  /**
   * Offsets (px) of an expanding pseudo-element relative to the control, negative when it grows the
   * real hit area. Only absolute, content-bearing pseudo-elements with pointer events count.
   */
  readonly insetLeft?: number | undefined;
  readonly insetTop?: number | undefined;
  readonly insetRight?: number | undefined;
  readonly insetBottom?: number | undefined;
}

/** The computed pseudo-element properties needed to know whether it expands the hit area. */
export interface PseudoStyle {
  readonly content: string;
  readonly position: string;
  readonly pointerEvents: string;
  readonly inset: string;
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
}

export interface ControlInsets {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface EffectiveSize {
  readonly width: number;
  readonly height: number;
}

/** Browsers resolve insets to px, but a rem/em inset is converted with the default 16px root. */
export const ASSUMED_ROOT_FONT_SIZE_PX = 16;

function pxValue(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em)$/iu.exec(value.trim());
  if (match === null) return null;
  const parsed = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(parsed)) return null;
  return (match[2] ?? "px").toLowerCase() === "px" ? parsed : parsed * ASSUMED_ROOT_FONT_SIZE_PX;
}

function expandInsetShorthand(value: string): readonly [string, string, string, string] | null {
  const parts = value.trim().split(/\s+/).filter((part) => part !== "");
  if (parts.length < 1 || parts.length > 4) return null;
  const top = parts[0] ?? "0";
  const right = parts[1] ?? top;
  const bottom = parts[2] ?? top;
  const left = parts[3] ?? right;
  return [top, right, bottom, left];
}

/**
 * Insets of a pseudo-element that genuinely extends the hit area, or `null` when it does not: a
 * static/relative pseudo-element, no generated content, or `pointer-events: none` never count.
 */
export function insetsFromPseudo(style: PseudoStyle): ControlInsets | null {
  if (style.content === "none" || style.content === "normal") return null;
  if (style.position !== "absolute") return null;
  if (style.pointerEvents === "none") return null;
  const shorthand = expandInsetShorthand(style.inset);
  const read = (longhand: string, index: 0 | 1 | 2 | 3): number => {
    const direct = pxValue(longhand);
    if (direct !== null) return direct;
    const fromShorthand = shorthand === null ? null : pxValue(shorthand[index]);
    return fromShorthand ?? 0;
  };
  return {
    top: read(style.top, 0),
    right: read(style.right, 1),
    bottom: read(style.bottom, 2),
    left: read(style.left, 3),
  };
}

/** Per side, the greatest expansion (most negative inset) of both pseudo-elements; 0 when none. */
export function mergeControlInsets(first: ControlInsets | null, second: ControlInsets | null): ControlInsets {
  const pick = (key: keyof ControlInsets): number => Math.min(first?.[key] ?? 0, second?.[key] ?? 0);
  return { left: pick("left"), top: pick("top"), right: pick("right"), bottom: pick("bottom") };
}

function expansion(inset: number | undefined): number {
  if (inset === undefined || !Number.isFinite(inset) || inset >= 0) return 0;
  return -inset;
}

/** Real hit area: the border box plus any expanding pseudo-element insets, never below zero. */
export function effectiveTargetSize(control: VisualControl): EffectiveSize {
  return {
    width: Math.max(0, control.width + expansion(control.insetLeft) + expansion(control.insetRight)),
    height: Math.max(0, control.height + expansion(control.insetTop) + expansion(control.insetBottom)),
  };
}

export interface VisualSnapshot {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly scrollWidth: number;
  readonly controls: readonly VisualControl[];
  readonly consoleErrors: readonly string[];
  readonly networkFailures: readonly string[];
  readonly dialogCalls: readonly string[];
  readonly focusedOutline: string | null;
}

export type VisualRule =
  | "target-size"
  | "accessible-name"
  | "horizontal-overflow"
  | "console-error"
  | "network-failure"
  | "native-dialog"
  | "focus-visible";

export interface VisualViolation {
  readonly rule: VisualRule;
  readonly message: string;
}

function describeControl(control: VisualControl): string {
  const name = control.name.trim() === "" ? "(sin nombre)" : control.name.trim();
  const size = effectiveTargetSize(control);
  return `«${name}» (${size.width}×${size.height}px)`;
}

function hasVisibleFocus(focusedOutline: string | null): boolean {
  if (focusedOutline === null) return false;
  return focusedOutline.split(";").some((segment) => {
    const separator = segment.indexOf(":");
    if (separator === -1) return false;
    const property = segment.slice(0, separator).trim().toLowerCase();
    if (property !== "outline" && property !== "box-shadow") return false;
    const value = segment.slice(separator + 1).trim().toLowerCase();
    if (value === "" || value.includes("none")) return false;
    if (property === "outline") {
      const widths = value.match(/\d+(?:\.\d+)?px/g) ?? [];
      return widths.some((width) => Number.parseFloat(width) > 0);
    }
    return true;
  });
}

export function findViolations(input: VisualSnapshot): VisualViolation[] {
  const violations: VisualViolation[] = [];

  for (const control of input.controls) {
    if (!control.visible) continue;
    const targetSize = effectiveTargetSize(control);
    if (targetSize.width < MIN_TARGET_PX || targetSize.height < MIN_TARGET_PX) {
      violations.push({
        rule: "target-size",
        message: `Área táctil menor a ${MIN_TARGET_PX}×${MIN_TARGET_PX}px: control ${describeControl(control)}`,
      });
    }
    if (control.name.trim() === "") {
      violations.push({
        rule: "accessible-name",
        message: `Control visible sin nombre accesible: ${control.width}×${control.height}px`,
      });
    }
  }

  if (input.scrollWidth > input.viewportWidth) {
    violations.push({
      rule: "horizontal-overflow",
      message: `Desbordamiento horizontal: scrollWidth ${input.scrollWidth}px > viewport ${input.viewportWidth}px`,
    });
  }

  for (const error of input.consoleErrors) {
    violations.push({ rule: "console-error", message: `Error de consola: ${error}` });
  }

  for (const failure of input.networkFailures) {
    violations.push({ rule: "network-failure", message: `Fallo de red: ${failure}` });
  }

  for (const call of input.dialogCalls) {
    violations.push({ rule: "native-dialog", message: `Diálogo nativo no permitido: ${call}` });
  }

  if (!hasVisibleFocus(input.focusedOutline)) {
    violations.push({
      rule: "focus-visible",
      message: `Foco sin indicador visible (outline/box-shadow: ${input.focusedOutline ?? "null"})`,
    });
  }

  return violations;
}

export function assertVisualSnapshot(input: VisualSnapshot): void {
  const violations = findViolations(input);
  if (violations.length === 0) return;
  const detail = violations.map((violation) => `- [${violation.rule}] ${violation.message}`).join("\n");
  throw new Error(`Violaciones visuales (${violations.length}):\n${detail}`);
}
