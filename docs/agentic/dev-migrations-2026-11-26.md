# Migraciones de desarrollo aplicadas — 2026-11-26 (cierre M3)

Aplicación al Supabase de **desarrollo** `zwbyiefqeujstyzysydn` de las dos migraciones nuevas de la
ola de cierre de M3, con el protocolo de AGENTS §19.6. No se editaron migraciones ya aplicadas ni el
historial.

## Migraciones

| Versión | Qué añade |
|---|---|
| `20261126001200_inventory_manual_movement_api.sql` | Envoltorio `app_private.inventory_record_manual_movement` (solo `adjustment`/`waste`/`count_adjustment`, fuente `inventory_manual`) y **revocación de `EXECUTE` sobre el ledger crudo** para `public/anon/authenticated/service_role/app_api`. |
| `20261126001300_inventory_default_warehouse.sql` | `create_inventory_warehouse` y `update_inventory_warehouse` aceptan `p_is_default`; mueven el único default de la sucursal, exigen `active` (`22000`) y limpian el flag al desactivar. |

## Puertas ejecutadas (en este orden)

1. **Local desde cero:** `verify:inventory-schema:rollback` → `migrationsApplied=90`, `status=ok`,
   `local_cleanup stopped=true` (ejecutado antes y después de los dos P2 de `m3-warehouse-fix`).
2. **Contratos HTTP:** `test:http:local -- --local-disposable-only` → 9/9 flujos en verde, incluido
   `http_flow_inventory` (consumo con almacén predeterminado) y `http_flow_inventory_api`.
3. **Preflight READ_ONLY:** `lastRemote=20261126001100`; candidatas exactas
   `20261126001200` y `20261126001300` (más la excluida histórica `20260908000100`).
4. **Sonda rollback-only por candidata:** `20261126001200` → 7 sentencias `ok`;
   `20261126001300` → 27 sentencias `ok`. Ninguna escritura persistente.
5. **Respaldo:** `pg_dump --schema-only --no-owner --no-privileges` → 1 386 760 bytes,
   130 `CREATE TABLE`, exit 0 (fuera del repo, en el temporal del operador).
6. **Dry-run:** anunció **exactamente** las dos candidatas.
7. **Apply único:** `supabase db push --skip-vault` → las dos migraciones aplicadas, exit 0.
8. **Postcheck:** `lastRemote=20261126001300`, sin faltantes ni duplicados, `upToDate=true`;
   `EXECUTE` de `app_api` = true en `inventory_record_manual_movement`,
   `create_inventory_warehouse` y `update_inventory_warehouse`; **false** en
   `inventory_record_movement`; `authenticated` false en las cuatro; owner true.
   Catálogo: 69 tablas aseguradas, 15 políticas, **160** funciones `SECURITY DEFINER` (antes 159).
9. **Segundo dry-run:** `Remote database is up to date`, sin candidatas.

## Desviaciones y notas

- No hay staging provisionado: el destino fue dev, como en el corte del 2026-11-25.
- `20260908000100` sigue sin fila en el historial remoto con sus objetos ya existentes; se excluyó y
  **no** se tocó `supabase_migrations.schema_migrations`.
- El staging temporal del CLI se armó con `config.toml`, las cinco migraciones ADR históricas
  hash-idénticas y el resto de `supabase/migrations` sin `20260908000100`; se borra al cerrar.
- La API local se reconstruyó y reinició con el esquema nuevo; `/api/v1/health` 200.
