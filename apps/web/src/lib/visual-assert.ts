export const MIN_TARGET_PX = 44;

export interface VisualControl {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
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
  return `«${name}» (${control.width}×${control.height}px)`;
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
    if (control.width < MIN_TARGET_PX || control.height < MIN_TARGET_PX) {
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
