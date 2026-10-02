# web-capture-feedback

## Tarea
web-capture-feedback · capa: L2 (Codex) · riesgo: moderado · nivel C (`apps/web/src/app/app/capture/*`, `apps/web/src/lib/capture-*`). Sin cambios en `apps/api`, `packages/*` ni SQL; si un criterio exige un dato que el API no devuelve, se reporta como hallazgo con archivo:línea y se deja el resto hecho. Lote `lote-feedback-20261001` (e) y (f): hallazgos #9 #10 #11 #14 #16 #17 #18 #19 #20 #21 #22 #23 #24. Base: `main` ya con `web-money-pesos` integrado (usar `formatMinorUnits` y `parseMoneyInputToMinor`).

## Objetivo
Que la captura telefónica se sienta como una pantalla de operador: pasos en orden lógico, cada acción responde con éxito o error, el cambio se ve, convertir en orden no exige elegir turno, los borradores se reconocen por cliente, y armar o editar un producto muestra el precio mientras se construye.

## Hechos verificados (main 7047fbe)
- `capture-workspace.tsx:969-976` botón «Guardar instrucciones» con `disabled={locked}` sin `busy`; el único feedback es el aviso genérico «Guardando en el servidor…» (`:740-746`) compartido por todas las operaciones; no hay confirmación de éxito ni error específico. `saveDeliveryInstructions` en `:521-527`.
- `capture-payment.tsx:131-139` botones de método con `disabled={busy}` pero sin estado ni resultado visible; `chooseMethod` `:74-77`; `setPaymentIntent` en `capture-workspace.tsx:560-579`; el 409 `CAPTURE_PAYMENT_INTENT_INSUFFICIENT` deja nota local (`:574`).
- Cambio: `capture-payment.tsx:186-187` sólo lo pinta si `projection.method === "cash"` y `changeDueMinor !== null`; `CapturePaymentIntentProjectionV1` (`packages/shared-types/src/capture-payment-intent.ts:127-138`) trae `changeDueMinor`. Verificar en navegador/red qué llega; si llega `null` con efectivo ≥ total, reportar como hallazgo del API.
- Turno: `capture-workspace.tsx:1057-1077` select «Turno abierto» alimentado por `getCaptureConfirmationContext` (`apps/web/src/lib/capture-confirmation-context.ts:20-41`, `GET /shifts/active`); `confirmCapture` (`:586-599`) bloquea si `selectedShiftId === ""`. El texto «Guarda un cliente y una dirección validada…» aparece aunque haya cliente.
- Borradores recuperables: la bandeja (`CaptureWorkTrayResultV1`, ver `capture-workspace.tsx` ~`:254` y `lib/capture-workspace.ts`) se pinta con IDs; revisar qué campos trae (cliente, teléfono, `updatedAt`, canal) y usarlos.
- Lease: mensaje «La captura cambió en otra estación o el lease venció» (buscar `lease` en `capture-workspace.tsx`); revisar duración y si existe renovación (`attentionLeaseId`, endpoint de heartbeat/renovación).
- Armado de producto: `product-sheet.tsx` (modal); el precio sólo se actualiza al aceptar; no hay edición de una línea ya armada; el botón «Agregar» de modificadores tiene fondo y texto blancos (revisar clases).
- Decisiones de Emmanuel del 2026-10-01: «Transferir a otro operador» sale del flujo a un menú «Más»; «Sin venta» pasa a «Cancelar» (técnicamente sigue siendo `close_capture_no_sale` con motivo); el operador nunca elige turno.

## Criterios de aceptación (verificables)
- [ ] **Orden de pasos** (#11): 1 Cliente → 2 Menú → 3 Entrega (dirección e instrucciones) → 4 Cobro → 5 Confirmar. Las instrucciones de entrega viven dentro del paso 3, después del cliente.
- [ ] **Resultado visible en toda acción** (#19 #20 #21): guardar instrucciones, elegir método, montos (exacto/100/200/500/otro) y propina muestran estado «Guardando…» en el propio botón o campo y, al terminar, «Guardado» (2 s) o el error concreto junto al control. Ningún botón vuelve a su estado sin decir nada. Un helper puro `actionFeedback(state)` con prueba si simplifica.
- [ ] **Cambio visible** (#22): con efectivo y monto ≥ total, se muestra «Cambio: $X.XX» desde `changeDueMinor`; si el API devuelve `null` en ese caso, mostrar «Sin cambio calculado» y reportar hallazgo con la respuesta de red.
- [ ] **Convertir en orden** (#23): sin select de turno. Si `/shifts/active` devuelve exactamente un turno, se usa; si varios, se usa el más reciente y se muestra cuál («Turno: Matutino»); si ninguno, el botón se deshabilita con «No hay turno abierto» y un enlace a la pantalla donde se abre (localizarla: caja o turnos). Los mensajes de requisitos son verdaderos: si ya hay cliente no se pide cliente; se listan sólo los que faltan.
- [ ] **Borradores por cliente** (#9): cada borrador muestra nombre y teléfono del cliente (o «Sin cliente»), canal, hora en zona del restaurante y total si existe; el ID desaparece de la vista (puede quedar como `title`). Si la bandeja no trae cliente, reportar hallazgo con el contrato y dejar el resto.
- [ ] **Lease** (#24): texto en español operativo («Otra estación tomó esta captura» o «Se venció tu tiempo de atención; vuelve a tomarla») con botón «Retomar»; si existe renovación en el API, renovar automáticamente mientras la pestaña está activa y el operador interactúa (cada N segundos, N < duración del lease); si no existe, reportar hallazgo.
- [ ] **Precio tentativo en vivo** (#16): dentro de `product-sheet.tsx`, mientras se eligen tamaño/ingredientes se muestra «Estimado: $X.XX» sumando los `unitPriceMinor` que el release ya entregó (suma de enteros, etiquetada como estimado); el precio definitivo sigue viniendo del servidor al agregar. Helper puro con prueba.
- [ ] **Editar línea armada** (#17): desde el ticket, «Editar» abre la hoja con la configuración actual y al aceptar reemplaza la línea (si el API sólo permite quitar y agregar, hacerlo en ese orden en una sola acción de UI con feedback; reportar si no hay forma).
- [ ] **Copy y menú** (#18 #10): «Dejar en espera» → «Guardar para después» con ayuda «Se conserva para retomarla»; «Sin venta» → «Cancelar» con motivo obligatorio y ayuda «Queda registrada como cancelada»; «Transferir a otro operador» pasa a un menú «Más».
- [ ] **Botón «Agregar»** (#14) legible: fondo primario y texto en contraste, 44 px.
- [ ] Sin `alert/confirm/prompt`; 390×844 sin scroll horizontal; consola limpia.

## Invariantes
Servidor decide permisos, totales y transiciones; el estimado es sólo visual; contratos intactos; sin SQL.

## Fuera de alcance
API, SQL, fotos, mesas, caja.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
1. Resumen. 2. Archivos tocados. 3. Salida literal. 4. Hallazgos del API (contrato y línea) y dudas. Sin diffs. No hagas commit: el orquestador commitea tu worktree.
