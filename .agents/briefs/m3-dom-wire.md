# Brief m3-dom-wire (nivel B · cableado del dominio de inventario)

## Objetivo
Exportar los cuatro módulos de inventario desde el índice del dominio y registrar sus suites en el script de test.

Tiempo estimado: 10 min. `main` ya contiene `units.ts`, `stock-ledger.ts`, `costing.ts` y `recipe-explosion.ts`.

## Alcance
- Edita SOLO: `packages/domain/src/index.ts`, `packages/domain/package.json`.
- Prohibido: modificar la lógica de los módulos, `errors.ts`, otras apps, dependencias. Sin commit ni push.

## Qué hacer
1. `packages/domain/src/index.ts`: añade al final del bloque de exports:
   `export * from "./inventory/units.js";`
   `export * from "./inventory/stock-ledger.js";`
   `export * from "./inventory/costing.js";`
   `export * from "./inventory/recipe-explosion.js";`
   Si hay colisión de nombres entre módulos, resuélvela con exports explícitos renombrados mínimos y anótalo.
2. `packages/domain/package.json` → `scripts.test`: añade antes de la limpieza final, después de `units.test.js`:
   `node .test-dist/inventory/stock-ledger.test.js && node .test-dist/inventory/costing.test.js && node .test-dist/inventory/recipe-explosion.test.js`

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/domain build
& $PNPM --filter @super-restaurant/domain typecheck
& $PNPM --filter @super-restaurant/domain test
```

## Hecho cuando
`build`, `typecheck` y `test` del dominio en verde, con las cuatro suites de inventario visibles en la salida real; `git diff --check` limpio.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con el resumen final de la suite (bloque con comando + salida real).
Aplica Ponytail: solo el cableado.
