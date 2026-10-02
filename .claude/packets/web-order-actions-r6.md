# web-order-actions-r6 (addendum; hallazgos Codex ronda 5, log `.claude/runs/web-order-actions/review-r5.log`)

## Tarea
web-order-actions-r6 · capa: L1 (`implementer-claude`, mismo escritor) · riesgo: moderado · nivel B (`apps/api/src/orders.ts` sendToKitchen, derivación de claves) + nivel C (panel). Sin SQL ni cambio de contrato.

## Objetivo
- [P2 api] `orders.ts:465-470`: si un cliente reenvía el mismo `eventId`/`idempotencyKey` con una lista `orderItemIds` distinta, las ids nuevas reciben claves derivadas nuevas y se envían. Decisión del orquestador: sin payload persistido del comando (deuda nivel A: búsqueda por clave de idempotencia) no es posible rechazar el reenvío con lista distinta de forma completa; en este corte se liga cada clave derivada de paso a la huella del comando completo, de modo que un reenvío con lista distinta nunca comparte pasos con el original, y se documenta explícitamente la limitación.
- [P2 web] `order-detail-panel.tsx:99-108`: si la server action rechaza (promesa rechazada por transporte) en vez de devolver `{ok:false}`, `runAction`, `runSendToKitchen` y la carga inicial dejan `busyAction` puesto y el panel sin recuperación.

## Criterios de aceptación
- [ ] API: `stepAuditContext`/`derivedUuid` para los pasos de `sendToKitchen` incorporan una huella canónica del comando: `orderId`, `expectedVersion` y `orderItemIds` ordenados (sorted, unidos con un separador fijo), además del nombre del paso. Resultado: dos comandos con la misma clave y lista distinta derivan claves distintas en todos sus pasos y nunca replican pasos ajenos. Prueba: mismo `idempotencyKey` con lista {A} y luego {A,B} → los pasos de B tienen claves distintas de cualquier paso del primer comando; y el reintento byte-idéntico sigue reanudando sin conflicto (pruebas existentes verdes). Comentario de cabecera: añadir párrafo «Limitación: el payload del comando no se persiste; un cliente que reutilice la clave con otra lista no es rechazado, sólo aislado; el cliente web acuña clave y lista juntas por intento».
- [ ] Web: `load`, `runAction` y `runSendToKitchen` envuelven las llamadas a server actions en `try/catch`; una promesa rechazada se trata como `unavailable` (mismo mensaje y recarga del detalle); `busyAction` se limpia en `finally` en todos los caminos; la carga inicial que rechaza muestra el error con «Reintentar». Prueba unitaria sólo si existe un helper puro afectado; si no, describir el camino manual en el informe.
- [ ] Puertas: `pnpm --filter @super-restaurant/api test && typecheck && lint`; `pnpm --filter @super-restaurant/web lint && typecheck && test && build`.
- [ ] Commits `fix(api): …` y `fix(web): …` en `claude/web-order-actions`.

## Archivos de entrada
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.ts (líneas 425-500 y las definiciones de `derivedUuid`/`stepAuditContext`).
- C:\tmp\sr-wt\web-order-actions\apps\api\src\orders.test.ts (560-700).
- C:\tmp\sr-wt\web-order-actions\apps\web\src\app\app\orders\order-detail-panel.tsx (completo).

## Invariantes
Servidor decide; un reintento nunca duplica; sin dinero; sin SQL; contratos de Mobile/KDS intactos; sin alert/confirm/prompt.

## Fuera de alcance
Persistir el payload del comando (migración nivel A); RBAC `orders.checkout`; `fulfillment` V2.

## Formato de salida
Resumen, archivos y hashes, resultado final de cada puerta, riesgos.
