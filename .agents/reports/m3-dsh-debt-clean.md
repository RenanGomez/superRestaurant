## Estado — done: los cuatro P3 aplicados; typecheck, lint y test del API en verde.
## Qué hice — borré `items.module.ts` huérfano; validé `x-device-id` como UUID en el controller (400 `INVENTORY_REQUEST_INVALID`) y lo fijé por HTTP; añadí `23505`→`conflict` a las pruebas de recetas; añadí aserción `pg_proc` (`prosecdef`, `proowner=postgres`, `proconfig` search_path vacío) para las 8 funciones `app_private` del archivo SQL.
## Archivos tocados — D `apps/api/src/inventory/items.module.ts`; M `movements.controller.ts`, `movements.test.ts`, `recipes.test.ts`, `supabase/tests/inventory_api_functions_invariants.sql`.
## Verificación
```powershell
. .\tools\agentic\use-node24.ps1; $PNPM="C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"; & $PNPM --filter @super-restaurant/api typecheck; & $PNPM --filter @super-restaurant/api lint; & $PNPM --filter @super-restaurant/api test
Node activo: v24.19.0; $ tsc --noEmit --project tsconfig.json; $ eslint --max-warnings=0 --config ../../eslint.config.mjs src
TYPECHECK_EXIT=0 / LINT_EXIT=0 / TEST_EXIT=0
node .test-dist/inventory/movements.test.js -> tests 17 pass 17 fail 0; recipes.test.js -> tests 13 pass 13 fail 0
git status --short: D items.module.ts; M movements.controller.ts; M movements.test.ts; M recipes.test.ts; M supabase/tests/inventory_api_functions_invariants.sql
```
## Riesgos / dudas — NO VERIFICADO: SQL sin ejecutar por prohibición del brief; lo valida el orquestador con el probe rollback-only. El servicio ya validaba `deviceId`; el controller añade la comprobación sin cambiar el header.
## Notas propuestas — ninguna.