Now I have the full picture. Let me implement the shared API extensions first (additive, reusing the existing client).
The dev catalog is pizza-centric, and the UI sells `pizzaMode` products as a V2 two-halves line. I'll make the API plan builder support both the legacy V1 line and the V2 pizza line so the journey isn't skipped in the real catalog.
# SUB-013 — journey 13 de inventario [hecha]

Cambios: Añadido `journey-13-inventario.spec.ts` (venta confirmada descuenta, alerta con déficit, margen visible, ajuste por UI y cancelación con reversa) y métodos aditivos de inventario/captura en el cliente E2E compartido; sin segundo cliente HTTP.
Archivos: `apps/web/e2e/journeys/journey-13-inventario.spec.ts` (nuevo), `apps/web/e2e/fixtures/journey-api.ts` (solo métodos/tipos aditivos).
Siembra: insumo `Insumo <runId>` (g, mínimo 1000), proveedor reutilizado o `Proveedor <runId>`, una OC recibida por cada almacén activo (200 g a costo 1/g) y receta publicada de 120 g para un producto vendible del catálogo; la venta se confirma por los endpoints de captura (única ruta que consume). La limpieza se registra antes de la primera escritura y solo toca órdenes/insumo/proveedor del run; las OC recibidas y la versión de receta quedan (la API no borra ledger ni recetas).
Verificación: `pnpm --filter @super-restaurant/shared-types build` (faltaba `dist`) → exit 0; `pnpm --filter @super-restaurant/web e2e:typecheck` → pasa; `playwright test e2e/journeys/journey-13-inventario.spec.ts --list --project desktop` → 1 test listado; ESLint sobre ambos archivos → sin hallazgos.
Riesgos/pendientes: NO VERIFICADO: ejecución real del journey y PostgreSQL (los corre el orquestador con sesión válida). El almacén es el existente de la sucursal (la API no expone/crea `is_default`): se siembra stock/costo en todos los almacenes activos y, si la venta no consume, el test se salta con mensaje explícito. Insumo y proveedor llevan `runId`; el producto/almacén del catálogo no se renombran.
Notas: La fixture se amplió porque el cliente compartido no tenía lecturas/escrituras de inventario ni confirmación por captura; se mantuvo un único cliente autenticado. El plan de venta cubre línea V1 y Pizza V2 (dos mitades) para no saltarse el catálogo real.

```text
. .\tools\agentic\use-node24.ps1; $PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"; & $PNPM --filter @super-restaurant/web e2e:typecheck
$ tsc --noEmit --project tsconfig.e2e.json
(exit 0, sin salida)

Push-Location apps/web; & $PNPM exec playwright test e2e/journeys/journey-13-inventario.spec.ts --list --project desktop
Listing tests:
  [desktop] › journeys\journey-13-inventario.spec.ts:165:1 › journey 13: la venta descuenta inventario, la alerta muestra el déficit y cancelar repone el saldo
Total: 1 test in 1 file

& $PNPM exec eslint --max-warnings=0 --config ../../eslint.config.mjs e2e/journeys/journey-13-inventario.spec.ts e2e/fixtures/journey-api.ts
(exit 0, sin salida)
```