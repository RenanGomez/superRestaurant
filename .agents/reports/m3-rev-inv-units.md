I'll inspect the brief and supporting types before judging the invariants.
Now I'll verify the arithmetic semantics and overflow behavior by executing the exact function bodies in-memory (no files written).
Let me check ADR-013 (the cited authority) for the exact rounding/remainder/unit semantics.
The rounding uses `Math.floor(product / denominator)` (float division). Let me fuzz it against exact BigInt arithmetic to check for off-by-one at large magnitudes.
VEREDICTO: CAMBIOS

P1 packages/domain/src/inventory/units.ts:101-112 el `remainder` solo vale 0/1 y marca 1 aunque redondee hacia abajo (10/3→quantity 3, remainder 1), así que no puede poblar `rounding_remainder` de ADR-013 §2.10 ("el resto … para auditoría"): pierde la magnitud y, leído como ajuste ±1, es incorrecto en los redondeos hacia abajo; units.test.ts:50 fija esa semántica pérdida y ninguna prueba demuestra un resto fiel (el brief pide 0/1, así que es un conflicto brief↔ADR que debe resolver el orquestador).
P2 packages/domain/src/inventory/units.ts:75-78,96-99,108-110 las guardas de overflow safe-integer existen pero units.test.ts no las ejerce (máx. 151×2); verifiqué que lanzan, pero un cambio futuro podría perder precisión sin que falle un test.
P3 packages/domain/src/inventory/units.ts:101 usa división float (`Math.floor(product/denominator)`) pese al mandato "sin floats"; comparé 6.4M casos contra BigInt (incl. cerca de 2^53) sin discrepancia, riesgo teórico, no fallo demostrado.
P3 packages/domain/src/inventory/units.test.ts:36-59 falta denominador decimal (p. ej. 2.5) y cantidad decimal en `convertPurchaseQuantity`; el código los rechaza pero sin prueba.

```
$ node -e "const f=(q,n,d)=>{const p=q*n,w=Math.floor(p/d),r=p-w*d;return r===0?{quantity:w,remainder:0}:{quantity:r>=d-r?w+1:w,remainder:1}};console.log(JSON.stringify([f(10,1,3),f(16,1,3),f(17,1,3)]))"
[{"quantity":3,"remainder":1},{"quantity":5,"remainder":1},{"quantity":6,"remainder":1}]
$ node -e "console.log(Number.isSafeInteger(2**30*2**30), 2**30*2**30)"
false 1152921504606847000
```

Verificado por lectura del diff, `git show` de `errors.ts`/ADR-013 y ejecución in-memory de las funciones (sin escribir archivos); NO VERIFICADO: corrida real de la suite `node:test` del worktree (plan read-only, no copié archivos a tmp).