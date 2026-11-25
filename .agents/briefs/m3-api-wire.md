# Brief m3-api-wire (nivel B · exponer el módulo de inventario en la aplicación)

## Objetivo
Montar el módulo de insumos/almacenes en la aplicación Nest para que sus rutas existan en runtime, y fijarlo con una prueba. Hoy `apps/api/src/app.module.ts` **no importa** `ItemsModule`, así que los endpoints de #90 no están expuestos.

Tiempo estimado: 15 min.

## Alcance
- Edita solo: `apps/api/src/app.module.ts` y `apps/api/src/app.smoke.test.ts` (o el test de módulo existente que corresponda).
- Prohibido: `apps/api/package.json` (lo escribe otra tarea), SQL, otros módulos, dependencias, commit/push. No ejecutes PostgreSQL.

## Qué hacer
1. Importa `ItemsModule` desde `./inventory/items.module.js` y añádelo al array `imports` de `AppModule` (sigue el orden/estilo de los módulos existentes).
2. Comprueba cómo registra sus rutas `items.controller.ts` (prefijo `inventory/items` y `inventory/warehouses`; mira los `@Controller`/`@Get` del archivo) y añade a `app.smoke.test.ts` una aserción de que el módulo montado expone esas rutas: instancia la aplicación de prueba igual que el resto del archivo y verifica que la ruta existe (por ejemplo `GET /api/v1/inventory/items?restaurantId=<uuid>` sin token responde 401 en vez de 404, y las rutas de almacenes igual). No inventes un endpoint; usa los decoradores reales.
3. No cambies contratos, guards ni permisos.

## Puertas (Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api test
```

## Hecho cuando
`ItemsModule` importado, prueba de rutas añadida y typecheck/lint/test verdes con salida real. Informe con archivos, rutas comprobadas y `git status --short`. Aplica Ponytail.
