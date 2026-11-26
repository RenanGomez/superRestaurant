VEREDICTO: CAMBIOS

P1 packages/domain/src/inventory/stock-ledger.ts:148-163 `sale_reversal` no está en `MANUAL_KINDS` y solo exige `compensatesMovementId`: un reverso con `actorId:"  "` y `reason:null` pasa `validateMovement`, contra ADR-013 §2.5/§7.5 («exige `reason` y `actor_id`»); prueba ausente: stock-ledger.test.ts:163 solo cubre la compensación nula.
P1 packages/domain/src/inventory/stock-ledger.ts:14-30 `InventoryMovement` no declara `restaurantId`/`branchId` (AGENTS §10, ADR-013 §2.3-2.4) y no existe prueba de aislamiento; el ledger solo agrupa por `warehouseId:itemId`, así que el dominio no puede demostrar ni verificar scope Restaurant/Branch.
P1 packages/domain/src/inventory/stock-ledger.ts:178-193 `applyMovement`/`sumBalances` no deduplican por `id`/`idempotencyKey` ni validan la entrada: reaplicar el mismo movimiento duplica el saldo y `reconcileBalances` devuelve `ok` porque ambos lados suman el duplicado; no hay prueba de replay en stock-ledger.test.ts.
P2 packages/domain/src/inventory/stock-ledger.ts:21 `occurredAt` nunca se valida: `""` o un texto no ISO pasan como timestamp de auditoría (AGENTS §8/§11).
P2 packages/domain/src/inventory/stock-ledger.ts:185 `current + quantityDelta` no tiene guarda de entero seguro: una acumulación > 2^53 pierde precisión en silencio (contraste con unidades.ts:92-97 que sí valida).
P2 packages/domain/src/inventory/units.ts:107-112 `remainder` devuelve siempre `1` en vez del residuo: 11/3 da `quantity:4, remainder:1`, pero 4*3+1=13≠11 (residuo real 2); ADR-013 §2.10 exige guardar el resto para auditoría.
P2 packages/domain/src/inventory/stock-ledger.ts:195-212 `reconcileBalances` acepta `stored`/movimientos no enteros y confirma `ok` con saldos float o `NaN`-adyacentes.
P3 packages/domain/src/inventory/stock-ledger.ts:214-235 `validateTransferPair` no verifica que cada `compensatesMovementId` apunte al `id` del otro extremo del par.
P3 packages/domain/src/inventory/stock-ledger.ts:146 se valida la unidad pero no su coherencia con el insumo: movimientos `g` y `ml` del mismo `(warehouse,item)` se suman sin error.

```powershell
git show harness/m3-dom-ledger:packages/domain/src/inventory/stock-ledger.ts | Select-Object -Skip 121 -First 9
122: const MANUAL_KINDS: ReadonlySet<MovementKind> = new Set<MovementKind>([
123:   "waste"
124:   "adjustment"
125:   "count_adjustment"
126:   "transfer_out"
127:   "transfer_in"
128: ]);
# y :178-186
185:   return { ...balances, [key]: current + movement.quantityDelta };
```
NO VERIFICADO: no ejecuté `node .test-dist/...`; el modo plan es read-only y prohíbe copiar los `.ts` a `.harness/state/tmp` o escribir `dist`. Todo hallazgo sale del código leído con `git show` sobre `harness/m3-dom-ledger`.