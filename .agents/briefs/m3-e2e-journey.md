# Brief m3-e2e-journey (nivel B · journey E2E de inventario)

## Objetivo

Escribir el journey E2E de inventario con el stack local real (web + API + PostgreSQL de desarrollo):
crear insumo → almacén predeterminado → receta → venta confirmada descuenta → cancelar repone →
alerta cuando el saldo baja del mínimo → margen visible. Aserciones en la UI **y** en la API, consola
limpia.

Tiempo estimado: 60 min. Eres el **único escritor** de los archivos de la sección «Archivos».

## Archivos (exactos)

1. `apps/web/e2e/journeys/journey-13-inventario.spec.ts` (nuevo).
2. `apps/web/playwright.config.ts` (solo si hace falta un `grep` propio o `testMatch`; no toques los
   proyectos existentes más de lo imprescindible).
3. `apps/web/package.json` (solo si añades un script; es el único de esta tarea que puede tocarlo).

Prohibido tocar: `apps/api/**`, `supabase/**`, `packages/**`, `apps/web/src/**`, la spec
`e2e/visual/inventario.spec.ts` y los journeys 1-12.

## Patrón a seguir (léelo antes de escribir)

- `apps/web/e2e/journeys/journey-6-confirm-pay-send.spec.ts` y `journey-1-open-shift-cash-register.spec.ts`:
  estructura, `ensureBranchSelected`, `expectAuthenticated`, limpieza registrada **antes** de actuar.
- `apps/web/e2e/fixtures/journey-api.ts` y `journey-test.ts`: cliente de API disponible en el test,
  `runId` y helpers de siembra/limpieza. Reutilízalos; no crees un segundo cliente HTTP.
- `apps/web/e2e/helpers.ts`.

## Requisitos del journey

- `runId` en el nombre del insumo, almacén y producto (como el resto de journeys) y **limpieza
  registrada antes** de la primera escritura: borra solo los artefactos de este run, nunca datos
  ajenos.
- Sembrar por API (no por SQL): insumo con `minQuantity` alto, almacén por defecto de la sucursal
  (si ya existe uno, úsalo; no crees un segundo `is_default`), receta publicada para un producto
  existente del catálogo, y apertura de turno/caja si el flujo lo exige.
- Flujo de UI: abrir `/app/inventario?tab=compras`, **no** es necesario crear la OC por UI si la
  siembra por API ya deja saldo; usa la UI para el ajuste/recepción y para comprobar las pestañas.
- Confirmar una venta que consuma la receta y, desde `/app/inventario?tab=movimientos` y
  `?tab=alertas`, comprobar: saldo descontado, movimiento `sale_consumption`, alerta con el déficit y
  `?tab=alertas` mostrando el margen del producto.
- Cancelar la línea y comprobar el movimiento `sale_reversal` y el saldo restaurado.
- Aserciones de API (`GET /inventory/balances`, `/alerts`, `/margins`) además de las de UI: la UI no
  es la única fuente de verdad.
- Sin `alert/confirm/prompt`; esperas explícitas (nada de `waitForTimeout` como sincronización);
  consola sin errores.
- Si falta una precondición del entorno, **salta el test con mensaje explícito** (mismo patrón que los
  journeys existentes) en lugar de fallar de forma opaca.

## Reglas de la sesión

- No hagas `git commit`, `git push`, ni crees ramas o PRs.
- **No ejecutes Playwright ni PostgreSQL**: el orquestador levanta el stack y corre el journey. Puedes
  ejecutar `pnpm --filter @super-restaurant/web e2e:typecheck` y
  `pnpm exec playwright test --list --project desktop`.
- El API local exige `SYNC_CURSOR_SECRET` (32+); no lo definas ni lo imprimas.

## Puertas que debes ejecutar

```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web e2e:typecheck
Push-Location apps/web
& $PNPM exec playwright test e2e/journeys/journey-13-inventario.spec.ts --list --project desktop
Pop-Location
```

## Hecho cuando

La spec lista sin errores de tipos, cubre el flujo completo con aserciones de UI y API, registra su
limpieza antes de actuar, y `.agents/reports/m3-e2e-journey.md` explica qué se sembró, qué se limpió y
qué quedó sin ejecutar (la ejecución real la hace el orquestador con sesión válida).

Aplica Ponytail y AGENTS §15.
