# Migraciones remotas aplicadas — dev — 2026-11-25/26 (nivel A, datos)

- **Proyecto destino:** `zwbyiefqeujstyzysydn` (Supabase de desarrollo; no existe entorno de staging provisionado, ver `docs/runbooks/deploy.md` §9). Autorización explícita de Emmanuel para aplicar migraciones.
- **Base:** dos lotes sobre `origin/main`: `03dd2204` (13 migraciones) y `7b5ff570` (8 migraciones de la ola M3). El checkout principal estaba en uso por otra sesión, así que todo se ejecutó desde el worktree aislado `C:\Users\Emmanuel G\AppData\Local\Temp\opencode\sr-mig-main`.
- **Herramientas:** Node 24.19.0, pnpm 11.19.0, Supabase CLI 2.118.0, PostgreSQL 17.6 portable.
- **Sin secretos en el informe:** la cadena de conexión, la CA y `SYNC_CURSOR_SECRET` se usaron por nombre; no se imprimieron valores.

## 1. Estado real antes de tocar nada (preflight READ_ONLY)

- `lastRemote` inicial: `20261106000100` (no la lista corta del plan).
- 5 migraciones ADR históricas existen solo en el remoto (`20260825000100`…`20260829000100`), esperado.
- Pendientes reales: **21** en dos tandas, según avanzaba `main`:
  - lote 1: `20261120000100`, `20261120000200`, `20261121000100`, `20261122000100`, `20261123000100`…`20261123000600`, `20261126000100`…`20261126000300`;
  - lote 2 (fusionado después en M3): `20261126000400`…`20261126001100`.
- `20260908000100` aparece como pendiente por historial, pero se excluye: sus objetos ya existen en el remoto (ver desviaciones).
- Catálogo inicial: 50 tablas aseguradas, 5 políticas, 100 funciones `SECURITY DEFINER`.

## 2. Puertas ejecutadas antes de cada apply

### Lote 1 (13 migraciones)

1. **Probe local completo:** `verify:inventory-schema:rollback` → `status ok`, 80 migraciones desde cero, `cleanup stopped=true`.
2. **Sonda rollback-only por candidata:** pasaron las autocontenidas; fallaron por dependencia hacia adelante `20261122000100` (parchea la función de `20261120000100`), `20261123000400`/`000600` (necesitan `20261123000300`), `20261123000500` (necesita `20261121000100`) y `20261126000200`/`000300` (necesitan `20261126000100`).
3. **Sonda encadenada rollback-only** de las 13 contra el remoto real en una sola transacción → `{"migrationsAppliedInTxn":13,"rollback":"ok","status":"ok"}`.
4. **Respaldo lógico:** `dev-pre-20261125.dump`, 1244 entradas TOC verificadas.
5. **Dry-run exacto:** solo las 13 candidatas.
6. **Apply único:** `2026-11-25T15:48:39Z` → `15:49:16Z` (37 s).

### Lote 2 (8 migraciones)

1. **Probe local completo (main nuevo):** `verify:inventory-schema:rollback` → `status ok`, **88** migraciones desde cero, `cleanup stopped=true`.
2. **Sonda encadenada rollback-only** de las 8 contra el remoto (ya en `000300`) → `{"migrationsAppliedInTxn":8,"rollback":"ok","status":"ok"}`.
3. **Respaldo lógico:** `dev-pre-20261125-batch2.dump`, 1479 entradas TOC verificadas.
4. **Dry-run exacto:** solo las 8 candidatas.
5. **Apply único:** `2026-11-26T00:17:24Z` → `00:17:47Z` (23 s).

## 3. Migraciones aplicadas

- Lote 1: pizza v2 y probe, zonas/urbanización, fix de confirmación pizza v2, sync (`20261123000100`…`000600`) e inventario base (`20261126000100`…`000300`).
- Lote 2: compras (`000400`), consumo por venta (`000500`), funciones API (`000600`), cancelación de línea (`000700`), movimientos (`000800`), recetas API (`000900`), compras API (`001000`), costeo (`001100`).

## 4. Postcheck final (READ_ONLY)

- `lastRemote`: `20261126001100`; `missingVersions: []`; `duplicateVersions: []`; `upToDate: true`.
- Catálogo: **69** tablas aseguradas (antes 50), **15** políticas (antes 5), **159** funciones `SECURITY DEFINER` (antes 100).
- `EXECUTE` de `app_private` comprobado para `app_api` (y denegado a `authenticated`) en: `inventory_consume_order`, `inventory_reverse_order_item`, `cancel_order_with_inventory`, `confirm_capture_draft_v3_with_inventory`, `inventory_average_cost`, `list_inventory_items`, `inventory_receive_purchase_order`, `inventory_transfer`, `sync_device_state`, `replace_capture_selection_plan`.
- Segundo dry-run tras el lote 2: `{"upToDate":true,"migrations":[]}`.
- Auditoría RLS: ninguna tabla de `app` sin RLS. Tablas nuevas de sync/urbanización sin privilegios directos (solo funciones `SECURITY DEFINER`); inventario, compras y consumos con 1 política de lectura por membresía/sucursal y `SELECT` para `authenticated`, sin DML directo de `app_api`.

## 5. Desviaciones y notas

- **No hay staging provisionado:** dev fue el destino único (brecha de `docs/runbooks/deploy.md` §9).
- **`20260908000100`:** el historial remoto no tiene su fila, pero sus objetos (`app.system_admins`, etc.) ya existen; la sonda falló con `42P07 relation "system_admins" already exists`. Se excluyó del apply y **no** se tocó `supabase_migrations.schema_migrations` a mano. Requiere una migración idempotente nueva si se quiere reconciliar.
- **`20261120000200`:** sin envoltura `BEGIN/COMMIT`; se sondeó una copia envuelta y se aplicó el archivo real.
- **`main` avanzó entre lotes:** la ola M3 fusionó 8 migraciones nuevas después del primer apply; el segundo lote usó el protocolo completo otra vez y se revalidó el probe local con 88 migraciones.
- **Checkout principal en uso:** otra sesión cambió de rama durante el trabajo; el apply y los documentos se hicieron desde el worktree aislado. El informe va en la rama `docs/dev-migrations-20261125`.
- El respaldo y el staging temporal viven fuera del repositorio; los staging temporales se eliminaron tras cada segundo dry-run.

## 6. Verificación posterior y siguiente acción

- **API local contra el esquema nuevo:** reconstruida y arrancada en un puerto aislado con rol `app_api`; `GET /health` → `200 {"status":"ok"}`, `GET /api/v1/health` → `200 {"status":"ok"}`, `GET /ready` → `200 {"status":"ready"}`, `GET /api/v1/access/memberships` → `401`. Proceso detenido al terminar.
- Mergear `docs/dev-migrations-20261125`.
- Configurar `SYNC_CURSOR_SECRET` (≥32) en el runtime del API antes de probar pull/push de sync; su valor no se registra.
- Verificar en navegador real `/app/inventario` y `/app/sync` cuando el corte llegue a un entorno desplegado.
