# Revisión · m3-api-wire (nivel B)

Solo lectura. No leas `.agents/reports/*` ni rutas fuera del repo. No ejecutes nada. Responde en ≤ 12 líneas.

Lee:
- `git diff -- apps/api/src/app.module.ts apps/api/src/app.smoke.test.ts`
- `apps/api/src/inventory/items.controller.ts` (solo lectura) para confirmar rutas y guards.

Comprueba:
1. ¿Registrar `ItemsController`/`ItemsService` directamente en `AppModule` es coherente con el resto (no hay imports de módulos) y no duplica el registro de dependencias de `items.module.ts`?
2. ¿Las rutas reales del controlador son las que se prueban (`/api/v1/inventory/items`, `/api/v1/inventory/warehouses`) y el 401 se debe al guard global, no a una ruta inexistente?
3. ¿La prueba es estable y no requiere base de datos?

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos P1/P2/P3 con `archivo:línea`.
