# Brief m3-sql-catalog-fix2 (nivel B · 1 línea del verificador)

## Objetivo
Corregir el verificador de inventario para que las migraciones apliquen en el clúster local de pruebas.

Tiempo estimado: 5 min. Una sola corrección.

## Problema exacto
El orquestador ejecutó `verify:inventory-schema:rollback` y falló en la etapa `migrations`:
```
{"stage":"migrations","status":"failed","message":"column u.raw_user_meta_data does not exist"}
```
La causa es que `new LocalPostgres({ marker: "LOCAL_INVENTORY_SCHEMA_ONLY", databasePrefix: "..." })` no pasa `authUsersExtraColumns`, así que la tabla `auth.users` de fixtures no tiene las columnas que usan las migraciones.

## Alcance
- Edita SOLO: `apps/api/src/operations/run-inventory-schema-verification.ts`.
- Prohibido: tocar migraciones, tests SQL, otras apps, `package.json`, dependencias. Sin commit ni push; sin rutas fuera del worktree.

## Cambio
En la construcción de `LocalPostgres`, añade la misma opción que usa `apps/api/src/operations/run-sync-schema-verification.ts:8`:
```ts
new LocalPostgres({ marker: "LOCAL_INVENTORY_SCHEMA_ONLY", databasePrefix: "superrestaurant_inventory", authUsersExtraColumns: ", raw_user_meta_data jsonb" })
```
No cambies nada más.

## Puertas (obligatorio, Node 24.19.0)
No puedes ejecutar PostgreSQL (el binario vive fuera del worktree y el sandbox lo rechaza). Solo:
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
```
El orquestador re-ejecuta el verificador.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con el diff exacto del cambio y la salida real de typecheck y lint.
