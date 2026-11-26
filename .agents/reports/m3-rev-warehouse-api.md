I'll review the PR per the brief. Let me inspect the actual files and the diff.
## Estado
done — revisión A (contratos/API/UI), solo lectura en `harness/m3-default-warehouse`. **VEREDICTO: APROBAR — 0 P1, 2 P2, 3 P3 a deuda.**

## Hallazgos
- P2 `update_inventory_warehouse` ignora en silencio `{isDefault:true, active:false}`: `is_default=(p_is_default and p_active)` (migration:304) sin `22000`, así que PATCH responde 200 con `isDefault:false` mientras POST responde 400 (migration:188, items.service.ts:301).
- P2 falta test de `updateWarehouse` sobre un almacén ajeno con `isDefault`; la barrera real es items.service.ts:223 más el scope por fila del SQL, y solo `updateItem` tiene esa prueba.
- P3 la UI reimplementa `CheckField`; los 44 px quedan solo en el texto de la etiqueta y el checkbox sigue en 20 px (inventory-workspace.tsx:38,649).
- P3 `warehouseSaved` (inventory-workspace.tsx:207) recarga vía `loadWarehouses()`: si la recarga falla tras guardar, la lista válida se sustituye por el panel de error.
- P3 `isDefault` obligatorio en `InventoryWarehouseV1` (inventory.ts:39,354) sin bump de contrato; `exactRecord` rechaza claves extra, así que un API viejo o un bundle cacheado invalidan toda la lista.

## Verificación
```
git grep -n 'is_default = (p_is_default and p_active)' harness/m3-default-warehouse -- supabase/migrations/20261126001300_inventory_default_warehouse.sql
harness/m3-default-warehouse:supabase/migrations/20261126001300_inventory_default_warehouse.sql:304:          is_default = (p_is_default and p_active),
```
Leído además: `$1..$6`/`$1..$5` en orden correcto, `mergeWarehouse` conserva `isDefault` (:424), `23505→conflict` y `22000→request` (:301), boolean estricto antes de tocar la BD, badge/refresco/error en UI, tests create+update con y sin `isDefault`. **NO VERIFICADO**: typecheck, tests, PostgreSQL y Playwright (el brief prohíbe ejecutarlos).
Riesgo/decisión: unificar 400 en el PATCH incoherente y decidir si la primera bodega de una sucursal debe nacer predeterminada (hoy queda sin default).