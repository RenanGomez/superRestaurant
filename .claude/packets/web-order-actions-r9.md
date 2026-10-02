# web-order-actions-r9 (addendum; hallazgos Codex ronda 8, log `.claude/runs/web-order-actions/review-r8.log`)

## Tarea
web-order-actions-r9 · capa: L1 (`implementer-claude`, mismo escritor) · riesgo: moderado · nivel B (`apps/api/src/orders.ts` sendToKitchen) + nivel C (foco del diálogo). Sin SQL ni contrato.

## Objetivo
- [P1 api] `orders.ts:467`: un comando nuevo con `expectedVersion` obsoleta (otro operador editó la orden después de cargar el detalle) se acepta y envía las líneas restantes en silencio. Decisión del orquestador: sin búsqueda por clave en SQL no se puede distinguir replay de comando obsoleto por identidad, así que se distingue por *trabajo pendiente*: cuando `stored.version !== command.expectedVersion`, el comando sólo puede ser un reintento ya completado; cualquier trabajo que quede por hacer es conflicto.
- [P2 web] `order-detail-panel.tsx:164-165`: el diálogo no mueve el foco dentro, no lo contiene ni lo devuelve al botón que lo abrió.

## Criterios de aceptación
- [ ] API, regla nueva de `sendToKitchen`: (1) `stored.version < expectedVersion` → `conflict` (igual). (2) `stored.version === expectedVersion` → camino normal (guarda r8 incluida). (3) `stored.version > expectedVersion` → si la orden sigue `draft` o alguna línea listada sigue `pending`, `conflict` sin persistir nada; si la orden ya no es `draft` y ninguna línea listada está `pending` (todas `sent` o posteriores, o canceladas), devolver el resumen sin mutación con `replayed: true` (reintento completado). Actualizar el comentario de cabecera: el lote ya no «reanuda» un intento parcial con versión avanzada; un fallo a mitad devuelve `unavailable` al cliente, que recarga y reenvía con versión nueva y las líneas aún pendientes.
- [ ] Pruebas en `orders.test.ts`: (a) tercero cancela una de dos líneas listadas tras capturar la versión → `conflict`, ninguna línea enviada; (b) reintento byte-idéntico tras éxito total → `replayed: true`, sin eventos nuevos; (c) adaptar la prueba «resumes a partially-applied batch on retry» al nuevo comportamiento (ahora `conflict` y, tras recargar con la versión nueva y las líneas pendientes, éxito). Mantener verdes las demás.
- [ ] Web, diálogo accesible sin dependencias nuevas: al abrir, foco al contenedor del diálogo (`tabIndex={-1}`) o al primer control; `Tab`/`Shift+Tab` contenidos dentro del diálogo (helper puro `nextFocusIndex(count, index, shift)` o similar en `lib/order-detail.ts` con prueba, o un pequeño `useFocusTrap` en el componente); `Escape` cierra; al cerrar, el foco vuelve al elemento que tenía el foco al abrir (guardar `document.activeElement` en un ref). `aria-modal` ya existe. Sin alert/confirm/prompt; targets ≥44 px.
- [ ] Puertas: `pnpm --filter @super-restaurant/api test && typecheck && lint`; `pnpm --filter @super-restaurant/web lint && typecheck && test && build`. Commits `fix(api): …` y `fix(web): …`.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.ts (425-505), apps\api\src\orders.test.ts (560-760).
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\orders\order-detail-panel.tsx (completo), apps\web\src\lib\order-detail.ts y test.
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\orders\orders-tray.tsx: cómo se abre el panel (botón «Detalle»), para devolver el foco.

## Invariantes
Servidor decide; ninguna acción obsoleta se aplica en silencio; reintento nunca duplica; sin dinero; sin SQL; contratos de Mobile/KDS intactos.

## Fuera de alcance
Persistir el payload del comando (deuda A); RBAC `orders.checkout`; `fulfillment` V2.

## Formato de salida
Resumen con la regla final en una frase, hashes, resultado final de cada puerta, riesgos.
