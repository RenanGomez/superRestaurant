# migration-preflight-scripts

## Tarea
migration-preflight-scripts · capa: L1 (`implementer-claude`) · riesgo: moderado · nivel B (`apps/api/src/operations`, sólo lectura contra PostgreSQL, sin cambios de esquema ni contratos de producto).

## Objetivo
Dejar en el repo, como scripts reproducibles, los dos pasos de sólo lectura que el orquestador usó a mano el 2026-09-27 para aplicar migraciones: **preflight** (antes del apply) y **postcheck** (después). Referencia funcional: `tmp/reference-preflight.mjs` en este worktree (ignorado por Git; no lo commitees). Complementan `run-migration-rollback-probe.ts` ya existente.

## Criterios de aceptación
- [ ] `apps/api/src/operations/run-migration-preflight.ts` (script `preflight:migrations`): abre `BEGIN READ ONLY`, lee `supabase_migrations.schema_migrations`, lista los archivos de `supabase/migrations`, e imprime JSON con `remoteVersions`, `lastRemote`, `localFiles`, `localMissingInRemote` (versiones locales sin historial), `remoteMissingLocally` (versiones remotas sin archivo local, p. ej. las 5 ADR históricas), y el resumen de catálogo `securedTables/policies/securityDefinerFunctions` calculado en vivo con la misma consulta que usa `schema-verification.ts` (reutiliza `SUMMARY_SQL`/helpers exportados si existen; si no, extrae uno compartido sin duplicar). Siempre `ROLLBACK`. Exit 1 si la conexión falla o el project ref no coincide.
- [ ] `apps/api/src/operations/run-migration-postcheck.ts` (script `postcheck:migrations -- <version> [<version>...]`): READ ONLY; comprueba que cada versión pedida figura exactamente una vez en el historial, que la última versión del historial es la mayor pedida, imprime el resumen de catálogo, y para cada función `app_private` nombrada opcionalmente con `--functions a,b` reporta `has_function_privilege('app_api',…,'EXECUTE')`, lo mismo para `authenticated` y el owner. Exit 1 si alguna versión falta o está duplicada.
- [ ] Ambos leen la configuración `SCHEMA_VERIFICATION_DATABASE_URL`, `SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF`, `SCHEMA_VERIFICATION_CA_CERT_PATH` (misma carga y validación que `run-migration-rollback-probe.ts`; reutiliza su helper de sesión/config), exigen `SCHEMA_VERIFICATION_CONFIRMATION=READ_ONLY` (nuevo valor permitido sólo para estos dos), nunca imprimen URL, host completo ni secretos, y no aceptan `--db-url` por argumento.
- [ ] Pruebas `node:test` con sesión falsa (patrón de `run-migration-rollback-probe.test.ts`): cálculo de faltantes en ambos sentidos, versión duplicada → exit 1, versión ausente → exit 1, ROLLBACK siempre (también ante error), sin fuga de la URL en la salida.
- [ ] `docs/runbooks/migration-apply.md` nuevo (≤80 líneas): procedimiento completo tal como se ejecutó el 2026-09-27: preflight → sonda rollback-only (`probe:migration:rollback`) → staging temporal hash-idéntico (config.toml + 5 SQL ADR históricos de `tmp/capture-tray-apply-staging` + `supabase/migrations` sin `20260908000100`) → `npx --yes supabase@2.118.0 db push --db-url "<URL con sslmode=verify-full y sslrootcert absoluto>" --skip-vault --dry-run` (debe anunciar sólo las candidatas) → apply único → `postcheck:migrations` → segundo dry-run `upToDate` → borrar staging → reiniciar API local. Incluye la advertencia de que `run-capture-schema-verification` y `run-delivery-zones-schema-verification` no sirven contra el remoto actual (conteos fijos y `SET ROLE`). Corrige la línea 21 de `docs/runbooks/customer-directory-verification.md` para que apunte a la sonda genérica en lugar del runner desactualizado.
- [ ] `pnpm --filter @super-restaurant/api test|typecheck|lint|build` verdes. No conectar a ningún remoto.

## Invariantes
- Sólo lectura; nada de `db push`, apply ni escritura en el repo desde los scripts.
- Sin secretos en salida ni en Git.

## Entorno
Worktree `C:\tmp\sr-wt\migration-preflight-scripts` (rama `claude/migration-preflight-scripts` desde `main` 770f88f). Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`. Commits: `feat(api): ...` y `docs: ...`. Informe con salida literal; parcial a los ~35 turnos. Sin push.
