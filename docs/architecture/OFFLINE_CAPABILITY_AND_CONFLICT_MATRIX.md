# Matriz de capacidades offline y conflictos — Fase 3

**Estado:** propuesta de política objetivo para revisión humana

**Alcance:** Web POS, Mobile y KDS en Fase 3 (offline por dispositivo)

**Fuera de alcance:** elección de base local, librería de sincronización, servidor LAN, pagos integrados, reglas fiscales definitivas y cambios de esquema

## 1. Propósito y límites

Esta matriz define qué puede hacer cada cliente cuando la conectividad cambia y cómo se debe resolver una mutación concurrente al sincronizar. Es una política conservadora: ante duda se conserva la evidencia, se evita una fusión silenciosa y se envía el caso a `manual_review`.

La autoridad de datos en Fase 3 es la nube/API. Cada dispositivo puede continuar con una réplica local y una outbox durable, pero sincroniza de forma independiente. **Sin WAN no existe comunicación directa ni garantía de entrega entre Web POS, Mobile y KDS**, aunque los dispositivos estén en la misma sucursal o conectados a la misma red local. Un pedido creado en un dispositivo no se considera visible en otro hasta que el servidor lo acepte y el otro dispositivo lo reciba.

Fase 3B (servidor local/relay LAN, promoción, failover y reconciliación) requiere una ADR separada. Nada de esta matriz implica que Fase 3 incluya operación LAN multi-dispositivo.

### 1.1 Estados de conectividad

| Estado | Definición operativa | Autoridad y sincronización |
|---|---|---|
| `online` | El cliente alcanza la API y recibe respuestas verificables. | API autoritativa; push/pull normal. |
| `degraded` | Hay WAN, pero hay timeout, pérdida de respuesta o reintentos. | La operación local solo se confirma cuando queda en outbox durable; el resultado por evento puede ser `accepted`, `duplicate`, `rejected`, `conflict` o `manual_review`. |
| `offline` | No hay WAN utilizable; no se debe inferir que otros dispositivos recibieron cambios. | Réplica y outbox de este dispositivo; no hay coordinación entre clientes. |
| `reconnecting` | Se recupera la conexión y la cola aún no está reconciliada. | No se anuncia “sincronizado” hasta confirmar push y pull; se aplican validaciones del servidor. |
| `sync_blocked` | Hay eventos rechazados, incompatibles, esquema atrasado o `manual_review` pendiente. | Las operaciones afectadas quedan retenidas; las no afectadas pueden continuar según su capacidad. |

La UI debe mostrar estado de conexión, sucursal, turno/caja, cantidad de eventos pendientes, último sync confirmado y errores recuperables. `offline` no significa “servidor local” ni “modo LAN”.

## 2. Matriz de capacidades objetivo

**Leyenda:** ✅ operación ofrecida por ese cliente cuando la red y sus reglas lo permiten; ⚠️ operación ofrecida con precondiciones (por ejemplo, hardware o autorización); ⛔ no ofrecida en Fase 3; N/A no aplica. Las columnas de estado de red son la decisión efectiva para ese estado. Las precondiciones se verifican localmente solo como ayuda operativa y se revalidan en el servidor al sincronizar. Un permiso cacheado nunca sustituye autorización vigente.

### 2.1 Operaciones por cliente y estado de red

| Operación | Web POS | Mobile | KDS | `online` / `degraded` | `offline` / `reconnecting` |
|---|---:|---:|---:|---|---|
| Consultar menú, precios y modificadores cacheados | ✅ | ✅ | N/A | ✅ lectura actual; indicar versión | ✅ solo versión cacheada; no afirmar actualidad |
| Consultar mesas/canales cacheados | ✅ | ✅ | N/A | ✅ | ⚠️ lectura local; el estado puede estar obsoleto |
| Crear orden local con identificadores y snapshots | ✅ | ✅ | N/A | ✅ push inmediato o en cola | ⚠️ solo local; la orden no es visible en otros dispositivos |
| Editar/agregar líneas de una orden creada en este dispositivo | ✅ | ✅ | N/A | ✅ | ⚠️ si el estado local acepta líneas y existe snapshot; queda pendiente |
| Editar una orden originada en otro dispositivo | ✅ | ✅ | N/A | ✅ con versión vigente | ⛔ no disponible; no existe garantía de que el dispositivo la haya recibido |
| Asignar mesa/canal o cambiar ocupación | ✅ | ✅ | N/A | ✅ con versión esperada | ⚠️ solo estado local; conflicto posterior no se oculta |
| Aplicar descuento/cortesía que no requiere supervisor | ✅ | ✅ | N/A | ✅ con autorización del servidor | ⚠️ solo si la regla versionada, vigencia, límite y permiso local ya permiten la acción sin supervisor; revalidación obligatoria |
| Descuento/cortesía fuera de límite o reapertura sensible | ✅ | ✅ | N/A | ⚠️ autorización de supervisor y auditoría | ⛔ hasta revalidar; no crear una excepción silenciosa |
| Avanzar KDS de un ticket ya recibido y asignado a la estación | N/A | N/A | ⚠️ | ✅ | ⚠️ solo local, con estado monotónico y auditoría; otros clientes no lo ven aún |
| Recibir una orden/ticket nuevo desde otro dispositivo | N/A | N/A | ✅ | ✅ por API/stream y recuperación por cursor | ⛔; no hay comunicación directa entre dispositivos |
| Reasignar ticket a otra estación o sucursal | N/A | N/A | ⚠️ | ✅ con autorización y alcance | ⛔ |
| Ver tickets previamente recibidos en KDS | N/A | N/A | ✅ | ✅ | ✅ solo caché; mostrar hora de última recepción |
| Registrar cobro en efectivo | ✅ | ⚠️ según hardware y caja/turno local | N/A | ✅ | ⚠️ solo con caja, cajero, secuencia e idempotency key disponibles; conciliación posterior |
| Emitir/imprimir ticket de una venta local | ✅ | ⚠️ según hardware | N/A | ✅ | ⚠️ si la plantilla y datos están cacheados; conservar comprobante y estado pendiente |
| Registrar `card_manual` | ⚠️ | ⚠️ | N/A | ⚠️ registrar referencia/evidencia, sin simular integración | ⚠️ solo si una terminal externa confirmó por su propio canal; conciliación posterior y advertencia visible. No se marca `captured` por este registro ni se guardan PAN/CVV. |
| Iniciar/consultar cobro por pasarela o terminal integrada | ⛔ | ⛔ | N/A | ⛔ fuera de Fase 3; solo existe `card_manual` | ⛔ |
| Reembolso, anulación financiera o ajuste de pago | ⛔ | ⛔ | N/A | ⛔ fuera de Fase 3; requiere integración futura | ⛔; enviar solicitud pendiente no equivale a reembolsar |
| Cerrar/reabrir caja o ejecutar corte X/Z | ✅ | ✅ | N/A | ✅ con autoridad del servidor | ⛔ por defecto; queda para decisión explícita de capacidad offline |
| CFDI/timbrado, consulta fiscal o documento dependiente de PAC | ⛔ | ⛔ | N/A | ⛔ fuera de Fase 3 | ⛔ |
| Ajustar inventario, consumir/recibir mercancía o aprobar compra | ⛔ | ⛔ | N/A | ⛔ fuera de Fase 3 | ⛔; no crear existencias locales que parezcan globales |
| Reporte consolidado multi-sucursal | ✅ lectura | ✅ lectura | ⛔ | ✅ | ⛔; solo reportes locales explícitamente rotulados |
| Borrado físico de entidad sincronizable | ⛔ | ⛔ | ⛔ | ⛔ | ⛔; usar tombstone y política de retención |

### 2.2 Precondiciones comunes para una operación ⚠️

Antes de confirmar localmente una operación condicional, el cliente debe comprobar, como mínimo:

- sesión, actor, `restaurantId`, `branchId`, dispositivo y turno/caja correctos;
- permiso vigente en caché solo para operaciones que no exigen supervisor; una
  autorización de supervisor que el dominio exige verificar en servidor nunca
  se sustituye por caché ni por revalidación posterior;
- estado local compatible y `baseVersion` esperada;
- snapshots de catálogo, impuestos y descuentos completos, versionados e inmutables para la orden;
- `eventId`, `idempotencyKey` y secuencia local monotónica únicos y persistidos junto con el cambio;
- mensaje de advertencia que indique “solo este dispositivo” cuando WAN no esté disponible.

Si falta cualquiera de estas pruebas, la UI bloquea la operación o la deja como borrador no confirmable. La cola no debe reinterpretar un rechazo como éxito.

### 2.3 Mensajes mínimos de UI

Los mensajes deben ser accionables, accesibles y persistir en el detalle del evento. Ejemplos de copy objetivo:

| Situación | Mensaje |
|---|---|
| Sin WAN | “Sin conexión. Este cambio se guardó en este dispositivo; no está disponible en otros equipos todavía.” |
| Cola pendiente | “Pendientes de sincronizar: {n}. Puedes continuar con operaciones permitidas.” |
| Reintento | “No se confirmó la respuesta. Conservamos el cambio y lo reintentaremos sin duplicarlo.” |
| Rechazo de permiso | “La autorización no fue válida en el servidor. El cambio no se aplicó.” |
| Conflicto no financiero | “Otro cambio usa una versión distinta. Conservamos ambas evidencias; revisa antes de continuar.” |
| Conflicto financiero | “Operación financiera pendiente de revisión. No se fusionó ni se cobró de nuevo.” |
| Ticket KDS local | “Estado guardado en este KDS; otras estaciones lo verán al sincronizar.” |
| Reconciliación completa | “Sincronización confirmada a las {hora}. No hay pendientes.” |
| Esquema atrasado | “Esta versión de la app debe actualizarse antes de sincronizar esta operación.” |

No usar `alert`, `confirm` ni `prompt`. Los bloqueos deben ofrecer ver detalle, reintentar cuando sea seguro y escalar a supervisor cuando corresponda.

## 3. Contrato de evento y autoridad

Cada mutación sincronizable conserva un envelope con `eventId`, `idempotencyKey`, `deviceId`, `actorId`, `restaurantId`, `branchId`, `entityType`, `entityId`, `operation`, `schemaVersion`, `localSequence`, `baseVersion`, `occurredAt`, `receivedAt`, `payload`, `retryCount` y estado local. `receivedAt` queda vacío hasta la recepción del servidor; el reloj del cliente no ordena eventos por sí solo.

El flujo objetivo es:

1. Validar la intención contra el estado local y guardar estado + outbox de forma atómica.
2. Reintentar por lote con backoff; un timeout no autoriza a crear un segundo evento.
3. Autenticar, revalidar Restaurant/Branch/actor/permiso, validar esquema y deduplicar en el servidor.
4. Aplicar dentro de una transacción o devolver `accepted`, `duplicate`, `rejected`, `conflict` o `manual_review` por evento, con versión/referencia canónica recuperable.
5. Confirmar solo el outbox del evento, conservar un error recuperable o abrir `manual_review`; nunca marcar como aplicado por la sola existencia local ni avanzar el cursor de pull con una respuesta de push.
6. Hacer pull incremental con cursor opaco versionado y migrar clientes atrasados antes de aplicar eventos incompatibles.

La autoridad de servidor prevalece sobre el timestamp del dispositivo, pero no convierte un conflicto en un merge automático. Toda mutación sensible debe conservar actor, sucursal, dispositivo, instante, motivo y autorización.

## 4. Matriz de conflictos y resolución

### 4.1 Resultados y reglas

| Resultado | Uso | Tratamiento |
|---|---|---|
| `accepted` | Evento válido, autorizado, con versión compatible o combinación aditiva segura. | Confirmar outbox y mostrar éxito local; programar pull, sin avanzar `pullCursor`. |
| `duplicate` | El servidor ya aplicó el mismo `eventId` o la misma intención idempotente y devuelve el resultado original. | Confirmar outbox con ese resultado; hacer pull normal, sin crear otro efecto ni avanzar `pullCursor`. |
| `rejected` | Permiso inválido, esquema inválido, entidad fuera de scope, precondición incumplida o stale write no recuperable. | No aplicar; estado terminal para el envelope. Conservar motivo; una nueva intención solo se crea si la regla de dominio lo permite. |
| `conflict` | Dos intenciones válidas no pueden combinarse de manera segura. | No elegir por timestamp/LWW; retener evidencia y abrir `manual_review`. |
| `manual_review` | Estado visible de una entidad o conjunto de eventos que requiere una decisión autorizada. | Bloquear operaciones dependientes; resolución explícita y auditada. |
| `compensated` | Corrección posterior aprobada para un hecho ya aplicado. | Crear movimiento/evento compensatorio enlazado; nunca editar o borrar el hecho original. |

La deduplicación por `eventId` o `idempotencyKey` devuelve el resultado original. La repetición de una solicitud después de perder la respuesta no puede duplicar una orden, ticket, pago, reembolso o movimiento de caja. **Nunca se usa Last-Write-Wins (LWW) para dinero, pagos, caja, inventario, descuentos/cortesías autorizadas ni estados críticos de orden/KDS.**

### 4.2 Política por entidad y operación

Las filas de reembolso e inventario especifican cómo preservar evidencia si un
evento llega por una integración o si una fase posterior habilita la capacidad;
**no** habilitan esas operaciones en Fase 3. La matriz de la sección 2 sigue
siendo la autoridad de qué puede confirmarse o encolarse por cliente y red.

| Entidad / operación concurrente | Merge permitido | Validación y autorización | Resultado ante conflicto | Corrección posterior |
|---|---|---|---|---|
| Catálogo: dos ediciones del mismo producto/modificador | No merge de campos sensibles; cada edición requiere versión esperada. | Validar `catalogVersion`, alcance y permiso de catálogo. Una orden usa su snapshot histórico, no el precio actual. | `rejected` por stale write si puede rebasarse de forma segura; si hay cambios incompatibles, `manual_review`. | Nueva versión de catálogo; nunca reprecificar una orden histórica. |
| Catálogo: productos distintos o nuevas líneas con IDs distintos | Sí, si no rompen claves únicas ni reglas de menú. | Validar scope, SKU/identificador y versión de esquema. | `accepted` o `rejected` por restricción concreta. | Evento compensatorio de catálogo, no borrado físico. |
| Mesas/canales: dos asignaciones, apertura/cierre o cambio de ocupación | No merge de dos estados exclusivos. | Validar branch, `baseVersion`, turno y permiso; evitar asignación a mesa ocupada. | `conflict` → `manual_review`; no desplazar silenciosamente al comensal. | Decisión auditada que establece el estado vigente; conservar ambas intenciones. |
| Mesas/canales: cambios sobre mesas diferentes | Sí, si pertenecen al mismo scope y no comparten una reserva exclusiva. | Validar branch y permisos. | `accepted`. | Evento compensatorio si se corrigió una asignación ya comunicada. |
| Orden: dos dispositivos agregan líneas distintas | Sí: combinar eventos aditivos con `orderItemId` distintos. | Validar que la orden aún acepte líneas, scope, snapshots y permisos. | `accepted`; recalcular en servidor con snapshots, sin floats. | Anulación compensatoria de una línea si fue agregada por error. |
| Orden: ambos modifican cantidad, precio, descuento o cliente de la misma línea | No merge implícito. | `baseVersion`, snapshot y autorización; el cliente no puede cambiar total histórico arbitrariamente. | `conflict` → `manual_review`, salvo una regla de dominio expresamente determinista. | Corrección auditada o línea compensatoria; no sobrescribir historia. |
| Orden/ítem: transición de estado válida y monotónica desde la misma versión | Sí solo si son el mismo resultado o una transición compatible. | Máquina de estados centralizada, scope y permiso. | `accepted` o deduplicado; nunca retroceder estado. | Transición compensatoria solo si el dominio la permite. |
| Orden/ítem: cancelar vs preparar/entregar, o cancelar ítem ya enviado | No merge. | Motivo, actor, branch, device, timestamp y autorización de supervisor; validar evidencia KDS. | `conflict` → `manual_review`; cancelación post-envío nunca es silenciosa. | Cancelación autorizada + auditoría; compensar inventario/caja si ya hubo efectos. |
| KDS: dos ACK/inicios/listos para el mismo ticket | Sí si representan el mismo estado y estación autorizada; idempotencia por evento. | Scope estricto por branch/station y transición monotónica. | `accepted` o deduplicado. | Evento de corrección auditado si la estación equivocada actuó. |
| KDS: estados incompatibles, doble estación o ticket perdido | No merge automático. | Releer por cursor y comprobar ticket, station y orden. | `conflict` → `manual_review`; mantener ticket visible hasta decisión. | Reasignación/avance autorizado y trazable; nunca ocultar pérdida. |
| Descuento/cortesía: dos aplicaciones distintas sobre la misma orden | No sumar automáticamente si compiten por la misma base o exceden límites. | Validar regla/version, vigencia, base imponible, límite y autorización. | `conflict` o `rejected`; `manual_review` cuando el resultado financiero sea ambiguo. | Nuevo descuento o reversa compensatoria, con motivo y aprobador. |
| Descuento/cortesía: eventos distintos autorizados y no excluyentes | Sí solo si la política fiscal/comercial lo permite y la suma queda dentro del límite. | Recalcular en servidor con orden de aplicación y snapshots. | `accepted`; registrar estrategia/version. | Compensación inmutable si se detecta error. |
| Cancelación/reapertura de orden | No merge de dos decisiones sobre una orden pagada/cerrada. | Estado central, motivo, permiso de supervisor y auditoría. | `conflict` → `manual_review`; no reabrir por LWW. | Reapertura/cancelación autorizada y asientos compensatorios donde aplique. |
| Pago: dos cobros para la misma obligación o mismo `idempotencyKey` | Mismo idempotency key: deduplicar; claves distintas: nunca fusionar ni descartar uno por LWW. | Estado de orden, monto exacto en minor units, moneda, caja/cajero y proveedor si aplica. | Duplicado exacto → resultado original; cobro ambiguo/excedente → `manual_review`, bloquear nuevo cobro. | Reembolso/ajuste compensatorio aprobado; no borrar el pago ni fingir confirmación de proveedor. |
| Pago: efectivo offline | Eventos aditivos pueden registrarse por secuencia de caja si no exceden límites locales aprobados. | Caja, cajero, branch, secuencia, monto y recibo; revalidación server-side. | `accepted` o `manual_review` por salto/duplicado de secuencia o total imposible. | Movimiento compensatorio de caja y conciliación auditada. |
| Reembolso/anulación | No merge ni ejecución offline por defecto. | Pago original, estado liquidado, monto, motivo y autorización; proveedor confirma cuando exista. | `rejected` si falta precondición; `manual_review` si existe respuesta incierta. | Reembolso confirmado o compensación enlazada; jamás marcar “reembolsado” localmente sin evidencia. |
| Cierre/reapertura de caja | No merge de cierres concurrentes. | Turno, caja, secuencia, conteo y permiso de supervisor; servidor autoritativo. | `conflict` → `manual_review`; bloquear doble cierre. | Cierre corregido mediante ajuste auditado, no edición destructiva. |
| Inventario: movimientos de entradas/salidas distintos *(no habilitado en Fase 3)* | Solo combinar como movimientos inmutables si cada uno es válido y el saldo resultante no viola reglas. | Producto, branch, lote/unidad si aplica, autorización y versión de existencias. | `accepted` por movimientos independientes; saldo negativo/ambigüedad → `manual_review`. | Movimiento compensatorio enlazado; nunca reescribir el movimiento original. |
| Inventario: dos ajustes sobre la misma existencia o recepción/consumo que cruza cero *(no habilitado en Fase 3)* | No LWW ni suma ciega. | Revalidar disponibilidad, versión y permisos en servidor. | `conflict` → `manual_review`; no ocultar sobrantes ni faltantes. | Conteo/ajuste aprobado como nuevo movimiento. |
| Borrado sincronizable | No borrado físico; un tombstone es idempotente. | Scope, permiso, retención y `baseVersion`. | Tombstone repetido → `accepted` idempotente. Update atrasado → `rejected`/`conflict` sin resurrección. Recreación solo con ID nuevo y regla explícita; si compite por identidad semántica, `manual_review`. | Restaurar o recrear con nuevo identificador/version, nunca reutilizar silenciosamente el ID borrado. |

Los registros financieros, pagos, reembolsos, cierres de caja y movimientos de inventario son append-only. Una corrección siempre apunta al evento original, al actor autorizador y al motivo.

## 5. Failure injection y matriz de pruebas

Estas pruebas deben ejecutarse con datos de dos restaurantes y dos sucursales, actores con permisos distintos y al menos dos dispositivos por cliente cuando aplique. Deben comprobar el estado local, outbox, respuesta del servidor, auditoría, cursor y estado visible en UI.

| Inyección / escenario | Expectativa verificable | Clientes |
|---|---|---|
| Cortar WAN antes de persistir estado local | La operación no aparece confirmada; no hay evento huérfano ni pérdida silenciosa. | Web POS, Mobile, KDS |
| Cierre forzado alrededor del commit local de réplica + outbox | Antes del commit no existe ninguno; después existen ambos y se recuperan atómicamente tras reinicio. | Web POS, Mobile |
| Cierre forzado después de enviar y antes de recibir respuesta | Reenvío con la misma idempotency key devuelve el resultado original y no duplica. | Web POS, Mobile, KDS |
| Timeout después de commit del servidor | Reenvío con mismo `eventId`/idempotency key recupera el resultado original; confirma el outbox y luego hace pull normal, sin generar segundo cobro, ticket o movimiento. | Web POS, Mobile |
| Push `accepted` mientras falla el pull posterior | El outbox queda terminal, pero `pullCursor` no avanza; el siguiente pull aplica también los cambios concurrentes que no venían en la respuesta de push. | Todos |
| Repetir lote y eventos fuera de orden | Deduplicación mantiene un único resultado; `localSequence` no se reutiliza, los huecos cross-scope no crean causalidad y `baseVersion`/máquina de estados bloquean dependencias adelantadas. | Todos |
| Dos dispositivos agregan líneas distintas a una orden | Ambas líneas se conservan; total server-side con snapshots; no se pierde una línea. | Web POS + Mobile |
| Dos dispositivos editan la misma línea/precio/descuento | `conflict`/`manual_review`, sin sobrescritura LWW ni total silencioso. | Web POS + Mobile |
| Cancelar ítem mientras KDS lo prepara | Cancelación post-envío exige autorización/motivo; estado KDS no retrocede. | Web POS + KDS |
| Dos estaciones avanzan el mismo ticket | Estado igual es idempotente; estados incompatibles quedan visibles para revisión. | KDS + KDS |
| Pago repetido con misma y distinta idempotency key | Misma clave deduplica; clave distinta no duplica cobro y abre revisión si excede la obligación. | Web POS + Mobile |
| Reembolso con pago pendiente o respuesta del proveedor perdida | No se marca reembolsado sin evidencia; queda retenido para revisión. | Web POS, Mobile |
| Reloj adelantado/atrasado y `occurredAt` manipulado | El orden no depende del reloj cliente; auditoría conserva ambos tiempos. | Todos |
| Actor revocado mientras hay eventos offline | Push se revalida y rechaza eventos no autorizados; no se aplica por permiso cacheado. | Todos |
| Evento de otra sucursal/restaurante | Se rechaza sin filtrar solo en UI; no se crea estado local fuera de scope. | Todos |
| Cliente con `schemaVersion` atrasada | Se detiene el evento incompatible, se ofrece migración/actualización y no se corrompe la cola. | Todos |
| Tombstone seguido de update/recreación | No resucita silenciosamente; conflicto visible y recreación con política explícita. | Todos |
| Cola grande, backoff, reconexiones intermitentes | Progreso observable, orden local monotónico, límites de reintento y recuperación sin duplicados. | Todos |
| Saldo de inventario concurrente que cruza cero | No oversell silencioso; rechazo o `manual_review` y movimiento compensatorio posterior. | Web POS, Mobile |
| WAN caída con Web POS, Mobile y KDS en la misma LAN | Cada dispositivo solo ve sus propios cambios; la UI no afirma entrega entre dispositivos. | Todos |

## 6. Criterios de aceptación de Fase 3

La política se considera demostrada únicamente cuando:

1. La matriz de capacidades se prueba en `online`, `degraded`, `offline`, `reconnecting` y `sync_blocked`, con Web POS, Mobile y KDS, y la UI muestra sucursal, conexión, pendientes y último sync.
2. Reinicio, cierre forzado y reintento no pierden una operación confirmada localmente ni generan duplicados.
3. El servidor autentica, revalida Restaurant/Branch/actor/permiso, valida esquema y deduplica cada evento; un permiso cacheado no basta.
4. Pull por cursor recupera eventos omitidos y reconstruye KDS después de perder una notificación; Realtime, si existe, no se trata como entrega durable.
5. Dos dispositivos agregando líneas distintas combinan correctamente; edición concurrente y cancelación vs preparación son deterministas y auditables.
6. Pagos, reembolsos y cierres ambiguos nunca se fusionan por LWW, no duplican cobros y quedan en `manual_review` con evidencia suficiente.
7. Dinero, impuestos, descuentos y propinas se calculan en servidor con representación exacta y snapshots; los clientes no recalculan ventas históricas desde el catálogo actual.
8. Actores revocados, scopes cruzados, clientes atrasados y eventos fuera de sucursal son rechazados sin fuga de datos.
9. Tombstones, compensaciones de inventario y correcciones financieras preservan la inmutabilidad y trazabilidad del hecho original.
10. La cola es observable y recuperable: cada evento muestra estado, reintentos, último error y acción segura disponible; no hay “éxito” basado solo en almacenamiento local.
11. La prueba explícita de LAN sin WAN confirma que no existe garantía de comunicación Web POS → KDS, Mobile → KDS ni entre otros dispositivos en Fase 3.
12. Las brechas de hardware, proveedor de pagos, fiscalidad o plataforma se documentan y no se presentan como capacidad general del producto.

## 7. Política objetivo frente a decisiones pendientes

### Política objetivo (aplica salvo cambio aprobado)

- Fase 3 es offline por dispositivo con nube/API autoritativa; no es Fase 3B LAN.
- Las escrituras locales usan outbox durable, envelopes versionados, idempotencia, cursor pull y revalidación server-side.
- Se permiten offline, con límites explícitos, consulta cacheada, órdenes locales, efectivo/ticket y estados locales de tickets ya recibidos; tarjetas integradas, fiscal, reembolsos, cierres de caja e inventario quedan bloqueados por defecto.
- Los eventos aditivos seguros pueden combinarse; las intenciones exclusivas o estados críticos requieren versión, autorización y revisión si divergen.
- No hay LWW para dinero, pagos, caja, inventario, descuentos/cortesías autorizadas ni estados críticos.
- Los hechos financieros y de inventario son inmutables; la corrección es compensatoria y auditada.
- Todo conflicto ambiguo es visible, recuperable y escalable a `manual_review`; ningún timestamp del cliente decide por sí solo.

### Decisiones humanas, fiscales y de proveedor pendientes

Estas preguntas no quedan resueltas por esta matriz y deben aprobarse antes de convertir cada capacidad en promesa comercial:

- ¿El v1 incluye Web POS offline, Mobile offline y/o KDS con avance local? ¿Qué operaciones y límites exactos puede ejecutar cada rol?
- ¿Qué país, moneda, zona horaria, tasas, impuestos incluidos/excluidos, propinas, descuentos y tratamiento de CFDI aplican? ¿Qué asesoría fiscal valida el orden de cálculo?
- ¿Se acepta efectivo offline y bajo qué límite, secuencia de caja, ventana temporal y procedimiento de conciliación?
- ¿El registro `card_manual` se permite offline solo con qué terminal externa, evidencia, contrato del proveedor y responsabilidad de conciliación?
- ¿Qué hardware de impresión y cajón soportan Web POS/Mobile, y qué se hace si no hay impresora?
- ¿Qué retención, autorización y SLA tendrá `manual_review`? ¿Qué rol puede aprobar compensaciones y reembolsos?
- ¿Qué garantía de recuperación, RPO/RTO, límites de cola y política de actualización tendrán clientes atrasados?
- ¿KDS multi-dispositivo durante caída total de WAN es requisito? Si lo es, se debe aprobar ADR-009/Fase 3B con autoridad local, failover, split-brain y reconciliación; no se obtiene de esta matriz.
- ¿Qué proveedor de pagos/fiscalidad ofrece contratos verificables para estados, reintentos, refunds, webhooks y operación fuera de línea?

Hasta resolver estas decisiones, la UI debe etiquetar las capacidades como “propuesta”, mantener bloqueadas las operaciones de alto riesgo y evitar cualquier afirmación de operación LAN o de cobro integrado offline.
