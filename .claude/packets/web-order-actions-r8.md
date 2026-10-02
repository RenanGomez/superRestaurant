# web-order-actions-r8 (addendum; hallazgo Codex ronda 7, log `.claude/runs/web-order-actions/review-r7.log`)

## Tarea
web-order-actions-r8 · capa: L1 (`implementer-claude`, mismo escritor) · riesgo: bajo · nivel B (`apps/api/src/orders.ts` sendToKitchen). Sin SQL ni contrato.

## Objetivo
[P2] `orders.ts:473-477`: si otro operador cancela todas las líneas seleccionadas entre la carga del detalle y la petición, los ids siguen perteneciendo a la orden, el borrador se abre y el bucle no envía nada: queda una cuenta abierta vacía por una acción obsoleta.

## Criterios de aceptación
- [ ] Antes del paso `open`: si `stored.order.status === "draft"` y ninguna línea listada en `command.orderItemIds` está `pending`, lanzar `applicationError("conflict")` sin persistir nada. Si la orden ya no es borrador (p. ej. reintento tras abrirla este mismo comando) el comportamiento actual se mantiene (bucle sin envíos → resumen sin mutación).
- [ ] Prueba en `orders.test.ts`: borrador con línea A listada; A cancelada por otro actor antes del envío → `conflict`, la orden sigue `draft` y sin eventos nuevos. Las pruebas existentes de reanudación siguen verdes.
- [ ] Comentario de cabecera actualizado con la regla en una línea.
- [ ] Puertas: `pnpm --filter @super-restaurant/api test && typecheck && lint`. Commit `fix(api): …`.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.ts (425-500), apps\api\src\orders.test.ts (560-720).

## Invariantes
Servidor decide; sin mutaciones vacías por acciones obsoletas; reintento byte-idéntico reanuda; contratos intactos.

## Formato de salida
Resumen, hash, resultado final de cada puerta, riesgos.
