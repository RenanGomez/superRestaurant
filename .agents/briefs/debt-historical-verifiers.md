# Brief debt-historical-verifiers

NO escribas archivos fuera del repo ni en `$env:TEMP`: sandbox de rutas limitado al worktree. Si necesitas temporales, `.harness/state/tmp/` y bórralos. NO ejecutes PostgreSQL, pg_ctl, psql ni Playwright (el orquestador los corre). NO commitees, NO hagas push, NO instales dependencias.

## Objetivo
Que los dos verificadores históricos de esquema que hoy no corren pasen **desde cero sobre PostgreSQL local desechable**, arreglando el fixture/arnés, sin tocar migraciones aplicadas ni el esquema.

Tiempo estimado: 35 min

## Alcance (únicos archivos que puedes editar)
- `supabase/tests/menu_shared_modifier_groups_invariants.sql`
- `supabase/tests/customer_directory_invariants_pre_20260917000100.sql` (nuevo, fixture histórico pineado)
- `apps/api/src/operations/run-menu-locked-ingredients-schema-verification.ts`
- `apps/api/src/operations/run-capture-schema-verification.ts`
- `apps/api/package.json` (solo la línea del script `verify:capture-schema:rollback`)

Prohibido: `supabase/migrations/**`, `post-bootstrap-catalog.ts` (sus conteos 27/5/36/35/5/41 son la auditoría histórica), `supabase/tests/customer_directory_invariants.sql` (lo usan otros verificadores vigentes), cualquier archivo de producto.

## Contexto mínimo y evidencia real

### Fallo 1 — `verify:menu-shared-modifier-groups-schema:rollback`
Salida real:
`{"stage":"migrated","status":"failed","code":"LOCAL_MENU_SHARED_GROUPS_FAILED","invariant":"SCHEMA_VERIFICATION_SQL_REJECTED",...}`

Causa exacta: `supabase/tests/menu_shared_modifier_groups_invariants.sql` empieza con `begin;` y **termina con `rollback;`**, pero el arnés lo ejecuta con `extractMigrationBody()` (`apps/api/src/operations/schema-verification.ts`), que exige `BEGIN … COMMIT` y lanza `SCHEMA_VERIFICATION_SQL_REJECTED`. Los otros dos ficheros que ese mismo arnés carga (`catalog_halves_invariants.sql`, `catalog_halves_product_level_invariants.sql`) terminan en `commit;`.

Arreglo:
1. Normaliza el fixture a la convención `begin; … commit;` (solo la última sentencia). Ningún otro runner depende de que sea `rollback;`: `run-menu-locked-ingredients-schema-verification.ts` ya acepta **ambas** convenciones para sus suites de regresión (si es `begin;/rollback;` lo recorta; si no, usa `extractMigrationBody`). No lo toques salvo que encuentres un fallo real al ejecutarlo.
2. Verifica con grep que no queda otro consumidor que exija `rollback;` en ese fichero antes de cambiar nada.
3. No cambies `menu_locked_ingredients_invariants.sql` (su propio runner exige `begin;/rollback;` y lo recorta él mismo).

### Fallo 2 — `verify:capture-schema:rollback`
Salida real: `{"code":"SCHEMA_VERIFICATION_CONFIGURATION_REJECTED","stage":"configuration","status":"failed"}`
Porque el runner solo lee configuración remota (`readSchemaVerificationConfig`) y no tiene modo local desechable. Deuda documentada en `docs/agentic/debt.md` (P2 verificador histórico de Capture): ejecuta `supabase/tests/customer_directory_invariants.sql` **actual**, que exige que validar una dirección incompleta devuelva `rejected`; ese comportamiento lo introdujo `20260917000100_reject_incomplete_customer_address_validation.sql`, que NO forma parte del conjunto de migraciones del verificador (base post-bootstrap + `20260916000100…000800` + `20260920000100`), así que la función histórica devuelve `conflict`.

Arreglo:
1. Añade al runner `--local-disposable-only`, copiando el patrón ya probado de `apps/api/src/operations/run-menu-shared-modifier-groups-schema-verification.ts` (cluster propio con `initdb`/`pg_ctl` de `.cache/postgres-local/pgsql/bin`, puerto libre, `CREATE ROLE anon/authenticated/service_role`, esquema `auth`, tabla `auth.users`, `auth.uid()`, password temporal borrado, parada en `finally`, `runId` y JSON final con `stage`/`status`/`stopped`). Sin argumento, comportamiento actual intacto (remoto rollback-only).
2. En modo local, aplica **en orden** todas las migraciones de `supabase/migrations` anteriores a `20260916000100_create_capture_drafts.sql` (base post-bootstrap; nada más: los conteos 27/5/36 dependen de eso), siembra un actor en `auth.users` y luego llama a `verifyCaptureSchema` con configuración de cluster local (`host 127.0.0.1`, usuario `postgres`, base `postgres`, sin query, tal como exige `readLocalClusterSchemaVerificationConfig`). Postcheck y limpieza igual que el patrón.
3. Pinea el fixture histórico: crea `supabase/tests/customer_directory_invariants_pre_20260917000100.sql` con el contenido de `git show dad5e516^:supabase/tests/customer_directory_invariants.sql` (esa rama ya existe en el repo; no reescribas la historia) y una cabecera de 3–4 líneas que explique que está pineado porque el bloque de dirección incompleta requiere `20260917000100`. El runner de capture usa **ese** fichero; `customer_directory_invariants.sql` actual no se toca.
4. Script: `verify:capture-schema:rollback` pasa a `… run-capture-schema-verification.js --local-disposable-only`.

Señal de éxito que el orquestador correrá (no tú):
`LOCAL_POSTGRES_BIN=… pnpm --filter @super-restaurant/api run verify:menu-shared-modifier-groups-schema:rollback` → `status:"ok"`
`LOCAL_POSTGRES_BIN=… pnpm --filter @super-restaurant/api run verify:menu-locked-ingredients-schema:rollback` → `status:"ok"` (regresión del fixture normalizado)
`LOCAL_POSTGRES_BIN=… pnpm --filter @super-restaurant/api run verify:capture-schema:rollback` → `status:"ok"`

## Hecho cuando
- Los tres comandos anteriores están listos para correr sin variables remotas y sin tolerancias (sin `|| true`, sin relajar aserciones, sin `expectedSummary` nuevo).
- No cambiaste migraciones ni el fichero de invariantes vigente.
- `pnpm --filter @super-restaurant/api run typecheck`, `lint` y `test` en 0 (los puedes correr; no usan PostgreSQL).

## Pruebas (ahorro de cuota)
- Corre typecheck/lint/test una vez al terminar. Máximo 3 ciclos probar→corregir; si sigue rojo, para y reporta la salida real.
- Filtra salida (`Select-Object -Last 30`).

## Reporte
`.agents/reports/debt-historical-verifiers.md` con: archivos tocados, decisiones, comandos ejecutados y su salida real (bloque ```), y qué queda sin verificar (PostgreSQL/Playwright = orquestador). Aplica Ponytail: el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación ni errores.
