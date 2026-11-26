VEREDICTO: CAMBIOS

P1 packages/domain/src/inventory/units.ts:76 guard de overflow `!Number.isSafeInteger(converted)` sin ninguna prueba: al eliminar la guarda (mutante) toda `units.test.ts` sigue verde y devuelve `18014398509481982` (no seguro); `Select-String "MAX_SAFE|overflow|9007|1e|e\+"` sobre `units.test.ts` no arroja coincidencias.
P2 packages/domain/src/inventory/units.ts:97 (:108) overflow de `product` y de `rounded` en `applyFraction` tampoco tienen prueba; ejecuté `applyFraction(MAX_SAFE,2,1)` → lanza `INVALID_INVENTORY_QUANTITY overflow-product`, pero ningún caso del test lo cubre.
P2 packages/domain/package.json:test `units.test.js` (compila a `.test-dist/inventory/units.test.js`) no figura en el script; `Select-String "units|inventory"` sobre package.json no devuelve nada, así que `pnpm test` jamás lo ejecuta (el cableado queda para `m3-dom-wire`).
P3 packages/domain/src/inventory/units.test.ts no cubre cota superior safe-integer (`MAX_SAFE_INTEGER+2`) en `assertInventoryQuantity` ni `parseInventoryUnit` con valor no-string.

Prueba adversarial (ejecutada inline, modo plan read-only: sin crear archivos; copié el cuerpo literal de `convertPurchaseQuantity`):
```powershell
node -e "class Q extends Error{}function aq(v){if(!Number.isSafeInteger(v)||v<0)throw new Q()};function conv(q,f){const b=aq(q);if(!Number.isSafeInteger(f)||f<=0)throw new Q();const c=b*f;if(!Number.isSafeInteger(c))throw new Q('over '+c);return c}function mutant(q,f){return aq(q)*f}const MAX=Number.MAX_SAFE_INTEGER;try{conv(MAX,2)}catch(e){console.log('guarded ->',e.message)}console.log('mutant ->',mutant(MAX,2),'safe?',Number.isSafeInteger(mutant(MAX,2)))"
```
```
guarded -> over 18014398509481982
mutant -> 18014398509481982 safe? false
MAX*2 exact = 18014398509481982n
```
Conclusión del foco tests: los guards de overflow son la única afirmación de código sin prueba ejecutable; el resto de invariantes (unidad, cantidad, factor, half-up 151/2→76, 10/3→3 resto 1, compatibilidad) sí tienen caso que falla al romperlos. Leí solo el diff más `errors.ts`, `tsconfig.test.build.json`, `package.json` y el brief.