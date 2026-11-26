VEREDICTO: CAMBIOS
P1 supabase/tests/inventory_catalog_invariants.sql:66 falta la prueba negativa del FK compuesto: nunca se intenta insertar un almacén `(restaurant_id=r, branch_id=b2)` con `b2` de otro restaurante esperando `foreign_key_violation`; el aislamiento de escritura entre tenants queda sin demostrar.
P1 supabase/tests/inventory_catalog_invariants.sql:86 el punto 6 solo prueba que el borrado lógico libera el SKU; no se prueba que un SKU activo duplicado (insensible a mayúsculas, mismo restaurante) ni un nombre de almacén duplicado sean rechazados con `unique_violation` ("no duplicar" sin prueba).
P2 supabase/tests/inventory_catalog_invariants.sql:30 los grants de escritura solo se comprueban para `authenticated` y `app_api`; `anon`, `service_role` y `public` también reciben `revoke all` (migración:53) pero no se verifica que no puedan escribir.
P3 apps/api/package.json:172 el archivo entero se re-serializa (indent 2→4, `'`→`\u0027`) por añadir un script; el JSON queda idéntico salvo `verify:inventory-schema:rollback`, pero son 253 líneas de diff y riesgo de conflicto.

Verificación (comandos exactos y salida real):
```powershell
git grep -n -E "foreign_key_violation|unique_violation" harness/m3-sql-catalog -- supabase/tests/inventory_catalog_invariants.sql
# NO_MATCHES(exit=1)

git grep -n "has_table_privilege" harness/m3-sql-catalog -- supabase/tests/inventory_catalog_invariants.sql
# 30:    if pg_catalog.has_table_privilege('authenticated', 'app.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')
# 31:      or pg_catalog.has_table_privilege('app_api', 'app.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')

node -e "…JSON.parse(origin/main y branch)…"
# scriptsAdded [ 'verify:inventory-schema:rollback' ]; scriptsRemoved []; depsEqual true; changedScripts []
```
No ejecuté el verificador (binario PG local fuera del repo, prohibido por el brief): NO VERIFICADO el runtime de `verify:inventory-schema:rollback`.