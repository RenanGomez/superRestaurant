Now I'll add the six negative tests to the SQL file.
Now run the required verification gates.
## Estado
done — seis pruebas negativas añadidas; migración intacta.
## Qué hice
- Añadidas: FK compuesta `(r,b2)` → `foreign_key_violation`; SKU `FLOUR`/`flour` → `unique_violation`; almacén `main`/`Main` → `unique_violation`.
- Insumo con `deleted_at` invisible para `authenticated`; `anon`/`service_role`/`public` sin escritura; names vacío/161 → `check_violation`; reuso de SKU tras borrado reforzado.
## Archivos tocados
- supabase/tests/inventory_catalog_invariants.sql — solo pruebas.
## Verificación
```
. .\tools\agentic\use-node24.ps1; node -v; Select-String -Path supabase/tests/inventory_catalog_invariants.sql -Pattern "raise exception|unique_violation|foreign_key_violation|has_table_privilege"
v24.19.0
supabase\tests\inventory_catalog_invariants.sql:96:  exception when unique_violation then null; end;
supabase\tests\inventory_catalog_invariants.sql:102:  exception when foreign_key_violation then null; end;
supabase\tests\inventory_catalog_invariants.sql:108:  exception when unique_violation then null; end;
supabase\tests\inventory_catalog_invariants.sql:35:      or pg_catalog.has_table_privilege('public', 'app.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')
```
NO VERIFICADO: PostgreSQL rollback no ejecutado (binario fuera del worktree); lo corre el orquestador.
## Riesgos / dudas
- Ninguno de código; falta confirmar semántica con `verify:inventory-schema:rollback`.
## Notas propuestas
- ninguna.