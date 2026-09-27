# api-capture-lines · subunidad 4: correcciones de revisión doble

## Tarea
api-capture-lines-4-review-fixes · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A. Rama `claude/api-capture-lines` (HEAD `a5d2fa8`). Cierra los hallazgos de `codex exec review --base main` y del reviewer Sonnet sobre la rama completa.

## Hallazgos de Codex (obligatorios)
1. **[P1] Workspace público sin V4** — `apps/api/src/captures.controller.ts:114-120`. `POST /captures/workspace` sólo acepta peticiones V1–V3; tras guardar una selección y recargar, el cliente recibe `repeatOrderPlan: null` y no recupera líneas ni proyección. Acepta el comando de lectura V4 (añade `schemaVersion: 4` al parser del comando de workspace en shared-types si el comando lleva versión; si no, versiona por campo), enruta a `read_capture_workspace_v4`, adjunta `selectionProjection` calculada contra el catálogo vigente y devuelve `CaptureWorkspaceV4`. `apps/web/src/lib/capture-workspace.ts` pide V4 en la operación `workspace`. V3 sigue disponible para clientes viejos.
2. **[P2] Selección vacía bloquea confirm** — `apps/api/src/capture-repeat-order-plan.ts:98-100`. `lines: []` persiste una fila vacía y `materializeCaptureSelectionOrder` la rechaza. Decisión: un plan con 0 líneas se trata como «sin plan»: `replace_capture_selection_plan` con 0 líneas borra la fila (auditado) en lugar de guardarla; la API y el SQL de confirm siguen la ruta de orden sin líneas como antes. Prueba SQL y unitaria.
3. **[P2] Replay idempotente devuelve 503** — `apps/api/src/captures.ts:711-712`. Cuando SQL devuelve `replayed`, el servicio exige `version === expectedVersion + 1`. Maneja `replayed` devolviendo el resultado almacenado sin condicionarlo a la versión actual, como hace la ruta de `repeat`. Prueba: replay tras otra mutación → 200 con el resultado original.
4. **[P2] La nota de línea se pierde** — `apps/api/src/capture-repeat-order-plan.ts:105-110`. Comprueba con CodeGraph si `OrderItem`/`addOrderItem` (`packages/domain/src/order.ts`) ya tiene campo de nota/instrucción. Si existe, llévala en la materialización y en el snapshot; si no existe, rechaza `note !== null` en `replace` con 409 `CAPTURE_SELECTION_NOTE_UNSUPPORTED` y documenta la brecha (no ampliar el dominio Order en esta rama).

## Hallazgos del reviewer Sonnet
(Se adjuntan al final del paquete por el orquestador; si la sección está vacía, sólo aplica lo anterior.)

## Criterios
- [ ] Pruebas nuevas para cada hallazgo (api unit/controller, fixture SQL cuando aplique).
- [ ] `pnpm --filter @super-restaurant/shared-types test|typecheck|lint|build`; `pnpm --filter @super-restaurant/api test|typecheck|lint|build`; `pnpm --filter @super-restaurant/web test|typecheck|lint|build`; verificador PG local `--local-disposable-only` en verde.
- [ ] Commits convencionales por hallazgo. Sin push. Informe parcial antes de agotar turnos.

## Entorno
Worktree `C:\tmp\sr-wt\api-capture-lines`; Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; PG17 en `.cache/postgres-local/pgsql`.
