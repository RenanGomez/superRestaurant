# Brief m3-rev-warehouse-sql (revisión A · foco SQL/grants)

Diff: main...harness/m3-default-warehouse

Revisa el SQL del PR #125. **No escribas archivos ni uses `$env:TEMP`** (el sandbox los rechaza):
lee con `git show`. No ejecutes PostgreSQL ni Playwright. No comentes el resto del PR salvo que
afecte al SQL.

Comprueba:

1. `supabase/migrations/20261126001300_inventory_default_warehouse.sql`: firmas nuevas de
   `create_inventory_warehouse`/`update_inventory_warehouse`, `drop` de las viejas (¿queda algún
   grant huérfano o llamada interna rota?), `owner to postgres`, `search_path = ''`, guardia de
   roles, `revoke`/`grant` solo a `app_api`.
2. Invariante del único default: mover el default limpia el anterior; `is_default` con
   `active = false` falla con `22000`; desactivar limpia el flag; el índice parcial
   `inventory_warehouses_one_default_idx` sigue siendo la última red y el código no lo sortea con
   `set constraints`/`deferrable` ni inserts ciegos.
3. Listados: `list_inventory_warehouses` y `read_inventory_warehouse_for_manage` devuelven
   `is_default` (¿`select *`?), sin filtrar por tenant de más ni de menos.
4. Pruebas: `supabase/tests/inventory_default_warehouse_invariants.sql` prueba de verdad las cuatro
   reglas y los grants; `inventory_api_functions_invariants.sql` sigue coherente tras cambiar la
   firma (¿el cambio debilita una aserción existente?). Señala aserciones tautológicas.

Entrega `VEREDICTO: APROBAR|CORREGIR` con P1/P2/P3, archivo y línea.
