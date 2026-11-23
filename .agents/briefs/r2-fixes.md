# Brief r2-fixes (nivel C)
## Objetivo
Corregir la revisión de Fase 4 (`.agents/reports/review-r2-wave.md`) en `apps/web/src/app/app/capture/{capture-ticket,capture-workspace,product-sheet}.tsx`:
1. P1 capture-ticket: `itemsTotalMinor` excluye la entrega; rotular «Subtotal» (no «Total») en la barra y la hoja, salvo que el API ya entregue total.
2. P1 capture-workspace (~1121): no ocultar borradores con cliente e importe no disponibles; ocultar solo los que se sepa vacíos.
3. P2 hoja del pedido móvil: cerrarla antes de abrir el editor de línea/nota (z-40 sobre z-20).
4. P2 product-sheet: elevar el diálogo sobre la nav inferior z-30 respetando safe-area.
5. P2 diálogo de pedido: nombre accesible (aria-label/labelledby), foco inicial, confinamiento, Escape y restaurar foco al cerrar.
6. P2 atajo de cliente: si el paso móvil no es Cliente, cambiar primero al paso y luego enfocar.
## Alcance
Solo esos tres archivos y helpers puros en `apps/web/src/lib` (con test). Prohibido API, SQL, commit/push.
## Hecho cuando
lint, typecheck y test web en verde con salida real.
## Cierre
Ponytail: cambio mínimo correcto, sin recortar validación/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe `.agents/reports/r2-fixes.md` (≤12 líneas) con bloque ``` de comando y salida real.
