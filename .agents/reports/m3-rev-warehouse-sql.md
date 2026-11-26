VEREDICTO: APROBAR

P1: ninguno. P2: ninguno.

P3 `supabase/migrations/20261126001300_inventory_default_warehouse.sql:304` — `update` coerciona `is_default = (p_is_default and p_active)` y **no** emite `22000` (create sí, :187-189); un PATCH `{isDefault:true,active:false}` devuelve 200 con `isDefault:false`, no 400. Parece intencional (desactivar el default debe limpiar el flag; test :80); confirmar la intención.
P3 `supabase/tests/inventory_default_warehouse_invariants.sql:108-111` — aserción casi tautológica: tras el paso 5 `second_warehouse` ya es `false` y solo se comprueba `is_default_value is null`; conviene `= false` o un caso `true`.
P3 `supabase/tests/inventory_default_warehouse_invariants.sql:21` + `inventory_api_functions_invariants.sql:39-77` — prueban que `app_api` ejecuta los wrappers (implícito) y que no tiene DML de tabla, pero falta la aserción negativa de `EXECUTE` para `public/anon/authenticated/service_role` (grep sin coincidencias).
P3 `00100_inventory_catalog.sql:32-48` / `00500:6-8` — sin `CHECK (not (is_default and not active))`: el índice parcial solo protege defaults activos; un write directo del owner podría dejar un default inactivo (no vía `app_api`).

Correcto: drop de firmas viejas sin grants huérfanos (:10-22), `owner to postgres` + `search_path=''` en las 4 (:40/79/162/232, :335-338), `revoke/grant` solo a `app_api` (:340-354), `list`/`read` con columnas explícitas incluida `is_default` y scope restaurant+branch (:42,:137), clear-then-set sin `deferrable`/`set constraints` ni inserts ciegos, e índice `inventory_warehouses_one_default_idx` intacto (00500:6-8). Los tests cubren mover, desactivar y `22000` en create. Abrí fuera del diff (necesario para juzgar drop/índice/firmas): 00500, 00100, 00600 y el wiring del verificador.

Verificación (solo lectura; NO ejecuté PostgreSQL ni Playwright):
```powershell
git show harness/m3-default-warehouse:supabase/migrations/20261126001300_inventory_default_warehouse.sql | Select-String -Pattern "'22000'|is_default = \(p_is_default|owner to postgres"
    raise exception using errcode = '22000', message = 'INVENTORY_WAREHOUSE_DEFAULT_REQUIRES_ACTIVE';
          is_default = (p_is_default and p_active),
alter function app_private.update_inventory_warehouse(uuid, uuid, text, boolean, boolean) owner to postgres;
git show harness/m3-default-warehouse:supabase/tests/inventory_default_warehouse_invariants.sql | Select-String -Pattern "first_warehouse, 'Bodega central', false|is_default_value is null"
  perform app_private.update_inventory_warehouse(manager, first_warehouse, 'Bodega central', false, true);
  if is_default_value is null then raise exception 'read for manage did not expose is_default'; end if;
```
NO VERIFICADO: runtime (migración desde cero, conflicto 23505 concurrente) — el brief prohíbe ejecutar PostgreSQL/Playwright; conclusiones estáticas. AGENTS.md §10 no contiene plantilla de informe.