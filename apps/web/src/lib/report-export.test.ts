import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPORT_FILENAME_FALLBACK,
  exportButtonLabel,
  exportErrorMessage,
  parseExportFilename,
} from "./report-export";

test("exportErrorMessage maps API statuses to Spanish messages and undefined on 200", () => {
  assert.equal(exportErrorMessage(200), undefined);
  assert.equal(exportErrorMessage(400), "La fecha no es válida. Elige otra.");
  assert.equal(exportErrorMessage(401), "Tu sesión caducó. Vuelve a iniciar sesión.");
  assert.equal(exportErrorMessage(403), "Tu rol no puede exportar reportes de esta sucursal.");
  assert.equal(exportErrorMessage(413), "El día supera 50 000 filas; exporta por turno.");
  assert.equal(exportErrorMessage(504), "El resumen tardó demasiado. Reintenta en un momento.");
  assert.equal(exportErrorMessage(0), "No se pudo generar el archivo. Reintenta.");
});

test("exportErrorMessage never returns undefined for unknown statuses", () => {
  for (const status of [404, 418, 500, 502, 503]) {
    const message = exportErrorMessage(status);
    assert.notEqual(message, undefined);
    assert.equal(message, "No se pudo generar el archivo. Reintenta.");
  }
});

test("exportButtonLabel returns the idle and busy Spanish labels", () => {
  assert.equal(exportButtonLabel("idle"), "Descargar CSV");
  assert.equal(exportButtonLabel("busy"), "Generando…");
});

test("parseExportFilename extracts safe filename or falls back", () => {
  assert.equal(
    parseExportFilename('attachment; filename="day-summary_2026-10-06.csv"'),
    "day-summary_2026-10-06.csv",
  );
  assert.equal(
    parseExportFilename("attachment; filename=day-summary_2026-10-06.csv"),
    "day-summary_2026-10-06.csv",
  );
  assert.equal(parseExportFilename(null), EXPORT_FILENAME_FALLBACK);
  assert.equal(parseExportFilename("attachment"), EXPORT_FILENAME_FALLBACK);
});
