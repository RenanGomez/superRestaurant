# menu-size-presets-fixture · corregir el fixture de orden en las invariantes SQL

Archivo único: `supabase/tests/menu_size_presets_invariants.sql`. No toques nada más.

Al ejecutarlo en PostgreSQL falla con `ORDER_RESTAURANT_TIME_ZONE_MISMATCH` (trigger `app_private.enforce_order_restaurant_time_zone`) en el `insert into app.orders` (~línea 175): el `aggregate` no lleva `timeZone`. Añade al `jsonb_build_object` del aggregate `'currency', 'MXN'` y `'timeZone', 'America/Hermosillo'` (igual que `supabase/tests/branch_order_work_tray_delivery_state_invariants.sql:72`). Revisa si hay otros inserts de `app.orders` en el archivo con el mismo problema y corrígelos igual.

Hecho cuando: el diff sólo toca ese archivo. No hagas commit. Informe con el diff en un bloque ```.
