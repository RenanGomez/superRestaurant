# S8 · Captura y cobro durante el pedido

Estado: diseño S8.0, intención pura S8.1a/S8.1b y proyección pura de obligación S8.2a implementados; listo para revisión humana antes de persistencia financiera.

## 1. Objetivo y límites

Este corte completa el recorrido de cobro de la sección 8.8.6 sin reemplazar las autoridades existentes de `Payment`, `Order`, caja y auditoría. Separa con claridad:

- intención informativa de pago durante Capture;
- obligación pendiente de una Order confirmada;
- intento de pago con estado propio;
- pago efectivamente capturado;
- devolución o corrección compensatoria;
- conciliación por caja, terminal, referencia externa o repartidor.

Incluye progresivamente efectivo ahora, “pagará con”, efectivo contra entrega, tarjeta manual confirmada fuera del sistema, transferencia, pagos mixtos, anticipos, saldo contra entrega y estados pendientes/ambiguos. No incluye terminal integrada, vales/tarjetas de regalo, crédito comercial, fiscalidad, propinas ni reglas de devolución no aprobadas.

## 2. Autoridades existentes que se conservan

| Hecho | Autoridad actual | Consecuencia para S8 |
|---|---|---|
| Total histórico de venta | `Order` y snapshots de líneas/impuestos | Ningún intento o plan de pago recalcula ni modifica el total. |
| Intento y compensación financiera | `Payment`, sus transiciones y `Refund` | S8 amplía el modelo de forma aditiva; no crea otro ledger de cobros. |
| Efectivo físico | `CashRegister` y `CashMovement` | Sólo efectivo realmente recibido genera `cash_sale`; “pagará con” no mueve caja. |
| Cobro simple operativo | `FinancialService`, contratos V1 y funciones privadas PostgreSQL | V1 permanece compatible; S8 introduce contratos versionados y comandos explícitos. |
| Estado comercial | `Order` (`open`, `partially_paid`, `paid`, etc.) | Se deriva del total capturado; no se cierra por intención, autorización o ambigüedad. |
| Proyección multieje | `OrderPaymentStatus` | `pending` y `ambiguous` provienen de intentos autoritativos, no de flags cliente. |
| Identidad y scope | membership/RBAC Restaurant/Branch | Cada lectura/mutación se reautoriza en servidor y falla cerrada ante pares falsos. |
| Cumplimiento contra entrega | futuro `OrderFulfillment` S7 | S8 referencia la obligación; no asigna repartidor ni declara entrega. |

La tabla `app.payments` actual sólo persiste `cash|card_manual` ya capturados. No representa todavía intentos en curso, resultado ambiguo, obligaciones diferidas, transferencias ni refunds persistidos. Esa limitación debe evolucionar mediante migraciones nuevas; no se edita la migración aplicada.

## 3. Vocabulario y separación de hechos

### 3.1 Intención de pago

`PaymentIntentSnapshot` es una preferencia operativa congelada en Capture/Order, no dinero:

- método previsto y momento: `now | on_fulfillment`;
- importe previsto en minor units y moneda de la Order;
- para efectivo, `tenderedAmountMinor` opcional (“pagará con”);
- cambio estimado derivado, nunca editable ni contabilizado;
- actor, dispositivo, versión, timestamps e idempotency key;
- vínculo al Capture mientras es borrador y snapshot en la Order al confirmar.

El cambio requerido se calcula únicamente cuando el método es efectivo y existe monto entregado/prometido:

`changeDue = tenderedAmount - cashAmountDue`

Debe cumplir `tenderedAmount >= cashAmountDue > 0`, moneda única y enteros seguros. Editar precio, descuento, cargo, anticipo o composición del plan invalida/recalcula la estimación y exige reconfirmación visible; jamás crea `Payment` ni `CashMovement`.

### 3.2 Obligación de cobro

`PaymentObligation` describe cuánto falta por liquidar, cuándo y bajo qué canal operativo. Se deriva de total vigente menos importes capturados y menos refunds que restituyen saldo según una política explícita. Una obligación puede estar prevista `now` o `on_fulfillment`, pero no cuenta como cobro.

Un anticipo es un `Payment` capturado normal; el saldo contra entrega es una obligación restante vinculada a fulfillment. No existe una clase especial de dinero ni se duplica el total.

S8.2a implementa `derivePaymentObligation` y su contrato V1 como una proyección sin efectos: conserva por separado total, capturado, exposición `pending`, exposición `ambiguous`, saldo, sobreexposición y monto cobrable. Cualquier exposición no resuelta hace `collectibleAmount = null`; `ambiguous` tiene precedencia sobre `pending`, y ninguna de las dos se suma a capturado. El adaptador puro `projectPaymentObligation` vuelve a validar entrada y salida en minor units, sin endpoint, lectura SQL ni mutación.

El autosave S8.1c no puede persistirse de forma segura todavía: Capture no posee un total general autoritativo para líneas configuradas. La intención no aceptará un total calculado por el cliente; debe enlazarse después a las líneas/precios autoritativos de Capture u Order y revalidar su versión antes de congelar la estimación.

### 3.3 Intento de pago

Un intento conserva identidad estable e idempotencia aun cuando el proveedor o la red no respondan. Estados propuestos:

1. `initiated`: comando aceptado, sin resultado financiero final;
2. `pending`: proveedor/operación sigue en proceso y sólo puede consultarse;
3. `authorized`: fondos autorizados, aún no capturados;
4. `captured`: dinero confirmado por la autoridad del método;
5. `failed`: rechazo final sin cobro;
6. `ambiguous`: no se sabe si hubo efecto; bloquea un intento equivalente hasta consultar/conciliar;
7. `voided`: autorización/intento anulado con evidencia;
8. `refunded`: todo el importe capturado fue compensado; refunds parciales conservan `captured` más saldo reembolsable.

`ambiguous` no significa `failed`, no libera un reintento automático y no cierra Order. Sólo una consulta idempotente al adaptador, webhook firmado o conciliación autorizada puede resolverlo a un estado final permitido.

## 4. Métodos y evidencia mínima

| Método | Captura | Evidencia mínima | Caja |
|---|---|---|---|
| `cash` ahora | operador confirma recepción | actor/dispositivo/sesión | movimiento `cash_sale` |
| `cash` contra entrega | repartidor/caja confirma recepción | fulfillment, responsable y liquidación | movimiento al recibir/liquidar según decisión humana |
| `card_manual` | confirmación externa explícita | proveedor, terminal y referencia opcional | sin movimiento de efectivo |
| `transfer` | confirmación o conciliación autorizada | referencia, cuenta lógica/proveedor y momento | sin movimiento de efectivo |
| `card_terminal` futuro | adaptador idempotente | identidad de intento/proveedor, nunca PAN/CVV | sin movimiento de efectivo |

Una instrucción “tarjeta” o “transferencia” capturada durante la llamada es intención. Sólo evidencia válida produce un Payment `captured`. No se almacenan PAN, CVV, tokens secretos, imágenes completas de comprobantes ni payloads personales innecesarios.

## 5. Pagos mixtos, anticipos y saldo

- cada parte es un Payment independiente con `paymentId`, `eventId` e idempotency key propios;
- la suma neta capturada nunca excede el total cobrable de la Order;
- el servidor bloquea y recalcula bajo lock las versiones de Order/caja antes de aceptar cada parte;
- una parte fallida o ambigua no revierte ni oculta las partes ya capturadas;
- la UI muestra total, capturado confirmado, pendiente/ambiguo separado y saldo cobrable;
- no se considera `paid` mientras exista saldo positivo, aunque el plan prometido sume el total;
- el anticipo puede cobrarse antes de cocina sólo si la política comercial lo permite; su existencia no confirma por sí sola producción o cumplimiento;
- el saldo contra entrega se conserva como obligación y se concilia con fulfillment/repartidor sin mutar pagos anteriores.

La división por persona o productos requiere una asignación explícita y queda fuera del primer incremento. El ledger siempre cobra importes contra la Order completa; una asignación futura no cambia el total ni la propiedad histórica del Payment.

## 6. Invariantes de servidor y esquema

- Restaurant, Branch, Order, sesión de caja, fulfillment y moneda deben coincidir exactamente;
- importes son enteros minor seguros y positivos; no hay floats ni conversión implícita;
- `PaymentIntentSnapshot`, obligación e intento tienen identidades distintas y no son intercambiables;
- un mismo event/idempotency key no puede representar dos importes, métodos, scopes o evidencias;
- cada comando usa expected versions; lock + persistencia de Payment/Order/caja/auditoría es atómica;
- `pending|ambiguous` no incrementan `capturedAmountMinor` ni producen `cash_sale`;
- `captured` se registra una sola vez aun tras timeout, replay, webhook duplicado o reinicio;
- sobrepago se rechaza; “pagará con” superior al saldo sólo calcula cambio y no aumenta el Payment;
- refunds y ajustes son append-only, autorizados y vinculados al hecho original;
- RLS+FORCE, funciones privadas exactas y cero CRUD financiero desde clientes;
- toda evidencia incluye actor, Branch, dispositivo, tiempo, motivo/autorización cuando aplique;
- ninguna proyección o snapshot contiene secretos del proveedor o datos completos de tarjeta;
- una sesión revocada, membership revocada o par Restaurant/Branch falso falla cerrado antes de cualquier efecto.

## 7. Entregas incrementales

1. **S8.0 — este documento:** autoridad, vocabulario, invariantes, decisiones y aceptación.
2. **S8.1 — intención y “pagará con”:** S8.1a aporta `buildPaymentIntentQuote`; S8.1b publica request/quote V1 y el adaptador puro `quotePaymentIntent` dentro de la autoridad financiera API. El autosave S8.1c espera un total Capture autoritativo; no admitirá uno enviado por el cliente. Sin Payment ni caja.
3. **S8.2 — obligación/checkout V2:** S8.2a ya proyecta y valida total, capturado, pendiente, ambiguo, saldo, sobreexposición y monto cobrable sin efectos. Falta conectar una lectura productiva V2 a hechos persistidos autoritativos.
4. **S8.3 — métodos capturados:** ampliar de forma aditiva el writer actual a transferencia y momento contra entrega según políticas aprobadas.
5. **S8.4 — intentos pending/ambiguous:** journal, consulta/reconciliación y adaptador provider-neutral; sin reintento ciego.
6. **S8.5 — anticipos y mixtos:** varias capturas, saldo diferido y vínculo con fulfillment/liquidación.
7. **S8.6 — refunds/voids:** compensaciones persistidas, autorización y caja; integra S6 sin borrar historia.
8. **S8.7 — experiencia y E2E:** teclado/táctil, recuperación tras reinicio, doble envío, timeout y role plays financieros.

Cada incremento requiere pruebas unitarias de dominio, integración PostgreSQL, aislamiento, idempotencia, doble envío, recovery y E2E proporcional. Las migraciones candidatas se validan desde cero y sobre la versión anterior; aplicarlas remotamente requiere autorización explícita.

## 8. Criterios de aceptación

- “pagará con” calcula cambio exacto, visible para despacho, sin crear pago ni movimiento de caja;
- editar total o plan invalida/reconfirma el cambio antes de cobrar;
- efectivo y tarjeta capturados por separado dejan saldo correcto y sólo efectivo afecta caja;
- anticipo más saldo contra entrega nunca duplica el total y mantiene estados independientes;
- timeout de terminal queda `pending|ambiguous`, bloquea reintento inseguro y puede consultarse tras reinicio;
- replay exacto devuelve el mismo resultado; colisión de clave falla sin efectos parciales;
- sobrepago, moneda distinta, versión obsoleta y scope ajeno fallan cerrados;
- refund/void conserva el Payment original y genera compensación/auditoría;
- otra sucursal/restaurante, membership revocada o dispositivo no autorizado no pueden leer ni mutar;
- el checkout muestra por separado total, confirmado, pendiente/ambiguo y saldo;
- la UI no solicita ni registra PAN/CVV;
- los role plays “billete grande”, “efectivo + tarjeta”, “terminal tarda”, “reinicio con pago pendiente” y “repartidor cobra diferente” tienen contrato, dominio y E2E.

## 9. Decisiones humanas requeridas antes de S8.3+

1. Métodos habilitados en el piloto y cuáles requieren caja abierta.
2. Si `card_manual` significa terminal externa ya confirmada y qué referencia/evidencia es obligatoria.
3. Cómo se confirma una transferencia, quién puede conciliarla y qué referencia se conserva.
4. Cuándo se permite anticipo, mínimo/máximo y si libera cocina o sólo confirma compromiso comercial.
5. Momento de registrar efectivo contra entrega: recepción por repartidor, entrega o liquidación en caja.
6. Quién porta/responde por el efectivo y cómo se modelan diferencias del repartidor.
7. Política de propina por canal/método y su relación con venta, cargo de entrega y caja.
8. Resolución de intentos pendientes/ambiguos: proveedor, timeout, consulta, webhook, roles y SLA.
9. Política de void/refund parcial/total, ventanas, permisos y destino de efectivo/tarjeta/transferencia.
10. Si la división por persona/productos entra al piloto y cómo se asigna sin alterar el ledger.

S8.1–S8.2 pueden modelar intención y lectura sin elegir esas políticas. S8.3+ no debe ampliar SQL, estados persistidos, métodos, refunds o conciliación hasta resolver las decisiones aplicables.
