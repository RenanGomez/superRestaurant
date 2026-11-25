# Brief m3-sql-ledger-fix (nivel B · 1 cast en la prueba SQL)

## Objetivo
Corregir un error de tipos en la prueba de invariantes del ledger.

Tiempo estimado: 5 min. Una sola corrección.

## Error real (ejecutado por el orquestador)
```
{"stage":"invariants:ledger","status":"failed","message":"function pg_catalog.coalesce(bigint, integer) does not exist"}
```

## Causa y cambio
`supabase/tests/inventory_ledger_invariants.sql:69`:
```sql
select pg_catalog.coalesce(pg_catalog.sum(quantity_delta), 0) into balance from app.inventory_movements
```
`sum(quantity_delta)` es `bigint`; el literal `0` es `integer`. Cámbialo a `0::bigint` (o `0::bigint` con el mismo esquema de nombres). No cambies nada más del archivo.

## Alcance
- Edita SOLO: `supabase/tests/inventory_ledger_invariants.sql`.
- Prohibido: migración, código, `package.json`, dependencias. Sin commit ni push; sin acceder fuera del worktree.

## Puertas (obligatorio, Node 24.19.0)
No puedes ejecutar PostgreSQL (binario fuera del worktree). Solo comprueba el texto:
```powershell
Select-String -Path supabase/tests/inventory_ledger_invariants.sql -Pattern "coalesce"
```
El orquestador re-ejecuta el verificador.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con el `Select-String` real y el diff de la línea.
