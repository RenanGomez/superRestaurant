# api-capture-lines · subunidad 3: API, workspace y confirm

## Tarea
api-capture-lines-3-api · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A. Subunidad 3 de 4 del paquete padre `.claude/packets/api-capture-lines.md`. Rama `claude/api-capture-lines` (HEAD `39f8128`): subunidad 1/1b = contrato `packages/shared-types/src/capture-selection-plan.ts`; subunidad 2 = migración candidata `supabase/migrations/20260928000100_capture_selection_plan.sql` + `supabase/tests/capture_selection_plan_invariants.sql` + verificador `apps/api/src/operations/run-capture-selection-plan-schema-verification.ts`.

## Hallazgos de `codex exec review --base main` que esta subunidad DEBE cerrar
1. **[P1] Workspace V3 roto.** `read_capture_workspace_v3` ahora devuelve `selectionPlan` con `schemaVersion: 3`; `parseCaptureWorkspaceV3` (`commercial-capture.ts`) exige exactamente cinco claves y rechazaría toda lectura tras aplicar la migración. Solución preferida: dejar V3 intacto (SQL y parser), añadir `app_private.read_capture_workspace_v4` que devuelva V3 + `selectionPlan` (nullable) con `schemaVersion: 4`, contrato `CaptureWorkspaceV4` + `parseCaptureWorkspaceV4` en shared-types, y que `CaptureService` (API) y `apps/web/src/lib/capture-workspace.ts` lean V4. Edita la migración candidata `20260928000100` (aún no aplicada en ningún sitio, es legítimo modificarla dentro de esta rama) para retirar el cambio sobre `read_capture_workspace_v3` y crear la V4. Si eliges en cambio versionar V3 in-place, justifica y actualiza todos los consumidores (CodeGraph).
2. **[P1] Confirm no materializa el plan de selección.** `CaptureService.confirmDraft` sólo lee `repeatOrderPlan`; con plan de selección construye una Order sin ítems y el SQL devuelve `conflict`. Extiende la materialización: leer el plan de selección (`app_private.read_capture_selection_plan`), cotizar cada línea con `createMenuProductPriceSnapshot` contra el catálogo vigente (`MenuCatalogV1`, `toDomainMenuCatalog`), `addOrderItem` con ids derivados (`derivedUuid` con `lineId` en lugar de `sourceOrderItemId`), y pasar los ítems a `confirm_capture_draft_v3` como hoy. Generaliza `materializeCaptureOrder` (o añade `materializeCaptureSelectionOrder`) sin duplicar la lógica de precios. `variantId` no nulo: si el catálogo legado no tiene variantes, rechaza con `409` (`CAPTURE_SELECTION_VARIANT_UNSUPPORTED`) en vez de ignorarlo; documenta la brecha con el catálogo configurado S5.
3. **[P2] CHECK SQL de líneas.** El CHECK acepta cinco claves por línea; el contrato exige `lineId, productId, variantId, quantity, modifierGroups, note`. Alinea el CHECK y la lógica de confirm con el contrato (claves exactas, `variantId` uuid o null, `note` texto ≤200 o null) y actualiza el fixture de `capture_selection_plan_invariants.sql` para que use la forma real producida por `parseReplaceCaptureSelectionPlanCommandV1` (incluido `variantId: null`).

## Además: endpoint y proyección
- `POST /api/v1/captures/selection-plan` en `apps/api/src/captures.controller.ts` siguiendo `customer`/`fulfillment`: parsea `ReplaceCaptureSelectionPlanCommandV1`, autoriza (`captures.update` + `catalog.read`), carga el catálogo publicado de la sucursal, valida que `plan.catalogVersion` sea la vigente y que cada producto/opción esté activo y dentro de los límites del grupo (`409` tipado si no), llama a `app_private.replace_capture_selection_plan`, y devuelve el workspace V4.
- Proyección `CaptureSelectionPlanProjectionV1` (contrato ya existe): el API la construye desde el plan guardado + catálogo vigente (nombre, `unitPriceMinor`, `lineTotalMinor`, `subtotalMinor`, `lineCount`) y la incluye en la respuesta del workspace V4 como `selectionProjection` (nullable) — añádelo al contrato V4. Precio de línea = snapshot de `createMenuProductPriceSnapshot` × cantidad; nunca sumas en el cliente.
- Web: sólo `apps/web/src/lib/capture-workspace.ts` (parser/cliente) para leer V4 y añadir la operación `selectionPlan` al `requestCapture`; NO tocar `capture-workspace.tsx` ni `actions.ts` más allá de enrutar la operación (la UI la hace Codex en `web-capture-menu-tactil`).

## Criterios de aceptación
- [ ] Pruebas unitarias en `apps/api` (`capture-repeat-order-plan.test.ts` o nuevo): materialización desde plan de selección con 2 líneas y modificadores → Order con 2 ítems y snapshots congelados; `variantId` no nulo → 409; catálogo con versión distinta → 409; producto inactivo → 409; ids de ítem deterministas por `lineId`.
- [ ] Pruebas del controlador/servicio con el patrón existente (`captures.test.ts` o equivalente): autorización por scope, replay idempotente, CAS.
- [ ] `supabase/tests/capture_selection_plan_invariants.sql` actualizado y el verificador local `node dist/operations/run-capture-selection-plan-schema-verification.js --local-disposable-only` en verde (mismo patrón que subunidad 2; binarios PG17 en `.cache/postgres-local/pgsql`, cópialos del repo principal si faltan).
- [ ] `pnpm --filter @super-restaurant/shared-types test|typecheck|lint|build`, `pnpm --filter @super-restaurant/api test|typecheck|lint|build`, `pnpm --filter @super-restaurant/web test|typecheck|lint` en verde.
- [ ] CodeGraph reconsultado: consumidores de `CaptureWorkspaceV3`, `materializeCaptureOrder`, `requestCapture`, `read_capture_workspace_v3` sin referencias rotas.
- [ ] Commits convencionales por unidad (`fix(supabase)`, `feat(shared-types)`, `feat(api)`, `feat(web)`). Sin push.

## Invariantes
- Dinero en minor units; snapshots del servidor; el cliente sólo manda ids y cantidades.
- Scope y membership revalidados en API y SQL; idempotencia y CAS como en `repeat`.
- No relajar ninguna comprobación existente de `confirm_capture_draft_v3` para el plan de repetición; el flujo «repetir pedido» sigue verde (sus pruebas existentes deben pasar).
- No aplicar nada en remoto.

## Entorno
Worktree `C:\tmp\sr-wt\api-capture-lines`. Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`. `captures.ts` tiene 846 líneas: pide rangos con CodeGraph (`confirmDraft`, `readWorkspace`, `repeatCustomerOrder`) en lugar de leerlo entero.

## Formato de salida
Resumen y decisiones (V4 vs V3), archivos y commits, salida literal de todos los comandos (incluido el verificador PG local), riesgos.
