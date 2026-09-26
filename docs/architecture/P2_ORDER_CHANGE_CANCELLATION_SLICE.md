# P2 S6 — Cambios, eliminación y cancelación de líneas

Estado: S6.0 y clasificador puro S6.1a implementados; integración productiva `BLOCKED` por decisiones operativas enumeradas.

Fecha: 2026-09-25.

## 1. Objetivo

Este slice separa tres operaciones que no son equivalentes:

1. **eliminar del borrador**: retirar una selección que todavía no creó una línea de `Order` ni llegó a producción;
2. **cambiar una línea**: conservar la historia de la versión anterior y materializar una sustitución explícita;
3. **cancelar una línea confirmada**: transición inmutable a `cancelled`, con motivo, autorización contextual y efectos correctivos.

La implementación no puede borrar una línea histórica, mutar su snapshot ni recalcularla desde el catálogo vigente. Tampoco puede inferir reembolsos, movimientos de inventario o reglas comerciales de merma.

## 2. Autoridades existentes confirmadas

CodeGraph y la inspección dirigida confirman que el repositorio ya tiene una base parcial, que debe extenderse en lugar de duplicarse:

- `packages/domain/src/order-state.ts` permite `pending|sent|preparing|ready → cancelled`; exige autorización desde `sent` y conserva `OrderItemCancellationAudit`;
- `packages/domain/src/order.ts` materializa la cancelación como nueva versión inmutable de `Order` y excluye líneas canceladas de los totales;
- `packages/shared-types/src/orders.ts` define el comando exacto `CancelOrderItemCommandV1`; el cliente no puede enviar evidencia de autorización;
- `apps/api/src/orders.ts` deriva el permiso `orders.cancel.pending` o `orders.cancel.sent` desde el estado persistido y enlaza al actor autenticado;
- `app_private.persist_order_item_cancellation` guarda `Order`, auditoría y evento KDS durable en una sola transacción e impide alterar otros campos;
- pagos simples están vinculados a `Order`, pero todavía no existe refund/void operativo para compensar una línea;
- no existe aún `packages/printing` ni un outbox de impresión; KDS es el único canal correctivo productivo actual;
- no existe todavía autoridad de recetas/consumo de inventario que permita calcular una reversa exacta.

## 3. Matriz normativa del slice

| Momento | Operación pública | Historia | Producción | Dinero | Inventario |
|---|---|---|---|---|---|
| selección en Capture, antes de confirmar | eliminar | evento de Capture y nueva versión; no crear `OrderItem` | ninguna corrección | recalcular sólo el borrador | sin movimiento |
| `OrderItem.pending`, antes de envío | cancelar o sustituir | línea original queda `cancelled`; reemplazo usa ID y snapshot nuevos | no imprimir/KDS correctivo si nunca fue liberada | permitido sólo sin pago capturado | sin reversa si no hubo consumo |
| `sent` | cancelar o sustituir | motivo y autorización; vínculo explícito original→reemplazo | evento correctivo KDS e impresión con identidad idempotente | bloquear si requiere compensación no creada | aplicar política de reserva/consumo decidida |
| `preparing` o `ready` | cancelar o sustituir | motivo, autorización reforzada y resultado operativo | corrección prioritaria a cada destino confirmado | bloquear si requiere compensación no creada | merma/reversa sólo según política decidida |
| `delivered` | devolución/ajuste, no cancelación | preservar venta origen | no retroceder estado de cocina | refund/compensación vinculada | movimiento compensatorio, nunca borrado |
| `partially_paid` o `paid` | compensación financiera, no mutación silenciosa | operación separada e idempotente | corrección sólo si producción aún aplica | refund/void/saldo explícito | efecto ligado a la operación compensatoria |

`Eliminar` sólo existe antes de que haya una línea histórica. Después de confirmar, incluso `pending` se conserva como cancelación auditada. `Cambiar` se modelará como cancelación de la línea original más alta de una línea nueva, ambas ligadas por una sola operación; nunca como edición destructiva.

## 4. Entregas técnicas

### S6.1 — política pura y contratos

- **S6.1a implementado:** `assessOrderItemChangeImpact` deriva `eligible | blocked` desde operación, estado de línea/orden, monto capturado y compromiso de inventario. Expone por separado autorización, producción, dinero, inventario y decisiones de política aún requeridas; no ejecuta ni autoriza una mutación;
- publicar el resultado mediante un contrato de transporte exacto sólo cuando exista un consumidor autorizado;
- enumerar por separado efectos `production`, `financial` e `inventory`;
- exigir motivo y autorización según la matriz, sin aceptar autorización del cliente;
- crear identidad idempotente común para la operación y sus efectos, incluida sustitución;
- probar doble envío, actor/scope ajeno, versiones obsoletas y objetos hostiles.

El clasificador puro rechaza campos extra, accessors, prototipos y proxies hostiles; congela toda salida y bloquea explícitamente líneas ya canceladas, entregadas, órdenes terminales y casos con compensación financiera pendiente. No selecciona rol, destino de producción, tratamiento de inventario ni atomicidad financiera.

### S6.2 — borrador Capture

- añadir/eliminar/reemplazar selecciones configuradas mediante lease, CAS y journal Capture;
- no producir KDS, impresión, pago ni inventario;
- restaurar exactamente el borrador tras recarga.

### S6.3 — corrección de producción

- evolucionar el evento durable actual a una corrección con tipo, motivo, línea origen y, cuando aplique, línea reemplazo;
- fan-out idempotente a KDS y al futuro adaptador de impresión;
- registrar por destino `pending | delivered | failed` para permitir reintento selectivo y evitar duplicados;
- nunca considerar una impresión exitosa como sustituto de la recuperación durable KDS.

### S6.4 — compensaciones

- integrar refund/void/saldo sólo después de que la autoridad financiera de P2 exista;
- integrar reserva, consumo, merma y reversa sólo después de que recetas/inventario definan su autoridad;
- persistir movimientos compensatorios inmutables; no editar pagos ni movimientos originales.

### S6.5 — UX y aceptación

- mostrar al operador qué ocurrió, qué destino recibió la corrección y qué compensación queda pendiente;
- confirmar acciones destructivas dentro de la aplicación y exigir motivo cuando corresponda;
- ejercer al menos: eliminar antes de cocina, cambiar enviado, cancelar preparando, reintento correctivo y cancelación con pago capturado bloqueada/compensada.

## 5. Decisiones humanas que bloquean S6.1/S6.3

Antes de codificar la política posterior al envío se requieren respuestas explícitas para Vittorinos:

1. ¿Quién puede cancelar una línea `sent`, `preparing` y `ready`: supervisor, gerente o ambos?
2. ¿En qué estado se cobra, se desperdicia o se devuelve inventario, y quién confirma la merma?
3. ¿Un cambio enviado siempre crea línea reemplazo o puede terminar sólo en cancelación?
4. ¿Qué destinos de impresión existen y cuál es la precedencia entre KDS, impresora y reimpresión manual?
5. ¿Qué debe ocurrir si KDS confirma pero la impresora falla, o viceversa?
6. ¿Se permite cancelar con pago parcial/completo antes del refund, o la compensación debe completarse atómicamente?

Hasta resolverlas, el comportamiento seguro existente se conserva: cancelación de `draft/open` solamente, autorización server-side para líneas enviadas, evento KDS durable y rechazo de órdenes `partially_paid|paid`. No se afirmará soporte de impresión, devolución o inventario.

## 6. Criterios de salida

- eliminar, cambiar y cancelar tienen contratos y auditorías distintos;
- ninguna línea confirmada se borra o reescribe;
- KDS e impresión reciben correcciones idempotentes por destino;
- permisos y scope se derivan en servidor;
- dinero e inventario siempre declaran `none`, `pending` o una compensación identificable;
- reintento no duplica línea, evento, impresión, refund ni movimiento;
- pruebas cubren antes/después de cocina, pago, aislamiento y recuperación parcial;
- navegador real verifica escritorio y 390×844 sin acciones críticas ocultas.
