**Tarea:** m3-contracts — REVIEW (nivel A, rama `harness/m3-contracts`, sin commit).
**Archivos:** `src/inventory.ts` y `src/inventory.runtime.test.ts` (nuevos), `src/node-test-shims.d.ts` (nuevo), `src/index.ts` (export), `package.json` (suite en `test`), `tsconfig.test.json` (include del shim).
**Decisiones:** 8 kinds de ADR-013; parsers exact-key sin lanzar ni `any`; IDs UUID/ULID; dinero entero + moneda ISO; cantidades enteras; `unitCode` uniforme; request sin `id`/`occurredAt`. No añadí `@types/node` (dependencia nueva): un shim mínimo tipa `node:test`/`node:assert/strict`, porque activar `@types/node` rompía `capture-selection-plan.runtime.test.ts` (TS2416) en el repo.
**Riesgos:** el shim sólo declara lo usado; CI lo incluye vía `tsconfig.test.json`.

```text
> node -v
v24.19.0
> pnpm --filter @super-restaurant/shared-types build / lint / typecheck
$ tsc --project tsconfig.build.json
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
$ tsc --noEmit --project tsconfig.json
> tsc --project tsconfig.test.build.json; node .test-dist/inventory.runtime.test.js
ℹ tests 19  ℹ pass 19  ℹ fail 0
> pnpm --filter @super-restaurant/shared-types test
exit 0 (30 suites, incluye inventory.runtime.test.js)
> git diff --check
sin salida (limpio)
```

**Siguiente:** el orquestador revisa el diff y fusiona.