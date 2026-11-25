# Revisión servicio · m3-api-functions (nivel A, solo lectura)

No modifiques nada, no ejecutes test/PG y no leas `.agents/reports/*` ni rutas fuera del repo. Responde en ≤ 20 líneas.

Lee SOLO:
- `git diff -- apps/api/src/inventory/items.service.ts apps/api/src/inventory/items.test.ts packages/shared-types/src/inventory.ts packages/shared-types/src/inventory.runtime.test.ts`
- `apps/api/src/inventory/items.controller.ts` (lectura)

Contexto: las consultas del servicio pasan de DML directo a 8 funciones `app_private`; `42501` debe ser 403 (`authorization`), `23514`→400, `23503/23505`→409; el parser de `name` pasa a 160 para alinear con el CHECK. Typecheck, lint y test API ya están verdes.

Busca:
1. Que no quede ningún DML directo ni SQL muerto, y que el orden actor/scope de cada llamada coincida con la firma de la función (`actorId` primero).
2. Mapeo de errores correcto y sin filtrar SQL al cliente; ningún caso que antes fuera 409/400 y ahora sea 503.
3. Que `updateItem`/`updateWarehouse` sigan validando el merge con los parsers (no aceptar valores inválidos por saltarse la validación) y que la lectura previa use `read_..._for_manage`.
4. Que las pruebas nuevas cubran el cambio (`42501`→authorization, `23514`→request, 160) y no se hayan debilitado las existentes.

Salida: primera línea `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`; hallazgos numerados P1/P2/P3 con `archivo:línea` y corrección propuesta.
