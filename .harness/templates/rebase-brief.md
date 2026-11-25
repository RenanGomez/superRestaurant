# Brief <ID> (rebase sobre main)

## Objetivo
Rebasar tu rama sobre `origin/main` resolviendo conflictos, y dejar las suites de dominio en verde.

Tiempo estimado: 15 min.

## Contexto
`origin/main` ya contiene unidades de inventario (`packages/domain/src/inventory/units.ts`) y el catálogo SQL. Tu rama salió de una versión anterior de esas piezas, por eso el PR no es fusionable.

## Pasos
1. `git fetch origin`
2. `git rebase origin/main`
3. Resuelve conflictos quedándote con la versión de `main` para los archivos que no son tuyos (`units.ts`, `units.test.ts`, migraciones) y con tu versión para los archivos que sí lo son (`<OWN_FILES>`).
4. Si el rebase ya estaba aplicado o no hay conflictos, continúa.
5. Ejecuta las puertas.

## Reglas
- No cambies la lógica de tu entrega; solo resuelve el choque con `main`.
- No toques archivos fuera de tu alcance ni `package.json`.
- Sin commit final de merge commits raros: el rebase debe dejar tus commits encima de `main`.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/domain typecheck
& $PNPM --filter @super-restaurant/domain lint
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json
Push-Location packages/domain
node .test-dist/inventory/<TEST>.test.js
Pop-Location
```

## Cierre
No hagas push (el orquestador lo hace). Tu respuesta final ES el informe con: `git log --oneline -3`, `git status`, y la salida real de las tres puertas.
