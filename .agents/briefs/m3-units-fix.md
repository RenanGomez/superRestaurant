# Brief m3-units-fix (nivel A · corrige hallazgos de la revisión de m3-dom-units)

## Objetivo
Cerrar los P1/P2 de la revisión de `units.ts`: pruebas de las guardas de desbordamiento y `remainder` con el resto real.

Tiempo estimado: 15 min. Tu worktree ya contiene `m3-dom-units` (PR #80).

## Correcciones
### P1 — guardas sin prueba
`convertPurchaseQuantity` (`units.ts:76`) y `applyFraction` (`units.ts:96`) lanzan en desbordamiento, pero mutar la guarda a `if (false)` deja todas las pruebas en verde. Añade una prueba por guarda que falle si la guarda desaparece:
- `convertPurchaseQuantity(Number.MAX_SAFE_INTEGER, 2)` lanza `INVALID_INVENTORY_QUANTITY`.
- `applyFraction(Number.MAX_SAFE_INTEGER, 2, 1)` lanza el error correspondiente.

### P2 — `remainder` debe ser el resto real
Hoy `remainder` es 0/1 (resto del redondeo). Cámbialo al resto entero exacto de `(quantity * numerator) % denominator` (0 … denominator-1) y documenta en el JSDoc que `quantity` es el cociente redondeado medio hacia arriba y `remainder` el resto no aplicado. Actualiza las pruebas:
- `applyFraction(10, 1, 3)` → `{ quantity: 3, remainder: 1 }`.
- `applyFraction(11, 1, 3)` → `{ quantity: 4, remainder: 2 }`.
- `applyFraction(151, 1, 2)` → `{ quantity: 76, remainder: 1 }`.
- `applyFraction(150, 1, 2)` → `{ quantity: 75, remainder: 0 }`.

### P3 — honestidad de la API
`unitsAreCompatible` compara unidades iguales; renómbralo a `unitsAreEqual` (y actualiza la prueba y cualquier uso interno) o corrige el JSDoc para que no prometa una noción de dimensión que no existe. Elige la opción con menos cambios.

## Alcance
- Edita SOLO: `packages/domain/src/inventory/units.ts`, `packages/domain/src/inventory/units.test.ts`.
- Prohibido: `index.ts` (lo cablea `m3-dom-wire`), `package.json`, otras apps, dependencias. Sin commit ni push.

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
Todas las pruebas (antiguas + nuevas) en verde con salida real; typecheck, lint y `git diff --check` limpios.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación ni pruebas.
