export const EXPORT_FILENAME_FALLBACK = "day-summary.csv";

const FILENAME_PATTERN = /filename=(?:"([^"]+)"|([^;\s]+))/iu;

/** Mensaje en español para un status del API; undefined en 200. */
export function exportErrorMessage(status: number): string | undefined {
  if (status === 200) return undefined;
  if (status === 413) return "El día supera 50 000 filas; exporta por turno.";
  if (status === 504) return "El resumen tardó demasiado. Reintenta en un momento.";
  if (status === 401) return "Tu sesión caducó. Vuelve a iniciar sesión.";
  if (status === 403) return "Tu rol no puede exportar reportes de esta sucursal.";
  if (status === 400) return "La fecha no es válida. Elige otra.";
  return "No se pudo generar el archivo. Reintenta.";
}

/** Etiqueta del botón según el estado. */
export function exportButtonLabel(state: "idle" | "busy"): string {
  return state === "busy" ? "Generando…" : "Descargar CSV";
}

/** Extrae el nombre de archivo de Content-Disposition o usa el respaldo seguro. */
export function parseExportFilename(contentDisposition: string | null): string {
  if (contentDisposition === null) return EXPORT_FILENAME_FALLBACK;
  const match = FILENAME_PATTERN.exec(contentDisposition);
  const raw = (match?.[1] ?? match?.[2] ?? "").trim();
  const base = raw.split(/[\\/]/u).pop()?.trim() ?? "";
  return base.length > 0 ? base : EXPORT_FILENAME_FALLBACK;
}
