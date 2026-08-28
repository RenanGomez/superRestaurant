# Contrato de sincronización offline por dispositivo

- Estado: **PROPUESTA PARA FASE 3**
- Alineación: ADR-004, secciones 9, 11 y 17 del plan maestro
- Alcance: contrato lógico de eventos, outbox, push y pull
- Fecha: 2026-08-26

Este documento define una especificación implementable para la sincronización
offline de Fase 3. No implementa clientes, API, almacenamiento local, outbox ni
un motor de sincronización. Tampoco selecciona una base local, una librería, un
ORM, un transporte HTTP/WebSocket o un proveedor de autenticación.

La palabra **MUST** en este documento significa requisito del contrato; **SHOULD**
es una recomendación que puede apartarse solo con una decisión documentada; y
**MAY** indica una extensión compatible.

## 1. Contexto, topología y garantías

### 1.1 Topología por fase

En Fases 1 y 2 el sistema es online-first: la nube/API es la autoridad y no se
promete una base local persistente para operar durante una partición.

En Fase 3 cada Web POS o cliente mobile puede tener una réplica local y un
outbox durable. El flujo es:

```text
UI -> transacción local (réplica + outbox) -> push por lote -> API autoritativa
 ^                                                        |
 +---------------- pull por cursor ----------------------+
```

La API/nube mantiene el estado canónico. Cada dispositivo sincroniza de forma
independiente; **no hay comunicación directa entre dispositivos**. En
particular, un dispositivo offline no puede prometer que una orden aparecerá
en otro dispositivo o en KDS antes de sincronizar con la API.

La siguiente topología no forma parte de este contrato:

- Fase 3B podría añadir un servidor de sucursal/LAN autoritativo durante una
  caída total de internet.
- Esa opción requiere una ADR separada para autoridad, promoción, failover,
  split-brain, backup local y reconciliación cloud.
- Un cliente no debe asumir simultáneamente autoridad cloud y autoridad LAN.

### 1.2 Matriz mínima de garantías

La interfaz debe comunicar el estado real al operador:

| Capacidad | Fase 3 por dispositivo | Garantía contractual |
| --- | --- | --- |
| Consultar menú/tickets ya recibidos | Permitido desde caché local | Puede quedar desactualizado; muestra versión/fecha |
| Abrir o modificar una operación admitida | Permitido en local | Se conserva en outbox si la transacción local confirma |
| Registrar efectivo/ticket admitido | Solo donde la matriz de capacidades lo autorice | No equivale a liquidación server-side hasta aceptar el evento |
| Tarjeta por pasarela/terminal remoto | No disponible offline | Requiere red y contrato del proveedor |
| CFDI/timbrado | No disponible offline | Requiere red |
| Nueva orden visible en otro dispositivo sin WAN | No garantizado | Requiere servidor LAN de Fase 3B |
| Reporte consolidado multi-sucursal | No disponible offline | Requiere red y consulta autoritativa |

Una operación que la matriz no habilite no se encola como si hubiera sido
aceptada. La UI debe distinguir, como mínimo, `local_pending`, `server_accepted`,
`rejected`, `conflict` y `manual_review`.

## 2. Vocabulario y modelo de versiones

- **Evento**: intención de mutación de una entidad, una sola vez, con identidad
  propia y datos de auditoría.
- **Réplica local**: estado utilizable por el dispositivo, que puede estar
  atrasado respecto del servidor.
- **Outbox**: registro durable de eventos que todavía no tienen un resultado
  terminal conocido por el dispositivo.
- **Versión de entidad**: versión canónica de una entidad en el servidor; se
  incrementa de acuerdo con la mutación aceptada, no con el reloj del cliente.
- **Cursor**: posición opaca y versionada del historial de cambios que puede
  leer un principal dentro de un scope.
- **Scope**: `restaurantId` y, cuando corresponda, `branchId`; toda operación
  está autorizada dentro de ese límite.

`localSequence` y `baseVersion` son mecanismos distintos:

- `localSequence` ordena y detecta huecos dentro de un dispositivo.
- `baseVersion` expresa la versión de entidad que el cliente creyó haber
  leído y permite detectar escrituras obsoletas.
- Ninguno de los dos sustituye al orden canónico ni a la versión asignada por
  el servidor.

`localSequence` tampoco prueba causalidad entre dispositivos ni autoriza a
aplicar una transición fuera de orden. El servidor rechaza reutilizaciones o
retrocesos, conserva los saltos para diagnóstico y usa `baseVersion`, las
dependencias explícitas y la máquina de estados de cada entidad para decidir
si un evento separado por un hueco puede aplicarse. Un evento dependiente no
puede adelantar silenciosamente a su causa solo porque llegó en un lote.

## 3. Envelope de evento

El envelope persistido por el servidor contiene, como mínimo, estos campos.
Los nombres son parte del contrato lógico; el formato de transporte puede ser
JSON u otro formato equivalente una vez definido el transporte.

| Campo | Tipo lógico | Emisor/semántica |
| --- | --- | --- |
| `eventId` | UUID o ULID, string | Identidad de este envelope. Se genera una vez y no cambia al reintentar. |
| `idempotencyKey` | string opaca no vacía | Identidad de la intención de negocio. Permanece igual entre reintentos o reconstrucciones de la misma intención. |
| `deviceId` | UUID/ULID, string | Dispositivo que originó el evento. Debe estar registrado y habilitado para el scope. |
| `actorId` | UUID/ULID, string | Actor declarado para auditoría; el servidor lo deriva y verifica desde la sesión/membresía autenticada. Nunca se acepta solo por venir del payload. |
| `restaurantId` | UUID/ULID, string | Límite obligatorio de tenant. El servidor comprueba pertenencia y autorización. |
| `branchId` | UUID/ULID, string | Sucursal del evento. Debe pertenecer a `restaurantId` y estar autorizada para el actor/dispositivo. |
| `entityType` | identificador versionado, string | Tipo de entidad sincronizable, por ejemplo `Order` o `Payment`. No se aceptan tipos desconocidos. |
| `entityId` | UUID/ULID, string | Identidad de la entidad; no se sustituyen IDs sincronizables por autoincrementos locales. |
| `operation` | enum versionado | Operación de dominio, por ejemplo `create`, `update`, `transition`, `delete` o `compensate`; la lista real se define por entidad. |
| `schemaVersion` | string de versión | Versión del esquema del envelope y payload. Debe tener una migración/compatibilidad explícita. |
| `localSequence` | entero positivo o cero | Secuencia monotónica global por `deviceId`, asignada dentro de la transacción local. No se reinicia al cerrar la aplicación ni al cambiar de Restaurant/Branch. |
| `baseVersion` | entero no negativo o `null` | Versión canónica esperada de `entityId`; `null` solo es válido cuando la regla de creación lo permite. |
| `occurredAt` | timestamp RFC 3339 UTC | Hora del dispositivo. Sirve para contexto y auditoría, pero es no confiable y nunca decide por sí sola el orden o autorización. |
| `receivedAt` | timestamp RFC 3339 UTC | Hora asignada por el servidor al recibir el envelope. No puede ser escrita por el cliente. En el registro server-side es obligatoria. |
| `payload` | objeto validado por esquema | Intención y datos necesarios para aplicar la operación; el servidor vuelve a validar tipos, invariantes, scope y permisos. |
| `retryCount` | entero no negativo | Contador durable local de intentos de entrega. El cliente lo incrementa de forma atómica y el servidor no lo usa como autoridad. |
| `localState` | enum local | Estado del outbox. Se conserva localmente y se mapea al resultado del servidor; no se trata como una mutación de dominio confiable. |

El servidor puede añadir `serverVersion`, `canonicalVersion`, `committedAt`,
`outcomeCode`, `auditId` y referencias a la resolución. Esos campos son
metadatos autoritativos y deben conservarse junto con el resultado.

### 3.1 `eventId` frente a `idempotencyKey`

No son intercambiables:

| Identidad | Qué identifica | Regla de reenvío | Protección |
| --- | --- | --- | --- |
| `eventId` | Un envelope de sincronización concreto | Se conserva al repetir exactamente ese evento | Evita procesar dos veces el mismo envelope |
| `idempotencyKey` | Una intención de negocio, por ejemplo “registrar este pago” | Se conserva aunque el cliente reconstruya el request tras perder la respuesta | Evita dos efectos de negocio cuando cambia el envelope o la conexión |

El servidor debe mantener una huella de la solicitud y del resultado. Reusar una
`idempotencyKey` con payload, entidad, operación o scope incompatibles produce
un rechazo explícito (`IDEMPOTENCY_KEY_REUSE`), nunca una segunda aplicación ni
una respuesta de otro tenant. Un `eventId` repetido con contenido diferente
produce un rechazo de integridad y una señal auditable.

La consulta de deduplicación ocurre después de autenticar y comprobar el scope;
no puede revelar que existe una clave de otro restaurante o sucursal. La
unicidad efectiva debe quedar aislada por tenant y operación según la regla de
la entidad, aun cuando el identificador físico sea global.

### 3.2 Secuencia local y relojes

El dispositivo asigna `localSequence` dentro de la misma transacción que crea el
evento. Debe ser una sola secuencia global por `deviceId`, incluso después de
reinicio, cierre forzado, reintento o cambio de Restaurant/Branch. Esto cumple
la secuencia monotónica por dispositivo del plan y evita reinicios encubiertos
del contador al cambiar de scope. Un salto puede quedar registrado; una
reutilización o retroceso debe bloquear la emisión local y conservar el evento
para diagnóstico. La secuencia no relaja el aislamiento: el servidor solo la
evalúa después de autenticar y validar el scope del envelope.

`occurredAt` puede estar adelantado, atrasado o ser manipulado. El servidor usa
`receivedAt` y su secuencia/versión canónica para ordenar efectos. La hora del
cliente solo aporta contexto y no puede hacer que una cancelación preceda una
preparación, autorizar un pago o resolver un conflicto.

## 4. Autoridad y aplicación canónica

1. El cliente valida la intención contra su réplica local y la matriz de
   capacidades.
2. Una transacción local actualiza la réplica y crea el envelope del outbox.
3. El cliente envía uno o más envelopes por push.
4. El servidor autentica la solicitud, verifica dispositivo, actor, membresía,
   permisos y scope inmediatamente antes de cada aplicación.
5. El servidor valida `schemaVersion`, payload, `baseVersion`, invariantes de
   dominio, snapshots, reglas financieras e idempotencia.
6. La mutación aceptada se aplica en una transacción server-side, asignando
   `receivedAt`, versión canónica y auditoría. El orden canónico es el commit
   aceptado por el servidor, no `occurredAt`, `localSequence` ni el orden de
   llegada a la UI.
7. El resultado por evento se devuelve al cliente. Un evento con resultado
   terminal no se vuelve a aplicar al reintentar.
8. El cliente confirma el resultado en su outbox y hace pull para reconciliar
   la réplica local con el estado/cursor server-side.

El servidor recalcula cualquier total, impuesto, descuento, propina, estado de
orden, pago o movimiento de caja. Los importes enviados por el dispositivo son
informativos y no autorizan por sí solos un efecto financiero. Las operaciones
financieras ambiguas no se resuelven con last-write-wins ni mediante el reloj del
cliente: quedan en `manual_review`.

## 5. Push por lote

### 5.1 Request y orden de envío

El request de push contiene una lista finita de envelopes completos y una
versión del protocolo. El tamaño máximo y el transporte quedan pendientes de
la implementación, pero el contrato exige:

- el cliente conserva cada envelope hasta conocer un resultado terminal;
- para eventos del mismo scope, el dispositivo envía primero los pendientes en
  orden ascendente de `localSequence`, salvo que una dependencia explícita
  permita otro orden; al ser la secuencia global por dispositivo puede haber
  huecos que pertenecen a otro scope y no crean una dependencia entre tenants;
- un lote puede contener eventos de varias entidades del mismo scope, pero no
  debe mezclar scopes autorizados distintos;
- el servidor no debe asumir que el lote entero es atómico.

Cada evento obtiene su propia transacción de aplicación y su propio resultado.
Si la implementación ofrece atomicidad de lote, debe declararlo explícitamente;
el cliente no puede inferirla. Un fallo o timeout de un evento no permite
suponer que los demás no fueron committeados.

### 5.2 Resultados por evento

La respuesta incluye una entrada por cada evento recibido, indexada por
`eventId` y `idempotencyKey`, sin omitir entradas por errores parciales.

| Resultado | Semántica | Acción local |
| --- | --- | --- |
| `accepted` | La mutación se validó y se aplicó exactamente una vez; incluye versión y metadatos canónicos. | Marcar el outbox terminal exitoso y programar pull; no avanzar el cursor de pull con esta respuesta. |
| `duplicate` | El servidor ya tiene el mismo `eventId` o la misma intención idempotente con el mismo resultado; no crea un efecto nuevo. | Marcar el outbox terminal usando el resultado original y programar pull; no reemitir otro pago/ticket ni avanzar el cursor de pull. |
| `rejected` | No se aplicó por validación, autorización, schema incompatible, scope, entidad inexistente u otra regla no recuperable. | Terminal para este envelope: conservar código/motivo y no reintentar automáticamente. Una nueva intención solo puede crearse si la regla de dominio lo permite. |
| `conflict` | La intención es válida en forma, pero contradice la versión/estado canónico o una regla determinista de concurrencia. | No auto fusionar; detener dependientes y mostrar resolución requerida. |
| `manual_review` | El servidor detectó ambigüedad que una regla automática no puede resolver, obligatoria para dinero, pagos, cierres o auditoría. | Bloquear reintentos automáticos y abrir un caso durable de revisión. |

El resultado debe incluir un código estable, la versión canónica conocida si es
segura de revelar, y una referencia de auditoría. Los fallos transitorios de
transporte o de disponibilidad no se disfrazan de `rejected`: dejan el outbox
en `retry_wait` con una clasificación `retryable` explícita. No se envían
secretos ni payloads financieros completos como detalle de error.

Un timeout después de que el servidor hizo commit es un caso esperado: el
cliente reenvía el mismo `eventId` y `idempotencyKey`, recibe `duplicate` con el
resultado original y nunca crea un segundo efecto.

### 5.3 Confirmación de outbox y cursor de pull

La confirmación de un envelope y el progreso del changelog son dos registros
distintos. `accepted` o `duplicate` permite cerrar solo el registro de outbox
de ese `eventId`; no permite persistir ni adelantar `pullCursor`. Una respuesta
de push MAY incluir una referencia al cambio, versión canónica o *hint* de que
conviene hacer pull, pero no un cursor que el cliente pueda usar para saltarse
el historial: entre el commit del evento y cualquier posición del changelog
pueden existir cambios de otros dispositivos que ese cliente aún no aplicó.

Solo la transacción local descrita en 6.2, que aplica íntegramente un lote de
pull scoped y persiste su `nextCursor`, puede avanzar `pullCursor`. Tras un
`accepted`, `duplicate`, timeout recuperado o respuesta parcial, el cliente
conserva su cursor anterior y hace pull normal; puede confirmar el outbox en
paralelo sin confundir ambas evidencias.

## 6. Pull incremental

### 6.1 Cursor

Pull recibe un cursor **opaco, versionado y scoped**. El cliente no debe
decodificarlo, construirlo, compararlo lexicográficamente ni reutilizarlo con
otro:

- `cursor = null` significa inicio de una primera carga scoped;
- el servidor liga el cursor a `restaurantId`, `branchId` cuando aplique,
  principal/alcance autorizado y versión del protocolo;
- la respuesta devuelve `nextCursor` y `hasMore`; el cliente persiste el
  cursor solo junto con el lote que se aplicó correctamente;
- un cursor inválido, expirado o de otra versión produce un error explícito y
  requiere una estrategia de resync definida, no un salto silencioso;
- un cursor de otro tenant/sucursal se rechaza sin revelar datos ni posición.

La respuesta contiene cambios canónicos y, cuando corresponde, tombstones. Cada
cambio incluye la versión de entidad y el scope para que el cliente pueda
aplicar la misma regla de aislamiento. El orden del pull es el orden canónico
del historial del servidor, no el timestamp del cliente.

### 6.2 Atomicidad de pull

Aplicar un lote recibido y avanzar `nextCursor` es una sola transacción local.
Si falla una validación, migración o escritura, se hace rollback de ambos y el
cursor anterior se conserva. Repetir el pull produce el mismo resultado
idempotente en la réplica local.

El pull no reemplaza la revalidación del push. Es una lectura de recuperación y
reconciliación; un evento visible localmente no significa que el servidor lo
aceptó.

## 7. Outbox durable

### 7.1 Estados

La máquina de estados mínima es:

```text
pending -> sending -> accepted
    |         |          \
    |         |           -> duplicate
retry_wait <- timeout/retryable error

sending -> rejected
sending -> conflict
sending -> manual_review
```

Definiciones y transiciones:

| Estado | Significado | Transiciones permitidas |
| --- | --- | --- |
| `pending` | Envelope durable, aún no reclamado por un worker. | `sending`, `manual_review` por corrupción/invalidación local. |
| `sending` | Worker tiene un lease/attempt durable. | Resultado terminal, `retry_wait` por error retryable/timeout, o recuperación a `pending` al vencer lease. |
| `retry_wait` | Espera backoff con `retryCount` persistido. | `sending`, `manual_review` por límite/política explícita. |
| `accepted` | Aplicado por servidor. | Terminal local; solo reconciliación de réplica, nunca edición del evento. |
| `duplicate` | Duplicado seguro con resultado original. | Terminal local; se reconcilia la réplica. |
| `rejected` | No aplicado y no recuperable automáticamente. | Terminal para ese evento; una nueva intención puede crear otro evento solo si la regla lo permite. |
| `conflict` | No aplicado por conflicto determinista. | `manual_review` o una nueva intención autorizada; nunca mutación silenciosa del payload original. |
| `manual_review` | Requiere decisión humana durable. | Resolución explícita que genere evento compensatorio/nuevo, según la entidad. |

El worker debe usar leases o una equivalencia segura para que dos procesos no
apliquen el mismo evento simultáneamente. La expiración, reinicio, cierre
forzado o pérdida de conectividad nunca elimina el registro. `retryCount`, último
error, próximo intento y timestamps son durables y observables.

No se permite reciclar un envelope terminal cambiándole `payload`,
`entityId`, `scope` o `idempotencyKey`. Una corrección genera otra intención y
conserva la relación de auditoría.

### 7.2 Atomicidad local

Para una operación local admitida:

1. validar intención y scope disponible en la réplica;
2. reservar `localSequence`;
3. actualizar la réplica local y crear el envelope/outbox en la misma
   transacción durable;
4. confirmar la UI como `local_pending` solo después del commit.

Si el proceso muere antes del commit, no existe una operación confirmada. Si
muere después, existen ambos registros y el worker puede reanudar. Nunca se
acepta el estado “UI confirmó, pero no hay réplica ni outbox”. La implementación
debe definir cómo reporta falta de espacio, corrupción o imposibilidad de
commit; no debe descartar eventos silenciosamente.

## 8. Deduplicación y retención segura

El servidor conserva un ledger durable de deduplicación que relaciona scope,
`eventId`, `idempotencyKey`, huella del request, versión de schema, resultado,
referencia de negocio y auditoría. La huella permite detectar reutilización con
payload distinto sin almacenar datos sensibles innecesarios.

Reglas obligatorias:

- la deduplicación se hace antes de publicar un nuevo efecto, dentro de la
  misma frontera transaccional que el efecto aceptado;
- dos reenvíos concurrentes producen como máximo un resultado de negocio;
- `duplicate` debe devolver el resultado original o una referencia recuperable,
  nunca ejecutar de nuevo cobro, ticket, auditoría o movimiento de caja;
- pagos, reembolsos, cierres, impuestos, tickets y movimientos de caja no
  pueden perder su dedup por un TTL corto; sus claves/huellas y referencias se
  conservan al menos durante la retención financiera/auditora aplicable y
  mientras haya clientes capaces de reintentarlas;
- un evento financiero no se purga si su historial, compensación, reembolso o
  caso de revisión aún depende de él;
- para datos no financieros puede existir una política de expiración, pero
  solo con una ventana de reintento documentada, migración/resync probada y
  garantía de que un cliente atrasado no puede crear un efecto duplicado;
- purgar el ledger no borra la venta o auditoría inmutable. Si una retención
  legal permite purgar una huella, la operación debe impedir replays ambiguos o
  requerir una revisión explícita.

La duración exacta, jurisdicción y mecanismo de archivado son pendientes; la
implementación no puede inventar un TTL financiero para hacer viable el
almacenamiento.

## 9. Schema y migraciones

`schemaVersion` cubre el contrato del envelope y el payload, no la versión de
la aplicación. Cada versión debe declarar:

- esquema de validación y operaciones soportadas;
- versiones aceptadas por el servidor y por cada cliente;
- migraciones deterministas, reversibilidad cuando sea posible y pruebas;
- cambios que alteran semántica financiera o de autorización;
- fecha/condición de retiro y estrategia de resync.

Un cliente atrasado no puede enviar un payload que el servidor interprete con
otra semántica. Si existe una migración compatible, se aplica antes de la
validación final conservando `eventId`, `idempotencyKey`, actor, scope y
referencia de auditoría. Si no es semánticamente segura, el servidor devuelve
`rejected` con `SCHEMA_UNSUPPORTED` o `manual_review` para un evento financiero;
nunca lo transforma silenciosamente.

Los eventos ya aceptados son inmutables aunque cambie el esquema. El pull debe
indicar una versión compatible o exigir resync. Un cursor atado a una versión
retirada no se interpreta como otro cursor: se marca expirado y se ejecuta el
procedimiento de resync con snapshot scoped y tombstones.

## 10. Tombstones y borrados

El borrado sincronizable es un tombstone/soft delete, nunca la desaparición
física inmediata del historial:

- conserva `entityId`, scope, versión canónica, actor, motivo, `deletedAt` del
  servidor y referencia de auditoría;
- viaja por pull para que cada réplica elimine la entidad visible sin perder la
  marca de que existió;
- un update con `baseVersion` obsoleta no resucita la entidad;
- por defecto no se recrea una entidad usando el mismo `entityId`; una
  recreación crea una identidad nueva y enlaza la referencia si el dominio lo
  permite;
- compactar tombstones requiere conocer la retención de clientes atrasados,
  una barrera de resync y una prueba de que no vuelve a aparecer información
  borrada.

Pagos, cierres, movimientos de inventario y auditoría financiera no se borran
por este mecanismo; se corrigen con operaciones compensatorias autorizadas.

## 11. Autorización, revocación y aislamiento

En cada push el servidor debe, antes de deduplicar o aplicar el evento:

1. autenticar el token/sesión por el mecanismo seleccionado por ADR-010;
2. comprobar que `deviceId` está registrado, no revocado y corresponde a la
   instalación autorizada;
3. obtener el `actorId` de la identidad verificada, comprobar membresía/rol y
   permiso para `entityType`/`operation` en `restaurantId`/`branchId`;
4. verificar que la relación `branchId -> restaurantId` sigue vigente;
5. revalidar estado de sesión, membresía y dispositivo inmediatamente antes
   del commit, no solo cuando se abrió la app;
6. aplicar el evento dentro del scope ya comprobado.

Si actor, membresía, dispositivo o scope fueron revocados, el resultado es
`rejected` con código estable como `AUTH_REVOKED`, `DEVICE_REVOKED` o
`UNAUTHORIZED_SCOPE`, sin reasignar el evento a otro actor. Un evento financiero
pendiente no se vuelve válido porque otro usuario tenga permiso: pasa a
`manual_review` cuando la política de auditoría lo exija. Un efecto ya aceptado
no se deshace automáticamente por una revocación; cualquier corrección es una
operación compensatoria auditada.

Una autorización de supervisor que por regla de dominio exige comprobación del
servidor no puede ser concedida por una caché offline. En ausencia de WAN el
cliente puede conservar la solicitud como borrador no confirmado, pero no debe
confirmar localmente el descuento, cortesía, reapertura u otra excepción que
requiera esa autorización. Una futura excepción a esta regla requiere una ADR,
un límite explícito y evidencia de auditoría; la revalidación posterior no
convierte una autorización cacheada en autorización vigente.

Todo query, índice lógico, cursor, dedup lookup y mutación debe incluir o estar
ligado al scope. El servidor no confía en que la UI haya filtrado
`restaurantId`/`branchId`. Los clientes no reciben eventos de otro tenant,
sucursal o estación KDS aunque compartan cursor, dispositivo o actor.

## 12. Seguridad y datos locales

- Todo transporte de sync usa canal autenticado y cifrado; los secretos de
  servidor nunca llegan a Web POS, mobile o KDS.
- La réplica y outbox contienen el mínimo de datos necesario para las
  operaciones habilitadas. Debe existir cifrado en reposo y gestión de claves
  apropiada para la plataforma antes de habilitar datos sensibles.
- No se almacenan PAN, CVV, claves privadas, tokens de proveedor ni secretos
  en payloads, logs, snapshots locales o errores. Una referencia/tokenización
  autorizada no equivale a guardar datos de tarjeta.
- Logs y métricas pueden incluir `correlationId`, tenant, branch, device,
  eventId, resultado y código de error, pero no payload personal/financiero
  completo ni credenciales.
- El cierre de sesión, revocación o baja del dispositivo debe impedir nuevos
  pushes y definir cómo se purgan/cifran los datos locales pendientes sin
  destruir la evidencia necesaria para una revisión.
- La restauración desde backup local debe preservar integridad de
  `eventId`/`idempotencyKey` y nunca permitir que dos dispositivos adopten el
  mismo `deviceId` sin un procedimiento explícito.
- La validación de payload limita tamaño, profundidad, tipos y contenido para
  evitar abuso de almacenamiento y logs.

## 13. Decisiones e invariantes de este contrato

### Decisiones

1. ADR-004 mantiene Fases 1–2 online-first y reserva la réplica/outbox por
   dispositivo para Fase 3.
2. La nube/API es la autoridad canónica de Fase 3; no se asume sincronización
   peer-to-peer ni KDS entre dispositivos sin WAN.
3. El envelope exige identidad de evento, idempotencia, scope, secuencia local,
   versión base y timestamps separados por confianza.
4. Push devuelve un resultado por evento y cada aplicación aceptada es
   transaccional; el cliente no supone atomicidad de lote.
5. Pull usa cursor opaco versionado y ligado a scope; aplicar cambios y avanzar
   cursor es atómico localmente.
6. Pagos, cierres, caja y demás ambigüedades financieras nunca se resuelven
   con LWW ni se auto-fusionan.
7. Borrados sincronizables usan tombstones; registros financieros se corrigen
   por compensación.

### Invariantes

- Un `eventId` y una intención idempotente no producen más de un efecto de
  negocio.
- Un reintento, timeout o reinicio no pierde un evento local ya confirmado ni
  duplica un efecto server-side.
- El servidor es quien autoriza, calcula, versiona, ordena y audita; el cliente
  solo propone una intención.
- `occurredAt` nunca decide autoridad, orden o conflicto por sí solo.
- `localSequence` no retrocede ni se reutiliza globalmente por dispositivo,
  incluso al cambiar de scope.
- Ningún push/pull o cursor permite leer o escribir fuera de
  `restaurantId`/`branchId` autorizado.
- Un evento rechazado, conflictivo o en revisión no publica efectos parciales.
- Un tombstone impide resurrección por una versión atrasada.
- Los eventos y registros financieros aceptados son inmutables; una corrección
  queda enlazada y auditada.
- La aplicación de un pull y la persistencia de su cursor son indivisibles.

## 14. Pendientes explícitos

Este contrato no cierra las siguientes decisiones:

- elección de almacenamiento local y librería (ADR-005: no se selecciona
  Dexie, RxDB, WatermelonDB ni una alternativa en este documento);
- transporte concreto, formato wire, tamaño de lote, leases y límites de
  backoff;
- implementación de Auth/RBAC, membresías, registro de dispositivos y
  revocación, condicionada por ADR-010;
- catálogo de `entityType`/`operation` y reglas de conflicto específicas para
  Order, OrderItem, Payment, CashMovement, inventario y catálogo;
- matriz final de operaciones offline por cliente/hardware, incluyendo efectivo
  y ticket, y la decisión de mercado/fiscalidad;
- política legal de retención, archivado y purga de dedup/tombstones;
- algoritmo/almacenamiento interno de cursor y changelog server-side;
- cifrado local, rotación de claves, backup/restauración y respuesta ante
  dispositivo comprometido;
- procedimiento de resync completo y compatibilidad de clientes atrasados;
- servidor local LAN, autoridad durante partición y reconciliación (ADR-009,
  fuera del alcance de Fase 3 por defecto).

Resolver un pendiente no debe relajar las invariantes anteriores sin una ADR,
pruebas de aislamiento y pruebas de idempotencia/recuperación proporcionales al
riesgo.

## 15. Criterios de aceptación y pruebas

La implementación de Fase 3 no puede marcarse `REVIEW` sin evidencia
automatizada y reproducible de, como mínimo:

### Contrato y estado local

1. El envelope rechaza tipos ausentes/incorrectos, scope inválido,
   `localSequence` repetida o retrocedida, `baseVersion` ausente/no permitida
   para la operación, `schemaVersion` desconocida y timestamps malformados.
   Una `baseVersion` válida pero obsoleta se resuelve por la regla de entidad
   como `conflict`, `rejected` o `manual_review`, nunca por LWW implícito.
2. Una operación local confirmada deja réplica y outbox en la misma transacción;
   un cierre forzado antes del commit deja ninguno, y después del commit deja
   ambos.
3. El worker recupera leases `sending`, persiste `retryCount`, usa backoff/jitter
   y no pierde eventos al reiniciar o quedarse sin red.
4. La máquina cubre todos los estados y no permite editar un evento terminal;
   `conflict` y `manual_review` requieren resolución explícita.

### Push, dedup y autoridad

5. Reenviar el mismo evento y reenviar el mismo lote devuelven `duplicate` sin
   duplicar orden, ticket, pago, auditoría ni movimiento de caja.
6. Veinte reenvíos concurrentes de una misma intención producen exactamente un
   efecto de negocio y el mismo resultado original.
7. Una pérdida de respuesta después del commit se recupera por idempotencia.
8. Cada lote devuelve resultado para cada evento y no oculta errores parciales.
   `accepted`/`duplicate` confirma solo el outbox: si el pull posterior falla,
   el cursor anterior se conserva y el siguiente pull recupera también cambios
   concurrentes no incluidos en la respuesta de push.
9. Actor, membresía o dispositivo revocado antes del commit son rechazados; un
   evento financiero no se reasigna silenciosamente.
10. Totales, impuestos, descuentos, pagos y estados se recalculan/revalidan en
    servidor; nunca se acepta el total del cliente como autoridad.

### Conflictos, pull y tombstones

11. Dos dispositivos que agregan líneas compatibles producen el resultado
    definido por la regla de Order; cancelar frente a preparar no retrocede el
    estado y se eleva según autorización.
12. Un `baseVersion` obsoleto produce `conflict` o `manual_review` según la
    entidad, nunca una sobrescritura LWW implícita.
13. Pull con cursor normal, cursor repetido, cursor expirado y cursor de otro
    scope se comporta de forma determinista, sin fuga; lote y cursor se aplican
    atómicamente.
14. Un tombstone llega a todas las réplicas scoped, bloquea updates atrasados y
    una recreación usa una identidad nueva según la regla de entidad.
15. Un cliente atrasado migra un schema compatible sin cambiar identidad ni
    semántica; un schema incompatible queda visible como rechazo/revisión.

### Fallos y seguridad

16. Se prueban reloj adelantado/atrasado, caída antes/después de outbox, timeout
    post-commit, desconexión durante push/pull, cola grande, backoff y
    reanudación tras reinicio.
17. Se prueba fuga de evento, cursor, dedup y tombstone entre dos restaurantes y
    sus sucursales; el resultado esperado es cero lecturas/escrituras cruzadas.
18. Se verifica que no se persisten PAN/CVV/secretos, que logs no contienen
    payloads sensibles completos y que los datos locales quedan cifrados según
    la decisión de plataforma.
19. Se ejercita retención: una operación financiera todavía reintentable no
    pierde su dedup; la purga de datos no permite un replay ambiguo.
20. La matriz de capacidades demuestra que una operación no soportada offline
    queda bloqueada con explicación, no encolada como aceptada.

La evidencia debe indicar plataforma/cliente, scope, versiones de schema,
comandos reproducibles y limitaciones. Hasta que exista la implementación y
estas pruebas, este documento describe el contrato objetivo; no demuestra que
el producto actual funcione offline.
