import { defineConfig } from "buttonmash";

/**
 * Monkey tester exhaustivo para superRestaurant (solo entornos locales).
 * Requiere sesión guardada con `pnpm e2e:auth` y, una vez, `pnpm exec playwright install chromium`.
 */
export default defineConfig({
  target: "http://localhost:8082/app",
  seed: "ci",
  browser: "chromium",
  auth: { storageState: "playwright/.auth/user.json" },
  budget: { maxActions: 500, maxDurationMs: 300_000, maxPages: 40 },
  explore: { forms: { enabled: false } },
  guardrails: {
    billing: { mode: "refuse" },
    blockedPathPatterns: ["/login", "/logout", "/reset-password", "/app/system-admin"],
    includePaths: ["^/app"],
    excludePaths: ["/login", "/logout", "/reset-password", "/app/system-admin"],
    destructive: {
      enabled: true,
      extraVerbs: [
        "eliminar", "borrar", "quitar", "cancelar", "cerrar sesión", "salir", "logout", "cobrar", "pagar", "confirmar",
        "publicar", "enviar a cocina", "guardar", "crear", "nueva", "nuevo", "abrir cuenta", "abrir turno", "cerrar caja",
        "cerrar turno", "sin venta", "transferir", "desactivar", "asignar", "marcar", "imprimir", "subir", "convertir", "reintentar",
      ],
    },
  },
  detectors: { ignoreHttpStatuses: [401, 403], ignorePatterns: [] },
  report: { outDir: "buttonmash-report", formats: ["json", "html"] },
  failOn: "high",
});
