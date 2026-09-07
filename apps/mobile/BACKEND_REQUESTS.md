# Solicitudes al coordinador — apps/mobile

Solicitudes abiertas de este workstream frontend. Ninguna fue implementada,
simulada ni resuelta desde `apps/mobile`. Cada una detuvo únicamente la
capacidad afectada; el resto del entregable continuó.

Referencia: `docs/CLAUDE_FRONTEND_WORKSTREAM.md`, secciones 6, 7 y 8.2.

---

## SR-MOB-001 — Decisión de arquitectura: persistencia segura de la sesión

> **Alcance de esta solicitud**: solo la *persistencia en el dispositivo*. La
> *renovación del token en memoria* ya está implementada y no depende de esta
> decisión; se describe abajo para que ambas no se confundan.

- **Capacidad requerida**: una decisión aprobada sobre dónde y cómo persistir la
  sesión de Supabase Auth en el dispositivo (adaptador de almacenamiento,
  cifrado, expiración, borrado en logout y en revocación).
- **Pantalla o caso de uso bloqueado**: continuidad de sesión entre aperturas de
  la aplicación. Hoy, al cerrar la app el operador debe volver a autenticarse.
- **Contrato o componente buscado**: `@supabase/supabase-js` exige un adaptador
  de almacenamiento para `persistSession`. En React Native las opciones usuales
  son `expo-secure-store`, `@react-native-async-storage/async-storage` o un
  adaptador propio; ninguna está aprobada por el mandato ni existe en el
  repositorio.
- **Evidencia de no disponibilidad**: `docs/CLAUDE_FRONTEND_WORKSTREAM.md` §8.2
  prohíbe inventar persistencia segura de refresh tokens y ordena mantener la
  sesión en memoria mientras no haya un adaptador aprobado. `packages/*` no
  contiene ningún adaptador de almacenamiento móvil.
- **Decisión aplicada mientras tanto**: `src/session.ts` fija
  `persistSession: false` y no declara `storage`; nada se escribe en el
  dispositivo y la sesión muere con el proceso. Cubierto por pruebas, incluida
  una que instala un espía sobre `localStorage`/`sessionStorage` y comprueba
  cero accesos durante inicio, pausa, reanudación, lectura de sesión y cierre.
- **Datos mínimos que necesitaría la UI**: recuperar al abrir la app una sesión
  válida o la ausencia de sesión, sin exponer el refresh token al código de
  pantalla y con borrado garantizado al cerrar sesión o al revocarse el acceso.
- **Impacto si se difiere**: el operador vuelve a autenticarse en cada apertura.
  No hay riesgo de fuga de credenciales por diferirlo.
- **Decisión requerida**: elegir adaptador y política de cifrado/expiración, o
  confirmar por escrito que la sesión en memoria es aceptable para el piloto.

### Renovación en memoria — resuelto, no requiere decisión

`autoRefreshToken: true` con `persistSession: false`: mientras la app está
abierta y en primer plano, la sesión en memoria se renueva sola.
`MobileAuthPort` expone `startAutoRefresh`/`stopAutoRefresh`, implementados con
`client.auth.startAutoRefresh()`/`stopAutoRefresh()` de `@supabase/auth-js`
2.112.4 (`GoTrueClient.d.ts`, líneas 2321 y 2352), y el ciclo de vida los
arranca al montar, los pausa en segundo plano y los reanuda al volver. Ningún
token se escribe en almacenamiento ni se registra en logs.

---

## SR-MOB-002 — Contrato compartido para la respuesta de `POST /api/v1/access/branch` (CERRADA EN R6)

- **Cierre (2026-09-06, R6)**: resuelta de forma más completa de lo pedido. El
  flujo operativo ya no llama `POST /api/v1/access/branch` sino
  `POST /api/v1/access/branch/context`, cuya respuesta valida
  `parseBranchOperationalContextV1` —un parser compartido y versionado— y que
  además trae la zona IANA de la sucursal. Con eso **se eliminó el parser local**
  (`parseAuthorizedMobileBranch` y sus ayudantes, ~90 líneas) junto con el
  endpoint anterior de la lista de rutas autorizadas: mobile ya no conserva
  ninguna copia de ese contrato.

- **Capacidad requerida**: un parser versionado y compartido para la respuesta de
  revalidación de sucursal, equivalente a `parseBranchMembershipListV1`.
- **Pantalla o caso de uso bloqueado**: ninguna; la pantalla de selección de
  sucursal funciona. La solicitud es de consolidación de contrato.
- **Contrato o endpoint buscado**: `packages/shared-types` exporta
  `parseBranchScope` para la petición, pero no expone un parser para la
  respuesta `{ branchId, restaurantId, roles }` que devuelve
  `BranchAccessController`.
- **Evidencia de no disponibilidad**: `packages/shared-types/src/index.ts` no
  contiene ningún parser de esa respuesta; `apps/web/src/lib/branch-selection.ts`
  documenta explícitamente que mantiene el suyo local por esa razón.
- **Estado en este entregable**: `src/mobile-client.ts` valida la respuesta con
  un parser local endurecido, equivalente al de `apps/web`: prototipo
  `Object.prototype`/`null`, claves exactas por `Reflect.ownKeys`, solo
  descriptores de datos, fallo cerrado ante proxies que lanzan, `roles` denso y
  sin duplicados, y UUID normalizados. Exige además que el par devuelto sea
  idéntico al solicitado. No se modificó `packages/shared-types`.
- **Impacto si se difiere**: dos validaciones locales equivalentes (web y mobile)
  que pueden divergir si el servidor cambia la forma de la respuesta.
- **Decisión requerida**: si el coordinador publica el parser compartido, ambos
  clientes deben migrar a él en una unidad posterior.

---

## SR-MOB-003 — Turno operativo (shift) en el alcance móvil

- **Capacidad requerida**: contrato y endpoint para consultar el turno vigente de
  la sucursal y, si corresponde, seleccionarlo.
- **Pantalla o caso de uso bloqueado**: la selección de turno que pide la Fase 2
  del plan maestro (“login/sucursal/turno”). No se implementó ninguna pantalla ni
  representación de turno.
- **Contrato o endpoint buscado**: no existe `shift`/`turno` en
  `packages/shared-types` ni un endpoint equivalente en `apps/api`.
- **Evidencia de no disponibilidad**: los contratos versionados actuales cubren
  membresías, scope, layout de mesas, catálogo, órdenes, KDS y caja; ninguno
  modela turno. `docs/CLAUDE_FRONTEND_WORKSTREAM.md` §6 tampoco lo autoriza.
- **Datos mínimos que necesitaría la UI**: identificar el turno activo de la
  sucursal seleccionada y mostrar su estado; no se requiere mutarlo en este
  slice.
- **Impacto si se difiere**: ninguno para esta fundación de solo lectura. La
  toma de comanda posterior sí podría requerirlo si el dominio ata órdenes a un
  turno.
- **Decisión requerida**: confirmar si el turno forma parte del producto y, en
  ese caso, definir su contrato antes de la unidad de comanda móvil.

---

## SR-MOB-004 — Origen de API alcanzable desde un dispositivo físico

- **Capacidad requerida**: una política aprobada para que un dispositivo real
  alcance la API durante desarrollo y piloto.
- **Pantalla o caso de uso bloqueado**: uso de la app en un teléfono físico
  contra un entorno de desarrollo.
- **Contrato o endpoint buscado**: no aplica; es configuración/entorno.
- **Evidencia de la restricción**: `src/config.ts` acepta `https` en cualquier
  host y `http` únicamente en `127.0.0.1`/`localhost`, replicando la regla
  fail-closed de `apps/kds/src/config.ts`. Un teléfono en la red local no puede
  usar `127.0.0.1` ni un origen `http` de LAN.
- **Impacto si se difiere**: la verificación en dispositivo físico requiere un
  emulador con reenvío de puertos, un túnel TLS o un entorno remoto con TLS.
- **Decisión requerida**: definir el origen de API para dispositivos (túnel TLS,
  certificado de desarrollo o entorno remoto). No se relajará la validación de
  configuración sin esa decisión escrita.

---

## SR-MOB-005 — Entorno verificable para las pantallas autenticadas

- **Capacidad requerida**: una forma autorizada de ejecutar la app contra Auth y
  la API con datos sintéticos, para verificar visualmente sucursales, mesas y
  menú en un runtime real.
- **Pantalla o caso de uso bloqueado**: verificación visual de
  `BranchScreen`, `TablesScreen` y `MenuScreen`, y de la ausencia de fuga visual
  al cambiar de sucursal.
- **Contrato o endpoint buscado**: ninguno nuevo. Se necesita acceso ejecutable a
  las capacidades ya autorizadas (`/api/v1/access/*`, `/api/v1/dining/layout`,
  `/api/v1/catalog/menu`) y una sesión válida de Supabase Auth.
- **Evidencia de la restricción**: el mandato §10 prohíbe E2E remotas y crear
  usuarios o fixtures remotas; este workstream no tiene credenciales, no puede
  levantar `apps/api` (requiere conexión PostgreSQL privada y secretos) y
  `EXPO_PUBLIC_SUPABASE_URL` exige TLS, por lo que un doble local de Auth no es
  alcanzable desde el cliente sin relajar la validación de configuración.
- **Qué ya se verificó sin entorno remoto**: el arnés local `harness/`
  (fixtures sintéticas, sin credenciales ni datos remotos, resuelto por Metro
  solo con `MOBILE_VISUAL_HARNESS=1`) permitió recorrer en navegador real
  acceso, selección y cambio de sucursal, mesas, menú, revocación sin fuga,
  sesión expirada, y los estados vacío/carga/error/reintento, en 390×844 y en
  vista tablet, con consola limpia, contraste AA, foco visible y objetivos
  táctiles de 48 px. Lo respaldan 59 pruebas automatizadas.
- **Impacto si se difiere**: sigue sin comprobarse el comportamiento contra el
  servidor real y contra Supabase Auth (latencias, formas de error, expiración
  real de token) y en dispositivo Android/iOS.
- **Decisión requerida**: que el coordinador ejecute la app con su propio
  entorno, o que autorice expresamente un smoke acotado con usuario temporal,
  fixtures marcadas, cleanup obligatorio y recovery exclusivo, como se hizo para
  Web y KDS. El arnés no sustituye esa verificación: solo la anticipa.

---

## SR-MOB-006 — Actualizar `expo` a 57.0.20 (CERRADA)

- **Capacidad requerida**: una decisión sobre cómo subir `expo` a la versión que
  `expo install --check` exige, sin relajar la política de antigüedad mínima de
  paquetes del monorepo.
- **Compuerta bloqueada**: `pnpm --filter @super-restaurant/mobile exec expo
  install --check` termina en código 1 con
  `expo@57.0.19 - expected version: ~57.0.20`.
- **Evidencia exacta**: `expo@57.0.20` se publicó el 2026-09-04T07:46Z y
  `@expo/cli@57.0.22` el 2026-09-04T07:47Z. Una instalación de prueba en un
  proyecto aislado, fuera del repositorio, mostró que pnpm 11.19.0 solo acepta
  esas versiones si se registran cuatro entradas en `minimumReleaseAgeExclude`
  de `pnpm-workspace.yaml`: `@expo/cli@57.0.22`, `expo-modules-core@57.0.16`,
  `expo-modules-jsi@57.0.8` y `expo@57.0.20`. La última comprobación fue a las
  2026-09-05T06:54Z, todavía dentro de la ventana de 24 h.
- **Por qué se detuvo aquí**: `pnpm-workspace.yaml` es configuración raíz y el
  mandato la declara de solo lectura. No se relajó `minimumReleaseAge`, no se
  añadieron exclusiones y no se modificó ningún archivo fuera de
  `apps/mobile/**`.
- **Impacto si se difiere**: la compuerta `expo install --check` queda en rojo.
  El app compila, exporta y pasa el resto de las compuertas con `expo@57.0.19`.
- **Decisión requerida**: ninguna. **Resuelta el 2026-09-05.**
- **Cómo se cerró**: pasada la ventana de 24 h de las cuatro versiones
  (`expo@57.0.20` 07:46:21Z, `@expo/cli@57.0.22` 07:47:45Z,
  `expo-modules-jsi@57.0.8` 07:47:34Z, `expo-modules-core@57.0.16` 07:49:59Z),
  `pnpm install` las aceptó sin exclusiones. Se subió `expo` a `57.0.20` en
  `apps/mobile/package.json` y el `pnpm-lock.yaml` derivado; no se relajó
  `minimumReleaseAge` ni se modificó `pnpm-workspace.yaml`.
  `expo install --check` responde `Dependencies are up to date` (exit 0).

---

## SR-MOB-007 — Lectura consolidada de la orden activa de una mesa (PARCIALMENTE RESUELTA EN `main`)

- **Estado tras la revisión 0.R1 (2026-09-06)**: el coordinador informa que
  `main` ya incorporó una **lectura acotada de órdenes activas** que devuelve
  `orderId`, versión, estado, `shiftId` e `itemCount`. Eso resuelve la parte de
  `expectedVersion` y permite saber si una mesa tiene orden abierta, pero **no
  devuelve líneas ni modificadores**, así que el compositor todavía no puede
  reanudar una comanda existente ni mostrar lo ya pedido. Esta rama parte de
  `3061487a…` y **no incorpora `main`**: no se copió ni se redefinió ese
  contrato aquí. La integración contra él la hará el coordinador **después del
  merge**. Lo que sigue describe el estado en la base de esta rama.
- **Capacidad requerida**: un contrato versionado y un endpoint autorizado que
  devuelvan, para un par Restaurant/Branch y un `tableId`, si existe una orden
  abierta y cuál es su estado, versión, líneas y estados de `OrderItem`.
- **Pantalla o caso de uso bloqueado**: la vista de mesas no puede indicar
  ocupación, cuenta ni comanda en curso, y el compositor no puede continuar una
  comanda existente: solo puede empezar un borrador local. Tampoco puede
  aportar el `expectedVersion` que exigen `AddOrderItemCommandV1` y
  `OpenOrderCommandV1`.
- **Contrato o endpoint buscado**: `packages/shared-types` expone
  `parseOrderMutationSummaryV1`, que es la **respuesta de una mutación**, no una
  lectura. `apps/api` expone `POST /api/v1/orders`, `/orders/items`,
  `/orders/open` y `/orders/items/transition`; `GET /api/v1/kds/tickets` es una
  lectura por estación, no por mesa.
- **Evidencia de no disponibilidad**: CodeGraph sobre el worktree en
  `f1f8f27b4732810ee26c1bbab122016a7ede0dc1` sitúa a `OrderMutationSummaryV1`
  solo en `packages/shared-types/src/orders.ts`, `apps/api/src/orders.ts`,
  `apps/api/src/orders.controller.ts` y el verificador de tenancy; no existe
  ningún símbolo de lectura de orden por mesa. El mandato §0.5 lo declara
  explícitamente ausente.
- **Datos mínimos que necesitaría la UI**: por mesa, si hay orden abierta; su
  `orderId`, `version` y estado; y por línea, producto, cantidad, modificadores
  y estado de preparación. Descrito como necesidad, no como diseño impuesto.
- **Estado en este entregable**: la pantalla de mesas dice en texto que no
  muestra ocupación, cuenta ni orden activa, y el compositor declara que el
  borrador es local al dispositivo. No se inventó estado autoritativo alguno.
- **Impacto si se difiere**: dos operadores pueden componer borradores para la
  misma mesa sin verse, y el borrador no puede reanudar una comanda existente.
- **Decisión requerida**: definir el contrato de lectura y su permiso RBAC antes
  de conectar las mutaciones de Order desde mobile.

## SR-MOB-008 — Zona horaria operativa autoritativa de la sucursal (CERRADA EN R6)

- **Cierre (2026-09-06, R6)**: `POST /api/v1/access/branch/context` devuelve
  `timeZone` y es la única fuente que mobile usa para el `timeZone` de
  `CreateOrderCommandV2`. El dispositivo **no** lo deriva de su propio reloj ni
  de `Intl` local: sólo comprueba que este runtime pueda resolver la zona que el
  servidor envió, y si no puede, no construye el plan. La zona queda ligada al
  mismo operador, token, Restaurant/Branch e intento que la leyó.

- **Capacidad requerida**: que el servidor determine el `timeZone` que exige
  `CreateOrderCommandV1`, o que lo publique en un contrato que mobile pueda
  leer.
- **Pantalla o caso de uso bloqueado**: la creación real de una orden desde
  mobile. El intent `CreateOrderIntentV1` de este entregable omite `timeZone` a
  propósito.
- **Contrato o endpoint buscado**: `parseCreateOrderCommandV1` valida
  `timeZone` con `Intl.DateTimeFormat`, pero ningún contrato de acceso, layout,
  catálogo o turno publica la zona de la sucursal.
- **Evidencia de no disponibilidad**: `BranchMembershipSummaryV1`,
  `DiningLayoutV1`, `MenuCatalogStateV1` y `OperationalShiftSummaryV1` no
  contienen zona horaria. `PROJECT_NOTES.md` registra `America/Hermosillo` como
  decisión de producto, no como dato del contrato.
- **Impacto si se difiere**: ninguno para este slice. Al conectar la mutación,
  el cliente tendría que adivinar la zona de la sucursal, que es exactamente lo
  que `AGENTS.md` §5 prohíbe.
- **Decisión requerida**: derivarla en el servidor a partir de la sucursal, o
  añadirla al contrato de acceso/turno. Mobile no la asumirá.

## SR-MOB-009 — `deviceId` estable para la identidad de auditoría (CERRADA EN R6)

- **Cierre (2026-09-06, R6)**: Emmanuel autorizó `expo-secure-store`. Mobile
  acuña un UUID por instalación bajo la clave versionada
  `superRestaurant.deviceId.v1`, lo valida al leer, serializa la concurrencia con
  un único intento compartido —dos lecturas iniciales no pueden generar dos
  valores—, nunca lo registra y **falla explícitamente** si el almacén no está
  disponible, no se puede leer o guarda algo que esta app no escribió; un valor
  corrupto no se sobreescribe. `eventId` e `idempotencyKey` los acuña el cliente,
  uno por mutación, dentro de un plan inmutable por entrega (`src/order-plan.ts`).

- **Capacidad requerida**: una política aprobada para obtener un `deviceId` UUID
  estable por instalación, y una decisión sobre quién acuña `eventId` e
  `idempotencyKey` en el flujo móvil.
- **Pantalla o caso de uso bloqueado**: cualquier mutación de Order. Los cuatro
  comandos exigen `deviceId`, `eventId`, `idempotencyKey` y `occurredAt`.
- **Contrato o endpoint buscado**: `OrderAuditInputV1` los exige, pero nada en
  `apps/mobile` puede producir un `deviceId` que sobreviva al proceso: la
  sesión es solo de memoria y no hay almacenamiento aprobado (SR-MOB-001).
- **Estado en este entregable**: `src/order-intents.ts` omite deliberadamente
  todos esos campos y lo documenta. Un `deviceId` aleatorio por arranque haría
  inútil la deduplicación por dispositivo, así que no se generó ninguno.
- **Impacto si se difiere**: sin identidad de dispositivo estable, un reintento
  tras reiniciar la app no podría deduplicarse por dispositivo.
- **Decisión requerida**: elegir el origen del `deviceId` —junto con la decisión
  de almacenamiento de SR-MOB-001— y confirmar si el cliente acuña `eventId` e
  `idempotencyKey` o si los entrega el servidor.

## SR-MOB-010 — Validación del turno operativo en las mutaciones de Order (RESUELTA PARA CREACIÓN v2)

- **Estado tras la revisión 0.R1 (2026-09-06)**: el coordinador informa que
  `main` **resolvió la creación v2 ligando la orden al turno mediante
  `shiftId`**. La pregunta de esta solicitud queda contestada: `shiftId` viaja
  en el comando. Esta rama no incorpora `main` ni redefine ese contrato; el
  `CreateOrderIntentV1` local sigue **sin** `shiftId` a propósito, porque
  añadirlo aquí sería inventar la forma de un contrato que ya existe fuera. El
  coordinador hará la integración contra el contrato real después del merge.
- **Capacidad requerida**: confirmar si una comanda queda ligada al turno
  operativo y, en ese caso, cómo viaja esa relación.
- **Pantalla o caso de uso bloqueado**: el envío real de la comanda. La UI ya
  obliga a seleccionar un turno abierto antes de leer mesas y menú, pero el
  intent no puede declarar una relación que el contrato no modela.
- **Contrato o endpoint buscado**: `CreateOrderCommandV1`, `AddOrderItemCommandV1`
  y `OpenOrderCommandV1` no contienen `shiftId`, y el mandato §0.1 indica que el
  backend todavía no valida el turno operativo nuevo en esas mutaciones.
- **Evidencia de no disponibilidad**: CodeGraph no encuentra ninguna referencia
  a turno en `packages/shared-types/src/orders.ts` ni en `apps/api/src/orders.ts`.
- **Impacto si se difiere**: una comanda podría enviarse fuera de un turno
  abierto sin que el servidor lo note, y los cortes por turno no cuadrarían.
- **Decisión requerida**: decidir si `shiftId` entra en los comandos de Order o
  si el servidor lo deriva del estado de la sucursal, y hacerlo antes de
  conectar el envío.

## SR-MOB-011 — Importes calculados por el servidor para mostrarlos en la comanda

- **Capacidad requerida**: una lectura autorizada que devuelva subtotal,
  impuestos, descuentos y total de una orden, en unidad menor entera y con la
  moneda del contrato.
- **Pantalla o caso de uso bloqueado**: la comanda solo muestra precios
  unitarios. No puede decirle al operador cuánto suma lo que lleva, y el mandato
  §0.6 prohíbe calcularlo en el dispositivo, con razón: duplicaría reglas de
  dominio de dinero.
- **Contrato o endpoint buscado**: `OrderMutationSummaryV1` devuelve estado y
  versión, no importes. `packages/domain` calcula totales, pero no puede
  importarse desde el cliente sin duplicar la regla en el bundle.
- **Estado en este entregable**: la pantalla declara en texto que no calcula
  subtotales, impuestos, descuentos, propinas ni total, y una prueba verifica
  que el módulo de borrador no referencia ningún importe ni moneda.
- **Impacto si se difiere**: el operador no ve el importe de la comanda desde
  mobile; hoy debe consultarlo en la caja web.
- **Decisión requerida**: publicar los importes junto con la lectura de
  SR-MOB-007, o como un contrato aparte. Mobile no los calculará.

## SR-MOB-012 — Un catálogo puede publicar más grupos obligatorios de los que un comando admite (CERRADA EN `main`)

- **Cierre (2026-09-06, R6)**: la base del coordinador impuso la coherencia
  donde correspondía: `parseMenuCatalogPayload` ahora rechaza un catálogo que
  declare más de `MAX_ORDER_ITEM_MODIFIER_GROUPS` grupos obligatorios activos
  para un mismo producto. El caso ya no puede publicarse, así que la fixture que
  lo construía dejó de ser válida y la prueba de mobile pasó a comprobar que el
  parser compartido lo refuse. La garantía local —una línea con un grupo
  obligatorio sin seleccionar se rechaza, nunca se trunca— se conserva y se
  prueba en el límite que el contrato sí permite (50 grupos).

- **Capacidad requerida**: una regla acordada para el caso en que un producto
  publique más grupos de modificadores **obligatorios** (`minimumQuantity >= 1`)
  de los que un solo `AddOrderItemCommandV1` puede transportar.
- **Pantalla o caso de uso bloqueado**: la toma de comanda de ese producto, por
  completo. No es hipotético en el contrato: `MenuCatalogV1` admite hasta 2,000
  grupos por catálogo, mientras que `parseAddOrderItemCommandV1` acepta como
  máximo 50 grupos en un comando. Con 51 grupos obligatorios no existe ninguna
  selección válida que quepa en el comando.
- **Contrato o endpoint buscado**: ninguno lo impide hoy. El catálogo no valida
  que un producto sea pedible dentro de los límites del comando, así que puede
  publicarse un producto que ningún cliente puede ordenar.
- **Evidencia**: reproducido con una fixture sintética de 51 grupos activos y
  obligatorios en `apps/mobile/src/order-intents.test.ts`.
- **Estado en este entregable**: mobile **falla cerrado y lo dice**. Al construir
  el handoff, un producto en esa situación produce un único mensaje operativo
  —«exige N grupos obligatorios y una comanda admite 50»— y el envío se reporta
  como `stale` sin llamar a la integración. **No se trunca la selección** ni se
  relajan los límites del comando: enviar 50 de 51 grupos obligatorios sería
  construir una comanda que el servidor rechazaría, o peor, aceptaría incompleta.
- **Impacto si se difiere**: un error de captura en el catálogo deja un producto
  imposible de comandar desde mobile, y el operador solo se entera al intentar
  enviarlo. Hoy el mensaje le dice que lo pida en caja.
- **Decisión requerida**: decidir dónde se impone la coherencia —validación al
  publicar el catálogo, un límite declarado en el contrato de menú, o un comando
  capaz de transportar más grupos— y si el cliente debe ocultar por completo los
  productos que no puede representar en lugar de explicarlo al enviar. Mobile no
  inventará una regla de dominio para esto.

---

## SR-MOB-013 — Reanudar una entrega ambigua exige leer la orden activa

- **Capacidad requerida**: una forma de saber qué pasos de una secuencia
  `create → add → open` ya se aplicaron, cuando la primera respuesta se perdió.
- **Pantalla o caso de uso bloqueado**: ninguna; hay una solución que funciona,
  pero cuesta una lectura extra y depende de un detalle de implementación del
  servidor que conviene dejar por escrito.
- **Contrato o endpoint buscado**: `POST /api/v1/orders` es idempotente por
  `idempotencyKey` y responde `replayed: true`. `POST /api/v1/orders/items` y
  `POST /api/v1/orders/open`, en cambio, comprueban `expectedVersion` **antes**
  de mirar la idempotencia (`readExact` en `apps/api/src/orders.ts`), así que un
  paso ya aplicado responde `409` en lugar de reproducirse.
- **Estado en este entregable**: mobile reanuda en vez de repetir. Si `create`
  responde `replayed`, lee `GET /api/v1/orders/active`, compara los
  `orderItemId` del plan inmutable con los que la orden ya tiene y envía sólo
  las líneas que faltan, encadenando `expectedVersion` desde la versión que el
  servidor reporta. Una línea cancelada cuenta como aplicada: su id está tomado.
- **Impacto si se difiere**: ninguno urgente. La lectura extra sólo ocurre en un
  reintento, y es la misma que la pantalla de mesa ya hace.
- **Decisión requerida**: si el servidor prefiriera que un `addItem`/`open`
  repetido respondiera `replayed` en lugar de `409` —comprobando la idempotencia
  antes de la versión—, mobile podría reintentar sin esa lectura. Es una decisión
  del lado servidor; mobile no la anticipa.
