/** Pure option builders for the menu editor's unit and station selects. */
export interface SelectOption { readonly label: string; readonly value: string }

export const MENU_DEFAULT_UNIT = "pieza";
export const MENU_DEFAULT_STATION = "general";
export const MENU_STATION_MAX_LENGTH = 64;
/** Sentinel value of the «Otra estación…» entry; never stored as a station. */
export const MENU_OTHER_STATION = "__other__";

/** Common CSS classes enforcing the 3-tier row discipline (fixed-height label, 44 px control, reserved auxiliary line). */
export const MENU_FIELD_LABEL_CLASS = "flex h-5 min-h-5 items-center gap-1.5 leading-tight";
export const MENU_FIELD_CONTROL_CLASS = "h-11 min-h-11 min-w-0 w-full rounded-lg border border-border bg-surface px-2 text-[13px] disabled:opacity-70";
export const MENU_FIELD_AUXILIARY_CLASS = "min-h-4 text-[11px] font-normal leading-4 text-text-muted truncate";

const UNITS: readonly SelectOption[] = [
  { label: "Pieza (pz)", value: "pieza" },
  { label: "Porción", value: "porción" },
  { label: "Orden", value: "orden" },
  { label: "Rebanada", value: "rebanada" },
  { label: "Paquete", value: "paquete" },
  { label: "Gramos (g)", value: "g" },
  { label: "Kilogramos (kg)", value: "kg" },
  { label: "Mililitros (ml)", value: "ml" },
  { label: "Litros (L)", value: "L" },
];

/** The fixed unit list; a stored value outside it is appended so it is shown and never lost. */
export function unitOptions(current: string): readonly SelectOption[] {
  return UNITS.some((option) => option.value === current) || current === ""
    ? UNITS
    : [...UNITS, { label: current, value: current }];
}

/** Distinct stations already used by products, plus «general» and the current value, sorted with «general» first. */
export function stationValues(used: readonly string[], current: string): readonly string[] {
  const all = new Set<string>([MENU_DEFAULT_STATION]);
  for (const value of [...used, current]) {
    const trimmed = value.trim();
    if (trimmed !== "") all.add(trimmed);
  }
  const rest = [...all].filter((value) => value !== MENU_DEFAULT_STATION).sort((left, right) => left.localeCompare(right, "es"));
  return [MENU_DEFAULT_STATION, ...rest];
}
