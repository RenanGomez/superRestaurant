Now I'll implement the changes. Starting with the interfaces and validators in `inventory.ts`:
Now update the tests:
P3 requires the shim to leave the build config's `include`. The clean way is excluding it in `tsconfig.json` (which `tsconfig.test.build.json` re-includes via `"exclude": []`), so I'll add that one line and flag it in the report:
**Informe m3-contracts-fix — estado REVIEW (sin commit)**

- P1 dinero par: `isMoneyPair` exige ambos `null` o ambos válidos en `InventoryMovementV1`/`RequestV1`; `PurchaseOrderLineV1` recibe `currency` (opción más simple, coste sigue en la línea) y ambos se validan juntos. Pruebas de mitad de par en movimiento, request y línea.
- P1 correcciones: `sale_reversal`/`waste`/`adjustment`/`count_adjustment` exigen `reason` no vacío; `sale_reversal` exige además `compensatesMovementId`. Pruebas de rechazo por tipo.
- P1 no-lanzar: getter que lanza y clave símbolo devuelven `undefined` en item, movimiento, request y balance.
- P2 signos: `quantityDelta` ≠ 0 con signo por tipo (positivos/negativos/cualquiera), probado por tipo.
- P2 transferencias: `transferPairId` añadido a movimiento y request; obligatorio en `transfer_out`/`transfer_in`.
- P2 receta/saldo: `recipeVersionId: string|null` y `roundingRemainder` entero ≥ 0 en movimiento (defaults `null`/`0` probados); `InventoryBalanceV1` exige `restaurantId`/`branchId`.
- P2 orden: rechaza `lines: []` y duplicados `(itemId, unitCode)`; permite mismo ítem en otra unidad.
- P3 shims: `node-test-shims.d.ts` excluido del build en `tsconfig.json` (`tsconfig.test.build.json` lo re-incluye con `"exclude": []`). **Desviación de alcance:** edité `tsconfig.json` (no estaba en la lista) porque mover el shim fuera de `src` rompía el test build; `tsconfig.test.json` y el shim quedan intactos.

```powershell
. .\tools\agentic\use-node24.ps1
& $PNPM --filter @super-restaurant/shared-types build      # EXIT build: 0
& $PNPM --filter @super-restaurant/shared-types lint       # EXIT lint: 0
& $PNPM --filter @super-restaurant/shared-types typecheck  # EXIT typecheck: 0
```

```powershell
Push-Location packages/shared-types
& $PNPM exec tsc --project tsconfig.test.build.json        # EXIT testbuild: 0
node .test-dist/inventory.runtime.test.js                  # tests 37 / pass 37 / fail 0
Pop-Location
& $PNPM --filter @super-restaurant/shared-types test       # EXIT fulltest: 0
```

Riesgo: los consumidores de `InventoryMovementV1`/`InventoryBalanceV1`/`PurchaseOrderLineV1` fuera de shared-types deberán aportar los campos nuevos; no se compilaron aquí (fuera de alcance). Siguiente acción: revisión cruzada y merge.