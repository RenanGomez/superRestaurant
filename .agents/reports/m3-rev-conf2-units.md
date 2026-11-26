VEREDICTO: CAMBIOS
P1 packages/domain/src/inventory/units.ts:122 falta `unitsAreCompatible`, la firma exigida por `.agents/briefs/m3-dom-units.md:25`; solo exporta `unitsAreEqual` (y el test lo importa así). Prueba `git grep`: brief:25 `unitsAreCompatible` vs units.ts:122 `unitsAreEqual`; `m3-dom-wire` no podrá reexportar la firma acordada.
P1 packages/domain/src/inventory/units.test.ts:27 afirma rechazar "unbounded values" pero ningún caso distingue `isSafeInteger` de `isInteger`: los 6 inputs actuales dan idéntico resultado con ambos predicados; un regresión a `isInteger` (que acepta 2**53) pasaría la suite (segunda salida abajo).
P2 packages/domain/src/inventory/units.ts:119 `remainder` devuelve `residual` (0..denominator-1), no 0/1 como pide el brief, y al redondear hacia arriba no representa "lo no aplicado"; units.test.ts:54 afirma `remainder:2` (primera salida abajo).
P3 packages/domain/src/inventory/units.test.ts:36 factor solo se prueba con 0/-2/1.5; `NaN`/`Infinity` no se prueban (el código los rechaza, pero ninguna prueba fija ese límite).

Prueba adversarial (réplica literal de `applyFraction` del diff; el modo solo-lectura me impide compilar/ejecutar el `.ts` real):
$ node -e 'const MAX=Number.MAX_SAFE_INTEGER; function assertQ(v){if(!Number.isSafeInteger(v)||v<0)throw v;return v} function applyFraction(quantity,numerator,denominator){const base=assertQ(quantity);if(!Number.isSafeInteger(numerator)||numerator<=0)throw numerator;if(!Number.isSafeInteger(denominator)||denominator<=0)throw denominator;const product=base*numerator;if(!Number.isSafeInteger(product))throw product;const whole=Math.floor(product/denominator);const residual=product-whole*denominator;if(residual===0)return{quantity:whole,remainder:0};const rounded=residual>=denominator-residual?whole+1:whole;if(!Number.isSafeInteger(rounded))throw rounded;return{quantity:rounded,remainder:residual}} for(const a of [[11,1,3],[5,1,7],[1,1,2],[10,1,3]]) console.log(a, JSON.stringify(applyFraction(a[0],a[1],a[2]))); try{assertQ(2**53)}catch(e){console.log(2**53,e)} try{applyFraction(MAX,2,1)}catch(e){console.log(MAX,2,1,e)}'
```
[ 11, 1, 3 ] {"quantity":4,"remainder":2}
[ 5, 1, 7 ] {"quantity":1,"remainder":5}
[ 1, 1, 2 ] {"quantity":1,"remainder":1}
[ 10, 1, 3 ] {"quantity":3,"remainder":1}
```
$ node -e 'const okSafe=v=>Number.isSafeInteger(v)&&v>=0; const okInt=v=>Number.isInteger(v)&&v>=0; for(const v of [0,42,-1,1.5,NaN,Infinity,9007199254740992,9007199254740994]) console.log(String(v), okSafe(v), okInt(v));'
```
0 true true
-1 false false
1.5 false false
NaN false false
Infinity false false
9007199254740992 false true
9007199254740994 false true
```
NO VERIFICADO: ejecución del `units.test.ts`, lint y typecheck reales: el modo plan es de solo lectura y no puedo escribir `.test-dist`; la evidencia anterior es réplica literal del código del diff.