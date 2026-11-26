# Revisi├│n Nivel A (SQL) ΓÇö PR #51 (`ao/pizza-confirm-v2`)

- **PR revisado:** `RenanGomez/superRestaurant#51` (`9f87f9cbc45282aa5d16382cf2620a38598e2af1`, rama `ao/pizza-confirm-v2` ΓåÆ `main`)
- **Alcance:** `supabase/migrations/20261123000500_confirm_pizza_v2_and_zone_coverage.sql` (+842), `supabase/tests/delivery_zones_invariants.sql` (+132), `supabase/tests/pizza_model_v2_invariants.sql` (+328), `HANDOFF.md` (+22)
- **Fecha:** 2026-11-23 (America/Phoenix)

## VEREDICTO: APROBAR

---

## Matriz de verificaci├│n Nivel A

| Criterio | Estado | Evidencia |
|---|---|---|
| Sin edici├│n de migraciones aplicadas | OK | Solo se a├▒ade `20261123000500_confirm_pizza_v2_and_zone_coverage.sql`; ninguna migraci├│n previa (`20260927000100`, `20261120000100`, `20261121000100`, `20261122000100`, `20261123000100`) fue modificada. |
| Error `42703` (`base_group_id` / `extra_group_ids`) resuelto | OK | Reconstruye `confirm_capture_draft_v3` sobre `product.base_group_ids`, `product.extra_option_ids` (`:269-274`) y `removed_product.base_group_ids` (`:314`); auditado por regex y probado en entrega en `pizza_model_v2_invariants.sql:892-894,955-1203`. |
| `SECURITY DEFINER`, `search_path = ''`, grants m├¡nimos | OK | `confirm_capture_draft_v3` (`:22-23,760-763`): `owner to postgres`, `REVOKE ALL`, `GRANT EXECUTE TO app_api`. `enforce_delivery_zone_coverage_nonempty` (`:773-774,823-825`): `owner to postgres`, `REVOKE ALL` sin grants directos (`0` roles con `EXECUTE`). |
| Aislamiento `restaurant` / `branch` | OK | Autorizaci├│n de membres├¡a/rol fail-closed antes de leer datos (`:79-89`); todas las consultas y mutaciones filtran por `restaurant_id` y `branch_id` (incluyendo `capture_delivery_manual_fees:587-589`, `customer_fulfillment_snapshots:726-728`, `delivery_zones:792-796`, `delivery_zone_settlements:806-811`). |
| Idempotencia al confirmar dos veces | OK | `pg_advisory_xact_lock` por `(actor, restaurant, branch, idempotencyKey)` (`:95-97`), huella SHA-256 + verificaci├│n de `orders`/`order_operational_shifts`/`order_fulfillment_snapshots` (`:98-117`), escritura at├│mica v├¡a subtransacci├│n `P5100` (`:685-754`); replay validado en `pizza_model_v2_invariants.sql:1054-1061,1187-1194`. |
| Snapshots de precio/modificadores congelados en `OrderItem` y sin `float` | OK | Recomputa `pizza_halves_price_v2` desde el cat├ílogo vigente, exige igualdad JSONB exacta en `item->'snapshot'` (`:490-546`) y revalida `deliveryCharge` + `manualFee` live en `app.capture_delivery_manual_fees` + expiraci├│n tambi├⌐n en tarifa manual (`:587-643`). Sin tipos `float`/`real`/`double precision` (enteros `bigint` en unidad menor + ISO `currency`). |
| Pruebas negativas (`delivery_zones_coverage_nonempty`) y positivas en `supabase/tests` | OK | `delivery_zones_invariants.sql:80-82,241-355` cubre cobertura vac├¡a, solo `localities`, `UPDATE` vaciando `postal_codes`, `DELETE` de ├║ltima colonia activa (`23514` + `CONSTRAINT_NAME = 'delivery_zones_coverage_nonempty'`), desactivaci├│n y auditor├¡a de privilegios. `pizza_model_v2_invariants.sql:888-1203` cubre zona cubierta + extras/exclusiones, tarifa manual + `delivery_quote_expired` y replays. |

---

## Hallazgos por severidad

### P1 (Bloqueantes)

Ninguno.

### P2 (Importantes ΓÇö seguimiento recomendado, sin regresi├│n frente a `main`)

1. **`supabase/migrations/20261123000500_confirm_pizza_v2_and_zone_coverage.sql:599-600,625`** ΓÇö **Paridad de moneda entre `capture_delivery_manual_fees` / `frozen_quote` y `p_order` no se valida incondicionalmente.**
   - **Qu├⌐ est├í mal:** `v_manual_fee.currency_code` solo se compara si `frozen_quote->'override' ? 'currency'` (`:599-600`), clave que el formato actual del override omite (`pizza_model_v2_invariants.sql:1105-1109`). Tampoco se compara `frozen_quote->>'currency'` ni `v_manual_fee.currency_code` contra `p_order->>'currency'` (`:625` solo compara `deliveryCharge.amount.currency` con `p_order->>'currency'`). Heredado de `20261121000100`.
   - **C├│mo debe quedar:** exigir incondicionalmente `v_manual_fee.currency_code is distinct from p_order->>'currency'` (ΓåÆ `delivery_manual_fee_stale`) y `frozen_quote->>'currency' is distinct from p_order->>'currency'` (ΓåÆ `delivery_charge_mismatch`).

2. **`supabase/migrations/20261123000500_confirm_pizza_v2_and_zone_coverage.sql:624`** ΓÇö **Validaci├│n permisiva con `::text::numeric` en `deliveryCharge.amount.amountMinor`.**
   - **Qu├⌐ est├í mal:** `(p_order#>'{deliveryCharge,amount,amountMinor}')::text::numeric is distinct from v_effective_fee::numeric` acepta un decimal equivalente como `2500.0` (violando la pol├¡tica estricta de enteros sin punto decimal) y lanza `22P02 invalid_text_representation` sin capturar si `amountMinor` llega como string/null/boolean en lugar de devolver `conflict`/`rejected`. Heredado de `20261001000100`/`20261121000100`.
   - **C├│mo debe quedar:** validar `pg_catalog.jsonb_typeof(p_order#>'{deliveryCharge,amount,amountMinor}') = 'number'` y `(p_order#>>'{deliveryCharge,amount,amountMinor}') ~ '^(0|[1-9][0-9]*)$'` antes de comparar como `bigint` contra `v_effective_fee`.

3. **`supabase/migrations/20261123000500_confirm_pizza_v2_and_zone_coverage.sql:792-796`** ΓÇö **Lectura sin bloqueo `FOR SHARE` en `enforce_delivery_zone_coverage_nonempty()` permite write-skew en SQL directo concurrente.**
   - **Qu├⌐ est├í mal:** bajo `READ COMMITTED`, si una transacci├│n limpia `postal_codes = '{}'` en `app.delivery_zones` y otra borra en paralelo la ├║ltima fila en `app.delivery_zone_settlements`, `select * into v_current from app.delivery_zones ...` sin `for share` puede ver el estado previo al commit del otro escritor y dejar una zona activa sin cobertura. `upsert_delivery_zone` mitiga esto en operaci├│n normal al tomar `FOR UPDATE` sobre `app.delivery_zones`, pero el trigger es defensa a nivel de esquema contra escritores directos.
   - **C├│mo debe quedar:** a├▒adir `for share` a la lectura de `app.delivery_zones` en `:792-796` (o `for key share` si se busca menor contenci├│n; `for share` bloquea contra `UPDATE` de `postal_codes`/`active`/`deleted_at`).

### P3 (Menores / limpieza)

1. **`HANDOFF.md:11,20` y `supabase/tests/delivery_zones_invariants.sql:242`** ΓÇö Referencias obsoletas a `20261123000400` tras el renombrado en el commit `9f87f9c`; actualizar a `20261123000500`.
2. **`supabase/migrations/20261123000500_confirm_pizza_v2_and_zone_coverage.sql:607,662,667`** ΓÇö `clock_timestamp()` y `max(...)` sin calificar `pg_catalog.` dentro de funci├│n con `set search_path = ''` (seguro en PostgreSQL porque `pg_catalog` se busca impl├¡citamente, heredado de `20261120000100`, pero conviene homogeneizar con el resto del archivo).
3. **Integraci├│n / pruebas menores:** el PR #51 reporta conflicto de merge (`mergeable: CONFLICTING`) en `HANDOFF.md` contra el `main` actual; resolver al rebasar antes de fusionar. En `supabase/tests/pizza_model_v2_invariants.sql:1054-1061,1187-1194`, reforzar opcionalmente el replay comprobando `count(*) = 1` en `app.orders` y `app.capture_command_events` (como ya hace la secci├│n 5 en `:854-857`).

---

## Verificaciones observadas (solo lectura, sin mutar PR #51)

- `gh pr diff 51 --repo RenanGomez/superRestaurant` y diff exacto de `confirm_capture_draft_v3` contra `20261120000100_pizza_model_v2.sql` y `20261121000100_delivery_zones_settlements.sql`: ├║nica divergencia funcional intencional frente a `20261121000100` es la reconstrucci├│n sobre `base_group_ids`/`extra_option_ids`, la preservaci├│n de K0-B (`delivery_customer_required`), la aplicaci├│n de `delivery_quote_expired` tambi├⌐n a cotizaciones con tarifa manual, y la reafirmaci├│n expl├¡cita de `OWNER`/`REVOKE`/`GRANT`.
- Checks de CI en GitHub (`gh pr checks 51 --repo RenanGomez/superRestaurant`) sobre `9f87f9c`:
  - `Verify`: `pass` (2m40s)
  - `PostgreSQL verification`: `pass` (1m41s)
  - `Playwright smoke`: `pass` (1m16s)

## Riesgo residual

`CREATE CONSTRAINT TRIGGER` no valida filas preexistentes (si una base remota ya tuviera zonas activas pre-Z2 solo con `localities`, permanecer├ín hasta su pr├│ximo `UPDATE`), y los P2 de moneda/entero en `deliveryCharge` y `FOR SHARE` en el trigger quedan como deuda de endurecimiento SQL para un corte siguiente sin bloquear el desbloqueo del bug `42703`.
