# P2 — captura multicanal: auditoría y primer slice

**Estado:** S0 y contratos/dominio S1 implementados localmente; persistencia/API/UI permanecen `IN_PROGRESS`
**Fecha:** 2026-09-15
**Autoridad funcional:** sección 8.8 de `PLAN_MODERNIZACION_POS_RESTAURANTE.md`

## 1. Resultado de la auditoría

Ninguno de los 50 role plays está cubierto end-to-end. Hay fundamentos parciales reutilizables en órdenes, concurrencia optimista, snapshots de producto, KDS, cobro simple, auditoría y autorización; no equivalen a aceptación funcional. La clasificación conservadora de la matriz es 23 parciales y 27 ausentes. Los escenarios RP-43, RP-45 y RP-46 pertenecen deliberadamente a P6.

| Capacidad | Estado actual | Brecha | Entidades/contratos afectados | Riesgo | Slice |
|---|---|---|---|---|---|
| Estados ortogonales | `Order.status` mezcla orden y pago; KDS vive por ítem; `Payment` sí tiene autoridad propia | Falta ciclo comercial y fulfillment; no debe duplicarse un estado derivado | `Order`, `OrderState`, `Payment`, `OrderItemState`, codec y SQL | cierre, cobro o entrega falsos | S0–S1 |
| Borrador/espera | Draft Mobile sólo en memoria; Order `draft` es persistente por ID | Sin autoguardado recuperable, hold, folio, propietario, claim o transferencia | comandos Capture, bandeja, auditoría, índices | pérdida, duplicación, trabajo huérfano | S1/S3 |
| Cliente/dirección | Ausente | Directorio, búsqueda, duplicados y snapshots históricos | Customer, Contact, Address, OrderPartySnapshot | PII cruzada, entrega errónea | S2 |
| Origen/cumplimiento | Un solo `channel`; Mobile fuerza `table` | Separar conversación de promesa de entrega | Create Order V3, Order, SQL, KDS | WhatsApp/llamada indistinguible de pickup/delivery | S0–S1 |
| Configurador | Grupos/opciones/min/max/cantidades/precio | Sin variantes, dependencias, exclusiones, combos o fracciones | catálogo v2, snapshots KDS/ticket | precio o cocina ambiguos | S5 |
| Cambios/cancelación | Cancelación de ítem auditada y versionada | Falta reemplazo enlazado, compensación, costo y UX | Order/KDS/Payment/Inventory | cocina prepara versión vieja | S6 |
| Pago | Efectivo/tarjeta manual, parcial, replay; refund sólo dominio | Sin “pagará con”, pending/ambiguous, COD, refund API o liquidación | Payment, Cash, Order projection | doble cobro o saldo falso | S7 |
| Domicilio | Ausente | Cobertura, promesa, empaque, despacho, repartidor e incidencias | Fulfillment, Delivery, zonas | promesa incumplida | S8 |

## 2. S0 implementado: vocabulario sin segunda autoridad

`packages/domain/src/commercial-order-state.ts` añade vocabularios cerrados para `sourceChannel` y `fulfillmentChannel`, un ciclo comercial separado, continuidad de atención y proyecciones independientes de preparación, cumplimiento y pago. No modifica `Order`, `CreateOrderCommandV1/V2`, codecs ni SQL.

- `preparation` se deriva de los estados autoritativos de los ítems/KDS;
- `payment` será una proyección de `Payment` y refunds, nunca un comando de cliente;
- `fulfillment` tendrá autoridad propia y no se infiere de cocina o cobro;
- `attention` no se confunde con confirmación comercial;
- cancelar después de confirmar es estructuralmente representable, pero autorización, costo, refund e inventario siguen fuera de S0.

El legado conserva `channel` y `Order.status`. No se hará backfill heurístico de `counter`; `table→dine_in`, `takeout→pickup` y `delivery→delivery` sólo permiten inferir cumplimiento, no origen.

## 2.1 S1 implementado localmente: contrato y reglas puras de captura

`packages/shared-types/src/commercial-capture.ts` define contratos V1 fail-closed para crear, autoguardar, poner en espera, reclamar, retomar, transferir, confirmar y cerrar como `no_sale`. Incluye scope, `expectedVersion`, `eventId`, `idempotencyKey`, `deviceId` y `occurredAt`; los comandos con lease exigen `attentionLeaseId`. Los resultados incluyen `replayed`; el cliente no envía `actorId` ni PII, sólo referencias opacas a snapshots. Origen es obligatorio y cumplimiento puede ser `null` mientras el borrador está incompleto.

`packages/domain/src/capture-draft.ts` implementa el agregado puro e inmutable `CaptureDraft` y eventos de auditoría para ownership, hold, claim/resume, transferencia, confirmación y `no_sale`. El dominio recibe actor autenticado y aplica reglas de propiedad; versiones optimistas, leases, deduplicación y resolución membership→actor pertenecen a persistencia/API. No se modificaron `Order`, codecs V1/V2, API, SQL, migraciones ni UI.

`confirmCaptureDraft` significa confirmar la venta y enlazarla a una Order operativa; la atención del borrador se libera, pero la Order sigue visible en la bandeja de trabajo para cocina, cobro y entrega. Sólo después de cumplirse **cobro y entrega** la orden pasa a historial de sólo lectura. La confirmación comercial por sí sola no equivale a pago ni fulfillment. El cierre autoritativo requiere una proyección transaccional de esos estados, todavía no implementada.

## 3. Primer slice utilizable: llamada recuperable en espera

### Alcance

1. Crear/recuperar un borrador de captura telefónica.
2. Buscar o crear un cliente mínimo y una dirección operativa.
3. Separar origen (`phone`/`whatsapp_manual`/etc.) y cumplimiento (`counter`/`pickup`/`delivery`/`dine_in`).
4. Autoguardar, poner en espera, reclamar, retomar, transferir y cerrar como `no_sale`.
5. Confirmar congelando snapshots; todavía sin fracciones, cobertura/cargos ni política post-cocina.

### Entidades

- `Customer`: Restaurant-scoped, nombre/alias, timestamps y soft delete.
- `CustomerContact`: tipo, valor mostrado, valor normalizado y etiqueta. El teléfono normalizado **no es único** porque puede compartirse.
- `CustomerAddress`: etiqueta, componentes, referencias, instrucciones, coordenadas opcionales y estado de validación. Zona/cobertura es nullable hasta su slice.
- `OrderPartySnapshot`: `customerId` opcional, nombre/alias y contacto usado.
- `OrderFulfillmentSnapshot`: dirección e instrucciones realmente confirmadas.
- `CaptureDraft`: Restaurant/Branch, folio, versión, source/fulfillment, owner/lease, hold, promesa opcional y referencias a snapshots.

KDS no recibe PII de cliente/dirección salvo el mínimo que un contrato posterior justifique explícitamente.

### Comandos y eventos

| Comando | Evento |
|---|---|
| `CreateCaptureDraftV1` | `capture.created` |
| `AutosaveCaptureDraftV1` | `capture.autosaved` |
| `UpdateDraftCustomerV1` | `capture.customer_snapshot_changed` |
| `UpdateDraftFulfillmentV1` | `capture.fulfillment_changed` |
| `PutCaptureOnHoldV1` | `capture.held` |
| `ClaimCaptureV1` | `capture.claimed` |
| `ResumeCaptureV1` | `capture.resumed` |
| `TransferCaptureV1` | `capture.transferred` |
| `ConfirmCaptureV1` | `capture.confirmed` |
| `CloseCaptureNoSaleV1` | `capture.no_sale` |

Creación usa versión esperada cero; toda otra mutación exige `expectedVersion`. Cada comando incluye scope, actor autenticado en servidor, `deviceId`, `eventId`, `idempotencyKey` y `occurredAt`; el servidor añade `receivedAt`. La llave se liga al hash canónico del comando completo: replay exacto devuelve el mismo resultado y payload divergente produce conflicto.

### Invariantes

- Draft/held nunca genera KDS, cobro ni promesa de entrega confirmada.
- Delivery no se confirma sin snapshot de contacto y dirección con validación operativa; esto no implica todavía cobertura comercial.
- Anónimo sólo es válido para mesa/mostrador; no para delivery.
- Confirmar congela snapshots. Editar Customer o Address nunca cambia una orden histórica.
- Payment, preparation y fulfillment no cambian automáticamente el estado comercial.
- `pending` o `ambiguous` nunca equivale a pagado y bloquea un reintento como intento nuevo hasta conciliación.
- Claim/transfer es compare-and-swap atómico. Dos operadores no pueden editar silenciosamente la misma versión.
- Hold libera la edición; resume no sobrescribe una versión concurrente.
- Revocación bloquea mutaciones pero conserva el borrador server-side para reasignación autorizada.
- Coincidencias de cliente nunca se fusionan automáticamente.
- Todo acceso y búsqueda falla cerrado por Restaurant; Branch limita la operación cuando aplica.

### Permisos confirmados; implementación RBAC pendiente

Emmanuel aprobó que cajero, mesero, supervisor, gerente y administrador puedan leer/crear/editar/reclamar capturas; transferir y apropiarse por fuerza queda sólo para supervisor, gerente y administrador. `captures.read`, `captures.create`, `captures.update`, `captures.claim`, `captures.transfer`, `customers.read`, `customers.create` y `customers.update` son los códigos propuestos: aún no se incorporaron a la matriz RBAC compartida ni a PostgreSQL. Toda apropiación forzada exige motivo y auditoría. Kitchen no accede al directorio.

### Concurrencia

La propiedad usa `attentionLeaseId`, propietario y expiración calculada por servidor. La **reserva exclusiva de edición** dura cinco minutos y se renueva automáticamente mientras el operador trabaja; hold la libera de inmediato. Autosave, hold y transfer verifican simultáneamente scope, lease y versión; claim/resume adquieren un lease nuevo mediante CAS. La **recuperabilidad del borrador** dura un mes y se puede renovar si el usuario selecciona esa opción; no bloquea a otros operadores durante ese mes. El plazo de retención de borradores abandonados (90 días) es distinto: la expiración de recuperabilidad no autoriza por sí sola borrar registros. La detección de pedidos parecidos por teléfono/origen/ventana sólo advierte: no es idempotencia y no bloquea falsos positivos.

### Criterios de aceptación

- Recuperar una llamada en espera en ≤10 s desde una estación autorizada.
- Dos claims simultáneos producen un único propietario y un 409 recuperable.
- Reinicio restaura el draft; revocación lo conserva sin permitir mutaciones.
- Cambiar la ficha del cliente no altera el snapshot confirmado.
- Draft y hold producen cero eventos KDS y cero Payment.
- Replay exacto devuelve el mismo resultado; key divergente y versión obsoleta fallan.
- Pruebas de aislamiento Restaurant/Branch cubren búsquedas, detalle, snapshots y bandeja.
- RP-01, 02, 03, 04, 25, 29, 47, 48 y 50 pasan con evidencia. RP-06 sigue parcial hasta reconstrucción contra catálogo vigente.

## 4. Decisiones humanas pendientes

No bloquearon S0 y no deben codificarse por inferencia:

- precio de mitades/fracciones;
- sustituciones y sobreprecios de combos;
- cobertura, cargos, tiempos y overrides de domicilio;
- cancelación/costo/desperdicio después de cocina;
- reparto parcial, ampliación de pedido en ruta y liquidación;
- plazo legal/operativo concreto de conservación del historial y de PII asociada.

Los roles base y la política de retención ya fueron aprobados: borradores abandonados 90 días, clientes activos y snapshots históricos conservados por auditoría. Emmanuel confirmó que el mes con renovación opcional corresponde a recuperación del borrador; la reserva exclusiva de edición dura cinco minutos y se renueva mientras se trabaja. No activar limpieza de PII sin pruebas y regla de conservación aplicable.

## 5. Estrategia de verificación por slice

- S0: lint, typecheck, unit tests de producto cartesiano y CodeGraph.
- S1–S3: parser de contrato exacto, API/PostgreSQL rollback-only, aislamiento, replay/conflicto, dos escritores, revocación y recuperación.
- S4–S6: KDS/ticket, snapshots, cambios enlazados y regresión de cursor/Station.
- S7: pruebas de dominio + integración financiera, doble cobro y conciliación ambigua.
- S8: fulfillment, cobertura configurable, despacho, incidencias y liquidación.
- UI: navegador real, teclado/táctil, 390×844/tablet y medición ≤10 s. Ningún role play pasa a cubierto sin regresión y evidencia funcional.

## 6. Matriz RP-01…RP-50

| ID | Escenario | Estado | Brecha / riesgo principal | Pruebas mínimas | Slice |
|---|---|---|---|---|---|
| RP-01 | Cuelga y llama después | Ausente | Sin draft durable/bandeja; pérdida o duplicación | contrato, DB, UX≤10s, reinicio | S1–S3 |
| RP-02 | Segunda llamada durante captura | Ausente | Sin hold ni conversaciones simultáneas; mezcla clientes | contrato, DB, UX | S1–S3 |
| RP-03 | Dos operadores atienden igual | Parcial | CAS existe; falta ownership/detección | concurrencia, claim, UX | S1–S3 |
| RP-04 | Dirección nueva confusa | Ausente | Sin Customer/Address/validación | tenant, contrato, UX | S2 |
| RP-05 | Habitual desde otro número | Ausente | Sin contactos múltiples/selección | tenant, duplicados, UX | S2 |
| RP-06 | “Lo mismo de siempre” | Ausente | Sin historial/reconstrucción vigente | catálogo concurrente, UX | S2/S5 |
| RP-07 | Pizza por mitades | Parcial | Modificadores sin fracciones/alcance/regla | propiedades, DB, KDS, UX | S5 |
| RP-08 | Masa/orilla incompatible | Ausente | Sin dependencias/exclusiones | combinatorio, UX | S5 |
| RP-09 | Combo con bebida agotada | Parcial | Sin combo/sustitución/sobreprecio | contrato, DB, KDS, UX | S5 |
| RP-10 | Elimina antes de enviar | Parcial | Sólo reducer local; falta total autoritativo | dominio, UX | S4/S6 |
| RP-11 | Cambia artículo enviado | Parcial | Falta reemplazo enlazado/atómico | DB, KDS, concurrencia | S6 |
| RP-12 | Cancela mientras prepara | Parcial | Falta costo/refund/desperdicio/UX | dominio, DB, KDS, finanzas | S6/S7 |
| RP-13 | Agrega cuando está en ruta | Parcial | Sin ampliación/fulfillment vinculado | contrato, DB, UX | S8 |
| RP-14 | Pedido programado | Ausente | Sin promesa/liberación/alerta | reloj, DB, KDS, UX | S8 |
| RP-15 | Domicilio cambia a recoger | Ausente | Canal conflado; cargo/promesa inconsistentes | estado, DB, finanzas | S1/S8 |
| RP-16 | Efectivo con billete grande | Ausente | Sin pagará-con/cambio | contrato, DB, despacho | S7/S8 |
| RP-17 | Efectivo + tarjeta | Parcial | Cobros sucesivos existen; falta UX semántica | idempotencia, finanzas, UX | S7 |
| RP-18 | Terminal tarda y cuelga | Parcial | Sin pending/ambiguous productivo | proveedor, conciliación, reinicio | S7/P6 |
| RP-19 | Fuera de cobertura | Ausente | Sin cobertura/override/cargo | reglas configurables, DB, UX | S8 |
| RP-20 | Repartidor no encuentra | Ausente | Sin intentos/incidencia/regreso | DB, UX, liquidación | S8 |
| RP-21 | Falta producto al empacar | Ausente | Sin empaque/reposición/refund/ETA | KDS, DB, finanzas | S8 |
| RP-22 | Red cae al confirmar | Parcial | Replay en memoria; sin outbox/draft durable | idempotencia, reconexión, reinicio | S1/P3 |
| RP-23 | Reclamo histórico | Parcial | Snapshots/eventos sin timeline/PII | auditoría, seguridad, UX | S2/S6 |
| RP-24 | Corrección tras cierre | Parcial | Compensación sólo dominio | API, autorización, finanzas | S7 |
| RP-25 | Teléfono compartido | Ausente | Sin coincidencias/selección; identidad errónea | tenant, duplicados, UX | S2 |
| RP-26 | Dirección incompleta | Ausente | Sin draft de dirección/estado pendiente | contrato, DB, UX | S2 |
| RP-27 | Otra sucursal entrega | Ausente | Sin transferencia/capacidad; fuga/doble orden | multi-branch, seguridad | S8 |
| RP-28 | Alergia reportada | Ausente | Sin advertencia estructurada/KDS | contrato, KDS, UX | S5 |
| RP-29 | Precio cambia en espera | Parcial | Stale catalog existe; falta diff/reconfirmación | concurrencia, UX | S1/S5 |
| RP-30 | Promo deja de aplicar | Parcial | Totales exactos, sin motor/explicación | propiedades, DB, UX | S5 |
| RP-31 | Cupón usado en otro dispositivo | Ausente | Sin redención autoritativa | concurrencia, idempotencia | futuro P2 |
| RP-32 | Ingrediente agotado post-confirmación | Ausente | Sin inventario/incidencia/órdenes afectadas | DB, KDS, UX | P4 + S6 |
| RP-33 | Cocina pide aclaración | Ausente | Sin pregunta/respuesta/pausa | contrato, DB, KDS | S6 |
| RP-34 | Estaciones a ritmos distintos | Parcial | Ítems separados; falta proyección/empaque | proyección, KDS, UX | S0/S4 |
| RP-35 | Impresora falla, KDS recibió | Parcial | Sin destino/reimpresión selectiva | contract test hardware, KDS | impresión |
| RP-36 | Otra persona recogerá | Ausente | Sin receptor/verificación/privacidad | contrato, DB, UX | S8 |
| RP-37 | Llega temprano/tarde | Parcial | Sin llegada/promesa/ETA real | reloj, DB, UX | S8 |
| RP-38 | Entrega parcial | Ausente | Sin fulfillment por ítem/saldo | dominio, DB, finanzas | S8 |
| RP-39 | Corporativo multi-dirección | Ausente | Sin fulfillments relacionados/conciliación | dominio, DB, finanzas | futuro |
| RP-40 | Cambio de turno con pendientes | Parcial | Turnos existen; sin handoff de bandeja/rutas | DB, UX, finanzas | S3/S8 |
| RP-41 | Cancela una orden de ruta múltiple | Ausente | Sin ruta/manifiesto/liquidación | dominio, DB, despacho | S8 |
| RP-42 | Repartidor cobra distinto | Parcial | Variance de caja sin liquidación por repartidor | DB, finanzas, UX | S7/S8 |
| RP-43 | Factura después del cierre | Ausente P6 | Sin flujo fiscal vinculado | PAC contract, DB, finanzas | P6 |
| RP-44 | Refund parcial al día siguiente | Parcial | Refund sólo dominio; sin API/política | dominio, DB, finanzas | S7 |
| RP-45 | Webhook duplicado | Ausente P6 | Sin adaptador/identidad externa | contract, idempotencia, DB | P6 |
| RP-46 | Cancelación externa post-cocina | Ausente P6 | Sin política/comisión/refund de canal | contract, KDS, finanzas | P6 |
| RP-47 | Ver clientes de otro restaurante | Parcial | Auth base existe; Customer aún no | cross-tenant, no-cache/logs | S2 |
| RP-48 | Sesión revocada durante captura | Parcial | Hoy descarta draft; falta conservación/reasignación | revocación, reinicio, UX | S1–S3 |
| RP-49 | Reinicio con draft/pago pendiente | Ausente | Memoria efímera/sin conciliación | reinicio real, pago ambiguo | S1/S7/P3 |
| RP-50 | Cliente no responde al confirmar | Parcial | Draft no llega a KDS; falta awaiting-confirmation/callback | DB, bandeja, KDS | S1–S3 |
