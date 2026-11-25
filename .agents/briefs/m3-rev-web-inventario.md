# Revisión · m3-web-inventario (nivel C, solo lectura)

No leas `.agents/reports/*` ni rutas fuera del repo; no ejecutes nada. Responde en ≤ 15 líneas.

Lee:
- `apps/web/src/app/app/inventario/page.tsx`, `actions.ts`, `inventory-workspace.tsx`
- `apps/web/src/lib/inventory-ui.ts` y `inventory-ui.test.ts`
- `git diff -- apps/web/src/app/app/app-nav.tsx apps/web/package.json`

Comprueba:
1. Sin `alert/confirm/prompt`, sin cálculo de dinero/cantidades en cliente y sin UUIDs visibles al operador.
2. Estados de carga/vacío/error+reintento/éxito, foco contenido en el diálogo y devuelto al cerrar, Escape, targets ≥ 44 px en clases.
3. Las rutas y cuerpos que envía coinciden con el API (`GET/POST/PATCH /inventory/items|warehouses`, `restaurantId`/`branchId` del contexto, no libres).
4. `?tab=` estable y la prueba cubre el parseo no confiable.

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos P1/P2/P3 con `archivo:línea`.
