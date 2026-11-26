# Migración de desarrollo aplicada — 2026-11-26 (Ola 4, lecturas de compras)

Aplicación al Supabase de **desarrollo** `zwbyiefqeujstyzysydn` de la única migración nueva de la Ola 4,
con el protocolo de AGENTS §19.6. No se editó ninguna migración ya aplicada ni el historial.

## Migración

| Versión | Qué hace |
|---|---|
| `20261126001400_inventory_purchasing_reads.sql` | `create or replace` de **solo** `list_inventory_suppliers`, `list_inventory_purchase_orders` y `read_inventory_purchase_order`: el gate de roles pasa de `owner/admin/manager` a los ocho roles con `catalog.read`. Cuerpos idénticos salvo esa lista (comparado por script). Owner `postgres`, `SECURITY DEFINER`, `revoke` a `public/anon/authenticated/service_role/app_api` y `grant` solo a `app_api`. Las escrituras no cambian. |

## Puertas ejecutadas (en orden)

1. **Local desde cero:** `verify:inventory-schema:rollback` → `migrationsApplied=91`, `status=ok`,
   12 suites de invariantes en verde (incluida la política nueva de lectura y las negativas de
   `kitchen`/`courier`). Un `local_cleanup stopped:false` posterior fue un resto de procesos que el
   propio drain mató; la migración ya había reportado `ok`.
2. **Contratos HTTP:** `test:http:local -- --local-disposable-only` → **9/9**, con el bloque nuevo del
   `viewer` leyendo proveedores, órdenes y detalle (`local_cleanup stopped=true`).
3. **Preflight READ_ONLY:** candidatas exactas `20261126001400` (más la excluida `20260908000100`).
4. **Sonda rollback-only:** `probe:migration:rollback` → `statementCount=12`, `status=ok`, `ROLLBACK`.
5. **Respaldo:** `pg_dump --schema-only --no-owner --no-privileges` con `sslmode=verify-full` y la CA del
   proyecto → 1 391 234 bytes, 130 `CREATE TABLE`, exit 0 (fuera del repo, borrado tras el postcheck).
6. **Dry-run:** anunció **exactamente** `20261126001400_inventory_purchasing_reads.sql`.
7. **Apply único:** `supabase db push` (CLI 2.118.0 vía `npx`) → aplicada, exit 0.
8. **Postcheck:** `lastRemote=20261126001400`, 95 versiones sin duplicados; `app_api` con `EXECUTE` en
   las tres lecturas y en las dos funciones de escritura/lookup de proveedor, `authenticated`/`anon`
   sin `EXECUTE`, owner `postgres`, `prosecdef=true`; catálogo 69 tablas aseguradas, 15 políticas,
   160 funciones `SECURITY DEFINER`.
9. **Segundo dry-run:** `{"upToDate":true,"migrations":[]}`.

## Desviaciones y notas

- No hay staging provisionado: el destino fue dev, como en los cortes anteriores.
- `20260908000100` sigue sin fila en el historial remoto con sus objetos existentes; se excluyó del
  staging y **no** se tocó `supabase_migrations.schema_migrations`.
- El staging temporal reproducía las cinco migraciones ADR históricas (solo remotas) leyendo sus
  `statements` de `supabase_migrations` para que `db push` no abortara por versiones ausentes en local;
  el directorio se borró al terminar.
- El CLI no está en `PATH`; se usó `npx --yes supabase@2.118.0` (misma versión que los cortes previos).
- Los `comment on function` de `20261126001000` siguen diciendo «manage-only» para estas tres lecturas:
  no se pueden corregir editando una migración aplicada. Queda como P3 en `debt.md` (pide migración de
  comentarios cuando se toque el módulo).
