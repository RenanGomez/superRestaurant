# Brief o4-rev-compras-api

NO escribas archivos fuera de tu informe `.agents/reports/o4-rev-compras-api.md`. NO edites código, NO commitees, NO hagas push. NO ejecutes PostgreSQL ni Playwright. Trabaja en la raíz del repo y lee con `git show`.

## Objetivo
Revisión **foco API/pruebas** de la rama `harness/o4-compras-reads` (PR #131, nivel A): servicio, autorización y cobertura.

Tiempo estimado: 12 min

## Qué revisar
`git diff main...origin/harness/o4-compras-reads -- apps/` y los ficheros completos con `git show origin/harness/o4-compras-reads:<ruta>`:
`apps/api/src/inventory/purchasing.service.ts`, `purchasing.test.ts`, `apps/api/src/operations/http-flow-inventory-api.ts`.

## Qué comprobar
1. **Permisos**: lecturas con `catalog.read`, escrituras con `catalog.manage`; ningún camino de lectura quedó con `manage` por olvido (incluye `readPurchaseOrder`) y ninguno de escritura se relajó.
2. **Orden autorización/lectura en `readPurchaseOrder`**: lee la fila y luego autoriza. ¿Puede un actor ajeno distinguir existencia (200/403) de inexistencia (404)? El SQL filtra por membresía: argumenta si el resultado real es indistinguible y si el orden elegido es defendible.
3. **Errores**: `authorization` → 403 `ACTION_NOT_AUTHORIZED`; un `42501` inesperado del SQL no debe convertirse en 200 ni en 503 silencioso. Revisa `mapDatabaseError`/`execute`.
4. **Pruebas**: ¿las 4 pruebas nuevas de aislamiento pueden fallar de verdad (no tautológicas)? ¿Cubren viewer y auditor leyendo, viewer sin escrituras, ajeno 403? ¿Se perdió la prueba anterior de "rol sin permiso no llega a la base" al cambiar cashier→kitchen, y sigue siendo significativa?
5. **Flujo HTTP**: el bloque nuevo del viewer siembra datos con el manager y lee con el viewer; ¿limpia lo que crea (runId/marcas)? ¿Añade acoplamiento frágil o tiempo excesivo?
6. ¿La UI de compras necesita algún ajuste de permiso tras esto (hoy oculta la pestaña sin `catalog.manage`)? Si es así, dilo como hallazgo, no lo arregles.

## Reporte
`.agents/reports/o4-rev-compras-api.md`, máximo 20 líneas:
1. `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
2. Hallazgos `P1`/`P2`/`P3` con `archivo:línea` y una frase de por qué.
3. Qué no pudiste verificar (el orquestador corrió API typecheck/lint/test y `test:http:local` 9/9).
