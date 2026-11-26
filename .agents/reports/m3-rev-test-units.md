VEREDICTO: CAMBIOS

P1 packages/domain/src/inventory/units.ts:76 — la rama de desbordamiento de `convertPurchaseQuantity` no tiene prueba: mutar `if (!Number.isSafeInteger(converted))` a `if (false)` deja las 5 pruebas en PASS (`[C]` abajo), y el código real sí lanza `INVALID_INVENTORY_QUANTITY`.
P1 packages/domain/src/inventory/units.ts:96 — igual en `applyFraction`: la guarda del producto (`if (!Number.isSafeInteger(product))`) puede borrarse sin que falle ninguna prueba (`[D]`), aunque el real lanza con `(MAX_SAFE, 2, 1)`.
P2 packages/domain/src/inventory/units.ts:112 — `remainder` es 0/1 y no el resto real que exige ADR-013 §2.10 (`rounding_remainder` para auditoría): `applyFraction(10,1,3)` → `{quantity:3,remainder:1}` y la prueba lo fija así, perdiendo 1/3 de unidad.
P3 packages/domain/src/inventory/units.ts:108 — el chequeo de desbordamiento de `rounded` es inalcanzable (con denominador 1 se retorna antes; con ≥2, `rounded ≤ MAX/2+1`); rama muerta, no cubrible.
P3 packages/domain/src/inventory/units.test.ts — la suite no figura en `scripts.test` de `packages/domain/package.json`, así que `pnpm test`/CI no la ejecuta; está asignada a `m3-dom-wire` (fuera de este diff, pero el verde de CI hoy no la incluye).
P3 packages/domain/src/inventory/units.ts:113 — `unitsAreCompatible` se anuncia como "compara la dimensión" pero es `===` de string; el test solo fija igualdad, no una noción de dimensión.
Nota: la afirmación "aritmética entera" se sostiene; verificado con 205.339 casos diferenciales contra BigInt: `applyFraction differential vs BigInt half-up: checked=205339 mismatches=0`.

Prueba adversarial ejecutada (transpilé con `typescript` en memoria `errors.ts`+`units.ts`+`units.test.ts` del branch y sustituí `test`/assertiones; sin escribir archivos):
```
$ node --input-type=module -   # import data-URL de los archivos de harness/m3-dom-units
### node v22.20.0 | branch HEAD a7ced604
[A] Author tests vs ORIGINAL units.ts          -> los 5 tests PASS
[B] Mutation M1: half-up -> half-down          -> FAIL applyFraction :: +quantity:75 -quantity:76
[C] Mutation M2: convert overflow guard removed-> los 5 tests PASS   <-- invariante sin prueba
[D] Mutation M3: applyFraction product guard removed -> los 5 tests PASS   <-- invariante sin prueba
[E] convertPurchaseQuantity(9007199254740991, 2) -> threw InvalidInventoryQuantityError (INVALID_INVENTORY_QUANTITY)
[E] applyFraction(9007199254740991, 2, 1)        -> threw InvalidInventoryQuantityError (INVALID_INVENTORY_QUANTITY)
[E] applyFraction(10, 1, 3)                      -> {"quantity":3,"remainder":1}
```
Las guardas de desbordamiento funcionan, pero ninguna prueba falla si se rompen: dos P1 abiertas → CAMBIOS. No modifiqué ni ejecuté escrituras en el repo.