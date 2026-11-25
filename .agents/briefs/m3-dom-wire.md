# Brief m3-dom-wire (nivel B · cableado del dominio de inventario)

## Objetivo
Exportar los módulos de inventario desde el índice del dominio y registrar sus pruebas en el script `test` del paquete.

Tiempo estimado: 10 min. Tu worktree ya contiene `units.ts`, `stock-ledger.ts`, `costing.ts` y `recipe-explosion.ts` fusionados.

## Alcance
- Edita SOLO: `packages/domain/src/index.ts`, `packages/domain/package.json`.
- Prohibido: modificar la lógica de los módulos de inventario, `errors.ts`, otras apps, migraciones, dependencias. Sin commit ni push.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Qué hacer
1. `packages/domain/src/index.ts`: exporta todo lo público de los cuatro módulos (sigue el orden alfabético/estilo del archivo):
   `export * from "./inventory/units.js";` y equivalentes para `stock-ledger`, `costing`, `recipe-explosion`.
2. `packages/domain/package.json` → `scripts.test`: añade, antes de la limpieza final, `node .test-dist/inventory/units.test.js && node .test-dist/inventory/stock-ledger.test.js && node .test-dist/inventory/costing.test.js && node .test-dist/inventory/recipe-explosion.test.js`.
3. Verifica que no haya colisiones de nombres exportados (dos módulos exportando el mismo símbolo). Si las hay, resuélvelas con exportaciones explícitas renombradas mínimas y anótalo.

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
`build`, `typecheck` y `test` del dominio en verde, con las cuatro suites de inventario visibles en la salida real. `git diff --check` limpio.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con el bloque de comando y su salida real (resumen final de la suite). Sin evidencia = NO VERIFICADO.
Aplica Ponytail: cambio más pequeño correcto.
