## Informe m3-units-fix

- **Estado:** REVIEW (nivel A).
- **Archivos:** `packages/domain/src/inventory/units.ts`, `packages/domain/src/inventory/units.test.ts` (sin tocar `index.ts` ni dependencias; sin commit/push).
- **Cambios:** P1 pruebas de desbordamiento para `convertPurchaseQuantity(MAX_SAFE_INTEGER,2)` y `applyFraction(MAX_SAFE_INTEGER,2,1)` (código `INVALID_INVENTORY_QUANTITY`); P2 `remainder` ahora es `product % denominator` con JSDoc; P3 `unitsAreCompatible` → `unitsAreEqual` (menor cambio) y título de prueba actualizado.
- **Riesgo:** ninguno abierto; consumidores externos quedan fuera de alcance (`index.ts` lo cablea `m3-dom-wire`).
- **Siguiente acción:** el orquestador revisa y fusiona.

Verificación real (Node v24.19.0):
```powershell
$PNPM --filter @super-restaurant/domain typecheck   # $ tsc --noEmit --project tsconfig.json  (sin errores)
$PNPM --filter @super-restaurant/domain lint        # $ eslint --max-warnings=0 ... (sin errores)
$PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json
node .test-dist/inventory/units.test.js
# ✔ convertPurchaseQuantity ... ✔ applyFraction ... ✔ unitsAreEqual compares identical inventory units
# ℹ tests 5  ℹ pass 5  ℹ fail 0
git diff --check                                     # sin salida (limpio)
```