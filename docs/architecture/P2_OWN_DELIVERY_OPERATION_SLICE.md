# S7 · Operación de domicilio propio

Estado: diseño S7.0, listo para revisión humana antes de persistencia.

## 1. Objetivo y límites

Este corte extiende la venta confirmada con cumplimiento operativo para `delivery` y `pickup`. No crea otra `Order`, no recalcula ventas históricas y no convierte Capture, KDS, caja o turno operativo en autoridades de reparto.

Incluye progresivamente:

- cobertura, zona, cargo y promesa explicables antes de confirmar;
- pedido inmediato o programado y liberación posterior a cocina;
- empaque y handoff a recoger/despachar;
- directorio operativo y asignación de repartidor;
- salida, intentos, incidencias, regreso, entrega y cierre operativo;
- dinero por cobrar y liquidación del repartidor como conciliación, nunca como edición del pago original.

Quedan fuera de S7: agregadores externos, optimización automática de rutas, navegación propia, tracking público, nómina/comisiones, inventario avanzado, fiscalidad y soporte implícito de entregas parciales.

## 2. Autoridades existentes que se reutilizan

| Hecho | Autoridad actual | Consecuencia para S7 |
|---|---|---|
| Venta, líneas, totales y estado comercial | `Order` y sus snapshots/auditoría | Fulfillment referencia la Order; no copia ni muta sus líneas. |
| Cliente, teléfono y dirección usados | `OrderFulfillmentSnapshotV1` creado desde Capture | Despacho lee una proyección minimizada del snapshot congelado, nunca la ficha Customer mutable. |
| Canal de cumplimiento | Capture confirmado → `Order.channel` + snapshot | Sólo `delivery` y `takeout` abren los caminos S7 correspondientes. |
| Preparación | estados `OrderItem`, eventos KDS y cursores | Empaque no marca producción completa por inferencia; consume un resumen autoritativo de readiness. |
| Pagos y caja | pagos, auditoría financiera y sesiones de caja | “Por cobrar” es una obligación referenciada; liquidar genera/relaciona movimientos financieros canónicos. |
| Turno de operación | `operational_shifts` y vínculo Order | No representa turno/carga del repartidor ni su liquidación. |
| Autorización | memberships y RBAC exacto Restaurant/Branch | Todo comando S7 reautoriza actor y scope en servidor. |

No existe aún `packages/printing`; los comprobantes de despacho/entrega deben quedar como puertos futuros y no como éxito simulado.

## 3. Separación de estado

La Order conserva su estado comercial. Preparación conserva estados por ítem. Pago conserva sus estados financieros. S7 introduce un único agregado de cumplimiento por Order y revisión, con versión optimista y journal append-only.

Estados canónicos propuestos:

1. `pending_confirmation`: cobertura/promesa todavía no aceptadas.
2. `scheduled`: confirmado para una ventana futura, aún no liberado.
3. `confirmed`: cumplimiento aceptado y elegible para preparación.
4. `preparing`: producción iniciada o parcialmente lista.
5. `ready_to_pack`: producción requerida completa, falta empaque.
6. `ready_for_handoff`: empacado y listo para recoger o despachar.
7. `assigned`: una persona repartidora activa aceptó/asumió la entrega.
8. `en_route`: handoff de sucursal consumado.
9. `delivered`: entrega confirmada con evidencia operativa mínima.
10. `delivery_failed`: intento fallido; exige incidencia y siguiente disposición explícita.
11. `cancelled`: cumplimiento cerrado por cancelación autorizada; no borra Order, pagos ni eventos previos.

`pickup` termina desde `ready_for_handoff` mediante un evento de entrega en sucursal y nunca entra en `assigned/en_route`. El nombre mostrado puede ser “Listo para recoger” o “Listo para despachar” según canal, sin crear estados persistidos divergentes.

Transiciones de regreso, reintento, reasignación, cancelación en ruta y entrega parcial no se fijan todavía: requieren las decisiones de la sección 8. El journal debe representar compensaciones; no se reescribe una transición ya aceptada.

## 4. Modelo mínimo propuesto

### 4.1 Cotización/promesa de entrega

`DeliveryQuote` es una decisión versionada anterior a confirmación, acotada a Restaurant/Branch y al snapshot Address:

- `quoteId`, `restaurantId`, `branchId`, `captureDraftId`;
- `addressSnapshotRef` y versión/hash de los hechos geográficos usados;
- `coverageStatus`: `covered | outside | manual_review`;
- `zoneId` y versión de regla, ambos nullable sólo cuando no hay match;
- cargo exacto en minor units + moneda ISO;
- ventana prometida con inicio/fin y zona horaria autoritativa del Restaurant;
- desglose explicable de regla, sin publicar configuración privada completa;
- override nullable con actor, permiso, motivo y cargo/ventana finales;
- `calculatedAt`, `expiresAt`, `version` e idempotency key.

Confirmar Capture delivery exige una quote vigente y aceptada que corresponda exactamente al Address snapshot. La Order congela quote, cargo y promesa; nunca los recalcula desde una zona actualizada.

### 4.2 Agregado de cumplimiento

`OrderFulfillment` contiene identidad/scope, `orderId`, canal, estado, versión, ventana prometida congelada, readiness de empaque, asignación vigente nullable, timestamps efectivos y referencias a obligaciones financieras. No contiene PAN/CVV, catálogo, líneas duplicadas ni la ficha Customer completa.

Cada comando incluye actor, device, event/idempotency key, expected version, occurredAt y motivo/evidencia cuando aplique. El servidor fija `receivedAt`, revalida permisos y persiste agregado + evento en una transacción.

### 4.3 Repartidor, carga y privacidad

La persona repartidora se selecciona desde una membership activa del mismo Branch con capacidad explícita de reparto. La asignación conserva identidad, estado, capacidad y carga observada, pero una ruta agrupada sólo relaciona fulfillment IDs: no fusiona Orders, pagos o propiedad del efectivo.

La proyección móvil/operativa entrega únicamente nombre operativo, teléfono necesario, dirección snapshot, instrucciones, navegación derivada, importe por cobrar y ventana. Al cerrar/expirar retención, las vistas dejan de exponer contacto/dirección aunque la auditoría protegida conserve referencias necesarias.

### 4.4 Incidencias y liquidación

Una incidencia es append-only y tipada (`customer_unreachable`, `address_not_found`, `access_blocked`, `missing_item`, `payment_difference`, `vehicle`, `other`), con texto acotado, actor, tiempo y disposición posterior. No cambia por sí sola venta, pago o inventario.

El efectivo por cobrar se deriva de la autoridad financiera. La liquidación compara obligación, cobro declarado y movimientos recibidos; una diferencia queda abierta con motivo y revisión. Nunca se ajusta el total de Order ni se elimina un Payment para hacer cuadrar al repartidor.

## 5. Invariantes de esquema y servidor

- una Order tiene como máximo un cumplimiento activo por revisión; reprogramar o reemplazar conserva vínculo y eventos;
- Restaurant/Branch/Order/canal deben coincidir en todas las tablas y funciones;
- sólo delivery exige snapshot de dirección y quote cubierta/override; pickup no puede portar cargo/assignment de reparto;
- promesa usa `timestamptz` más zona horaria congelada y `end > start`;
- cargos y obligaciones usan enteros minor + moneda coincidente con Order;
- `assigned/en_route` requieren repartidor activo del mismo Branch; `delivered` exige salida previa para delivery;
- `ready_to_pack` depende de readiness autoritativo de todos los ítems requeridos, no de un booleano cliente;
- comandos usan CAS + idempotencia y replay exacto; colisión tardía revierte evento y agregado;
- RLS+FORCE y cero CRUD de clientes; sólo capacidades privadas exactas para `app_api`;
- eventos financieros/inventario/fulfillment son inmutables; correcciones son compensatorias;
- cambio de sucursal es una transferencia explícita con nueva evaluación, no una actualización de `branchId`;
- cierre no elimina historia ni datos necesarios para disputa/conciliación.

## 6. Entregas incrementales

1. **S7.0 — este documento:** estados, autoridad, privacidad, decisiones y criterios.
2. **S7.1 — cobertura/promesa:** dominio puro de zonas y quote, contratos runtime, persistencia versionada y lectura/aceptación en Capture.
3. **S7.2 — programación:** ventana congelada, cálculo de liberación y job idempotente; no se selecciona cola hasta una ADR.
4. **S7.3 — cumplimiento/empaque:** agregado, journal, readiness derivado de KDS y flujos pickup/delivery hasta `ready_for_handoff`.
5. **S7.4 — repartidores/despacho:** directorio, capacidad/carga, assign/reassign, handoff y proyección minimizada.
6. **S7.5 — incidencias/entrega:** intentos, regreso, reprogramación/cancelación compensatoria y entrega.
7. **S7.6 — cobranza/liquidación:** obligación contra entrega y conciliación enlazada a pagos/caja.
8. **S7.7 — experiencia y E2E:** bandeja/filtros, desktop/tablet/móvil objetivo, role plays, aislamiento y recuperación.

Cada entrega requiere dominio, contrato, Nest+PostgreSQL, rollback-only, aislamiento, idempotencia, cleanup/recovery y verificación visual proporcional antes de REVIEW. Ninguna candidata se aplica sin autorización explícita.

## 7. Criterios de aceptación del slice

- domicilio no puede confirmarse sin Customer, Address snapshot validado y quote vigente cubierta/override;
- el operador ve explicación de cobertura, cargo y promesa antes de aceptar;
- pedido programado no se libera prematuramente y un reintento no duplica producción;
- producción parcial no permite handoff; una incidencia de empaque impide despacho;
- sólo repartidores activos del Branch aparecen y dos actores no pueden asignar la misma versión;
- la vista del repartidor contiene sólo datos mínimos y deja de exponerlos después del cierre/retención;
- intento fallido, regreso y cancelación conservan eventos y no alteran silenciosamente Order/pagos;
- importe por cobrar y liquidación se reconcilian sin borrar pagos ni ajustar la venta;
- doble envío, doble entrega, replay, conflicto CAS y caída entre agregado/evento no producen efectos duplicados;
- pruebas de otro Restaurant, otro Branch, membership revocada y par Restaurant/Branch falso fallan cerradas;
- teléfono → dirección → quote → Order → cocina → empaque → despacho → cobro → cierre funciona end-to-end.

## 8. Decisiones humanas requeridas antes de persistir S7.1+

1. Fuente inicial de cobertura: zonas manuales, código postal/colonia, polígonos, distancia o combinación; proveedor de geocodificación si existe.
2. Fórmula y autoridad del cargo/tiempo, gratuidad, mínimos, impuestos, propina y overrides por rol.
3. Forma exacta de ventana prometida y reglas de re-promesa/retraso.
4. Política de pedidos programados: horizonte, cutoff, capacidad, timezone/DST y autoridad del scheduler.
5. Definición de “listo para empacar”, checklist/evidencia y quién puede liberar con faltantes.
6. Quién es repartidor (membership/rol), límites de carga, reasignación y si habrá autoasignación en el piloto.
7. Intentos permitidos, contacto, regreso, reprogramación, cancelación en ruta y retención de PII.
8. Si se permite entrega parcial; si sí, unidad de seguimiento, cobro, faltante y cierre.
9. Métodos contra entrega, “pagará con”, manejo de diferencias y relación con caja/turno del repartidor.
10. Hardware/canal de impresión y evidencia de handoff/entrega del piloto.

Hasta resolverlas, S7.0 no autoriza tablas, endpoint, cálculo monetario, job, asignación automática ni mutación financiera.
