# api-capture-lines · subunidad 2: migración SQL candidata

## Tarea
api-capture-lines-2-sql · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A (esquema `app`, funciones `app_private`, confirm de captura). Subunidad 2 de 4 del paquete padre `.claude/packets/api-capture-lines.md`. Prerrequisito: subunidad 1 (contrato `CaptureSelectionPlanV1`) ya está en la rama `claude/api-capture-lines`.

## Objetivo
Una migración nueva candidata que permita persistir sobre un borrador de captura un plan de selección armado desde el catálogo (`plan_kind = 'selection'`), reemplazarlo completo con CAS e idempotencia, exponerlo en el workspace y hacer que la función de confirm lo consuma con las mismas garantías que el plan de repetición. Sin aplicar en remoto.

## Criterios de aceptación (verificables)
- [ ] Archivo `supabase/migrations/20260928000100_capture_selection_plan.sql`, reproducible desde cero sobre la cadena actual, sin editar migraciones existentes.
- [ ] Persistencia: generalizar `app.capture_repeat_order_plans` (columna `plan_kind text not null default 'repeat' check (plan_kind in ('repeat','selection'))`, `customer_id` y `source_order_id` nullables sólo cuando `plan_kind='selection'` mediante CHECK; `selection_plan jsonb` conserva el JSON del contrato exacto) **o**, si la revisión de las funciones existentes demuestra que acoplar rompe invariantes, tabla hermana `app.capture_selection_plans` con la misma disciplina (una fila por captura, `applied_capture_version`, actor, dispositivo, `occurred_at`, `idempotency_key` único por captura). Justifica la elección en la salida.
- [ ] Función `app_private.replace_capture_selection_plan(...)` (o el nombre que siga la convención de `20260923000300`/`20260924000100`): verifica scope Restaurant/Branch y membership igual que las funciones hermanas, `attention_lease_id` vigente y propiedad del operador, `expected_version` (CAS → error tipado de conflicto), idempotencia por `idempotency_key` (repetir el mismo comando devuelve el mismo resultado sin nueva versión), guarda el plan, incrementa la versión de la captura, registra evento de auditoría (`capture.selection_replaced` añadido al CHECK de tipos de evento si existe), e invalida/borra el plan de repetición si había uno (excluyentes) dejando rastro auditado.
- [ ] La función que arma el workspace devuelve `selectionPlan` (JSON del plan tal como se guardó, sin precios: los precios los proyecta el API contra el catálogo) junto al `repeatOrderPlan` existente.
- [ ] La función de confirm (`20260924000100`) se reemplaza (`create or replace`) para: si hay plan `selection`, exigir `applied_capture_version = expected`, contar líneas igual que hoy y aceptar los `order_items` que el API materialice; sin plan de ningún tipo se conserva el comportamiento actual. No relajar ninguna comprobación existente del plan de repetición.
- [ ] Pruebas SQL en `supabase/tests` (o el mecanismo que ya use el repo) que cubran: aislamiento (captura de otra sucursal/restaurante → rechazo), CAS, idempotencia, exclusión repeat/selection, y confirm con plan de selección. Ejecutadas en un PostgreSQL 17 local desechable aplicando toda la cadena de migraciones desde cero; pegar el resumen.
- [ ] Si `apps/api/package.json` tiene scripts `verify:*:rollback`, añadir `verify:capture-selection-plan-schema:rollback` siguiendo el patrón de `verify:delivery-zones-schema:rollback` (transacción + `ROLLBACK` siempre + postcheck sin estado). No ejecutarlo contra remoto.
- [ ] `pnpm --filter @super-restaurant/api typecheck|lint` no se rompen (la API aún no consume la función; eso es la subunidad 3).

## Archivos de entrada
- `C:\tmp\sr-wt\api-capture-lines\supabase\migrations\20260923000300_capture_repeat_order_workspace.sql`: tabla `capture_repeat_order_plans`, cómo entra `repeatOrderPlan` al workspace.
- `C:\tmp\sr-wt\api-capture-lines\supabase\migrations\20260924000100_confirm_capture_repeat_order.sql`: función de confirm (líneas ~75-200: comprobaciones `applied_capture_version`, `customerId`, conteo de líneas, `jsonb_array_elements` con ordinality).
- Migraciones de captura previas (`20260918000100` bandeja, y las de customer/fulfillment/delivery-instructions) para la convención de funciones `app_private`, errores tipados, auditoría y CAS: localízalas con `grep -l capture supabase/migrations/*.sql`.
- `supabase/tests/*` existentes como patrón de prueba.
- Contrato: `packages/shared-types` (subunidad 1) — la forma JSON exacta de `CaptureSelectionPlanV1`.

## Invariantes que NO deben cambiar
- Scope Restaurant/Branch y membership verificados en SQL, no sólo en la API.
- Registros financieros y de auditoría inmutables; correcciones por eventos nuevos.
- No editar migraciones aplicadas; `create or replace` sólo dentro de la migración nueva.
- Sin datos reales, sin aplicar en `zwbyiefqeujstyzysydn`; cualquier verificación remota sería rollback-only y aquí no se pide.

## Fuera de alcance
- Endpoint NestJS, materialización de Order en TypeScript, web (subunidades 3-4).

## Verificación
- PostgreSQL 17 desechable: aplicar todas las migraciones desde cero + pruebas; pegar recuento (migraciones aplicadas, pruebas pasadas).
- `pnpm --filter @super-restaurant/api typecheck && pnpm --filter @super-restaurant/api lint`.
- `git diff --check`.

## Entorno
Worktree `C:\tmp\sr-wt\api-capture-lines`, rama `claude/api-capture-lines`. Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`. Un commit `feat(supabase): add capture selection plan migration (candidate)`. Sin push, sin remoto.

## Formato de salida esperado
1. Resumen y decisión de persistencia con justificación.
2. Archivos tocados y commit.
3. Salida literal de la verificación (incluido el PostgreSQL local).
4. Riesgos: plan de rollback de la migración; qué comprobaciones de confirm cambiaron.
