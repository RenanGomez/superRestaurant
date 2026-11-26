# Revisión · m3-web-movimientos (nivel C)

No leas `.agents/reports/*` ni salgas del repo; no ejecutes nada. Responde en ≤ 15 líneas.

Lee:
- `apps/web/src/app/app/inventario/movements-panel.tsx`, `inventory-modal.tsx`
- `git diff -- apps/web/src/app/app/inventario/actions.ts apps/web/src/app/app/inventario/inventory-workspace.tsx apps/web/src/lib/inventory-ui.ts`
- `apps/web/src/lib/inventory-ui.test.ts` (casos nuevos)

Comprueba:
1. Cuerpos y rutas coinciden con el API (`POST /inventory/movements` con `toWarehouseId` solo en transferencias; `reason` obligatorio; `idempotencyKey` estable al reintentar).
2. Sin `alert/confirm/prompt`, sin dinero calculado en cliente, sin UUIDs visibles; estados carga/vacío/error+reintento/éxito.
3. Diálogo accesible (rol, Escape, foco contenido y devuelto, botón deshabilitado al guardar) y targets ≥ 44 px.
4. No rompe las pestañas existentes ni el `?tab=`.

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos P1/P2/P3 con `archivo:línea`.
