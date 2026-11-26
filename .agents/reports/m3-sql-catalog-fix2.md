**Informe m3-sql-catalog-fix2**

- **Estado:** completado (sin commit/push)
- **Archivo:** `apps/api/src/operations/run-inventory-schema-verification.ts:5`
- **Cambio:** añadida opción `authUsersExtraColumns: ", raw_user_meta_data jsonb"` al constructor de `LocalPostgres` (idéntica a `run-sync-schema-verification.ts:8`)
- **Diff:**
```diff
-const local = new LocalPostgres({ marker: "LOCAL_INVENTORY_SCHEMA_ONLY", databasePrefix: "superrestaurant_inventory" });
+const local = new LocalPostgres({ marker: "LOCAL_INVENTORY_SCHEMA_ONLY", databasePrefix: "superrestaurant_inventory", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
```
- **Verificación (Node v24.19.0):**
```
$ & $PNPM --filter @super-restaurant/api typecheck
$ tsc --noEmit --project tsconfig.json
(sin errores)
$ & $PNPM --filter @super-restaurant/api lint
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
(sin errores)
```
- **NO VERIFICADO:** ejecución del verificador `verify:inventory-schema:rollback` (PostgreSQL fuera del worktree; lo re-ejecuta el orquestador)
- **Riesgos:** ninguno; cambio de una línea aislado al alcance permitido.