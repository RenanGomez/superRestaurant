# S9 · Puesto operativo y role plays de captura

Estado: S9.0 diseñado/auditado, contrato puro S9.1a, proyección API S9.1b1 y reader interno S9.1b2 implementados; la tarea continúa `IN_PROGRESS` antes de la composición, endpoint o ampliación de Mobile.

## 1. Objetivo y límites

Este corte convierte las secciones 8.8.1, 8.8.8, 8.8.9 y 8.8.10 del plan en una arquitectura incremental verificable. El puesto operativo debe permitir que una persona vea contexto, encuentre el trabajo activo y ejecute la siguiente acción segura sin navegar entre autoridades paralelas.

No redefine estados de Order, Capture, KDS, fulfillment o Payment; tampoco inventa totales, cobertura, políticas comerciales, impresión ni permisos móviles. La UI compone hechos autoritativos y sólo ofrece comandos que las autoridades actuales pueden aceptar.

## 2. Autoridades y superficies existentes

| Necesidad | Autoridad/superficie actual | Consecuencia |
|---|---|---|
| Borradores, espera, propiedad y recuperación | Capture, journal/lease y `CaptureWorkTrayResultV1` | La bandeja unificada extiende esta lectura; no crea otra cola de borradores. |
| Cliente, dirección e historial | Customer directory, snapshots y recent Order history | Se muestran dentro del trabajo activo, sin copiar fichas ni fusionar identidades. |
| Orden, líneas y estados comerciales | Order y contratos compartidos | La estación no recalcula totales ni muta estados localmente. |
| Preparación | KDS tickets/cursor durable | Estado de cocina se proyecta; enviar/corregir sigue en su autoridad. |
| Cobro y caja | Payment, CashRegister/CashMovement y S8 | Intención, exposición y capturado se muestran separados. |
| Mesas y captura móvil actual | layout/active Orders y composer Mobile | Mobile conserva su flujo de mesa hasta decidir roles/hardware; no duplica Capture web. |
| Identidad operativa | sesión verificada, membership, Branch y turno | Todo read model se reautoriza y oculta datos al perder el contexto. |

CodeGraph confirmó que `CaptureWorkspace` sólo entra por la página protegida de Capture; `CaptureWorkTrayResultV1` ya atraviesa shared-types, API, web y pruebas. `ActiveOrdersPanel` consume snapshots server-owned y Mobile mantiene Branch/turno/operador visibles. Extender esos caminos es preferible a crear un dashboard independiente.

## 3. Composición del puesto primario web/tablet

La estación se divide en cuatro regiones persistentes:

1. **Contexto operativo:** Restaurant, Branch, turno, caja cuando aplique, operador, conectividad y operaciones pendientes. Un dato desconocido se muestra como desconocido; nunca se inventa.
2. **Bandeja única:** filtros por clase de trabajo y atención requerida, búsqueda autorizada y tiempos derivados por servidor. Mesas es un filtro/vista, no la raíz del producto.
3. **Trabajo activo:** cliente/canal/cumplimiento, configuración de líneas y snapshot de Order; conserva el panel mientras se explora catálogo o cliente.
4. **Resumen y acciones:** ejes independientes de Order, cocina, fulfillment y Payment, importes autoritativos y sólo las acciones habilitadas por estado/permiso.

En anchura tablet/escritorio, bandeja, trabajo y resumen pueden coexistir. En anchura móvil web se apilan, con contexto y acciones principales pegajosos y sin overlays sobre el área operativa. Ninguna acción crítica queda sólo en hover, gesto o color.

## 4. Proyección de bandeja unificada

S9.1 debe añadir una lectura server-only, versionada y paginada que componga referencias, no copie agregados. Cada item incluye como mínimo:

- identidad estable, folio humano, `restaurantId` y `branchId` implícitos en el scope autorizado;
- tipo `capture | order | fulfillment_incident` y vínculos aplicables;
- cliente minimizado o etiqueta anónima, canal origen y canal de cumplimiento;
- propietario/operador visible, turno y timestamps autoritativos;
- estados independientes `attention`, `order`, `production`, `fulfillment` y `payment`;
- `needsAttention` con códigos cerrados, nunca texto cliente;
- promesa/programación cuando exista y tiempo transcurrido derivado de timestamp servidor;
- versión/cursor para recuperar conflictos, no para permitir writes desde la lista;
- acciones candidatas como códigos informativos; el comando vuelve a autorizar y revalidar.

S9.1a publica ya `OperationalWorkTrayRequestV1`, `OperationalWorkItemV1` y `OperationalWorkTrayV1` con parsers fail-closed. Capture y Order tienen identidad discriminada; los ejes comerciales, preparación, fulfillment y Payment usan vocabularios independientes, y un hecho todavía inexistente viaja como `null`, nunca como un estado inferido. Scope, UUID, timestamps canónicos, cursores, límites, filtros, acciones/atenciones únicas y colecciones densas están acotados. Es contrato puro: no hay endpoint, SQL, permiso implícito ni lectura productiva todavía.

S9.1b1 añade en API dos proyectores puros sobre lecturas ya autorizadas. Capture conserva identidad, folio, canal y atención; no convierte el `membershipId` en etiqueta ni inventa Customer, turno o estados posteriores. La Order activa de mesa convierte `draft` y `open|partially_paid` al eje comercial, deriva preparación desde los estados autoritativos de sus líneas y sólo publica pago parcial cuando el snapshot lo declara. `open` no demuestra `unpaid`; source, fulfillment operativo y Customer permanecen `null`. El reader actual de Orders exige `tableId`, por lo que esta unidad es una transición probada y no una bandeja completa de Branch.

S9.1b2 añade `app_private.list_branch_active_orders` y su adaptador interno. La lectura usa scope exacto Restaurant/Branch, roles con `orders.read`, estados activos, límite 1–100 y orden estable por `updated_at DESC, id`; el cursor conserva microsegundos aunque `updatedAt` visible conserve milisegundos. La página devuelve identidad, canal, mesa/turno cuando existen, estado, versión y estados de líneas; no transporta importes, snapshots de producto ni PII. Un cambio concurrente puede mover una Order a una página anterior: la UI deberá reiniciar la bandeja al refrescar, no prometer un snapshot congelado. Tras verificarla en transacción rollback-only, la migración se aplicó de forma persistente al proyecto autorizado `zwbyiefqeujstyzysydn`; el historial y la lectura postcheck quedaron verdes.

Filtros iniciales: `draft`, `on_hold`, `scheduled`, `confirmed`, `preparing`, `ready`, `dispatch`, `in_route`, `incident`, `payment_attention` y `all`. Un item puede aparecer en más de un filtro sin duplicar su identidad. La ordenación prioriza atención explícita, promesa vencida y antigüedad; no usa timestamps cliente.

## 5. Búsqueda, favoritos y ergonomía

- La búsqueda global enruta a capacidades existentes por folio, teléfono/nombre/dirección y producto; no concatena PII en un índice cliente.
- Favoritos y recientes necesitan identidad Branch/turno/operador, versión y reglas de agotado; hasta S5 productivo sólo pueden existir como diseño, no como ranking local implícito.
- Atajos visibles: nueva captura, buscar cliente, guardar/espera, enviar, cobrar y volver. Cada atajo comparte la misma función accesible del control táctil.
- Cantidades conservan botones táctiles amplios y teclado numérico; dinero, cancelación y envío mantienen confirmación contextual.
- Estados de carga, vacío, error, conflicto, sesión revocada y resultado incierto conservan lo local y explican la siguiente acción segura.
- La métrica de recuperación inicia al activar la búsqueda/bandeja y termina cuando el mismo borrador autoritativo está editable; debe registrar mediana y p95 sin PII.

## 6. Límite web, tablet y Mobile

Web/tablet es el puesto primario multicanal porque ya integra Capture, Customer y confirmación. La aplicación Mobile actual sigue siendo una estación de mesa con Branch, turno, menú y Order; no recibe directorio completo, caja o delivery por conveniencia.

Antes de S9.5 Emmanuel debe decidir por rol/hardware qué subconjuntos corresponden a mesero, capturista, caja, supervisor y repartidor. Cualquier capacidad Mobile nueva reutiliza contratos/acciones autorizadas y minimiza datos; no replica persistencia ni lógica financiera.

## 7. Escalera obligatoria de evidencia

Cada role play usa cuatro niveles acumulativos:

1. `WALKTHROUGH`: flujo, estados, decisiones y recuperación definidos.
2. `CONTRACT`: parsers/dominio y errores cubren el escenario sin depender de la UI.
3. `E2E`: identidad real, Nest y PostgreSQL verifican efectos, idempotencia y aislamiento.
4. `CLIENT`: teclado/táctil y breakpoint objetivo, consola/red y tiempo cuando aplique.

`VERIFIED` exige los cuatro niveles aplicables. `PARTIAL` significa que existe una autoridad reutilizable pero falta al menos un nivel. `DESIGN` indica que sólo hay decisión arquitectónica. `BLOCKED` identifica una política o módulo ausente; no se simula en UI.

## 8. Matriz de los role plays 8.8.9

| ID | Escenario resumido | Estado actual | Evidencia siguiente mínima |
|---|---|---|---|
| RP-01 | llamada interrumpida y retomada | `VERIFIED` para Capture básico | Automatizar métrica p95; la prueba manual recuperó el mismo folio en ~2,5 s. |
| RP-02 | segunda llamada mientras se captura | `PARTIAL` | Añadir espera/temporizador visible y alternancia E2E entre dos Captures. |
| RP-03 | dos operadores, mismo cliente | `PARTIAL` | Detector de posible duplicado; lease/CAS/transfer ya protegen edición. |
| RP-04 | dirección nueva confusa | `PARTIAL` | Integrar cobertura/promesa S7 y lectura final; alta/validación ya existen. |
| RP-05 | cliente habitual desde otro número | `PARTIAL` | Walkthrough cliente-contacto y E2E de alta sin fusión automática. |
| RP-06 | “lo mismo de siempre” | `PARTIAL` | Smoke cliente D5; historial/preview/repetición ya tienen contrato y persistencia. |
| RP-07 | pizza por mitades y alcances | `BLOCKED` | Resolver políticas S5 de fracciones/extras y publicar configurador. |
| RP-08 | masa/orilla incompatible | `PARTIAL` | Publicar S5; dominio ya modela restricciones sin destruir selección. |
| RP-09 | combo con bebida agotada | `BLOCKED` | Política de combo/sustitución y autoridad de agotados. |
| RP-10 | eliminar antes de enviar | `DESIGN` | Conectar editor Capture a línea autoritativa y totales. |
| RP-11 | cambiar artículo enviado | `BLOCKED` | Decisiones S6 e impresión/corrección productiva. |
| RP-12 | cancelar durante preparación | `BLOCKED` | Política S6, refunds e inventario productivo. |
| RP-13 | agregar cuando va en ruta | `BLOCKED` | Política S7 de ampliación/segunda entrega. |
| RP-14 | pedido programado | `BLOCKED` | Ventanas, promesa y activación de cocina S7. |
| RP-15 | domicilio cambia a recoger | `BLOCKED` | Regla S7 de re-quote y compensación. |
| RP-16 | efectivo con billete grande | `CONTRACT` | Persistir intención con total autoritativo y mostrarla en despacho. |
| RP-17 | efectivo más tarjeta | `PARTIAL` | Writer multi-Payment y E2E de saldo/caja S8. |
| RP-18 | terminal pendiente/ambigua | `CONTRACT` | Persistencia de intento, consulta/reconciliación y recovery S8. |
| RP-19 | fuera de cobertura | `BLOCKED` | Política y cálculo de cobertura/override S7. |
| RP-20 | repartidor no encuentra cliente | `BLOCKED` | Incidencias/retención/reprogramación S7. |
| RP-21 | faltante al empacar | `BLOCKED` | Estado de empaque, incidencia y política de reposición/refund. |
| RP-22 | red cae al confirmar | `PARTIAL` | E2E de resultado incierto y replay del mismo comando; autosave ya conserva selección. |
| RP-23 | disputa sobre pedido previo | `PARTIAL` | Timeline autorizado que componga snapshots, auditoría y pagos. |
| RP-24 | corrección después del cierre | `BLOCKED` | Movimientos compensatorios y permiso/política S6/S8. |
| RP-25 | teléfono compartido | `CONTRACT` | Walkthrough/CLIENT de selección explícita entre fixtures homónimas. |
| RP-26 | dirección incompleta | `PARTIAL` | UX de pendiente y futura ayuda mapa; servidor ya bloquea confirmación delivery. |
| RP-27 | entrega desde otra sucursal | `BLOCKED` | Política/capacidad multi-Branch y transferencia explícita. |
| RP-28 | alergia | `BLOCKED` | Política legal/operativa y nota estructurada S5; nunca prometer ausencia. |
| RP-29 | precio cambia en espera | `PARTIAL` | Total autoritativo Capture y reconfirmación visible antes de Order. |
| RP-30 | promoción deja de aplicar | `BLOCKED` | Autoridad versionada de promociones/descuentos. |
| RP-31 | cupón usado concurrentemente | `BLOCKED` | Módulo cupón/idempotencia aún inexistente. |
| RP-32 | ingrediente agotado post-confirmación | `BLOCKED` | Autoridad de disponibilidad e incidencia/cambio S5/S6. |
| RP-33 | cocina pide aclaración | `BLOCKED` | Conversación/evento durable KDS↔captura. |
| RP-34 | estaciones terminan desfasadas | `PARTIAL` | Proyección agregada de tickets e integración con empaque/promesa. |
| RP-35 | impresora falla, KDS confirma | `BLOCKED` | `packages/printing`, destinos e idempotencia de reimpresión. |
| RP-36 | recoge otra persona | `BLOCKED` | Política de identidad mínima y entrega pickup S7. |
| RP-37 | llegada fuera de hora | `BLOCKED` | Promesa/estimación y evento de entrega S7. |
| RP-38 | cumplimiento parcial | `BLOCKED` | Política explícita, items/saldo y agregado fulfillment. |
| RP-39 | corporativo multi-domicilio | `BLOCKED` | Política de Orders/fulfillments relacionados y fiscalidad. |
| RP-40 | cambio de turno con trabajo abierto | `DESIGN` | Bandeja S9.1 y protocolo de handoff con dinero/incidencias. |
| RP-41 | ruta múltiple con cancelación | `BLOCKED` | Ruta/liquidación y política S7/S8. |
| RP-42 | repartidor cobra diferente | `BLOCKED` | Diferencia, revisión y liquidación compensatoria S7/S8. |
| RP-43 | factura después del cierre | `BLOCKED` | Módulo fiscal/PAC futuro. |
| RP-44 | refund parcial posterior | `BLOCKED` | Política y writer Refund S8.6. |
| RP-45 | webhook externo duplicado | `DESIGN` | Adaptador de canal e identidad/idempotencia persistida. |
| RP-46 | plataforma cancela tras cocina | `BLOCKED` | Contrato/cancelación/comisión del adaptador externo. |
| RP-47 | acceso a otro Restaurant | `PARTIAL` | Añadir CLIENT/E2E específico del puesto; API/RLS ya tienen aislamiento. |
| RP-48 | sesión revocada durante captura | `PARTIAL` | E2E/CLIENT de preservación local, bloqueo y reasignación. |
| RP-49 | reinicio con borrador y pago pendiente | `BLOCKED` | Intento persistido S8; recovery de borrador ya existe. |
| RP-50 | cliente no responde al confirmar | `DESIGN` | Estado/acción de devolución de llamada sin liberar Order/KDS/cobro. |

La matriz no convierte contratos aislados en evidencia de cliente ni usa una prueba de Capture para afirmar pagos, fulfillment o impresión.

## 9. Entregas incrementales

1. **S9.0 — este documento:** composición, límites cliente/autoridad, ergonomía, métrica y matriz completa.
2. **S9.1 — bandeja unificada:** S9.1a aporta contrato/parsers runtime, S9.1b1 los proyectores Capture/Order sin inferencias y S9.1b2 el reader Order paginado por Branch; faltan composición autorizada, cursor unificado, filtros, búsqueda y endpoint.
3. **S9.2 — shell operativo:** contexto persistente y estados multieje con acciones contextuales revalidadas.
4. **S9.3 — descubrimiento de producto:** búsqueda/favoritos/recientes tras publicación S5 y autoridad de disponibilidad.
5. **S9.4 — equivalencia táctil/teclado:** atajos enseñables, foco, cantidades y modo de alto volumen.
6. **S9.5 — matriz por rol/dispositivo:** capacidades Mobile después de decidir hardware y responsabilidades.
7. **S9.6 — runner de role plays:** fixtures recuperables, métricas y evidencia E2E/CLIENT por escenario aplicable.

## 10. Criterios de aceptación

- la bandeja muestra todo trabajo abandonable y nunca reemplaza sus autoridades;
- el contexto operativo y los cuatro ejes de estado permanecen visibles o declaran claramente que no están disponibles;
- una persona localiza y retoma el mismo borrador en ≤10 s, medido desde la acción inicial hasta edición autorizada;
- teclado y táctil alcanzan la misma operación y el foco es visible;
- errores, conflicto, revocación y resultado incierto conservan contexto y ofrecen una siguiente acción segura;
- otra Branch/Restaurant no filtra PII, trabajo, importes ni contadores;
- ninguna acción aparece habilitada sólo por estado cliente;
- cada RP aplicable avanza por walkthrough, contrato, E2E y cliente con evidencia enlazada;
- los RP bloqueados permanecen visibles como gates y no se simulan con flags o textos de UI.

## 11. Decisiones humanas antes de S9.3/S9.5

1. Roles y hardware exactos del piloto por capturista, caja, mesero, supervisor y repartidor.
2. Si favoritos son por Branch, turno, operador o una combinación, y quién los administra.
3. Atajos físicos requeridos y layout/teclado objetivo del piloto.
4. Qué datos mínimos puede portar Mobile por rol y por cuánto tiempo.
5. Qué role plays quedan explícitamente fuera del piloto por módulos futuros, sin presentarlos como soportados.

### 11.1. Decisiones aprobadas por Emmanuel el 2026-09-26

1. Roles y hardware del piloto: capturista y caja en PC o tablet web; supervisor en web; repartidor en móvil; sin rol mesero en el piloto.
2. Favoritos por Branch, administrados por el supervisor; recientes por operador, automáticos y no editables.
3. Teclado estándar; sin teclado numérico dedicado ni atajos de hardware en el piloto.
4. Mobile sólo porta el pedido asignado al repartidor: nombre, teléfono enmascarado, dirección e instrucciones; se borra del dispositivo al liquidar el viaje.
5. Fuera del piloto: mesas, reservaciones, división de cuenta, notificaciones push al cliente y agregadores; no se presentan como soportados.

Con esto S9.3 (tras publicación S5) y S9.5 quedan desbloqueados.
