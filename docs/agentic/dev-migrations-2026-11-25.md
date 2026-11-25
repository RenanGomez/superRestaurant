# Migraciones remotas aplicadas — 2026-11-25 (nivel A, datos)

- **Proyecto destino:** `zwbyiefqeujstyzysydn` (Supabase de desarrollo; no existe entorno de staging provisionado, ver `docs/runbooks/deploy.md` §9). Autorización explícita de Emmanuel para aplicar migraciones.
- **Base:** `origin/main` en `03dd2204`. La copia de trabajo principal estaba en uso por otra sesión (cambiaba de rama durante la sesión), así que el trabajo se ejecutó desde un worktree aislado en `C:\Users\Emmanuel G\AppData\Local\Temp\opencode\sr-mig-main` con el mismo SHA.
- **Herramientas:** Node 24.19.0, pnpm 11.19.0, Supabase CLI 2.118.0, PostgreSQL 17.6 portable.
- **Sin secretos en el informe:** la cadena de conexión, la CA y `SYNC_CURSOR_SECRET` se usaron por nombre; no se imprimieron valores.

## 1. Estado real antes de tocar nada (preflight READ_ONLY)

- `lastRemote`: `20261106000100`.
- 5 migraciones ADR históricas existen solo en el remoto (`20260825000100`…`20260829000100`), esperado.
- `localMissingInRemote` (14):
  - `20260908000100` (excluida del apply: sus objetos ya existen en el remoto; ver desviaciones).
  - `20261120000100`, `20261120000200`, `20261121000100`, `20261122000100`.
  - `20261123000100`…`20261123000600`.
  - `20261126000100`, `20261126000200`, `20261126000300`.
- Catálogo remoto inicial: 50 tablas aseguradas, 5 políticas, 100 funciones `SECURITY DEFINER`.

La lista real era mayor que la del plan (el remoto estaba en `20261106000100`): además de las 5 de sync, faltaban pizza v2, sus fixes y las 3 de inventario.

## 2. Puertas ejecutadas antes del apply

1. **Probe local completo:** `verify:inventory-schema:rollback` con `LOCAL_POSTGRES_BIN` → `{"stage":"inventory_schema_rollback","status":"ok","migrationsApplied":80}` y `{"stage":"local_cleanup","status":"ok","stopped":true}`.
2. **Sonda rollback-only por candidata** (`probe:migration:rollback`), siempre `BEGIN`/`ROLLBACK`:
   - Pasaron aisladas: `20261120000100` (36 sentencias), `20261120000200` (5), `20261121000100` (97), `20261123000100` (3), `20261123000200` (4), `20261123000300` (44), `20261126000100` (27).
   - Fallaron por dependencia hacia adelante, no por defecto propio: `20261122000100` (parchea la función de `20261120000100`), `20261123000400` y `20261123000600` (necesitan `app.sync_devices`/`app.sync_changelog` de `20261123000300`), `20261123000500` (necesita `app.capture_delivery_manual_fees` de `20261121000100`), `20261126000200`/`20261126000300` (necesitan `app.inventory_items` de `20261126000100`).
3. **Sonda encadenada rollback-only** contra el remoto real: las 13 candidatas, en orden, dentro de una sola transacción → `{"migrationsAppliedInTxn":13,"rollback":"ok","status":"ok"}`.
4. **Respaldo lógico previo:** `pg_dump` custom a `%TEMP%\opencode\dev-pre-20261125.dump`, 1.6 MB, TOC con 1244 entradas verificado con `pg_restore --list`.
5. **Dry-run exacto:** anunció únicamente las 13 candidatas (sin seeds ni roles).

## 3. Apply

- Ventana: `2026-11-25T15:48:39Z` → `2026-11-25T15:49:16Z` (37 s), un solo `supabase db push --skip-vault`, sin reintentos.
- Aplicadas, en orden: `20261120000100`, `20261120000200`, `20261121000100`, `20261122000100`, `20261123000100`, `20261123000200`, `20261123000300`, `20261123000400`, `20261123000500`, `20261123000600`, `20261126000100`, `20261126000200`, `20261126000300`.

## 4. Postcheck (READ_ONLY)

- `lastRemote`: `20261126000300`; `missingVersions: []`; `duplicateVersions: []`; `upToDate: true`.
- Catálogo: 65 tablas aseguradas (antes 50), 11 políticas (antes 5), 128 funciones `SECURITY DEFINER` (antes 100).
- Privilegios `EXECUTE` en `app_private` verificados: `inventory_record_movement`, `publish_inventory_recipe`, `sync_device_state`, `sync_write_allowed`, `replace_capture_selection_plan`, `confirm_capture_draft_v3`, `save_menu_catalog` → `app_api: true`, `authenticated: false`, `owner: true`.
- Segundo `db push --dry-run`: `{"upToDate":true,"migrations":[]}`.
- Auditoría RLS de las 15 tablas nuevas: ninguna tabla de `app` quedó con RLS deshabilitado. Las tablas de sync/urbanización quedan con 0 políticas y sin privilegios directos (escritura solo por funciones `SECURITY DEFINER` de `app_api`); las de inventario tienen 1 política de lectura por membresía/sucursal y `SELECT` para `authenticated`, sin acceso directo de `app_api` (lectura/escritura por funciones).

## 5. Desviaciones y notas

- **No hay staging provisionado:** dev se usó como destino único; queda registrado como brecha de `docs/runbooks/deploy.md` §9.
- **`20260908000100`:** el historial remoto no tiene su fila, pero sus objetos (`app.system_admins`, etc.) ya existen. La sonda falló con `42P07 relation "system_admins" already exists`; se excluyó del apply (como indica `docs/runbooks/migration-apply.md`). No se tocó `supabase_migrations.schema_migrations` a mano. Queda pendiente decidir si se reconcilia con una migración idempotente nueva.
- **`20261120000200`:** el archivo no tiene envoltura `BEGIN/COMMIT`, por lo que la sonda genérica no lo acepta. Se sondeó una copia envuelta (solo para el ensayo); el apply usó el archivo real.
- **Copia principal en uso:** otra sesión cambió de rama en el checkout principal durante la sesión (de `harness/m3-inventory-batch` a `main` y a `harness/m3-api-items`). Por eso el apply se ejecutó desde un worktree aislado y este informe se entrega en la rama `docs/dev-migrations-20261125`, no directamente en `main`.
- El respaldo y el staging temporal viven fuera del repositorio; el staging temporal se eliminó tras el segundo dry-run.

## 6. Siguiente acción mínima

- Reconstruir/reiniciar `apps/api` local con el esquema aplicado y comprobar `/api/v1/health`.
- Configurar `SYNC_CURSOR_SECRET` (≥32) en el runtime del API antes de probar pull/push de sync; su valor no se registra.
- Verificar en navegador real las pantallas que dependen de sync e inventario cuando sus PRs lleguen a `main`.
