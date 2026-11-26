I'll start by reading the required operational files and the target files.
Now the gates.
**Informe · m3-units-fix2 (nivel B)**

- **Estado:** REVIEW (sin commit, worktree `harness/m3-units-fix2`).
- **Cambios:** `units.ts` — renombrado `unitsAreEqual` → `unitsAreCompatible` + JSDoc ("Compares that both sides are the same inventory unit"), sin alias. `units.test.ts` — imports/tests renombrados y nuevo test del límite seguro (`2 ** 53` para `assertInventoryQuantity` y `convertPurchaseQuantity`), que falla si la guarda pasa a `Number.isInteger`.
- **Archivos:** solo `packages/domain/src/inventory/units.ts`, `packages/domain/src/inventory/units.test.ts` (`git diff --stat`: 2 files changed, 17 insertions(+), 7 deletions(-)).
- **Riesgos:** ninguno; `remainder` intacto (ADR-013 §2.10). Sin cambios en `index.ts`/otros consumidores (grep: 0 referencias fuera de estos 2 archivos).
- **Siguiente acción:** orquestador revisa y fusiona.

Verificación (Node v24.19.0):
```powershell
& $PNPM --filter @super-restaurant/domain typecheck
# $ tsc --noEmit --project tsconfig.json   (sin errores)
& $PNPM --filter @super-restaurant/domain lint
# $ eslint --max-warnings=0 --config ../../eslint.config.mjs src   (sin errores)
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json   (sin salida = ok)
node .test-dist/inventory/units.test.js
# 1..6 / # tests 6 / # pass 6 / # fail 0
# ok 4 - assertInventoryQuantity rejects integers beyond the safe integer limit
# ok 6 - unitsAreCompatible compares identical inventory units
git diff --check   (sin salida = limpio)
```