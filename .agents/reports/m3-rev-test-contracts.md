VEREDICTO: CAMBIOS
P1 packages/shared-types/src/inventory.ts:355-356 (y 494-495) `unitCostMinor` y `currency` se validan por separado: aceptan medio dinero (`{unitCostMinor:12,currency:null}` y `{unitCostMinor:null,currency:"MXN"}`), violando «importe entero + moneda ISO» del brief; ninguna prueba cubre el par.
P1 packages/shared-types/src/inventory.runtime.test.ts:113-210 no existe prueba del invariante «sin lanzar» que el autor afirma: si se quita el `try/catch` de `exactRecord`/`exactArray`, la suite sigue verde (0 casos con Proxy/getter/símbolo).
P2 packages/shared-types/src/inventory.runtime.test.ts:133,141 exact-key sólo se prueba en item (clave extra) y warehouse (clave faltante); movement/balance/recipe/request/purchaseOrder no tienen prueba de clave extra/faltante ni de array disperso.
P3 packages/shared-types/src/inventory.ts:348,488 aceptan `receipt` con `quantityDelta` negativo y `sale_reversal` sin `compensatesMovementId`; combinaciones que la ADR-013 no admite y ninguna prueba rechaza.
P3 packages/shared-types/src/node-test-shims.d.ts:1 queda también en `tsconfig.json` (include `src/**/*.ts`, exclude sólo `*.test.ts`), no sólo en `tsconfig.test.json` como afirma el informe; colisionará con `@types/node` si se añade.

Prueba adversarial propia (fuente real de la rama, transpilada en memoria y ejecutada con Node v22.20.0):
```
$ git show harness/m3-contracts:packages/shared-types/src/inventory.ts -> ts.transpileModule -> node -
-- hostiles en los 7 parsers: proxyThrows=undefined getterProp=undefined symbolKey=undefined (no lanza)
 Movement extraKey: rejected | missing(id): rejected | Recipe sparse lines: undefined
-- semantic probes: receipt negative delta: ACCEPTED | money w/o currency: ACCEPTED
   currency w/o money: ACCEPTED | sale_reversal w/o compensates: ACCEPTED
$ node -e "ts.sys.readDirectory('node_modules/typescript/lib',['.d.ts'],undefined,['**/*.ts'])"
count 110   # => el patrón **/*.ts sí incluye .d.ts (.d.ts entra al tsconfig de producción)
```
Los invariantes «exact-key en los 7 parsers» y «no lanza» se cumplen hoy, pero el P1 es que el repo no tiene la prueba que falle si se rompen.