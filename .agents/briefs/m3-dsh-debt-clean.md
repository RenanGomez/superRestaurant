# Brief m3-dsh-debt-clean (nivel B · deuda P3 de inventario)

## Objetivo

Cerrar cuatro P3 registrados en `docs/agentic/debt.md` sin cambiar contratos ni esquema:

1. Borrar el módulo huérfano `apps/api/src/inventory/items.module.ts` (nadie lo importa; `AppModule`
   registra controladores y proveedores directos). Confirma antes con `grep` que no lo usa nadie.
2. Validar `x-device-id` como UUID en `apps/api/src/inventory/movements.controller.ts` (hoy se toma
   tal cual): si viene y no es un UUID válido, la respuesta debe ser `400 INVENTORY_REQUEST_INVALID`,
   no un 500 ni un valor corrupto persistido. Reutiliza el patrón de validación que ya usa el servicio
   para `deviceId` de recepción (`UUID_PATTERN`) y **no** cambies el nombre del header.
3. Revisar el mapeo de errores de `apps/api/src/inventory/recipes.service.ts`: si `23505` ya mapea a
   `conflict`, solo añade una prueba unitaria que lo fije; si no, mapéalo como el resto (`conflict`).
4. Añadir a `supabase/tests/inventory_api_functions_invariants.sql` aserciones `pg_proc` para las
   funciones `app_private` de inventario: `prosecdef = true`, propietario esperado y `proconfig`
   vacío o el esperado (search_path). Usa el estilo y los helpers que ya tiene ese archivo; no
   dupliques bloques ni cambies los existentes.

## Archivos (exactos)

- `apps/api/src/inventory/items.module.ts` (borrar)
- `apps/api/src/inventory/movements.controller.ts`
- `apps/api/src/inventory/movements.test.ts` (prueba del header inválido)
- `apps/api/src/inventory/recipes.service.ts` y `apps/api/src/inventory/recipes.test.ts` (solo si el
  mapeo falta o para fijarlo con prueba)
- `supabase/tests/inventory_api_functions_invariants.sql`

Prohibido tocar: migraciones (`supabase/migrations/**`), `app.module.ts`, `package.json`,
`packages/shared-types/**`, `apps/web/**`, `apps/api/src/operations/**`. No crees migraciones nuevas:
si algo exige SQL nuevo, **detente** y anótalo como bloqueo.

## Reglas de la sesión

- No hagas `git commit`, `git push`, ni crees ramas o PRs.
- **No ejecutes PostgreSQL** ni `verify:*`/`test:http:local` (los corre el orquestador). Puedes
  ejecutar lint, typecheck y `test` unitario del API.
- No edites `dist`, `node_modules` ni artefactos.

## Puertas que debes ejecutar (Node 24.19.0)

```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api test
```

Si un script sale con exit 1 sin diagnóstico, ejecuta el `tsc`/`node` del script directamente y
revisa la salida real.

## Hecho cuando

Los cuatro puntos están aplicados, typecheck/lint/test del API en verde con salida real, y
`.agents/reports/m3-dsh-debt-clean.md` lista archivos, qué quedó pendiente y por qué, salida de
puertas y `git status --short`. El SQL lo verifica el orquestador con el probe rollback-only.

Aplica Ponytail (el cambio mínimo que cumple) y AGENTS §8-§12.
