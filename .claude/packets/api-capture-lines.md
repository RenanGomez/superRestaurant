# api-capture-lines

## Tarea
api-capture-lines · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A (contrato compartido consumido por web y API; snapshots de precio; SQL en `app`)

## Objetivo
Que una captura telefónica pueda llevar líneas elegidas del catálogo publicado (no sólo copiadas de un pedido anterior). El servidor recibe un plan de selección construido por la UI (producto, cantidad, selecciones de modificadores), lo valida contra el catálogo vigente, lo cotiza con los snapshots existentes, lo persiste sobre el borrador con CAS e idempotencia, y lo devuelve en el workspace con totales calculados por el servidor. `confirm` materializa la Order desde ese plan igual que hoy lo hace desde el plan de repetición.

## Contexto verificado (CodeGraph 2026-09-27)
- `apps/api/src/capture-repeat-order-plan.ts` (1-130): `CaptureRepeatSelectionPlan { catalogVersion, customerId, lines[{ sourceOrderItemId, productId, quantity, modifierGroups[{groupId, selections[{optionId, quantity}]}] }], schemaVersion:1, sourceOrderId }`; `materializeCaptureOrder(command, actorId, channel, plan|null, catalog|null)` cotiza cada línea con `createMenuProductPriceSnapshot(domainCatalog, {currency, productId, restaurantId}, line.modifierGroups)` y `addOrderItem`; ids derivados con `derivedUuid` a partir de `command.eventId`/`idempotencyKey` y `sourceOrderItemId`.
- Persistencia: `supabase/migrations/20260923000300_capture_repeat_order_workspace.sql` y `20260924000100_confirm_capture_repeat_order.sql` — tabla `app.capture_repeat_order_plans` (`selection_plan jsonb`, `applied_capture_version`, `customer_id`); la función de confirm compara `applied_capture_version` con `expected`, exige `customerId` del plan y cuenta líneas.
- Contratos: `packages/shared-types/src/commercial-capture.ts` — `ConfirmCaptureDraftCommandV2` (líneas 125-131, no lleva líneas), `parseConfirmCaptureDraftCommandV2` (434-465); el workspace devuelve `repeatOrderPlan`. `MenuCatalogV1`/`MenuCatalogStateV1` en `packages/shared-types/src/index.ts` (~300-335); `GET /api/v1/catalog/menu?restaurantId&branchId`.
- Rutas actuales: `apps/api/src/captures.controller.ts` — `@Controller("captures")` con `POST tray|/|autosave|workspace|hold|customer|fulfillment|delivery-instructions|confirm|claim|resume|transfer|takeover|recovery-preference|assignment-candidates`. Servicio: `apps/api/src/captures.ts` (846 líneas: pide rangos o resumen L3 con `tools/agentic/delegate.mjs`, no lo leas completo).
- Web consumidor: `apps/web/src/lib/capture-workspace.ts` (231) `requestCapture` + parsers; `apps/web/src/app/app/capture/capture-workspace.tsx` (741) estado `repeatPreview`/«Preparar N líneas».

## Criterios de aceptación (verificables)
- [ ] Contrato nuevo en `packages/shared-types`: `CaptureSelectionPlanV1 { schemaVersion:1, catalogVersion, lines[{ lineId (uuid generado por cliente), productId, quantity 1..1000, modifierGroups[{groupId, selections[{optionId, quantity}]}], note: string|null (≤200) }] }` con parser exacto que rechaza (no repara) claves extra, duplicados de `lineId`/`groupId`, cantidades no enteras. Comando `ReplaceCaptureSelectionPlanCommandV1` versionado como el resto (`captureDraftId`, `expectedVersion`, `attentionLeaseId`, `idempotencyKey`, `eventId`, `deviceId`, `occurredAt`, scope) que reemplaza el plan completo (semántica idempotente: mismo `idempotencyKey` → mismo resultado, sin duplicar).
- [ ] `POST /api/v1/captures/selection-plan` (misma convención que `customer`/`fulfillment`): valida sesión, membership y scope; carga catálogo publicado de la sucursal; rechaza `409` si `catalogVersion` no es la vigente, producto/opción inactivos o fuera del catálogo, o si viola `minimumQuantity/maximumQuantity` del grupo; cotiza cada línea con `createMenuProductPriceSnapshot`; persiste el plan con CAS (`expectedVersion`) y devuelve el workspace actualizado.
- [ ] El workspace (`CaptureWorkspaceV3` o versión nueva si el cambio de forma lo exige; mantener compatibilidad de los parsers web existentes) expone `selectionPlan` con, por línea: `lineId, productId, productName, quantity, unitPriceMinor, lineTotalMinor, modifiers[{groupId, optionId, name, unitPriceMinor, quantity}], note` y `totals { currency, subtotalMinor, lineCount }`. Nombres y precios son snapshot del servidor, nunca del cliente.
- [ ] `confirm` materializa la Order desde el plan de selección cuando exista (excluyente con el plan de repetición: cargar uno invalida el otro y queda auditado), usando `createMenuProductPriceSnapshot` + `addOrderItem` y `derivedUuid` con `lineId` en lugar de `sourceOrderItemId`. Si el catálogo cambió de versión entre plan y confirm → `409` explicable, nunca reprecio silencioso.
- [ ] Persistencia: preferir generalizar `app.capture_repeat_order_plans` (p. ej. `plan_kind text check in ('repeat','selection')`, `customer_id` nullable para `selection`, `source_order_id` nullable) sobre una tabla nueva. Toda modificación va en una **migración nueva candidata** `supabase/migrations/20260928000100_capture_selection_plan.sql` reproducible desde cero, con funciones `app_private` para upsert y con la función de confirm adaptada. No editar migraciones aplicadas. No aplicar en remoto: sólo verificar en PostgreSQL local desechable (patrón del reviewer S7.1b) y dejar listo un verificador rollback-only si el patrón existente lo permite (`apps/api/package.json` scripts `verify:*:rollback`).
- [ ] Pruebas: unitarias del parser (shared-types) y de la materialización (api, extender `capture-repeat-order-plan.test.ts`), integración/verificador SQL rollback-only o `supabase/tests` con: aislamiento entre restaurantes/sucursales (plan de otra sucursal → rechazado), idempotencia (mismo comando dos veces → una versión), CAS (expectedVersion viejo → 409), catálogo cambiado → 409, y confirm que produce Order con `n` ítems y snapshots congelados.
- [ ] `pnpm --filter @super-restaurant/shared-types test|typecheck|lint`, `pnpm --filter @super-restaurant/api test|typecheck|lint|build`, `pnpm --filter @super-restaurant/web typecheck` (no debe romper los parsers web) en verde.
- [ ] CodeGraph reconsultado al final: sin referencias rotas a `CaptureWorkspaceV3`, `materializeCaptureOrder`, `requestCapture`.

## Invariantes que NO deben cambiar
- dinero en minor units enteros + ISO; el cliente nunca envía precios ni nombres, sólo ids y cantidades;
- Order/OrderItem sólo se escriben desde NestJS; snapshots congelados en OrderItem;
- scope Restaurant/Branch en toda consulta y mutación SQL y en el controlador; RLS/funciones `app_private` como hasta ahora;
- parsers exactos que rechazan, nunca corrigen; `exactRecord`/`own` de `commercial-capture.ts`;
- toda mutación registra actor, sucursal, dispositivo, occurredAt, idempotencyKey y evento de auditoría (`capture.autosaved` o nuevo `capture.selection_replaced` si añades tipo, con su CHECK en SQL);
- las rutas y contratos existentes (`repeat`, `confirm` V2, `workspace`) siguen funcionando para el plan de repetición; el flujo «repetir pedido» no se rompe;
- no hay float, no hay `any`, no hay `Math.random` para ids en servidor.

## Fuera de alcance
- UI web (la hace Codex después con este contrato); Mobile; KDS.
- Fracciones/mitades de pizza (S5.1 `packages/domain` ya resuelve precios de fracciones; si `createMenuProductPriceSnapshot` no las soporta, déjalo documentado como brecha, no lo implementes aquí).
- Descuentos, propinas, impuestos nuevos, pagos, caja.
- Aplicar la migración en remoto (requiere autorización de Emmanuel).

## Verificación
Comandos exactos, pegar salida literal:
- `pnpm --filter @super-restaurant/shared-types test && pnpm --filter @super-restaurant/shared-types typecheck && pnpm --filter @super-restaurant/shared-types lint`
- `pnpm --filter @super-restaurant/api test && pnpm --filter @super-restaurant/api typecheck && pnpm --filter @super-restaurant/api lint && pnpm --filter @super-restaurant/api build`
- `pnpm --filter @super-restaurant/web typecheck`
- migración: aplicar desde cero las migraciones + la nueva en un PostgreSQL 17 desechable (ver HANDOFF «Ronda tres del harness» para el patrón del reviewer) y correr `supabase/tests` si aplica; pegar el resumen.
- Node 24 y pnpm 11 en `%LOCALAPPDATA%\Programs\node24` (primero en PATH).

## Entorno de trabajo
- Worktree ya creado por el orquestador: `C:\tmp\sr-wt\api-capture-lines`, rama `claude/api-capture-lines` desde `main`. Trabaja sólo ahí. Commits locales convencionales (`feat(api): ...`, `feat(shared-types): ...`, `feat(supabase): ...`); sin push, sin merge, sin tocar Supabase remoto.
- Usa `mcp__codegraph__codegraph_explore` antes de editar y al terminar. Archivos >300 líneas: rangos.

## Formato de salida esperado
1. Resumen de cambios (3-6 líneas) y decisiones tomadas (forma final del contrato, estrategia de persistencia).
2. Lista de archivos tocados y commits.
3. Salida literal de los comandos de verificación.
4. Riesgos o dudas abiertas (en particular: brechas del snapshot con fracciones; si la migración toca la función de confirm aplicada, plan de rollback).
No pegues diffs completos; el orquestador los lee con `git diff main...claude/api-capture-lines`.
