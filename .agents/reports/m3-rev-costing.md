I'll review the specified files for the m3-api-alerts-costing task.
VEREDICTO: APROBAR

C1 ✓ entero y medio-arriba: `:191 (v_value + v_quantity/2)/v_quantity`, `:192 v_value % v_quantity`; `unit_cost_minor >= 0` (ledger:41-42) ⇒ resto no negativo; sin casts numeric/float; COMMENT `:550` documenta el resto.
C2 ✓ alertas: `:76 coalesce(b.quantity,0) < i.min_quantity` con `min_quantity > 0`; membresía `:32-51`; alcance `i/w.restaurant_id = p_restaurant_id` y `w.branch_id = p_branch_id` `:69-75`; aislamiento/`unaffiliated` probados (test `:186-221`).
C3 ✓ margen con catálogo vigente (`menu_catalog_heads`+`menu_products` `:402-413`) y receta activa única (`inventory_recipes_active_scope_unique`); sin receta/precio devuelve 0 filas → 404 (service `:192`).
C4 ✓ `catalog.read` (`:205,223`); mapeo `22000/23514/22003→400, 23503/23505→409, 42501→403, resto 503` (`:238-243`) igual al brief; el servicio no hace aritmética de dinero.
P3 `supabase/migrations/20261126001100_inventory_costing_api.sql:441` — el margen usa `coalesce(costed.unit_cost_minor,0)`: receta sin receipts ⇒ coste 0 y margen = precio. Es el "0 si no hay receipts" del brief, pero el COMMENT del margen (`:554`) no lo advierte.
P3 `...:285-286` (product-costs) elige el primer almacén con saldo, no el "último almacén con costo" del objetivo; puede devolver 0 aunque otro almacén tenga costo.
P3 `...:280-287` product-costs no valida moneda mixta entre líneas (el margen sí, `:492-496`); conviene documentar que `currency` es por línea.

Evidencia (solo lectura):
```
PS> Select-String -Path supabase\migrations\20261126001100_inventory_costing_api.sql -Pattern "v_unit_cost :=|v_remainder :=|coalesce\(b.quantity, 0\) < i.min_quantity|v_cost_currency <> v_price_currency"
76:      and coalesce(b.quantity, 0) < i.min_quantity
191:   v_unit_cost := (v_value + (v_quantity / 2)) / v_quantity;
192:   v_remainder := v_value % v_quantity;
493:     or (v_cost_currency is not null and v_cost_currency <> v_price_currency)
```
NO VERIFICADO: no ejecuté la suite ni PostgreSQL (revisión de solo lectura); sin hallazgos P1/P2.