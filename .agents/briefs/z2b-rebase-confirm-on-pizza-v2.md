# Brief z2b-rebase-confirm-on-pizza-v2 (nivel A, SQL)

## Objetivo
La migración `supabase/migrations/20261121000100_delivery_zones_settlements.sql` (z2) redefine `app_private.confirm_capture_draft_v3` partiendo del cuerpo ANTERIOR a pizza v2 y pisa la versión de `20261120000100_pizza_model_v2.sql` (línea ~1767). Resultado: confirmar un borrador con pizza falla con SQLSTATE 42703 (`product.base_group_id` / `extra_group_ids` / `removed_product.base_group_id` ya no existen; v2 usa `base_group_ids` y `extra_option_ids`) y se pierde la semántica v2 (mitades, exclusión por id de opción, `pizza_quantities_valid`).

## Alcance
- Editar SOLO `supabase/migrations/20261121000100_delivery_zones_settlements.sql` (nunca se aplicó en remoto; edición in place permitida) y `supabase/tests/*_invariants.sql`.
- Reconstruye `confirm_capture_draft_v3` en z2 partiendo del cuerpo de `20261120000100_pizza_model_v2.sql` y añade SOLO el delta de zonas/asentamientos que z2 ya introducía (settlementId, cuota manual, cálculo de deliveryCharge). Mantén la firma.
- Haz un diff función por función: toda función que redefinan tanto b1b como z2 debe partir del cuerpo de b1b.
- Añade a `supabase/tests/delivery_zones_settlements_invariants.sql` un caso: confirmar un borrador con pizza (v2, con mitades) y dirección con zona cubierta, contra el esquema completo; debe confirmar sin 42703. Añade prueba negativa que fije que una zona no puede quedar sin cobertura (hoy se quitó `delivery_zones_coverage_nonempty`, queda solo en `upsert_delivery_zone`).

## Prohibido
git commit/push, tocar migraciones distintas de z2, SQL remoto, leer/escribir fuera del worktree ($env:TEMP, .harness/runs).

## Hecho cuando
Los dos invariantes (`pizza_model_v2_invariants.sql` y `delivery_zones_settlements_invariants.sql`) pasan en la verificación local rollback-only con todas las migraciones (docker/PG local del repo: scripts `verify:*-schema:rollback` de apps/api o el runner que usó z2). Informe ≤15 líneas con comando y salida real; sin evidencia = NO VERIFICADO.

## Cierre
Aplica Ponytail: el cambio más pequeño correcto, sin recortar validación/errores/seguridad/tests.

## Reintento (2026-11-21)
El worktree ya contiene un arreglo parcial de columnas (base_group_ids / extra_option_ids). NO lo rehagas: revísalo contra el cuerpo v2 de `20261120000100` (~línea 1767) y complétalo. Falta obligatoriamente: (1) caso en `supabase/tests` que confirme una pizza junto con una zona de entrega; (2) prueba negativa de cobertura vacía (el invariante `delivery_zones_coverage_nonempty` fue eliminado; lo protege `upsert_delivery_zone`); (3) escribir el informe en `.agents/reports/z2b-rebase-confirm-on-pizza-v2.md` con lo verificado. No leas ni escribas fuera del worktree.

## Reintento 2 (2026-11-22) — corregir el fixture de la prueba nueva

Estado verificado por el orquestador (PG 17 local, rollback): la corrección de `confirm_capture_draft_v3` en la migración Z2 está bien y `pizza_model_v2_invariants.sql` pasa con ella. NO toques la migración salvo que la prueba lo demuestre necesario.

Falla `supabase/tests/delivery_zones_settlements_invariants.sql`, en tu bloque `z2b_pizza_delivery_confirmation`, con `SQLSTATE 55000 CAPTURE_JOURNAL_CURRENT_VERSION_MISSING`: el borrador de captura de la prueba no tiene la fila de `app.capture_command_events` (restaurant_id, branch_id, capture_draft_id, result_version = versión actual del borrador, result_capture con `detail`) que exigen las funciones de captura. Mira cómo otras pruebas (p. ej. las de capture_delivery_order / selection plan) crean ese journal y crea el mismo en tu fixture, o usa el comando público que ya lo crea.

Además tu script `.cache/z2b-verify.mjs` tiene un bug en su SQL de resumen: `pg_catalog.pg_policy` no tiene `schemaname`; usa `pg_catalog.pg_policies`. Córrelo hasta que termine con `"status":"ok"` y los dos invariantes en `invariantFiles`.

Termina SIEMPRE escribiendo `.agents/reports/z2b-rebase-confirm-on-pizza-v2.md` (qué cambió, cómo verificaste, salida del verificador). Sin informe la tarea no se acepta.
