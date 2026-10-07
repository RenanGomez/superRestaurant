# web-capture-confirm-send-kitchen · «Enviar a cocina» en un toque tras confirmar la captura

## Tarea
web-capture-confirm-send-kitchen · **nivel C** (Codex L2, `-Base main`). Ritmo: operación (dos o tres toques). Brecha detectada por el flujo HTTP local y confirmada por researcher el 2026-10-06.

## Objetivo
Tras «Convertir captura en orden» con 200, la pantalla de captura muestra el resultado con la orden creada y un botón grande «Enviar a cocina» que envía todas las líneas pendientes con el comando atómico existente, muestra el resultado («Enviada a cocina · 4 líneas», o el conflicto en texto claro) y ofrece «Nueva captura» (atajo N) y «Ver orden». No se toca el API.

## Hechos verificados
- `apps/web/src/app/app/capture/capture-workspace.tsx:744-758` `confirmCapture()` sólo llama a `run("confirm", …)`; la Order nace `draft`; sin `send-to-kitchen` no entra al KDS ni a «Por asignar».
- `POST /orders/send-to-kitchen` (atómico, idempotente por comando; `orderItemIds` de líneas pendientes, `expectedVersion`) ya lo usa `/app/orders` (`apps/web/src/app/app/orders/*`, server action en `actions.ts`, helper `buildSendToKitchenCommand` o similar en `apps/web/src/lib/order-detail.ts`) y el detalle `POST /orders/detail` da `availableActions` y los ids de línea.
- PROJECT_NOTES 2026-10-01 «Envío a cocina atómico»: envío explícito, no automático. Mantener: es un toque del operador, no automático.

## Criterios de aceptación
- [ ] Captura → confirmar → «Enviar a cocina» (1 toque) → mensaje de éxito con número de líneas; replay seguro (botón deshabilitado mientras envía; segundo toque no duplica).
- [ ] Conflicto (versión distinta, línea ya enviada) se muestra en texto claro y ofrece «Ver orden».
- [ ] Reutiliza el helper/acción existentes de `/app/orders`; sin lógica nueva de dominio; sin alert/confirm; targets 44 px; 390×844.
- [ ] Helper puro con prueba: construir el comando desde el detalle (líneas pendientes) y decidir el texto de resultado.
- [ ] Puertas: `pnpm --filter @super-restaurant/web lint && typecheck && test && build`.

## Invariantes
Sin tocar apps/api ni SQL; el servidor decide; sin push.

## Formato de salida
Resumen (toques), archivos, salida literal, riesgos.
