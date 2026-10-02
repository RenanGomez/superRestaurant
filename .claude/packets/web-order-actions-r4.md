# web-order-actions-r4 (cierre de hallazgos Codex ronda 3)

## Tarea
web-order-actions-r4 · capa: L1 (`implementer-claude`) · riesgo: moderado · nivel B (API `apps/api/src/orders.ts` + contrato `SendOrderToKitchenCommandV1` consumido sólo por web; sin SQL, sin dinero nuevo) + nivel C (panel `order-detail-panel.tsx`).

## Objetivo
Cerrar los dos hallazgos pendientes de `codex exec review` sobre la rama `claude/web-order-actions` (HEAD `1bfd0c1`) sin reabrir el diseño ya aprobado por Sonnet: (P1) un reintento de `sendToKitchen` nunca debe enviar a cocina líneas que otro operador añadió después del intento original; (P2) si la recarga del detalle falla tras una acción, el panel no debe seguir mostrando un detalle obsoleto con acciones habilitadas.

## Criterios de aceptación (verificables)
- [ ] **P1 · contrato**: `SendOrderToKitchenCommandV1` (`packages/shared-types/src/orders.ts:128-133`, parser `parseSendOrderToKitchenCommandV1` `:574-583`) añade `orderItemIds: readonly string[]` (UUIDs, no vacío, sin duplicados, parser exacto que rechaza cualquier otra forma). El contrato aún no está en `main`, así que no hay compatibilidad hacia atrás que preservar; web es el único consumidor. Pruebas en `packages/shared-types/src/orders.runtime.test.ts` (parsea; rechaza vacío, duplicado, no-UUID, clave extra).
- [ ] **P1 · API** (`apps/api/src/orders.ts:446-490`, `sendToKitchen`): el conjunto de líneas a enviar es exactamente `command.orderItemIds`, fijado por el primer intento y por tanto idéntico en el reintento (los ids de paso ya se derivan del comando con `derivedUuid`, conservar). Reglas: cada id debe pertenecer a la orden, si no `not_found`; una línea listada que ya no está `pending` (enviada por este mismo comando en un intento anterior, o cancelada por un tercero) se omite como hoy; una línea `pending` que **no** está en la lista nunca se envía por este comando. Mantener `stored.version < command.expectedVersion → conflict` y el paso `open` si sigue en `draft`. Actualizar el comentario de cabecera para que describa la regla nueva (no sólo «no hard-fail»).
- [ ] **P1 · pruebas** (`apps/api/src/orders.test.ts`, junto a `:569-645`): (a) reintento tras respuesta perdida con una línea añadida por otro actor entre ambos intentos → la línea ajena sigue `pending`, el resto queda `sent`, sin `conflict`; (b) un id ajeno a la orden → `not_found`; (c) las pruebas existentes de `sendToKitchen` se adaptan al nuevo campo.
- [ ] **P1 · web**: `sendToKitchenAction` (`apps/web/src/app/app/orders/actions.ts:67-81`) acepta y valida `orderItemIds` (UUIDs, no vacío) y los envía; el panel (`order-detail-panel.tsx:~90-96`) manda los ids de las líneas `pending` del detalle que el operador está viendo y los reutiliza, junto con `eventId`/`idempotencyKey`, en el único reintento de `runAction`. Si el detalle no tiene líneas `pending`, el botón «Enviar a cocina» no se ofrece (el servidor ya no lo lista en `availableActions`; verificar y no duplicar lógica en cliente).
- [ ] **P2 · web** (`order-detail-panel.tsx:61-80`): si `load()` falla (en la carga inicial o tras una acción), se limpia `detail` (`setDetail(undefined)`) de modo que ninguna acción quede visible/habilitada, se muestra el error de carga y un botón «Reintentar» (≥44 px) que vuelve a llamar `load()`. El flujo de éxito no cambia. Sin `alert/confirm/prompt`.
- [ ] Helpers puros nuevos (si los hay, p. ej. `pendingOrderItemIds(detail)`) en `apps/web/src/lib/order-detail.ts` con prueba en `order-detail.test.ts`.
- [ ] Commits pequeños por unidad en la rama existente (shared-types → api → web), mensajes conventional commits. Sin cambios ajenos a estos dos hallazgos.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\packages\shared-types\src\orders.ts (líneas 100-145 y 560-600): contrato y parser del comando; patrón `exactRecord`/`uuid`/`integer`.
- C:\tmp\sr-wt\web-order-actions\packages\shared-types\src\orders.runtime.test.ts: pruebas del parser.
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.ts (líneas 425-520): `sendToKitchen`, `persistRaw`, `summaryFromResult`; buscar `derivedUuid` y `stepAuditContext` en el mismo archivo.
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.test.ts (líneas 560-680): pruebas de `sendToKitchen` y de `availableActions`.
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\orders\actions.ts (líneas 1-100): server actions y `parseAttemptIds`.
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\orders\order-detail-panel.tsx (completo, 195 líneas): panel.
- C:\tmp\sr-wt\web-order-actions\apps\web\src\lib\order-detail.ts y order-detail.test.ts: helpers puros.

## Símbolos relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|
| packages/shared-types/src/orders.ts | `SendOrderToKitchenCommandV1`, `parseSendOrderToKitchenCommandV1` | Contrato a extender con `orderItemIds` |
| apps/api/src/orders.ts | `OrdersService.sendToKitchen`, `persistRaw`, `derivedUuid`, `stepAuditContext` | Lógica de lote idempotente; fijar el conjunto de líneas |
| apps/api/src/orders.ts | `detail` / cálculo de `availableActions` | `sendToKitchen` sólo se ofrece con líneas `pending` |
| packages/domain/src/order-state.ts | `transitionOrderItemStatus` | No tocar; el dominio decide la transición |
| apps/web/src/app/app/orders/order-detail-panel.tsx | `OrderDetailPanel`, `load`, `runAction`, `nextAttempt` | P2 y envío de `orderItemIds` |
| apps/web/src/app/app/orders/actions.ts | `sendToKitchenAction`, `parseAttemptIds` | Validación cliente antes del POST |

## Invariantes que NO deben cambiar
- Transiciones y permisos los decide el servidor; la UI sólo envía lo que vio y consume `availableActions`.
- Dinero en minor units + ISO; este cambio no toca totales ni dinero.
- Alcance Restaurant/Branch en toda mutación (`authorize(principal, command.scope, "orders.update")` se conserva).
- Idempotencia: un reintento byte-idéntico replica el mismo resultado; ids de paso derivados del comando.
- Auditoría por línea (un evento por transición) se conserva; no fusionar pasos en una sola mutación.
- Contratos de Mobile/KDS intactos (`OpenOrderCommandV1`, `TransitionOrderItemCommandV1`, `CancelOrderItemCommandV1`).
- Sin `alert/confirm/prompt`; targets ≥44 px; sin scroll horizontal a 390×844.

## Fuera de alcance
- Permiso RBAC `orders.checkout` (P3 de Sonnet, siguiente corte); `fulfillment` del detalle (snapshot V2); informe de parciales del lote; cualquier SQL; tiempo real.

## Verificación
Entorno: worktree `C:\tmp\sr-wt\web-order-actions` (rama `claude/web-order-actions`, ya existente, HEAD `1bfd0c1`). Node 24/pnpm en `%LOCALAPPDATA%\Programs\node24` (anteponer al PATH). Si hace falta `pnpm install --prefer-offline` y construir `packages/domain` y `packages/shared-types` antes de api/web.
```bash
pnpm --filter @super-restaurant/shared-types test && pnpm --filter @super-restaurant/shared-types typecheck && pnpm --filter @super-restaurant/shared-types lint && pnpm --filter @super-restaurant/shared-types build
pnpm --filter @super-restaurant/api test && pnpm --filter @super-restaurant/api typecheck && pnpm --filter @super-restaurant/api lint && pnpm --filter @super-restaurant/api build
pnpm --filter @super-restaurant/web lint && pnpm --filter @super-restaurant/web typecheck && pnpm --filter @super-restaurant/web test && pnpm --filter @super-restaurant/web build
pnpm --filter @super-restaurant/mobile typecheck && pnpm --filter @super-restaurant/kds typecheck
```
Usa CodeGraph (`codegraph_explore`) antes de editar `sendToKitchen` y después para confirmar que ningún otro consumidor del comando quedó roto. Commit por unidad; informe parcial a los ~35 turnos si no has terminado. Sin push, sin remoto, sin Supabase remoto.

## Formato de salida esperado
1. Resumen de cambios (3-6 líneas) y la regla final de P1 en una frase.
2. Lista de archivos tocados y hashes de los commits.
3. Salida literal (resumida al resultado final de cada comando) de la verificación.
4. Riesgos o dudas abiertas.
No pegues diffs completos; el orquestador los lee con `git diff`.
