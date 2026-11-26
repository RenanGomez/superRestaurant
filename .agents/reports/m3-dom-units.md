**Tarea:** m3-dom-units — unidades de inventario y conversiones enteras (nivel A). **Estado:** REVIEW.
**Archivos:** `packages/domain/src/inventory/units.ts`, `packages/domain/src/inventory/units.test.ts` (sin tocar `index.ts`/`errors.ts`).
**Decisiones:** errores exportados en `units.ts` con campos públicos (`InvalidInventoryUnitError`, `InvalidInventoryQuantityError`, `InvalidInventoryFactorError`, `InvalidInventoryFractionError` con código `INVALID_INVENTORY_FRACTION`); redondeo medio-arriba con comparación entera `resto >= denom - resto`; desbordes de `Number.MAX_SAFE_INTEGER` rechazados. ADR-013 no existe en este worktree; se leyó desde `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\docs\adr\ADR-013.md` (§2.1/2.2/2.10).
**Verificación:**
```powershell
node -v                                  # v24.19.0
& $PNPM --filter @super-restaurant/domain lint       # $ eslint ... ; lint exit=0
& $PNPM --filter @super-restaurant/domain typecheck  # $ tsc --noEmit ... ; typecheck exit=0
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json  # testbuild exit=0
node .test-dist/inventory/units.test.js  # ℹ tests 5 / ℹ pass 5 / ℹ fail 0 ; node exit=0
git diff --check                         # git diff --check: clean
```
**Pruebas:** 5/5 verdes (unidades, cantidades negativas/decimales/NaN/∞, factor 0/negativo/decimal, 12×800=9600, fracciones 150/2=75 r0 y 151/2=76 r1, rechazos de fracción y compatibilidad g/g vs g/ml).
**Riesgos:** ninguno abierto; `applyFraction(...,numerator,denominator)` usa `INVALID_INVENTORY_FRACTION` (el brief no fijaba código para fracciones).
**Siguiente:** `m3-dom-wire` cablea los exports en `index.ts`; no hubo commit/push.