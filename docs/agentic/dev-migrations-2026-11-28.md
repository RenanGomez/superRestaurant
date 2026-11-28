# Migración de desarrollo aplicada — 2026-11-28 (Ola 7, ticket promedio)

Aplicación al Supabase de **desarrollo** `zwbyiefqeujstyzysydn` de la única migración nueva de la Ola 7,
con el protocolo de AGENTS §19.6. No se editó ninguna migración ya aplicada ni el historial.

## Migración

| Versión | Qué hace |
|---|---|
| `20261128000100_branch_day_summary_average_ticket.sql` | `create or replace` de **solo** `app_private.read_branch_day_summary(uuid, jsonb)`: mismo cuerpo que `20261007000700` y un único cambio en el `return`, `ordersPaid.averageMinor` (`null` si `count = 0`; si no, división entera `bigint` con redondeo medio hacia arriba). Propiedades, grants y los demás campos intactos (comparado línea a línea contra el cuerpo vigente: 199 líneas idénticas salvo ese bloque). |

## Puertas ejecutadas (en orden)

1. **Local desde cero:** `verify:branch-day-summary-schema:rollback` → `status=ok`, `priorMigrationsApplied=56`,
   95 funciones `SECURITY DEFINER` durante y 94 en el postcheck, `local_cleanup stopped=true`; el archivo
   de invariantes nuevo (`branch_day_summary_average_ticket_invariants.sql`) en verde y el histórico
   tolerante a `averageMinor`.
2. **Flujo HTTP local:** `test:http:local -- --local-disposable-only` → **9/9**, incluido el resumen del día
   con el promedio y el día vacío con `averageMinor: null`.
3. **Preflight READ_ONLY:** candidata exacta `20261128000100` (más la excluida `20260908000100`).
4. **Sonda rollback-only:** `run-migration-rollback-probe` → `{"statementCount":1,"status":"ok"}`.
5. **Respaldo:** `pg_dump --schema-only --no-owner --no-privileges` con `sslmode=verify-full` y la CA del
   proyecto → **1 421 920 bytes, 130 `CREATE TABLE`**, exit 0 (fuera del repo, borrado tras el postcheck).
6. **Dry-run:** anunció **exactamente** `20261128000100_branch_day_summary_average_ticket.sql`.
7. **Apply único:** `supabase db push --skip-vault` (CLI 2.118.0 vía `npx`) → aplicada, exit 0.
8. **Postcheck:** `lastRemote=20261128000100`, sin duplicados, owner `postgres`, `prosecdef=true`,
   `app_api` con `EXECUTE`, `authenticated` y `anon` sin él. Catálogo de la migración comparado contra el
   respaldo.
9. **Segundo dry-run:** `{"upToDate":true,"migrations":[]}`.

## Desviaciones y notas

- No hay staging provisionado: el destino fue dev, como en los cortes anteriores.
- `20260908000100` sigue sin fila en el historial remoto con sus objetos existentes; se excluyó del staging
  y **no** se tocó `supabase_migrations.schema_migrations`.
- El staging temporal del CLI se armó con `supabase/config.toml`, cinco archivos marcador con las versiones
  ADR históricas (ya aplicadas en remoto) y el resto de `supabase/migrations` sin `20260908000100`; se borró
  al terminar.
- El CLI exigió la CA del proyecto en `NODE_EXTRA_CA_CERTS` además de `sslmode=verify-full`; sin ella el
  `pg` del CLI falla con `self signed certificate in certificate chain`.
- El postcheck por script pide los nombres de función en un formato que rechazó la invocación; los mismos
  datos se leyeron con `psql` en contenedor (`has_function_privilege`, `pg_proc`, `schema_migrations`).
