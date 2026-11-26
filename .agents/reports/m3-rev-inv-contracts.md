VEREDICTO: CAMBIOS
P1 packages/shared-types/src/inventory.ts:355-356 (y 494-495, 96-101) costo y moneda son campos independientes: acepta `unitCostMinor:12` con `currency:null`, y `PurchaseOrderLineV1` lleva costo sin campo de moneda; viola AGENTS §9/ADR-013 §4 («toda moneda es entero de la moneda declarada») y ningún test cubre el par (inventory.runtime.test.ts:155 solo prueba `"mxn"`).
P1 packages/shared-types/src/inventory.ts:352-356 (y 491-495) ADR-013 §2.5 exige `compensatesMovementId` y `reason` en correcciones, pero el parser acepta `kind:"sale_reversal"|"adjustment"` con ambos `null`; la suite solo menciona `sale_reversal` en la constante (:117) y `compensatesMovementId:null` en el fixture (:66), sin prueba de que una corrección sin referencia sea rechazada.
P2 packages/shared-types/src/inventory.ts:348 y 488 `quantityDelta` acepta 0 y cualquier signo: un `receipt` negativo o `waste` positivo corrompe `SUM(quantity_delta)` sin rechazo ni prueba.
P2 packages/shared-types/src/inventory.ts:40-56 no existe campo que empareje `transfer_out`/`transfer_in` (:12-13): una salida puede quedar sin entrada y el invariante de transferencia (ADR-013 §2.4) no es verificable.
P2 packages/shared-types/src/inventory.ts:40-56 el movimiento omite `recipeVersionId` y `roundingRemainder` que ADR-013 §2.9-§2.10 exigen para reproducir el consumo histórico; sin prueba.
P2 packages/shared-types/src/inventory.ts:538 `parsePurchaseOrderV1` acepta `lines: []` y líneas duplicadas por `itemId` (línea 517), ruta para duplicar existencias al recibir; sin prueba.
P2 packages/shared-types/src/inventory.ts:58-63 `InventoryBalanceV1` no declara `restaurantId`/`branchId` (AGENTS §10): el saldo no tiene scope propio y la fuga depende de un join externo; sin prueba.
P2 packages/shared-types/src/inventory.ts:353 y 492 no hay prueba negativa de `idempotencyKey` ausente/vacía y el patrón admite cualquier ASCII imprimible (:404) cuando el resto del repo usa UUID; invariante de no-duplicación sin cobertura.
P3 packages/shared-types/src/inventory.ts:80-94 el request no lleva `deviceId` (AGENTS §8 y ADR-013 §7.5 lo exigen para movimientos manuales) y `actorId` viaja en el payload (línea 88), que el servidor debe sobrescribir con el actor autenticado.
P3 packages/shared-types/src/inventory.ts:305, 380, 450 los parsers devuelven `Object.freeze(...)` pero ningún test verifica `Object.isFrozen` sobre una instancia, solo sobre las constantes (:125-126); inmutabilidad no probada.

Evidencia (solo lectura, `git show` sobre la rama; no ejecuté la suite: NO VERIFICADO el runtime, el worktree de la rama no es accesible desde aquí):
```
$i=0; git show harness/m3-contracts:packages/shared-types/src/inventory.ts | %{ $i++; "{0,4}: {1}" -f $i,$_ } | Select-Object -Skip 345 -First 12
 346:     || !isInventoryId(itemId)
 347:     || !isMovementKind(kind)
 348:     || !isSafeInteger(quantityDelta)
 352:     || !isNullableText(reason, 500)
 354:     || !(compensatesMovementId === null || isInventoryId(compensatesMovementId))
 355:     || !(unitCostMinor === null || isNonNegativeInt(unitCostMinor))
 356:     || !(currency === null || isCurrency(currency))

git grep -n "sale_reversal|compensatesMovementId|isIdempotencyKey" ... inventory.runtime.test.ts
 66:    compensatesMovementId: null,
117:    "sale_reversal",
```
No se encontró ninguna condición que ligue `kind` con `reason`, `compensatesMovementId` o `currency`; el archivo solo tiene las constantes en :9,:12,:13 y los dos chequeos genéricos de moneda en :356,:495.