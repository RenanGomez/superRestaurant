# Brief m3-catalog-tests (nivel B · pruebas negativas del catálogo de inventario)

## Objetivo
Cerrar los P1/P2 de la revisión añadiendo las pruebas negativas que faltan en `supabase/tests/inventory_catalog_invariants.sql`.

Tiempo estimado: 20 min. Solo pruebas SQL: no cambies la migración.

## Alcance
- Edita SOLO: `supabase/tests/inventory_catalog_invariants.sql`.
- Prohibido: migraciones, código de apps, `package.json`, dependencias, rutas fuera del worktree. Sin commit ni push.

## Pruebas a añadir (mismo estilo `begin; … rollback;` y `do $$ … raise exception … $$`)
1. **FK compuesta entre tenants (P1)**: insertar un almacén con `restaurant_id = r` y `branch_id = b2` (sucursal de otro restaurante) debe fallar con `foreign_key_violation`.
2. **Único de SKU activo (P1)**: dos insumos del mismo restaurante con SKU `FLOUR` y `flour` deben fallar con `unique_violation`; tras `deleted_at` del primero, el segundo debe poder insertarse (ya cubierto: refuérzalo si hace falta).
3. **Único de nombre de almacén (P1)**: dos almacenes activos `(restaurant_id, branch_id, lower(name))` iguales deben fallar con `unique_violation`.
4. **Borrado lógico invisible (P2)**: un insumo con `deleted_at` no debe ser visible para el actor de su restaurante (la política filtra `deleted_at is null`).
5. **Privilegios (P2)**: `anon`, `service_role` y `public` tampoco pueden `INSERT/UPDATE/DELETE/TRUNCATE` sobre `app.inventory_items` ni `app.inventory_warehouses` (`has_table_privilege`).
6. **Checks de nombre (P3)**: nombre vacío o de 161 caracteres rechazado (`check_violation`).

Cada prueba con `raise exception` explícito si el comportamiento esperado no ocurre. Usa los helpers/UUIDs que ya emplea el archivo.

## Puertas (obligatorio, Node 24.19.0)
No puedes ejecutar PostgreSQL (binario fuera del worktree). Verifica la sintaxis con:
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
Select-String -Path supabase/tests/inventory_catalog_invariants.sql -Pattern "raise exception|unique_violation|foreign_key_violation|has_table_privilege"
```
El orquestador ejecuta `verify:inventory-schema:rollback` después.

## Hecho cuando
Las seis pruebas están escritas, sin tocar la migración, y el informe pega la salida real del `Select-String` con las nuevas aserciones.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe.
Aplica Ponytail: solo las pruebas necesarias, sin duplicar las existentes.
