VEREDICTO: CAMBIOS

P1 packages/domain/src/inventory/stock-ledger.ts:122 `sale_reversal` queda fuera de `MANUAL_KINDS`, así que el movimiento inverso acepta `reason=null` y `actorId="   "`, contra ADR-013 §2.5 («exige reason y actor_id»); prueba A lo demuestra.
P1 packages/domain/src/inventory/stock-ledger.ts:188 `sumBalances` no deduplica ni rechaza `idempotencyKey` repetida: el doble envío de un `sale_consumption` duplica el saldo (−20 con una sola venta), contra ADR-013 §2.7/§4; ninguna prueba lo cubre (prueba B).
P1 packages/domain/src/inventory/units.ts:112 `remainder` colapsa a 0/1; `applyFraction(11,1,3)` devuelve `remainder:1` cuando el resto real es 2, y `rounding_remainder` de ADR-013 §2.10 exige el resto para auditoría; el test units.test.ts:50-52 solo ejercita resto 1 (prueba C).
P1 packages/domain/src/inventory/stock-ledger.ts:161,214 `sale_reversal` y `validateTransferPair` no verifican que `compensatesMovementId` apunte de verdad al original/par: aceptan `ghost-a`/`ghost-b` sin error; no hay prueba de referencias incoherentes (prueba D).
P2 packages/domain/src/inventory/stock-ledger.ts:161 `sale_reversal` no exige que el referenciado sea un `sale_consumption` ni que la cantidad sea su inverso exacto.
P2 packages/domain/src/inventory/stock-ledger.test.ts:227 solo se prueban las razones `quantity` y `warehouse`; `kinds`, `item` y `unit` del `TransferPairMismatchError` no tienen prueba ejecutable.
P2 packages/domain/src/inventory/stock-ledger.test.ts:147 no se prueban `transfer_in` con delta negativo ni `transfer_out/in` con `reason`/`actorId` en blanco.
P3 packages/domain/src/inventory/units.test.ts:36 falta el desbordamiento de `convertPurchaseQuantity` (producto no seguro) y en `applyFraction` un resto > 1.
P3 packages/domain/src/inventory/stock-ledger.ts:185 `applyMovement` aplica sin validar: un delta decimal o unidad inválida entra al saldo si el llamador no valida antes.

Prueba adversarial (ejecutada inline sobre transcripción literal de las funciones de la rama; el modo solo-lectura impidió crear el archivo .ts, por lo que es NO VERIFICADO como módulo real):
```
@'...validateMovement/applyFraction/validateTransferPair/sumBalances literales...'@ | node
A sale_reversal sin reason/actor: ACEPTADO (no hay error)
B doble envio misma idempotencyKey: {"w1:i1":-20}
C applyFraction(11,1,3)= {"quantity":4,"remainder":1} resto real = 2
D par con referencias cruzadas falsas: ACEPTADO
```