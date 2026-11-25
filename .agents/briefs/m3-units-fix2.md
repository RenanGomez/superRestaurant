# Brief m3-units-fix2 (nivel B · cierra 2 P1 de la confirmación de units)

## Objetivo
Restaurar la firma acordada `unitsAreCompatible` y cubrir el límite de entero seguro (`2**53`).

Tiempo estimado: 10 min. Tu worktree ya contiene `m3-dom-units` con la ronda 1 de correcciones.

## Correcciones
1. **P1 firma**: `units.ts` exporta `unitsAreEqual`, pero el contrato del brief es `unitsAreCompatible(left, right)`. Restaura el nombre `unitsAreCompatible` (renombra de vuelta en `units.ts` y en `units.test.ts`) y deja un JSDoc que diga literalmente que compara que la unidad sea la misma. No dejes alias duplicados.
2. **P1 límite seguro**: añade a `units.test.ts` un caso que distinga `Number.isSafeInteger` de `Number.isInteger`: `assert.throws(() => assertInventoryQuantity(2 ** 53), InvalidInventoryQuantityError)` y otro equivalente para `convertPurchaseQuantity(2 ** 53, 1)`. Debe fallar si alguien cambia la guarda a `isInteger`.

## Nota (no cambiar)
`remainder` es el resto real `(quantity*numerator) % denominator` por decisión del orquestador (ADR-013 §2.10); el brief original decía 0/1 y ya se corrigió. No lo cambies.

## Alcance
- Edita SOLO: `packages/domain/src/inventory/units.ts`, `packages/domain/src/inventory/units.test.ts`.
- Prohibido: `index.ts`, `package.json`, otras apps, dependencias. Sin commit ni push.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/domain typecheck
& $PNPM --filter @super-restaurant/domain lint
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json
Push-Location packages/domain
node .test-dist/inventory/units.test.js
Pop-Location
```

## Hecho cuando
Todas las pruebas en verde con salida real; `unitsAreCompatible` exportado; typecheck, lint y `git diff --check` limpios.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con bloques comando + salida real.
