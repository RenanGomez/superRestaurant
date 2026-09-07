# Entregas del workstream frontend móvil (`apps/mobile`)

Mandato: `docs/CLAUDE_FRONTEND_WORKSTREAM.md`. Cada unidad queda lista para
revisión y **no integrada**: no hubo merge, rebase, push ni publicación de rama.

- **Unidad 2 — mesas y borrador de comanda (2026-09-05)**: sección A, abajo. Es
  el corte vigente y responde al mandato de la sección 0 del documento.
  **Integrada y conectada el 2026-09-06**: la sección **A.R6** describe la
  integración autorizada por §0.R6 —contexto operativo, `deviceId` y la
  secuencia Order v2— y es la más reciente. **A.R5** a **A.R1** describen las
  cinco revisiones anteriores del corte que R6 incorporó por cherry-pick. Donde
  se contradigan, prevalece la más reciente, y todas sobre las secciones A.1 a
  A.11, escritas para el corte `3061487a…`.
- **Unidad 1 — fundación Expo/Auth/sucursal**: ya integrada en `main` y marcada
  DONE. Su registro histórico se conserva a partir de la sección B y no describe
  el corte actual.

---

# A. Unidad 2 — mesas y borrador de comanda

## A.R6 Integración autorizada (2026-09-06) — contexto, `deviceId` y Order v2

Worktree y rama **nuevos**, como exige §0.R6: `claude/mobile-order-integration-20260906`
en `.claude/worktrees/mobile-order-integration-r6`, creado desde el HEAD limpio
del coordinador `cbde9b21562f0d91a4fd18306b922c8a921e24be`, que contiene
`3ce02dfe1db6032da6ad392585925c311041c5ac` (comprobado con `git merge-base
--is-ancestor`). El worktree R5 no se tocó. La P2 permanece **IN_PROGRESS**: la
integración local no es evidencia remota y las migraciones siguen sin aplicar.

### Incorporación del rango Mobile aceptado

`git cherry-pick f1f8f27b4732810ee26c1bbab122016a7ede0dc1..0fcd61d22c07d32ae47b0780992182f800f1d60f`
— los 18 commits ya revisados, en orden, **sin un solo conflicto**. Sin pull,
merge, rebase, reset ni push.

Comprobación de fidelidad: el árbol `apps/mobile` resultante es **idéntico** al
del corte aceptado — `git rev-parse HEAD:apps/mobile` y
`git rev-parse 0fcd61d:apps/mobile` dan ambos
`86fbcc59156ad367bb7a6c4489d041d4807b693c` — y el diff contra `cbde9b2` no toca
nada fuera de `apps/mobile/**`. HEAD tras la incorporación:
`ee6c037f1d1ab3f8959c143101fdc37b9c165112`.

### 1. Contexto operativo autoritativo

`POST /api/v1/access/branch/context` sustituye la autorización local en el flujo
operativo. Se valida **sólo** con `parseBranchOperationalContextV1`, y la
respuesta debe además devolver el par exacto que se pidió.

Al hacerlo se eliminó la copia local del contrato anterior: `authorizeBranch`,
`AuthorizedMobileBranch`, `parseAuthorizedMobileBranch` y sus ayudantes (~90
líneas) y la ruta `/api/v1/access/branch` salieron de la app. Eso **cierra
SR-MOB-002**, que pedía exactamente no conservar esa copia.

La zona que usa `CreateOrderCommandV2` viene de esa respuesta. Está ligada al
operador, al token, al Restaurant/Branch y al intento: `contextRead` guarda
`{attempt, operator, scope}`, `ownsContextRead` exige las tres cosas, y una
renovación de token entrega la lectura en vuelo dejando `pendingScope` intacto,
así que la pantalla vuelve a leer de inmediato en vez de devolver al operador a
la lista de sucursales. Una respuesta tardía no puebla otro contexto. La
revalidación de primer plano usa el mismo endpoint, así que un acceso confirmado
también refresca la zona. **Cierra SR-MOB-008.**

### 2. Identidad de dispositivo

`expo install expo-secure-store expo-crypto` (`~57.0.3` y `~57.0.2`, las versiones
que Expo 57.0.20 fija). El único efecto en `pnpm-lock.yaml` son esas dos
dependencias; `app.json` gana el config plugin `expo-secure-store`, que el
propio `expo install` añade.

`src/device-identity.ts` es puro y no importa nada nativo: acuña **un** UUID por
instalación bajo `superRestaurant.deviceId.v1`, lo valida al leer, comparte un
único intento entre llamadas concurrentes —dos lecturas iniciales no pueden
generar dos valores—, no lo registra nunca, y falla **explícitamente** con
`unavailable`, `unreadable`, `corrupt` o `unwritable`. Un valor que esta app no
escribió se trata como corrupto y **no se sobreescribe**: borrarlo eliminaría la
única evidencia de que algo más tocó la clave. `src/expo-device-identity.ts` es
el único archivo que importa los módulos nativos, con
`WHEN_UNLOCKED_THIS_DEVICE_ONLY` para que la identidad no viaje a otro
dispositivo por un respaldo de llavero. Ni correo, ni token, ni id de hardware,
ni advertising id, ni una constante. **Cierra SR-MOB-009.**

### 3. Plan inmutable por entrega

`src/order-plan.ts` construye una vez, por entrega lógica: `orderId`, un
`orderItemId` por línea, `eventId` e `idempotencyKey` **distintos por mutación**,
`occurredAt` UTC canónico, `deviceId`, scope, `shiftId`, la moneda del catálogo y
la zona del contexto. Se apoya en `buildOrderDraftHandoff`, así que la validación
fail-closed contra el catálogo completo es la misma de R1–R5, en un solo sitio.
Un generador que repita un valor, lance o devuelva algo que no sea UUID no
produce plan.

La pantalla guarda el plan con una clave `contexto|mesa|líneas`: un reintento del
mismo borrador reutiliza el plan **byte por byte**, y editar el borrador, cambiar
de mesa o de contexto, o un envío aceptado, lo descartan — la siguiente entrega
acuña identidades nuevas. Nada de esto se guarda en SecureStore: ni tokens, ni el
borrador. No se anuncia offline.

### 4. La secuencia real

`src/order-submission.ts` ejecuta exactamente `CreateOrderCommandV2 →
AddOrderItemCommandV1[] → OpenOrderCommandV1`, valida cada respuesta con
`parseOrderMutationSummaryV1` y **encadena `expectedVersion` desde la respuesta
autoritativa anterior** — nunca desde una versión que el cliente calculó. Un
fallo detiene la secuencia donde ocurrió: no se emite ninguna petición posterior
y `open` es inalcanzable mientras una línea no esté confirmada. Conflicto,
autorización, red y protocolo son estados distintos y recuperables.

Un reintento **reanuda, no repite**. `create` es idempotente por
`idempotencyKey`, pero `addItem` y `open` comprueban `expectedVersion` antes de
la idempotencia (`readExact` en `apps/api/src/orders.ts`), así que un paso ya
aplicado responde `409` y no `replayed`. Por eso, cuando `create` responde
`replayed`, la secuencia lee `GET /api/v1/orders/active`, compara los
`orderItemId` del plan con los que la orden ya tiene, y envía sólo las que
faltan. Una línea cancelada cuenta como aplicada: su id está tomado. Queda
anotado como **SR-MOB-013**, por si el servidor prefiriera comprobar la
idempotencia antes de la versión y ahorrar esa lectura.

Además el cliente **valida cada comando con el parser compartido antes de
enviarlo**: un comando mal construido falla como defecto de cliente sin llegar a
la red, y lo que va en el cuerpo es la forma normalizada que el servidor volverá
a parsear.

### 5. Órdenes activas de la mesa

`GET /api/v1/orders/active` con `parseActiveTableOrderListV2`. Se trata como
lista acotada: `src/ui/active-orders-panel.tsx` muestra **todas** las órdenes
activas de la mesa, con sus líneas y modificadores snapshot y el precio unitario
tal como llegó, y dice «Sin turno registrado» cuando `shiftId` es `null` —un
valor histórico válido—. No se calcula ni se muestra subtotal, impuesto,
descuento, propina ni total, y nada asume ocupación exclusiva por mesa: el panel
del borrador separa visiblemente lo que ya es del servidor de lo que sigue siendo
local y sin enviar. El recurso pertenece al scope, la mesa y el intento, igual
que las otras lecturas, y se relee cuando un envío es aceptado.

### 6. Garantías R1–R5 conservadas

Salida segura y confirmaciones dentro de la pantalla, cero reenvío de líneas
aceptadas, intentos ligados al contexto (`createOrderDeliveryTracker` sigue
siendo el único que decide qué entrega está en vuelo), validación fail-closed
contra el catálogo completo, una sola frontera de efecto (`OrderDeliveryPort`),
el layout de una sola columna a 390, y las lecturas pertenecientes a
operador/scope/intento de R4 y R5 —ahora también la de contexto y la de órdenes
activas—. La matriz R4 completa se repitió y sigue verde.

### Pruebas — 224 en `apps/mobile` (219 antes de las de reductor, 191 antes de R6)

| Archivo | Qué demuestra |
| --- | --- |
| `src/device-identity.test.ts` (10) | almacén vacío, ya escrito, no disponible, ilegible, que rechaza al escribir y con dato corrupto; dos cargas concurrentes comparten un intento; un generador que lanza o devuelve algo que no es UUID; un intento fallido se puede reintentar y uno exitoso no se repite; la identidad no se registra y nada más se guarda |
| `src/order-plan.test.ts` (7) | una identidad por mutación, todas distintas; cada comando construido desde el plan pasa el parser compartido; dos entregas no comparten identidades; un borrador que el catálogo ya no acepta no produce plan; identidad y contexto son obligatorios; un generador que repite o lanza no produce plan; el plan no pide, no nombra endpoints y no calcula dinero |
| `src/order-submission.test.ts` (15) | la secuencia exacta con rutas, métodos, Bearer y cuerpos; `expectedVersion` encadenado desde cada respuesta; reintento exacto que reanuda y envía sólo lo que falta; reintento de una entrega ya completa que no manda ninguna mutación; fallo ambiguo en cada paso, sin peticiones posteriores; `open` inalcanzable con una línea sin confirmar; cada fallo con su propio significado; respuesta de otra orden u otra sucursal rechazada; réplica cuya orden ya no está activa; lectura de reanudación que falla; línea cancelada que cuenta como aplicada; mesa con varias órdenes activas; lanzamiento síncrono contenido; promesa colgada sin duplicar; ningún rechazo sin manejar |
| `src/mobile-state.test.ts` (+5, 38) | el contexto confirma la sucursal y trae su zona; una respuesta de contexto exige operador, par pendiente e intento; una renovación de token entrega la lectura y conserva la selección; las órdenes activas pertenecen a scope, mesa e intento; turno, sucursal y acceso revocado las descartan, y un 401 de la lectura vigente revoca |
| `src/mobile-client.test.ts` (+9, 26) | el contexto con su cuerpo y su par de vuelta; una zona inutilizable como fallo de protocolo; los tres comandos con ruta, método, Bearer y cuerpo exacto; un comando mal construido que no llega a la red; el conflicto con su propio estado; la lista activa de una mesa, vacía, múltiple y con `shiftId: null`; un `tableId` que no es UUID no llega a la red |
| `src/order-intents.test.ts` (ajustado) | el handoff no lleva identidad de auditoría; el catálogo imposible ya no es publicable (lo refuta el parser compartido) y una línea con un grupo obligatorio sin seleccionar se rechaza en el límite que el contrato sí permite |

El doble HTTP de `order-submission.test.ts` es deliberadamente estricto: una
petición no guionizada **falla la prueba** en vez de absorberse, que es la forma
de demostrar «ninguna llamada después del primer fallo».

### Matriz visual R6 — Chrome real, clics de confianza

Sin `force`, sin coordenadas contra elementos tapados y sin editar DOM ni CSS.
El arnés simula los cinco endpoints nuevos con un **servidor de Order sintético**
que conserva las dos reglas que dan forma al reintento: `create` idempotente por
`idempotencyKey`, y `addItem`/`open` con `expectedVersion` exacto o `409`. Su
control por defecto es «Envío: servidor sintético (secuencia real)», que hace que
la pantalla construya su **puerto productivo** en lugar de recibir el doble.

| Comprobación | 390×844 | 1024×768 |
| --- | --- | --- |
| acceso → contexto de sucursal → turno → mesas | ✅ | ✅ |
| la mesa consulta sus órdenes activas y no inventa ocupación | ✅ «no tiene órdenes activas registradas» | ✅ |
| producto + modificador requerido → línea de borrador | ✅ | ✅ |
| `create` v2 → `add item` → `open` contra el servidor sintético | ✅ «La comanda se entregó» | ✅ |
| el servidor sintético quedó con la orden abierta y su línea | ✅ `open v3 · 1 línea(s) · mesa 66666666` | ✅ |
| en modo sintético el doble no recibe nada: la secuencia fue la real | ✅ «Plan ofrecido: ninguno todavía» | ✅ |
| la orden creada aparece como activa, con su línea snapshot | ✅ 1 orden abierta, con su precio unitario del servidor | ✅ |
| no se calcula ningún total en el dispositivo | ✅ sin total, subtotal, impuesto ni propina | ✅ |
| un conflicto se reporta como conflicto y el borrador sigue ahí | ✅ | ✅ |
| sin almacén seguro no hay `deviceId` y el envío falla explícitamente | ✅ el envío no reporta éxito y el borrador se conserva | ✅ |
| `scrollWidth` vs `innerWidth` | 390 = 390 | 1024 = 1024 |
| consola sin errores ni rechazos no manejados | ✅ | ✅ |

Un hallazgo del arnés, corregido: el doble del almacén seguro se creaba una sola
vez por montaje, así que cambiar el control a «no disponible» reusaba la
identidad ya cacheada y el envío **seguía funcionando**. El caché es correcto
—una identidad leída vale para toda la vida de la app—, así que lo que se corrigió
es el arnés: cambiar lo que el almacén contiene ahora se ve como una instalación
nueva. Antes del arreglo esa fila fallaba; después pasa en los dos viewports.

### Compuertas ejecutadas con Node 24.19.0

| Compuerta | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile run lint` | limpio |
| `pnpm --filter @super-restaurant/mobile run typecheck` | limpio |
| `pnpm --filter @super-restaurant/mobile run test` | 224/224 |
| `pnpm exec expo install --check` | `Dependencies are up to date` |
| `pnpm --filter @super-restaurant/mobile run build` (export Android) | 676 módulos, `index-f9efe33aeb037d89eaeff654c1ce5258.hbc` de 2 291 403 bytes |
| `pnpm lint --force` | 8/8 tareas, sin caché |
| `pnpm typecheck --force` | 11/11 tareas, sin caché |
| `pnpm test --force` | 11/11 tareas, sin caché |
| `pnpm build --force` | 8/8 tareas, sin caché |
| `git diff --check` | sin hallazgos |
| Fin de línea | LF en los 23 archivos modificados y los 8 nuevos (0 bytes CR) |
| Aislamiento del bundle | **sin** `harnessControl`, `FIXTURE_`, `Ocultar controles`, `example.invalid`, `Ir a segundo plano`, `HARNESS_SESSION_UNREADABLE`, `sb_publishable_fixture`, `Respuesta lenta`, `XTS`, `servidor sint`, `Almacen seguro` ni `no-es-un-uuid`; **con** `Cambiar sucursal`, `Acceso sin confirmar`, `Enviar comanda`, `Volver a mesas`, `superRestaurant.deviceId.v1`, `abierta`, `parcialmente pagada`, `borrador en el servidor` y `entregado`. Las cadenas con acentos del panel nuevo se comprobaron como UTF-16 (`Órdenes activas de la mesa` presente), porque Hermes las almacena así |
| CodeGraph final | índice local del worktree nuevo. `submitOrderPlan`, `buildOrderDeliveryPlan`, `listActiveTableOrders`, `ownsContextRead` y `ActiveOrdersPanel` se consumen sólo dentro de `apps/mobile`; sin referencias rotas ni huérfanos. CodeGraph señaló que `ownsContextRead` no tenía prueba propia y por eso se añadieron las cinco de reductor |

### Archivos tocados en R6

| Archivo | Cambio |
| --- | --- |
| `src/device-identity.ts` | nuevo: reglas puras del `deviceId` |
| `src/expo-device-identity.ts` | nuevo: el único archivo que importa `expo-secure-store` y `expo-crypto` |
| `src/order-plan.ts` | nuevo: el plan inmutable de una entrega |
| `src/order-submission.ts` | nuevo: la secuencia, la reanudación y el puerto de entrega |
| `src/ui/active-orders-panel.tsx` | nuevo: las órdenes activas de la mesa, snapshot y sin totales |
| `src/mobile-client.ts` | contexto, tres mutaciones y lista activa; se retira la copia local del contrato de `/access/branch` |
| `src/mobile-state.ts` | `MobileBranchContext`, `contextRead`, `ownsContextRead`, `contextReadTarget`, recurso `activeOrders` y su objetivo |
| `src/ui/app.tsx` | lectura de contexto con identidad de intento; identidad de dispositivo; caché del plan; puerto productivo; lectura de órdenes activas |
| `src/ui/order-draft-screen.tsx`, `src/ui/root.tsx` | reciben el panel y los puertos nuevos |
| `src/order-delivery.ts`, `src/order-intents.ts`, `src/revalidation.ts` | el seam pasa del handoff al plan; la revalidación devuelve el contexto |
| `harness/harness-server.ts`, `harness/harness-root.tsx` | servidor de Order sintético, doble de almacén seguro, generador de UUID y controles nuevos |
| `src/test-fixtures.ts` | cuerpos del contexto, de la lista activa y del resumen de mutación |
| `app.json`, `package.json`, `pnpm-lock.yaml`, `tsconfig.test.build.json` | las dos dependencias Expo y el registro de las pruebas nuevas |
| las seis suites existentes | actualizadas al contrato nuevo |

### Límites que siguen abiertos

- **Nada se ejecutó contra PostgreSQL, Data API ni Supabase**, y no se aplicó
  ninguna migración. Todo lo verificado corre contra fixtures sintéticas locales.
- **Sin verificación en Android/iOS reales**: no hay emulador ni SDK nativo en
  este entorno, así que `expo-secure-store` y `expo-crypto` sólo se ejercitaron a
  través de sus puertos. El bundle Android se genera; no se ejecutó en hardware.
- **SR-MOB-001** (persistencia de sesión), **SR-MOB-004** (origen de API para
  dispositivos físicos), **SR-MOB-005** (entorno verificable real),
  **SR-MOB-011** (importes calculados por el servidor) y **SR-MOB-013**
  (idempotencia antes de la versión en `addItem`/`open`) siguen abiertas.
- El módulo se llama `src/branch-read.ts` y también sirve lecturas que no son
  branch-scoped —membresías y contexto—. Renombrarlo es cosmético y se dejó para
  el corte coordinado.

---

## A.R5 Quinta revisión del coordinador (2026-09-06) — pertenencia de las lecturas de membresías

Partiendo de `9d1aa64c6d790f66af866832ae79eb45eb4e5917` (árbol
`4201508719c15aca488de6783db682f1c022342b`), sobre la misma rama
`claude/mobile-order-entry-ui-20260905` y el mismo worktree, con árbol limpio
verificado antes de editar. Sin reset, pull, merge, rebase ni push; `main` no se
incorporó. El diff sigue confinado a `apps/mobile/**`; `pnpm-lock.yaml` no
cambió. Las correcciones R1–R4 se conservan sin cambios funcionales. La P2
permanece **IN_PROGRESS**.

Nota de procedimiento: la sección **0.R5** de `docs/CLAUDE_FRONTEND_WORKSTREAM.md`
no existe en esta rama. El coordinador la añadió en
`904e420ee5f0e27b5cd0bfeb02ad2f2f0acfa52f`, sobre
`codex/p2-order-shift-server-evidence`. Se leyó ahí, sin incorporar ese commit ni
tocar `docs/**`, y sus criterios coinciden con el prompt humano.

### Hallazgo R5.1 — la lista de membresías no pertenecía a ningún operador

El guardia de la lectura de membresías era un serial local
(`membershipRequest.current`) que vivía sólo en la pantalla, y `membershipsLoaded`
/ `membershipsFailed` no llevaban ninguna identidad que el reductor pudiera
comprobar. De ahí dos agujeros:

1. **El serial no se invalida al cambiar de operador.** `sessionObserved` con otro
   `userId` reinicia el estado, pero no mueve el serial. Si el operador B no ha
   iniciado todavía su propia lectura —por ejemplo mientras `revalidating` está
   activo—, la respuesta de A pasa el guardia y se asienta: la regresión del
   coordinador cambió A→B con la lectura en vuelo, esperaba
   `memberships.value === undefined` y recibió las dos membresías de A.
2. **El 401 tardío de A podía cerrar la sesión de B.** En esa misma ventana, el
   `catch` llamaba `endSession("sessionEnded")` sin comprobar de quién era la
   respuesta, cerrando la generación y pidiendo `signOut()` al proveedor para una
   sesión que ya era de otro operador.

Además, una renovación de token del mismo operador durante la lectura dejaba el
recurso en `loading` con una respuesta que nadie iba a aplicar: spinner colgado.

### Corrección — la misma identidad de intento de R4, ahora con operador

No hay un sistema nuevo: la lectura de membresías pasa por el **mismo tracker**
(`src/branch-read.ts`, `createBranchReadTracker`) y por el mismo campo
`MobileResource.attempt` que R4 introdujo para `shifts`, `layout` y `menu`. Un
solo tracker sirve las cuatro lecturas, así que un intento nombra exactamente una
petición.

1. **`MembershipsRead = { attempt, operator }`** — el dueño es el `userId`
   inmutable de Supabase, nunca el correo y nunca el token; el intento distingue
   dos lecturas del *mismo* operador, que es lo que produce una renovación de
   token o un reintento.
2. **`ownsMembershipsRead(state, read)`** — exige las dos mitades. La usan el
   reductor (para `membershipsLoaded` y `membershipsFailed`) y la pantalla (para
   el único efecto que no es una transición de estado: avisar al proveedor). Una
   sola definición, dos llamadores.
3. **La revocación por 401 pasó al reductor.** `membershipsFailed` con
   `authorization`, y sólo si es la lectura vigente, produce el estado de sesión
   cerrada con el motivo `sessionEnded`. Un 401 que no es de la lectura vigente no
   llega a esa línea.
4. **`membershipsLoading` también se valida** por operador: una lectura iniciada
   para quien ya se fue no puede vaciar la lista de quien está ahora.
5. **`withoutReadsInFlight` incluye `memberships`**, así que renovar el token del
   mismo operador devuelve la lectura en vuelo a `idle` —lista para una lectura
   fresca, nunca colgada—. El cambio de turno usa
   `withoutBranchReadsInFlight`, que no toca la lista. Cierre de sesión y cambio
   de operador ya la dejaban `idle` por la vía del estado inicial.
6. **`membershipsReadOperator(state)`** dice de quién puede leerse la lista ahora,
   igual que los tres `*ReadTarget` de R4: el estado decide, la pantalla pregunta.
7. **Espejo del reductor en la pantalla.** `dispatch` avanza un `useRef` con el
   mismo reductor puro sobre los mismos eventos, en el mismo paso sincrónico. Un
   callback de petición corre mucho después del render que lo creó, y su única
   pregunta —¿el reductor acepta esta lectura como la vigente?— sólo puede
   responderse contra lo que el reductor sabe *ahora*. El espejo no puede
   discrepar de lo que React renderiza; sólo va por delante, que es exactamente
   lo que esos callbacks necesitan. Es lo que permite que la decisión del 401 use
   `ownsMembershipsRead` en lugar de un segundo guardia con reglas propias.

`loadMemberships` recibe la sesión completa, no sólo el token: la identidad y la
credencial viajan juntas porque la lectura pertenece a la primera.

### Pruebas nuevas — promesas controladas, sin temporizadores

`src/branch-read.test.ts` extiende el mismo arnés determinista de R4 con la
lectura de membresías y con el efecto que la pantalla ejecuta al recibir un 401,
de modo que «no cerró la sesión de B» es una aserción y no una lectura de código.
Los dos operadores tienen listas distintas —A autorizado en las dos sucursales, B
sólo en la segunda— así que cada respuesta se puede atribuir a su dueño.

| Prueba | Demuestra |
| --- | --- |
| `a membership answer of the previous operator never reaches the next one` | success tardío de A **después** de iniciar la lectura de B; B no espera a la petición de A |
| `a membership answer of the previous operator is refused before B even reads` | success tardío de A **antes** de que B lea: la ventana que el serial local no podía cerrar |
| `a late membership failure of the previous operator does not disturb the next one` | failure tardío de A: la lista de B sigue en pantalla, sin `failure` |
| `a late 401 of the previous operator does not end the next operator's session` | 401 tardío de A con la lectura de B ya respondida |
| `a late 401 of the previous operator is refused before B even reads` | 401 tardío de A en la ventana sin lectura de B: la sesión de B sobrevive, el proveedor no recibe `signOut`, y la lectura vigente de B se completa después |
| `a 401 of the read the screen is waiting for does end the session` | el 401 vigente sí cierra la sesión, con su motivo |
| `a hung read of the previous operator does not block the next one` | lectura colgada de A seguida de una lectura exitosa de B |
| `renewing the token of the same operator reads the list again, and only once` | renovación del mismo operador: una lectura nueva, sin spinner colgado, y la respuesta superada no aplica |
| `signing out while the list is being read leaves nothing behind` | cierre de sesión con la lectura en vuelo; su respuesta y su 401 no devuelven nada ni vuelven a cerrar |
| `a membership read that rejects or throws synchronously is an ordinary failure` | rechazo y lanzamiento síncrono contenidos, sin reintento automático |
| `membership ownership needs both halves of the identity` | intento correcto con operador equivocado y operador correcto con intento equivocado: ambos rechazados |
| `no rejection was left unhandled` | ningún `unhandledRejection` en todo el archivo |

`src/mobile-state.test.ts` suma cuatro pruebas de reductor —incluida la
regresión exacta del coordinador (`a membership list belongs to the operator that
asked for it`)— y sus casos existentes, junto con `src/sign-out.test.ts`, pasan a
anunciar el `loading` de cada respuesta de membresías.

Total: **185 pruebas** en `apps/mobile` (170 antes, +15).

### Matriz visual R5 — Chrome real, clics de confianza, `Respuesta lenta`

Sin `force`, sin coordenadas contra elementos tapados y sin editar DOM ni CSS. La
barra del arnés se contrae con su propio control y sólo se expande para pulsar un
control. `Respuesta lenta` está activa durante todo el recorrido, así que cada
control se pulsa con la lectura de membresías realmente en vuelo.

| Comprobación | 390×844 | 1024×768 |
| --- | --- | --- |
| A: la lista de sucursales queda en lectura lenta (`Consultando tus sucursales…`) | ✅ | ✅ |
| A: `Renovar token` durante esa lectura | ✅ no cuelga, no cierra sesión, llega la lista completa | ✅ |
| B: `Salir` con la lectura en vuelo | ✅ vuelve al acceso sin spinner | ✅ |
| B: la respuesta abandonada llega después (espera de 2,5 s) | ✅ no reabre la sesión ni muestra sucursales | ✅ |
| B: recorrido completo `acceso → sucursal → turno → mesas` con respuesta lenta | ✅ `Salón principal`, sin rastro de `Terraza` | ✅ |
| 401 de la lectura vigente (`Sesión expirada` al ingresar) | ✅ termina en el acceso con «Tu sesión se cerró en este dispositivo.» | ✅ |
| Consola | ✅ sin `error`, `warning`, `pageerror` ni rechazos no manejados | ✅ |

La matriz R4 se repitió completa en los dos viewports para comprobar que R1–R4
siguen en pie: recorrido con turno lento, la reproducción de R4.1 tras
`Cambiar turno` + segundo/primer plano, reingreso al turno, `Renovar token` con
una lectura de sucursal en vuelo, cambio de sucursal, `scrollWidth == innerWidth`
(390 y 1024) y consola limpia — **9/9 PASS en cada viewport**.

**Limitación del arnés (registrada, no cubierta con clics).** Dos cosas del
hallazgo R5.1 no son observables desde el arnés sin editar DOM/CSS ni ampliarlo:

1. Sus fixtures de membresías no varían por operador —`scenario: "ok"` responde
   siempre las dos sucursales—, así que un navegador no puede distinguir «la
   lista de A mostrada a B» de «la lista de B».
2. El cambio A→B **dentro de una misma generación** de autenticación no tiene
   control que lo produzca: en el arnés (y en el producto) pasar de A a B implica
   `Salir` e `Ingresar`, lo que cierra y abre la generación. El caso patológico
   que el reductor debe rechazar es precisamente el otro.

Ambas quedan sostenidas por las pruebas deterministas de la tabla anterior, que
usan dos `userId` distintos con listas distintas y despachan `sessionObserved`
directamente. Lo que el arnés sí demuestra con clics reales es la ventana
temporal: renovación de token y cierre de sesión con la lectura en vuelo, y el
401 de la lectura vigente.

### Compuertas ejecutadas con Node 24.19.0

| Compuerta | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile run lint` | limpio |
| `pnpm --filter @super-restaurant/mobile run typecheck` | limpio |
| `pnpm --filter @super-restaurant/mobile run test` | 185/185 |
| `pnpm exec expo install --check` | `Dependencies are up to date` |
| `pnpm --filter @super-restaurant/mobile run build` (export Android) | 662 módulos, `index-09d39976107222312df02cc2dee82bc3.hbc` de 2 238 549 bytes |
| `pnpm lint --force` | 8/8 tareas, sin caché |
| `pnpm typecheck --force` | 11/11 tareas, sin caché |
| `pnpm test --force` | 11/11 tareas, sin caché |
| `pnpm build --force` | 8/8 tareas, sin caché |
| `git diff --check` | sin hallazgos |
| Fin de línea | LF conservado en los seis archivos (0 bytes CR, igual que en `HEAD`) |
| Aislamiento del bundle | **sin** `harnessControl`, `FIXTURE_`, `Ocultar controles`, `example.invalid`, `Ir a segundo plano`, `HARNESS_SESSION_UNREADABLE`, `sb_publishable_fixture`, `Respuesta lenta` ni `XTS`; **con** `Cambiar sucursal`, `Acceso sin confirmar`, `Agregar al borrador`, `Enviar comanda` y `Volver a mesas` |
| CodeGraph final | el índice compartido no había reindexado los símbolos nuevos del worktree y devolvió coincidencias ajenas (`read`, `without` de `apps/api`); se completó con una búsqueda dirigida: `ownsMembershipsRead`, `membershipsReadOperator`, `MembershipsRead` y `withoutBranchReadsInFlight` sólo se usan dentro de `apps/mobile`, y `membershipRequest`/`canReadMemberships` no dejaron ninguna referencia |

### Archivos tocados en R5

| Archivo | Cambio |
| --- | --- |
| `src/mobile-state.ts` | `MembershipsRead`; `ownsMembershipsRead`; `membershipsReadOperator`; los tres eventos de membresías llevan `attempt` y `operator`; la revocación por 401 pasa al reductor; `withoutReadsInFlight` incluye la lista y `withoutBranchReadsInFlight` no |
| `src/ui/app.tsx` | espejo sincrónico del reductor; `loadMemberships` recibe la sesión y usa el tracker compartido; se retira `membershipRequest`; el efecto usa `membershipsReadOperator` |
| `src/branch-read.ts` | sólo documentación: el tracker sirve también la lista de membresías |
| `src/branch-read.test.ts` | el arnés determinista incluye la lectura de membresías y el aviso al proveedor; 12 pruebas nuevas |
| `src/mobile-state.test.ts` | 4 pruebas de reductor nuevas; los casos existentes anuncian el `loading` de membresías |
| `src/sign-out.test.ts` | idem para su lectura de membresías |

### Límites que siguen abiertos

Sin cambios respecto de A.R4, salvo que el límite que A.R4 anotaba —la lista de
membresías protegida sólo por un serial local— queda cerrado. Nuevo, menor: el
módulo se llama `src/branch-read.ts` y ahora también sirve una lectura que no es
branch-scoped; se dejó el nombre para no mover un archivo que el coordinador
acaba de aceptar, y renombrarlo a algo como `owned-read.ts` es un cambio
puramente cosmético que puede hacerse en el corte coordinado posterior.

---

## A.R4 Cuarta revisión del coordinador (2026-09-06) — propiedad de las lecturas branch-scoped

Partiendo de `5bb97233bf96acc31088cd2b1c353d76bea3fe75` (árbol
`13e719da55898a6967374dc07eb189533793bf9f`), sobre la misma rama
`claude/mobile-order-entry-ui-20260905` y el mismo worktree, con árbol limpio
verificado antes de editar. Sin reset, pull, merge, rebase ni push. El diff sigue
confinado a `apps/mobile/**`; `pnpm-lock.yaml` no cambió. El arreglo de layout de
`aa6bb2c4` no se tocó. La P2 permanece **IN_PROGRESS**.

### Hallazgo R4.1 — la lista de turnos quedaba cargando para siempre

Reproducido en Chrome real (Playwright sobre el Chrome instalado, clics de
confianza, sin `force` y sin editar DOM ni CSS) contra el HEAD sin modificar,
a 390×844:

1. `operador.a@example.invalid` / contraseña cualquiera → `Restaurante 1, Sucursal 1` → `Servicio activo`.
2. En el arnés, `Respuesta lenta`.
3. `Cambiar turno` → `Servicio activo`.
4. `Ir a segundo plano` → `Volver a primer plano`.

Resultado en el HEAD `5bb9723`, medido cada 1 500 ms:

```
+1500ms: screen=shifts shiftsLoading=true
+3000ms: screen=shifts shiftsLoading=true
+4500ms: screen=shifts shiftsLoading=true
+6000ms: screen=shifts shiftsLoading=true
+7500ms: screen=shifts shiftsLoading=true
```

Texto final de la aplicación: `Sucursal 1 | Elige el turno operativo | … |
Cambiar sucursal | Consultando turnos abiertos…`. Es decir, más de 7,5 s colgada,
sin ninguna salida: la sucursal ya no puede operarse hasta reiniciar la app.

**Causa.** La lectura de turnos seguía protegida por una bandera de cancelación
con alcance de efecto. El efecto despacha su propio `shiftsLoading`; ese despacho
cambia `state.shifts.status`, que está en su lista de dependencias; React vuelve a
ejecutar el efecto y la limpieza cancela la petición que el propio efecto acaba
de emitir. Como el efecto ya no está en `idle`, no vuelve a pedir nada. `3969aeb`
había quitado esa bandera de plano y catálogo, pero no de turnos, y la sustituyó
por un guardia que sólo compara Restaurant/Branch.

**Causa relacionada.** `forActiveScope` comparaba únicamente Restaurant/Branch, y
ese par es el mismo antes y después de una renovación de token, un cambio de
turno o una revalidación. Por eso:

- una respuesta vieja de plano o catálogo podía repoblar lo que
  `revalidationStarted` acababa de vaciar;
- un `401`/`403` de una petición emitida con el token anterior despachaba
  `accessRevoked` aunque el mismo operador ya hubiera renovado su token
  correctamente.

### Corrección — identidad explícita de intento, no otra bandera

Se extiende el patrón que ya existe en `src/order-delivery.ts` (serial + contexto,
un solo asentamiento por intento), esta vez para las tres lecturas de sucursal.

1. **`src/branch-read.ts` (nuevo)** — `createBranchReadTracker()` asigna un serial
   monótono por lectura, lo anuncia antes de la petición, contiene un `read()` que
   lanza de forma síncrona y garantiza exactamente un resultado por intento. No
   decide qué está obsoleto y no conoce ningún endpoint.
2. **`MobileResource.attempt`** — el reductor guarda ese serial en el recurso
   mientras está `loading`, y lo deja `undefined` en cualquier otro estado. Sólo
   el intento vigente puede aplicar `*Loaded`, `*Failed` o la revocación que
   provoca un `401`: `forCurrentRead` exige par activo **y** intento.
3. **La revocación pasó al reductor.** Las pantallas ya no despachan
   `accessRevoked` desde el `catch`; despachan `*Failed` con `authorization` y el
   reductor revoca sólo si ese intento es el vigente.
4. **`withoutReadsInFlight`** — al cambiar el token del mismo operador y al elegir
   turno, toda lectura que siga `loading` vuelve a `idle`, nunca se queda colgada.
   Los eventos que ya vaciaban los tres recursos (`revalidationStarted`,
   `branchRequested`, `branchReleased`, `shiftReleased`, `accessRevoked`,
   `revalidationFailed` de autorización, cambio de operador y cierre de sesión)
   siguen invalidando por la misma vía: `idle` no lleva intento.
5. **`shiftsReadTarget` / `layoutReadTarget` / `menuReadTarget`** — las condiciones
   de arranque de cada lectura viven en el estado, en un solo sitio, en vez de
   repetirse en listas de dependencias. Los efectos preguntan; no deciden. Es lo
   que permite que la prueba determinista ejerza exactamente la misma regla que la
   pantalla.

Invalidación garantizada: sesión/operador, token, Restaurant/Branch, turno y
comienzo de revalidación. **No** invalida el render que provoca el propio
`*Loading`: ese despacho es justamente el que fija el intento.

### Pruebas nuevas — promesas controladas, sin temporizadores

`src/branch-read.test.ts` (11) monta el bucle de lecturas de `src/ui/app.tsx` sin
React: el mismo reductor, el mismo tracker y las mismas funciones `*ReadTarget`,
con cada petición asentada a mano. Reproduce la propiedad que rompía la bandera:
anunciar `loading` vuelve a ejecutar la pasada de lecturas de inmediato.

| Prueba | Demuestra |
| --- | --- |
| `a read is not cancelled by the loading it announced itself` | un toque real que inicia una lectura no cancela su propia respuesta; una sola petición por lectura |
| `the shift list is never left loading by a foreground revalidation` | `shifts` no queda `loading` tras segundo plano/revalidación |
| `an answer started before the revalidation cannot repopulate what it emptied` | una respuesta de plano anterior al primer plano no repuebla, y después se hace una lectura nueva |
| `a late 401 from the previous token does not revoke the renewed session` | el `401` del token anterior no revoca la sesión renovada, y la lectura vigente sí responde |
| `a 401 from the read the screen is waiting for does revoke the branch` | la revocación sigue ocurriendo cuando corresponde |
| `a late answer for the same branch but another shift is ignored` | mismo Restaurant/Branch, otro intento/turno: se ignora |
| `changing branch, changing operator and signing out all fail closed` | los tres siguen fallando cerrado |
| `a failed read is reported once and can be retried` | un fallo no arranca lecturas solo, y el reintento sí |
| `a reader that throws before returning a promise is an ordinary failure` | contención del lanzamiento síncrono |
| `every attempt is distinct and settles exactly once` | seriales distintos, un solo asentamiento |
| `no rejection was left unhandled` | ningún rechazo sin manejar en todo el archivo (`process.on("unhandledRejection")`) |

`src/mobile-state.test.ts` suma 5 pruebas de reductor (`only the attempt the
resource is waiting for may settle it`, `an authorization failure for the current
read revokes the branch`, `a renewed token gives up the reads in flight and keeps
what already answered`, `choosing a shift gives up an operational read started
under the previous one`, `what may be read is decided by the state alone`) y sus
casos existentes pasan a anunciar el `loading` de cada respuesta, porque el
reductor ya no acepta una respuesta que nadie estaba esperando.

Total: **170 pruebas** en `apps/mobile` (154 antes, +16).

### Matriz visual R4 — Chrome real, clics de confianza, `Respuesta lenta`

Sin `force`, sin coordenadas contra elementos tapados y sin editar DOM ni CSS. La
barra del arnés se contrae con su propio control y sólo se expande para pulsar un
control.

| Comprobación | 390×844 | 1024×768 |
| --- | --- | --- |
| `login → sucursal → turno → mesas → producto` con respuestas lentas | ✅ | ✅ |
| Reproducción R4.1 tras `Cambiar turno` + segundo plano/primer plano | ✅ la lista de turnos responde; ya no queda `Consultando turnos abiertos…` | ✅ |
| Volver a entrar al turno y a las mesas después de esa revalidación | ✅ | ✅ |
| `Renovar token` con una lectura lenta en vuelo | ✅ no revoca, no queda `Cargando mesas…`, muestra `Terraza` | ✅ |
| Cambio a la sucursal 2 con respuestas lentas | ✅ `Salón principal`, sin rastro de `Terraza` | ✅ |
| `scrollWidth` vs `innerWidth` | 390 = 390 | 1024 = 1024 |
| Consola | ✅ sin `error`, `warning`, `pageerror` ni rechazos no manejados | ✅ |

Nota de método: el único ruido de consola es el banner de desarrollo de
react-native-web (`Running application "main"…`, `Development-level warnings: ON.`)
y el aviso `[DOM] Password field is not contained in a form`, ambos a nivel `log`
y `verbose`; se filtra por **nivel** de consola, no por la palabra «warning».
Runtime: Expo web sobre Metro local con Node 24.19.0 y
`MOBILE_VISUAL_HARNESS=1`; fixtures sintéticas, sin servidor ni credenciales
reales. Playwright se instaló únicamente en el scratchpad de la sesión y lanza el
Chrome ya instalado: no se añadió nada al repositorio ni a `pnpm-lock.yaml`.

### Compuertas ejecutadas con Node 24.19.0

| Compuerta | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile run lint` | limpio |
| `pnpm --filter @super-restaurant/mobile run typecheck` | limpio |
| `pnpm --filter @super-restaurant/mobile run test` | 170/170 |
| `pnpm exec expo install --check` | `Dependencies are up to date` |
| `pnpm --filter @super-restaurant/mobile run build` (export Android) | 662 módulos, `index-e14ad2c0a0cc0c2abab73d3871046a5c.hbc` de 2,2 MB |
| `pnpm lint --force` | 8/8 tareas, sin caché |
| `pnpm typecheck --force` | 11/11 tareas, sin caché |
| `pnpm test --force` | 11/11 tareas, sin caché |
| `pnpm build --force` | 8/8 tareas, sin caché |
| `git diff --check` | sin hallazgos |
| Fin de línea | LF conservado en los siete archivos (0 bytes CR, igual que en `HEAD`) |
| CodeGraph final | `MobileResource` se consume en las cinco pantallas y sólo por `status`/`value`/`failure`; `branch-read.ts` sólo lo usan `ui/app.tsx` y su prueba; sin referencias rotas ni huérfanos |

### Archivos tocados en R4

| Archivo | Cambio |
| --- | --- |
| `src/branch-read.ts` | nuevo: identidad de intento y asentamiento único de las lecturas de sucursal |
| `src/branch-read.test.ts` | nuevo: 11 pruebas deterministas con promesas controladas |
| `src/mobile-state.ts` | `MobileResource.attempt`; `forCurrentRead`; revocación en el reductor; `withoutReadsInFlight`; `shiftsReadTarget`/`layoutReadTarget`/`menuReadTarget` |
| `src/ui/app.tsx` | las tres lecturas usan el tracker y las funciones de objetivo; sin banderas de cancelación y sin `accessRevoked` desde el `catch` |
| `src/mobile-state.test.ts` | anuncia el `loading` de cada respuesta; 5 pruebas nuevas |
| `tsconfig.test.build.json`, `package.json` | registran el módulo y la prueba nueva |

### Límites que siguen abiertos

Sin cambios respecto de A.R3. Además: la lista de membresías **no** entra en este
alcance —sigue protegida por su propio serial en `src/ui/app.tsx`— y su caso
límite (una respuesta en vuelo cuando cambia el operador) queda anotado, no
corregido, porque no es una lectura branch-scoped.

---

## A.R3 Tercera revisión del coordinador (2026-09-06) — interacción táctil estrecha

Partiendo de `59b26ca15628e3c9ed847efe6dae549e74592eaf` (árbol
`a7ac9de413944607bb9002bc75825ad073b1fc2b`), sobre la misma rama
`claude/mobile-order-entry-ui-20260905` y el mismo worktree, con árbol limpio
verificado antes de editar. Sin merge, rebase, cherry-pick, push ni `main`
incorporado; `pnpm-lock.yaml` no cambió y el diff sigue confinado a
`apps/mobile/**`. Sin mutaciones reales de Order: cero llamadas a
`/api/v1/orders*` en las dos matrices. La P2 permanece **IN_PROGRESS**.

### Hallazgo R3.1 — el borrador no era operable a 390×844

`OrderDraftScreen` usaba la misma `column` (`flexBasis: 0`/`flexGrow: 1`) en las
dos disposiciones. A 390×844, con la barra del arnés contraída, el encabezado de
la mesa y el aviso de importes ya consumían casi toda la columna, así que las dos
`column` verticales se repartían un resto de pocos píxeles: el `ScrollView` del
catálogo terminaba con `clientHeight = 0`, sus productos se pintaban fuera de él
y `DraftPane` —que va después en el DOM— recibía el hit-testing. Un clic
semántico sobre el producto no abría el compositor.

La corrección separa **quién scrollea** en cada disposición, sin tocar la de dos
columnas:

| Disposición | Ancho | Scroller | Caja de cada panel |
| --- | --- | --- | --- |
| `columns` | ≥ 768 px | cada panel, dentro de su columna | `flexBasis: 0`/`flexGrow: 1`, igual que antes |
| `stacked` | < 768 px | **la pantalla**, una sola vez | altura natural, sin reparto de flex |

La decisión vive en un módulo puro nuevo, `src/ui/order-draft-layout.ts`
(`orderDraftLayout`, `screenOwnsScroller`, `paneOwnsScroller`,
`orderDraftPaneBox`), y la pantalla la consume: en `stacked` el encabezado, el
aviso y los dos paneles van dentro de un único `ScrollView`, y `PaneList` degrada
el scroller interno de cada panel a una caja normal —anidarlo dentro de un padre
de altura automática lo volvería a colapsar a cero—. `tabletBreakpoint` ya no se
lee desde la pantalla.

### Hallazgo R3.2 — bloqueo previo que impedía demostrar la aceptación R3

Al recorrer el flujo con taps reales apareció un **segundo bloqueo, ya presente
en el corte base sin modificar**: tras tocar el turno, la pantalla de mesas se
quedaba en «Cargando mesas de la sucursal…» para siempre, así que `mesa →
producto` no era alcanzable y la aceptación R3 no podía demostrarse.

Causa: en `app.tsx`, los efectos que leen el plano y el catálogo despachan su
propio estado `loading` y guardan el resultado con una bandera `active` de
instancia de efecto. Cuando la lectura la inicia un **tap real**, React vacía esa
actualización de forma síncrona dentro del mismo evento discreto, el efecto se
vuelve a ejecutar por su propia dependencia de estado y su limpieza pone
`active = false` **antes** de que resuelva la petición que él mismo acaba de
lanzar. La respuesta se descarta y el recurso queda `loading` de forma
permanente, sin reintento posible.

Reproducción en `59b26ca1` sin ningún cambio aplicado (Chrome real, dev server
del arnés, mismo guion):

| Gesto sobre el turno | Resultado |
| --- | --- |
| clic real (Playwright, evento confiable) | `STUCK LOADING` |
| `element.click()` programático (evento no confiable) | `TABLES LOADED` |

Corrección: los dos efectos dejan de usar la bandera de instancia y confían en el
filtro que ya existía y que sí describe lo que hace obsoleta una respuesta —
`forActiveScope` en el reducer, que descarta cualquier resultado cuyo
Restaurant/Branch ya no sea el activo—. No se tocó ningún otro efecto, contrato
ni estado.

**Esto excede lo que §0.R3 autoriza literalmente** («corregir únicamente el
bloqueo de layout»). Se hizo porque la aceptación obligatoria de R3 exige
recorrer `login → sucursal → turno → mesa → producto` con taps normales, y ese
recorrido es imposible sin ello. Va en un commit propio y separado
(`fix(mobile): keep a branch read alive through its own loading dispatch`) para
que el coordinador pueda aceptarlo, dividirlo o revertirlo sin tocar el arreglo
de layout. Es también un defecto real de producto: cualquier operador que
seleccione su turno con un toque real dejaba la vista de mesas colgada.

### Regresión añadida

`src/order-draft-layout.test.ts`, con el sistema de pruebas vigente
(`node:test` compilado por `tsconfig.test.build.json`), fija la causa sin inventar
otro arnés: qué disposición recibe cada ancho (390, 767, 768, 1024), que existe
exactamente un scroller por disposición y que nunca se anida, y que la caja
`stacked` no declara `flexGrow` ni `flexBasis` mientras la de `columns` sí. Una
cuarta prueba comprueba que la pantalla no reintroduzca una comparación de ancho
propia fuera del módulo. Total: **154 pruebas** (150 antes, +4).

### Matriz visual R3 — Chrome real, taps normales

Sin `force`, sin coordenadas contra elementos tapados y sin editar DOM ni CSS
desde el navegador. La barra del arnés se contrae con su propio control antes de
recorrer, como indica su README, y sólo se expande para leer los intentos
ofrecidos.

| Comprobación | 390×844 | 1024×768 |
| --- | --- | --- |
| `login → sucursal → turno → mesa → producto → modificador requerido → agregar línea` | recorrido completo | recorrido completo |
| Área alcanzable del producto | **134 px** (≥ 48) | **98 px** (≥ 48) |
| `elementFromPoint` dentro de esa área | pertenece al botón en las 5 sondas | pertenece al botón en las sondas dentro del área |
| `scrollWidth` vs `innerWidth` | 390 = 390 | 1024 = 1024 |
| Consola | sin errores ni advertencias | sin errores ni advertencias |
| Llamadas a `/api/v1/orders*` | 0 | 0 |
| Dos columnas | n/a (apiladas a propósito) | catálogo `x 24–500`, borrador `x 524–1000`, lado a lado |
| Confirmaciones distintas | n/a | «¿Descartar el borrador?» ≠ «¿Volver a mesas y descartar el borrador?» |
| Doble envío en vuelo (`aceptado (lento)`) | n/a | `crear` + **1** `ítem` por línea + `abrir`, una sola vez; el segundo toque lo rechaza el botón |

### Compuertas ejecutadas con Node 24.19.0

| Compuerta | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile run lint` | limpio |
| `pnpm --filter @super-restaurant/mobile run typecheck` | limpio |
| `pnpm --filter @super-restaurant/mobile run test` | 154/154 |
| `pnpm exec expo install --check` | `Dependencies are up to date` |
| `pnpm --filter @super-restaurant/mobile run build` (export Android) | 661 módulos, `index-…​.hbc` de 2 233 530 bytes |
| `pnpm lint --force` / `typecheck --force` / `test --force` / `build --force` | 8 / 11 / 11 / 8 tareas, todas verdes, sin caché |
| `git diff --check` | sin hallazgos |
| Aislamiento del bundle | sin `ARNÉS DE VERIFICACIÓN`, `harnessControl`, `FIXTURE_`, `Ocultar controles`, `example.invalid` ni `XTS`; con `Agregar al borrador`, `Enviar comanda` y `Volver a mesas` |
| CodeGraph final | los cinco símbolos nuevos se consumen sólo dentro de `apps/mobile`; `OrderDraftScreen` sigue con `app.tsx` como único consumidor; sin referencias rotas ni huérfanos |

### Archivos tocados en R3

| Archivo | Cambio |
| --- | --- |
| `src/ui/order-draft-layout.ts` | nuevo módulo puro con la decisión de disposición y las dos cajas de panel |
| `src/ui/order-draft-screen.tsx` | consume la decisión; `stacked` usa un solo scroller de pantalla y `PaneList` degrada los internos; se retira el estilo `columns` vertical y se añaden `stack` y `paneStacked` |
| `src/ui/app.tsx` | R3.2: las lecturas de plano y catálogo sobreviven a su propio despacho de `loading` |
| `src/order-draft-layout.test.ts` | regresión nueva del layout |
| `tsconfig.test.build.json`, `package.json` | registran el módulo y la prueba nueva |

### Límites que siguen abiertos

Sin cambios respecto de A.R2: no hay conexión productiva de Order, no hay lectura
de las líneas de una orden activa y no se copió ni redefinió ningún contrato.
SR-MOB-008, SR-MOB-009 y SR-MOB-011 siguen abiertas; SR-MOB-007 sigue parcial en
`main` y SR-MOB-010 resuelta para creación v2. La integración contra
`CreateOrderCommandV2`, `shiftId` y la lectura activa sigue a cargo del
coordinador después del merge.

---

## A.R2 Segunda revisión del coordinador (2026-09-06)

Partiendo de `16a5e65460e0796470997bccd8103243316ad84b`, sobre la misma rama y el
mismo worktree. Sin merge, rebase, cherry-pick, push ni `main` incorporado. El
diff sigue confinado a `apps/mobile/**` y `pnpm-lock.yaml` no cambió. Los cinco
hallazgos R1 siguen cubiertos por sus pruebas y no se regresionaron.

| # | Hallazgo | Corrección |
| --- | --- | --- |
| 1 | `orderableGroups` recortaba a `DRAFT_MAX_GROUPS` **antes** de que `draftLineIssues` validara, así que un grupo activo obligatorio en la posición 51 quedaba invisible para la comprobación y la línea se entregaba sin cumplirlo | Se separan las dos responsabilidades: **`activeProductGroups`** devuelve *todos* los grupos activos con *todas* sus opciones activas y **nunca** recorta —es contra lo que se valida—, y **`orderableGroups`** queda como la lista acotada que la pantalla presenta. `draftLineIssues` usa la primera. El compositor de la pantalla ahora corre la **misma** comprobación fail-closed, así que lo que la UI permite y lo que el handoff acepta no pueden divergir, y avisa cuántos grupos no cabe mostrar |
| 1b | Un catálogo puede exigir más grupos obligatorios de los que un comando admite | `draftLineIssues` lo reporta como no ordenable en vez de truncar. Los límites de `AddOrderItemCommandV1` no se relajaron: ningún comando lleva más de `DRAFT_MAX_GROUPS` grupos seleccionados. Queda registrado como **SR-MOB-012** |
| 2 | `draftLineIssues` comprobaba que el producto siguiera activo, pero no su categoría | **`isOrderableProduct`** exige producto activo **y** categoría presente y activa. Un producto cuya categoría se retiró deja de ser alcanzable por un borrador compuesto antes del cambio, igual que ya no es alcanzable navegando |
| 3 | A 390×844 el `ScrollView` de la barra del arnés consumía toda la columna y dejaba la aplicación con `clientHeight=0`; la matriz visual sólo podía ejecutarse editando DOM/CSS desde el navegador | La barra tiene un control **contraer/expandir** y está acotada incluso desplegada (`maxHeight: 240`). Es un `<button>` nativo enfocable, con nombre accesible «Controles del arnés», `accessibilityHint` que dice hacia dónde va, `accessibilityState.expanded` **y** `aria-expanded` explícito —react-native-web 0.21 no traduce el primero—, y objetivo táctil de **48 px** frente a los 44 px del resto de controles del arnés |

Los dos primeros hacen que `buildOrderDraftHandoff` devuelva `undefined`, que
`createOrderDeliveryTracker` traduce a `stale`, con **cero llamadas a `deliver`**
y sin entrega parcial de ninguna otra línea.

### Evidencia de los dos casos fail-closed

| Caso | Evidencia |
| --- | --- |
| **51 grupos activos**, los 50 primeros opcionales y el 51 con `minimumQuantity: 1` | `activeProductGroups` devuelve 51; `orderableGroups` devuelve 50 y **no** contiene el grupo 51; con el grupo 51 sin elegir, `draftLineIssues` reporta el incumplimiento, `buildOrderDraftHandoff` devuelve `undefined`, el tracker reporta **`stale`** y `integration.calls() === 0`. Al satisfacer el grupo 51 la **misma** línea se vuelve entregable y el comando lleva 1 grupo: la regla es "el requisito se exige", no "muchos grupos se rechazan" |
| **51 grupos, todos obligatorios** | `draftLineIssues` devuelve un único issue («exige 51 grupos obligatorios y una comanda admite 50»); `buildOrderDraftHandoff` devuelve `undefined` incluso seleccionando 50 de ellos |
| **Categoría inactiva** | `isOrderableProduct` = `false`; `draftLineIssues` = `["La categoría de este producto ya no está publicada."]`; handoff `undefined`; tracker **`stale`**; `deliver` **0 veces** |
| **Categoría inexistente** | `parseMenuCatalogStateV1` **rechaza** un cuerpo cuyo producto apunta a una categoría ausente —se afirma con `assert.throws`—, así que no puede llegar por la red; la rama defensiva se cubre con un catálogo ya parseado al que se le quita la categoría, y también falla cerrada |
| **No hay entrega parcial** | Una línea de una categoría vigente es entregable por sí sola, pero compartir el handoff con una línea de categoría retirada lo invalida entero |

### Matriz visual R2 — sin editar DOM ni CSS

Recorrido completo con eventos reales de puntero, en **390×844** y **1024×768**.
El panel del navegador de esta sesión sigue oculto y no dibuja, así que se mide
sobre el DOM real, como en las rondas anteriores.

| Caso | Viewport | Resultado |
| --- | --- | --- |
| Control contraíble: nombre, rol, estado y foco | 390×844 | ✅ `<button>`, `aria-label="Controles del arnés"`, `role=button`, `tabindex=0`, `aria-expanded` alterna `true`/`false`, texto «Ocultar controles ▲» / «Mostrar controles ▼» |
| Objetivo táctil del control | 390×844 y 1024×768 | ✅ 48 px en ambos |
| Altura utilizable de la aplicación | 390×844 | ✅ **740 px contraído** frente a 500 px desplegado; antes era **0** |
| Altura utilizable de la aplicación | 1024×768 | ✅ **712 px contraído** frente a 472 px desplegado |
| Contraer y volver a expandir | 390×844 | ✅ Alterna en ambos sentidos, con puntero y con activación de teclado |
| Login sintético → sucursal → turno → mesa | 390×844 y 1024×768 | ✅ Recorrido completo con la barra contraída, sin tocar DOM ni CSS |
| Composición con modificadores | 390×844 y 1024×768 | ✅ `1 × Arrachera…` con `• 1 × Bien cocido` |
| Salida con confirmación | 390×844 y 1024×768 | ✅ «¿Volver a mesas y descartar el borrador?» · «…Volverás al plano de mesas y la mesa quedará sin borrador.» · botones de 48 px · `Conservar borrador` deja la línea intacta |
| Descarte permaneciendo en la mesa | 390×844 | ✅ «Sí, descartar y seguir aquí» → sigue en Mesa 1 con «Borrador vacío» |
| Envío aceptado sin reenvío | 390×844 | ✅ Las líneas salen del borrador; un segundo toque no añade ni un intento a la barra |
| Doble toque en «Enviar comanda» | 390×844 | ✅ Un solo `crear table/XTS` + un `ítem draft-line-2` + un `abrir` |
| Promesa colgada + cambio de turno | 390×844 | ✅ Queda «Enviando la comanda…»; tras cambiar de turno el borrador desaparece y **la comanda del turno nuevo se entrega sin bloqueo** |
| Lanzamiento síncrono | 390×844 | ✅ «El servicio no está disponible en este momento.», la línea se conserva y `unhandledrejection` = **0** |
| Desbordamiento horizontal | 390×844 y 1024×768 | ✅ `scrollWidth == innerWidth` en cada paso |
| Dos columnas | 1024×768 | ✅ Catálogo 476 px en x=24, Borrador 476 px en x=524 |
| Consola | ambos | ✅ Sin errores ni warnings del app |
| Red | ambos | ✅ **0** llamadas a `/api/v1/orders*`, 0 recursos externos |

Nota de método, para que el auditor pueda repetirlo: la activación por teclado
se comprobó enviando un `click` sin eventos de puntero (`detail: 0`), que es
exactamente lo que un `<button>` nativo enfocado emite al pulsar Enter o Espacio.
Un `KeyboardEvent` sintético **no** dispara la activación por defecto del
navegador —eso sólo ocurre con eventos de confianza—, así que ese camino no
sirve como evidencia. El elemento es un `<button>` real con `tabindex=0`.

### Commits de esta ronda

| Hash | Mensaje |
| --- | --- |
| `531d1d6…` | `fix(mobile): validate a draft line against the whole published catalog` |
| `7e05e32…` | `fix(mobile): make the harness control bar collapsible so the matrix is reproducible` |
| (este documento) | `docs(mobile): record the second coordinator review` — su hash es el hash final y se reporta fuera del documento |

Los hashes completos y el hash final se reportan en la entrega; se leen con
`git rev-parse HEAD` sobre `claude/mobile-order-entry-ui-20260905`.

### Archivos y compuertas de esta ronda

Once archivos, todos bajo `apps/mobile/`. **Ninguno fuera**, y `pnpm-lock.yaml`
sin tocar.

**Modificados**: `src/order-draft.ts`, `src/order-draft.test.ts`,
`src/order-intents.test.ts`, `src/order-delivery.test.ts`,
`src/bundle-isolation.test.ts`, `src/test-fixtures.ts`,
`src/ui/order-draft-screen.tsx`, `harness/harness-root.tsx`,
`harness/README.md`, y este documento junto con `BACKEND_REQUESTS.md`.

Node **v24.19.0**, pnpm 11.19.0.

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile lint` | ✅ 0 errores, 0 warnings |
| `pnpm --filter @super-restaurant/mobile typecheck` | ✅ sin errores |
| `pnpm --filter @super-restaurant/mobile test` | ✅ **150 pruebas, 0 fallos** (eran 141) |
| `pnpm --filter @super-restaurant/mobile exec expo install --check` | ✅ `Dependencies are up to date` |
| `pnpm --filter @super-restaurant/mobile build` | ✅ `.hbc` de 2,232,339 bytes |
| `pnpm lint --force` | ✅ 8/8, **0 en caché**, 13.9 s |
| `pnpm typecheck --force` | ✅ 11/11, **0 en caché**, 14.0 s |
| `pnpm test --force` | ✅ 11/11, **0 en caché**, 43.4 s |
| `pnpm build --force` | ✅ 8/8, **0 en caché**, 28.7 s |
| `git diff --check` | ✅ sin errores de espacios; finales de línea LF sin cambios |

Las 9 pruebas nuevas: 3 en `order-draft` (presentación acotada frente a
validación completa; grupo y opción inactivos excluidos de **ambas**; producto
ordenable sólo con su categoría activa), 3 en `order-intents` (grupo obligatorio
más allá del tope y su contraparte satisfecha; catálogo con más obligatorios de
los representables; categoría retirada, inexistente y sin entrega parcial), 2 en
`order-delivery` (los dos casos anteriores traducidos a `stale` con `deliver`
cero veces) y 1 en `bundle-isolation` (contrato del control contraíble).

**Aislamiento del bundle** sobre el `.hbc` reexportado: contiene `Enviar
comanda`, `Agregar al borrador`, `Descartar borrador` y `draft-line-`; **no**
contiene `Ocultar controles`, `Mostrar controles`, `Controles del arn`,
`Intentos ofrecidos`, `harness`, `HARNESS_NETWORK_DOWN`,
`HARNESS_SESSION_UNREADABLE`, `HARNESS_SYNCHRONOUS_THROW`,
`sb_publishable_fixture`, `operador.a.sintetico`, `Limpiar intentos`,
`Grupo sint`, `example.invalid` ni `XTS`.

**CodeGraph final** (índice re-sincronizado: 8 archivos, 188 nodos): el flujo
queda `buildOrderDraftHandoff → draftLineIssues → isOrderableProduct`, y el
blast radius de `activeProductGroups`, `orderableGroups`, `isOrderableProduct`,
`draftLineIssues`, `buildOrderDraftHandoff` y `createOrderDeliveryTracker`
devuelve consumidores **sólo** dentro de `apps/mobile/**`. `draftLineIssues`
pasó de «sin pruebas que lo cubran» a estar cubierto por `order-draft.test.ts` y
`order-intents.test.ts`.

**La P2 no está terminada ni integrada**: sigue sin conectar mutaciones de Order
y sin la lectura de líneas de la orden activa.

---

## A.R1 Retrabajo de la revisión del coordinador (2026-09-06)

El coordinador revisó el corte `3061487a8b5568c32afc7730099182ffb09da774` y pidió
corregir cinco puntos antes de integrar (sección 0.R1 del mandato). Esta ronda
los corrige **sobre la misma rama y el mismo worktree**, partiendo exactamente de
ese hash: no hubo merge, rebase, `main` incorporado, push ni conexión de
endpoints Order. El diff sigue confinado a `apps/mobile/**` y `pnpm-lock.yaml`
no cambió.

| # | Hallazgo | Corrección | Dónde |
| --- | --- | --- | --- |
| 1 | `onBackToTables` despachaba `tableReleased` y vaciaba el borrador sin confirmar, mientras la ayuda accesible afirmaba lo contrario | El booleano `discardRequested` pasa a ser `pendingConfirmation: "discardDraft" \| "leaveTable"`, que **nombra el destino**. Con líneas o composición abierta la salida pasa por una confirmación dentro de la pantalla que dice exactamente qué se perderá y a dónde se va; con borrador realmente vacío se sale directo. Los dos textos, los dos cuerpos y las dos etiquetas de confirmación son distintos, así que un "sí" solo puede ejecutar lo que se preguntó | `order-draft.ts`, `order-draft-screen.tsx`, `app.tsx` |
| 2 | Tras `submissionSucceeded` las líneas aceptadas seguían siendo reenviables | `submissionSucceeded` **retira las líneas entregadas** y conserva mesa, zona y el aviso de éxito. Un segundo toque no tiene nada que ofrecer, editar o eliminar una línea aceptada es imposible porque ya no está, y `nextLineSerial` sigue corriendo para que ningún handle nuevo repita uno entregado | `order-draft.ts`, `order-draft-screen.tsx` |
| 3 | Un booleano global `submitting` bloqueaba para siempre una sucursal/turno/operador posterior, y una resolución tardía modificaba el borrador nuevo | Módulo nuevo `order-delivery.ts`: cada intento lleva **serial e identidad de contexto**. Solo un intento del *mismo* contexto bloquea; solo se aplica el desenlace del intento vigente; un cambio de contexto lo abandona. Contiene promesa colgada, rechazo tardío, valor que no es promesa y **lanzamiento síncrono** —sin `sending` atascado ni rechazo no manejado | `order-delivery.ts`, `app.tsx` |
| 4 | El handoff solo comprobaba `knownProductIds` | `buildOrderDraftHandoff` recibe el **catálogo** y revalida cada línea con `draftLineIssues`: producto activo, cantidad entera acotada, grupos y opciones activos y pertenecientes al producto, sin duplicados de grupo ni de opción, máximos por opción y por grupo, y mínimos requeridos. Un cambio de catálogo entre composición y envío produce `stale` y **cero callbacks**; una sola línea inválida invalida todo el handoff | `order-draft.ts`, `order-intents.ts` |
| 5 | `App` invocaba los callbacks de mutación y además llamaba a `submit` sobre el mismo objeto | `OrderDraftCallbacks` y `offerOrderDraft` desaparecen. `OrderDraftIntegration` expone **solo `deliver`**, una única llamada de entrega; el arnés inspecciona el handoff **dentro** de esa llamada. Una integración productiva futura ya no puede ejecutar crear/agregar/abrir dos veces | `order-intents.ts`, `app.tsx`, `harness-server.ts` |

Los cinco están acoplados por tipos (`OrderDraftEvent`, `OrderDraftState`,
`OrderDraftIntegration`), así que se entregan en un solo commit de código:
separarlos más habría producido commits que no compilan. Queda anotado como
desviación deliberada de "commits pequeños".

**Sigue sin haber**: HTTP, endpoints Order, auditoría, UUID acuñados por el
cliente, zona horaria, importes, impuestos, CFDI ni proveedor.

### Estado de las solicitudes tras la revisión

- **SR-MOB-007 — parcialmente resuelta en `main`**: ya existe una lectura
  acotada de órdenes activas con `orderId`, versión, estado, `shiftId` e
  `itemCount`, pero **no devuelve líneas ni modificadores**, así que el
  compositor todavía no puede reanudar una comanda.
- **SR-MOB-010 — resuelta para creación v2** mediante `shiftId` en el comando.
- **SR-MOB-008, SR-MOB-009 y SR-MOB-011 siguen abiertas.**

En los dos casos resueltos, esta rama **no copia ni redefine** los contratos
nuevos: parte de `3061487a…` y no incorpora `main`. La integración productiva
contra esos contratos la hará el coordinador **después del merge**.

### Commits de esta ronda

| Hash | Mensaje |
| --- | --- |
| `f8f1f84a88881f1ee70e45fa5a72984a21aefd2d` | `fix(mobile): rework the comanda hand-over after the coordinator review` |
| `27e787c9fb559ca697030b1660eedbe4a9edb216` | `docs(mobile): record the coordinator rework and its evidence` |
| (este documento) | `docs(mobile): correct the recorded hash of the rework commit` — su hash es el **hash final** y se reporta fuera del documento, porque un commit no puede contener el suyo |

Para auditar, el hash final se toma de `git rev-parse HEAD` sobre la rama
`claude/mobile-order-entry-ui-20260905`; debe ser descendiente directo de
`27e787c9…` y la punta del árbol limpio.

### Archivos de esta ronda

Trece archivos, todos bajo `apps/mobile/` (1,100 inserciones, 177 eliminaciones
frente a `3061487a…`).

**Nuevos**: `src/order-delivery.ts`, `src/order-delivery.test.ts`.

**Modificados**: `src/order-draft.ts`, `src/order-draft.test.ts`,
`src/order-intents.ts`, `src/order-intents.test.ts`, `src/test-fixtures.ts`,
`src/ui/app.tsx`, `src/ui/order-draft-screen.tsx`, `harness/harness-server.ts`,
`harness/README.md`, `package.json`, `tsconfig.test.build.json`, y este
documento junto con `BACKEND_REQUESTS.md`.

### Pruebas adversariales añadidas

De **118 a 141 pruebas, 0 fallos** (+23):

| Archivo | Antes | Ahora | Qué se añadió |
| --- | --- | --- | --- |
| `order-draft` | 24 | **32** | Salida a mesas confirmada; cancelar la salida; doble toque sobre "Volver a mesas"; los dos destinos resueltos por separado y nunca confundidos; composición sin confirmar como contenido; borrador vacío que sale directo; confirmación que se cierra al quedarse sin líneas; líneas aceptadas retiradas; segunda comanda local solo con líneas nuevas; handles no reutilizados tras éxito ni tras descarte |
| `order-intents` | 9 | **13** | Grupo retirado, opción retirada, mínimo nuevo y máximo rebajado entre composición y envío; línea que el reducer no podría producir (mínimo incumplido, grupo duplicado, opción duplicada, opción de otro grupo, máximo de grupo excedido, cantidad 0/negativa/fraccionaria/fuera de rango/`NaN`/infinita, cantidad de opción 0 y fraccionaria); una línea inválida invalida todo el handoff; handles duplicados; frontera única sin superficie de callbacks |
| `order-delivery` | — | **11 (nuevo)** | Un inicio y un solo desenlace; segundo toque rechazado de raíz; promesa colgada que no bloquea sucursal/turno/operador posterior; desenlace tardío de un contexto abandonado; intento superado que pierde frente al vigente; rechazo sin `unhandledRejection`; **lanzamiento síncrono** sin envío atascado y con reintento posible; valor que no es promesa; `stale` que libera el contexto y no llega a la integración; `build` que lanza; ausencia de red en el módulo |

### Compuertas de esta ronda

Node **v24.19.0**, pnpm 11.19.0, sin instalar nada en el sistema ni tocar
configuración del repositorio.

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile lint` | ✅ 0 errores, 0 warnings |
| `pnpm --filter @super-restaurant/mobile typecheck` | ✅ sin errores |
| `pnpm --filter @super-restaurant/mobile test` | ✅ **141 pruebas, 0 fallos** |
| `pnpm --filter @super-restaurant/mobile exec expo install --check` | ✅ `Dependencies are up to date`, exit 0 |
| `pnpm --filter @super-restaurant/mobile build` | ✅ `tsc --noEmit` + `expo export --platform android` → 660 módulos, `.hbc` de 2,230,489 bytes |
| `pnpm lint --force` | ✅ 8/8 tareas, **0 en caché**, 14.6 s |
| `pnpm typecheck --force` | ✅ 11/11 tareas, **0 en caché**, 14.3 s |
| `pnpm test --force` | ✅ 11/11 tareas, **0 en caché**, 52.2 s |
| `pnpm build --force` | ✅ 8/8 tareas, **0 en caché**, 29.1 s |

`git diff --check` no reporta errores de espacios. Los finales de línea no
cambiaron: base y árbol siguen en LF en los trece archivos.

**Aislamiento del arnés** sobre el `.hbc` reexportado (2,230,489 bytes):
contiene `Enviar comanda`, `Agregar al borrador`, `Descartar borrador` y
`draft-line-`; **no** contiene `Intentos ofrecidos`, `harness`,
`HARNESS_NETWORK_DOWN`, `HARNESS_SESSION_UNREADABLE`,
`HARNESS_SYNCHRONOUS_THROW`, `sb_publishable_fixture`, `operador.a.sintetico`,
`Limpiar intentos` ni `XTS`. Los dos controles nuevos del arnés («promesa
colgada» y «falla síncrona») tampoco filtran al bundle.

**CodeGraph final**: `impact` sobre `createOrderDeliveryTracker`,
`reduceOrderDraft`, `buildOrderDraftHandoff`, `draftLineIssues` y
`OrderDraftIntegration` devuelve consumidores **solo** dentro de
`apps/mobile/**` (`order-delivery.ts`, `order-intents.ts`, `ui/app.tsx`,
`harness/harness-server.ts` y sus pruebas). Ninguna referencia sale de la
frontera y no quedan símbolos huérfanos.

### Matriz visual de esta ronda

Mismo método que A.8 —Expo web con el arnés, panel del navegador oculto, se
conduce con eventos reales de puntero y se mide sobre el DOM real—, en
**390×844** y **1024×768**.

| Caso | Viewport | Resultado |
| --- | --- | --- |
| Borrador vacío → "Volver a mesas" | 390×844 | ✅ Sale directo al plano, sin preguntar |
| Composición sin confirmar → "Volver a mesas" | 390×844 | ✅ «¿Volver a mesas y descartar el borrador?» · «Se perderá **el producto que estás configurando**…» |
| 1 línea → "Descartar borrador" | 390×844 | ✅ «¿Descartar el borrador?» · «…**Seguirás en esta mesa**, con el borrador vacío.» · «Sí, descartar y seguir aquí» |
| 1 línea → "Volver a mesas" | 390×844 y 1024×768 | ✅ «¿Volver a mesas y descartar el borrador?» · «…**Volverás al plano de mesas** y la mesa quedará sin borrador.» · «Sí, descartar y volver a mesas» |
| Cancelar la salida | 390×844 y 1024×768 | ✅ «Conservar borrador» deja la mesa y la línea intactas |
| Doble toque en "Volver a mesas" | 390×844 | ✅ Una sola confirmación abierta; sigue en la mesa con su línea |
| Confirmar cada destino | 390×844 | ✅ «seguir aquí» conserva la mesa con borrador vacío; «volver a mesas» regresa al plano, y al reentrar la mesa no tiene borrador |
| Éxito y no reenvío | 390×844 | ✅ Las 2 líneas salen del borrador; «…sus líneas salieron del borrador, así que no pueden reenviarse»; estado «Sin líneas pendientes» |
| Segundo toque tras el éxito | 390×844 | ✅ La barra del arnés no registra ni un intento más |
| Segunda comanda local | 390×844 | ✅ Solo `ítem draft-line-4`; no reaparecen `draft-line-2` ni `draft-line-3` |
| Doble toque en "Enviar comanda" | 390×844 | ✅ Un solo `crear` + un `ítem` por línea + un `abrir` — **frontera única confirmada** |
| Envío: falla síncrona | 390×844 | ✅ «El servicio no está disponible…», la línea se conserva, `unhandledrejection` = 0 y el reintento en sitio funciona |
| Envío: promesa colgada + cambio de turno | 390×844 | ✅ Queda «Enviando la comanda…»; al cambiar de turno el borrador desaparece y **la comanda del turno nuevo se entrega sin bloqueo** |
| Objetivos táctiles de la confirmación | 390×844 y 1024×768 | ✅ «Sí, descartar…» y «Conservar borrador» a 48 px en ambos |
| Rol y región viva de la confirmación | 390×844 | ✅ `role="alert"`, `aria-live="polite"` |
| Contraste de la confirmación | 390×844 | ✅ 15.57 (título y cuerpo), 8.68 (ambas acciones) — AA |
| Desbordamiento horizontal | 390×844 y 1024×768 | ✅ `scrollWidth == innerWidth` en cada paso |
| Dos columnas con la confirmación abierta | 1024×768 | ✅ Columna de catálogo 476 px; la confirmación ocupa 976 px dentro de 1024, sin desbordar |
| Consola | ambos | ✅ Sin warnings ni errores del app (solo los avisos de modo desarrollo de React) |
| Red | ambos | ✅ 0 llamadas a `/api/v1/orders*`, 0 recursos externos |

Sigue vigente la limitación de A.8 sobre reduced motion y `aria-busy`: no se
añadió ninguna animación nueva en esta ronda.

---

## A.1 Punto de partida

- **Hash base**: `f1f8f27b4732810ee26c1bbab122016a7ede0dc1`
  (`docs(mobile): make Claude base handoff stable`), descendiente del ancestro
  mínimo exigido `c6f87961b2afddaef0c84fec50e8fa5ae4abbbc2` y portador del
  mandato de la sección 0.
- **Rama**: `claude/mobile-order-entry-ui-20260905`.
- **Worktree**: `.claude/worktrees/mobile-order-entry-ui-a7b3c5`, creado para
  esta sesión. **No se reutilizó** el worktree de la fundación
  (`.claude/worktrees/super-restaurant-mobile-foundation-2acb73`), que sigue
  intacto en su propia rama. El worktree lo creó el arnés de sesión con un
  sufijo aleatorio; la rama se renombró al nombre sugerido por el mandato.
- Árbol limpio al iniciar y al terminar. No se incorporó ningún commit posterior
  de `main`, ni hubo merge, rebase, push o cambio en otra rama.
- Archivos operativos leídos una sola vez: `AGENTS.md`, `TODO.md`, la sección
  Fase 2 del plan maestro y `docs/CLAUDE_FRONTEND_WORKSTREAM.md` completo.
  `PROJECT_NOTES.md` y `HANDOFF.md` son bitácoras acumulativas de 107 KB y
  269 KB; se leyeron dirigidamente —las secciones vigentes, las decisiones
  durables de mesas/layout y la coordinación del 2026-09-05— en lugar de
  completas, para no agotar la ventana de contexto de esta unidad. Queda
  registrado como desviación deliberada.

### Commits de esta unidad

| Hash | Mensaje |
| --- | --- |
| `b13ee69b1dc76c713608d6119a5c65dfd47f4843` | `feat(mobile): add an ephemeral order draft state and its integration seam` |
| `caadba3974841ef72367d7287b0df5ff6e599cde` | `feat(mobile): select a table and compose its comanda draft` |
| `d875cac706f7b9491ddfe10998b1e56202938328` | `test(mobile): cover table selection, draft composition and the hand-over` |
| `898a5d5aab015e4db6242e6e3e0ef40c9f1bb12b` | `test(mobile): drive the comanda hand-over from the isolated harness` |
| `3061487a8b5568c32afc7730099182ffb09da774` | `docs(mobile): record the order entry slice and its backend frontier` |

Los commits de la ronda de revisión están en **A.R1**.

## A.2 MCP instalados y usados

Emmanuel autorizó instalar y usar los MCP necesarios para esta unidad.

| Paso | Resultado |
| --- | --- |
| `codegraph install --target claude --location global --yes` | ✅ Escribió solo configuración de usuario: `~/.claude.json`, `~/.claude/settings.json` y `~/.claude/CLAUDE.md`. **Nada dentro del repositorio**; `git status` quedó limpio inmediatamente después. Se añadió `--yes` porque el instalador es interactivo y esta sesión no tiene stdin; el destino y la ubicación son los que pidió el mandato |
| `claude plugin install expo@claude-plugins-official` | ✅ `Successfully installed plugin: expo@claude-plugins-official (scope: user)`. **No pidió iniciar sesión en ninguna cuenta Expo**, así que no hubo que detenerse en ese paso |
| `/mcp` | ⚠️ No disponible: los diálogos interactivos de terminal no existen en el cliente de escritorio. En su lugar se comprobó la disponibilidad real por su efecto: el hook de CodeGraph empezó a inyectar contexto estructural en esta sesión, la herramienta MCP `codegraph_explore` quedó expuesta y la CLI `codegraph` respondió a `status`, `init`, `sync` e `impact`. Se reporta como limitación del entorno, no como omisión |

No se usó Supabase MCP, EAS, publicación, firma, credenciales ni ninguna
operación remota.

### CodeGraph — antes y después

El índice global vivía en el checkout principal e incluía los worktrees, así que
el propio CodeGraph avisó de la discrepancia. Se construyó un índice **local a
este worktree** (`codegraph init -i .`, 274 archivos, 4,736 nodos, 18,953
relaciones); `.codegraph/` está en `.gitignore` y no aparece en el diff.

- **Antes de editar**: `impact` sobre `TablesScreen`, `MenuScreen`,
  `reduceMobileState` y `MobileState` confirmó que ninguno tiene consumidores
  fuera de `apps/mobile/**`. `impact` sobre `CreateOrderCommandV1`,
  `AddOrderItemCommandV1`, `OpenOrderCommandV1`, `OrderMutationSummaryV1` y
  `ModifierGroupSelectionV1` los situó exclusivamente en
  `packages/shared-types/src/orders.ts`, `apps/api/src/orders.ts`,
  `apps/api/src/orders.controller.ts` y el verificador de tenancy: no existe
  ningún consumidor móvil ni ninguna lectura de orden por mesa.
- **Después de editar**: `codegraph sync` procesó 13 archivos (5 nuevos, 8
  modificados) y el índice quedó en 279 archivos, 4,862 nodos y 19,507
  relaciones. `impact` sobre `reduceOrderDraft`, `OrderDraftScreen`,
  `buildOrderDraftHandoff`, `disconnectedOrderDraftIntegration`,
  `renderMinorAmount` y `TablesScreen` devuelve consumidores **solo** dentro de
  `apps/mobile/**`, sin referencias rotas ni símbolos huérfanos.

## A.3 Alcance implementado

- **Selección táctil de mesa**: cada mesa es un control de 48 px con etiqueta
  accesible `zona, mesa, capacidad`, foco visible y estado seleccionado. Muestra
  solo lo que trae `DiningLayoutV1` —zona, nombre, capacidad y forma— y declara
  en texto que **no** muestra ocupación, cuenta ni orden activa.
- **Compositor visual del borrador** por mesa: categorías y productos del
  catálogo publicado, cantidad entera, grupos y opciones de modificadores que el
  contrato sigue publicando como activos, líneas editables y eliminables, salida
  segura a mesas y descarte con confirmación **dentro de la pantalla**.
- **Estados operativos explícitos**: `idle` (sin mesa), vacío, cargando, listo,
  enviando, éxito, conflicto, autorización, red, protocolo, más dos propios de
  esta frontera: catálogo obsoleto (`stale`) e integración sin conectar
  (`notConnected`).
- **Callbacks tipados** para `crear orden`, `agregar ítem` y `abrir/enviar
  comanda`, más una integración que reporta el resultado. La que trae el
  producto acepta el borrador, **no hace ninguna petición** y lo dice.
- **Limpieza de contexto**: el borrador pertenece a un operador, una sucursal y
  un turno; al cambiar cualquiera de ellos —o al cerrar sesión, o si el servidor
  revoca el acceso— se descarta en la misma transición.

### Alcance omitido deliberadamente

- Mutaciones productivas de Order: ningún gesto llama a `POST /api/v1/orders`,
  `/orders/items` ni `/orders/open`. La lista de rutas autorizadas del cliente
  sigue siendo la misma y una prueba la fija.
- Lectura de la orden activa de una mesa, ocupación, disponibilidad y cuenta
  (SR-MOB-007): no existen en el servidor y no se simularon.
- Subtotales, impuestos, descuentos, propinas y totales (SR-MOB-011): la
  pantalla muestra únicamente precios unitarios del contrato.
- CFDI, fiscalidad, pagos, caja, impresión, notificaciones push y offline.
- Cualquier cambio fuera de `apps/mobile/**`.

## A.4 Archivos

Todos dentro de `apps/mobile/**`. **`pnpm-lock.yaml` no cambió**: no se añadió,
quitó ni actualizó ninguna dependencia.

**Nuevos**: `src/order-draft.ts`, `src/order-draft.test.ts`,
`src/order-intents.ts`, `src/order-intents.test.ts`,
`src/ui/order-draft-screen.tsx`.

**Modificados**: `src/ui/tables-screen.tsx`, `src/ui/app.tsx`,
`src/ui/menu-screen.tsx`, `src/money.ts`, `src/money.test.ts`,
`src/test-fixtures.ts`, `harness/harness-server.ts`, `harness/harness-root.tsx`,
`harness/README.md`, `package.json`, `tsconfig.test.build.json`, y este
documento junto con `BACKEND_REQUESTS.md`.

## A.5 Cómo se respetaron las fronteras de dominio

| Regla del mandato | Cómo se cumple, y cómo se comprueba |
| --- | --- |
| No calcular dinero en mobile | `src/order-draft.ts` no referencia ningún importe ni moneda. Una prueba lee el módulo del disco, le quita los comentarios y falla si aparece `unitPriceMinor`, `amountMinor`, `PriceMinor`, `currency`, `MXN` o `formatMinorAmount` |
| Moneda del contrato, nunca `MXN` por defecto | `renderMinorAmount` exige entero seguro e ISO de tres letras mayúsculas; si no, muestra "Precio no disponible". `buildOrderDraftHandoff` devuelve `undefined` ante una moneda malformada en lugar de sustituirla. Probado con `""`, `"mxn"`, `"MX"`, `"MXNN"`, `" MXN"` y `"XT1"` |
| No inventar estado autoritativo | La mesa no declara ocupación; el borrador se declara local; la integración por defecto responde "no conectado" en vez de fingir éxito |
| No repetir UUID documentados | Los 12 identificadores nuevos de fixture se generaron con `crypto.randomUUID()` en esta sesión y se comprobó por `grep` que ninguno existía en el repositorio |
| No duplicar reglas de dominio | Los únicos límites que la UI aplica son los que el propio contrato publica (`minimumQuantity`/`maximumQuantity` por grupo y por opción) y el rango entero que acepta `parseAddOrderItemCommandV1`. Existen para no ofrecer lo que el contrato ya rechaza; el servidor revalida |
| Tipos locales solo de presentación | `OrderDraftState` guarda mesa, líneas, composición en curso y estado de envío. Los identificadores de línea son `draft-line-N`, **no** UUID, y una prueba lo fija |
| Ningún `alert`/`confirm`/`prompt` | El descarte se confirma con un bloque dentro de la pantalla, con `accessibilityRole="alert"` |

## A.6 Pruebas

Cifras del corte `3061487a…`; la ronda de revisión las lleva a **141** y añade
`order-delivery` (ver **A.R1**).

`pnpm --filter @super-restaurant/mobile test` ejecutaba **118 pruebas, 0 fallos**
(antes de esta unidad eran 84):

| Archivo | Pruebas |
| --- | --- |
| config | 5 |
| session | 7 |
| supabase-auth | 2 |
| lifecycle | 4 |
| revalidation | 6 |
| sign-out | 5 |
| auth-gate | 8 |
| bundle-isolation | 2 |
| money | 5 (+1) |
| mobile-client | 17 |
| mobile-state | 24 |
| **order-draft** | **24 (nuevo)** |
| **order-intents** | **9 (nuevo)** |

Lo que cubren las 33 nuevas: selección, reselección y cambio de mesa; borrador
vacío; producto con modificadores y cantidad; edición de línea en su sitio;
eliminación; descarte confirmado y cancelado; cambio de contexto; doble toque
sobre la mesa, sobre el compositor, sobre los steppers y sobre la acción
primaria; congelación del borrador durante el envío; cada estado de fallo con su
mensaje; filtrado de categorías, productos, grupos y opciones inactivos; los
límites publicados por el catálogo; la forma exacta de los tres intents y la
ausencia de todo campo de auditoría; la moneda sin valor por defecto; el orden
crear → ítems → abrir; y la lista de rutas Nest sin ninguna ruta de Order.

Dos son invariantes en lugar de comportamiento: la ausencia de dinero en el
módulo de borrador, y que ninguna fuente de comanda contenga `fetch(`, `/api/`,
`XMLHttpRequest`, `WebSocket` ni `MOBILE_API_PATHS`, con el cliente HTTP
alcanzable solo por un `import type`.

Además, las fixtures nuevas se parsean con `parseDiningLayoutV1` y
`parseMenuCatalogStateV1` dentro de una prueba, así que un cuerpo que el
servidor rechazaría falla en `pnpm test` y no solo en el navegador. Esa prueba
ya atrapó dos defectos reales de fixture durante esta sesión.

## A.7 Comandos ejecutados

Entorno: Windows 10, pnpm 11.19.0 y **Node v24.19.0**, la versión que declara
`engines.node`. El binario oficial ya estaba descargado y verificado por SHA-256
en una sesión anterior de este proyecto; se copió al scratchpad de esta sesión y
se usó desde ahí. **No se descargó nada nuevo** y no se instaló nada en el
sistema ni se tocó configuración del repositorio.

Del app:

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile lint` | ✅ 0 errores, 0 warnings |
| `pnpm --filter @super-restaurant/mobile typecheck` | ✅ sin errores |
| `pnpm --filter @super-restaurant/mobile test` | ✅ **118 pruebas, 0 fallos** |
| `pnpm --filter @super-restaurant/mobile exec expo install --check` | ✅ `Dependencies are up to date`, exit 0 |
| `pnpm --filter @super-restaurant/mobile build` | ✅ `tsc --noEmit` + `expo export --platform android` → 659 módulos, bundle Hermes de 2.2 MB en `dist/` (ignorado por Git) |

Globales, sin caché (`--force`), con Node 24.19.0:

| Comando | Resultado |
| --- | --- |
| `pnpm lint --force` | ✅ 8/8 tareas, 0 en caché, 19.0 s |
| `pnpm typecheck --force` | ✅ 11/11 tareas, 0 en caché, 24.5 s |
| `pnpm test --force` | ✅ 11/11 tareas, 0 en caché, 66.0 s |
| `pnpm build --force` | ✅ 8/8 tareas, 0 en caché, 86.1 s |

`git diff --check` no reporta errores de espacios en la rama ni en el árbol.

Nota operativa: Turbo necesita `pnpm` en `PATH` y ejecuta las tareas con el
entorno filtrado, así que el shim temporal del scratchpad tuvo que apuntar al
binario por ruta absoluta en vez de por variable de entorno. No se modificó
ninguna configuración del repositorio.

### Aislamiento del arnés en el bundle distribuible

Sobre el `.hbc` exportado (2,226,932 bytes): contiene `Enviar comanda`,
`Agregar al borrador`, `Descartar borrador` y `draft-line-`, y **no** contiene
`Intentos ofrecidos`, `harness`, `HARNESS_NETWORK_DOWN`,
`HARNESS_SESSION_UNREADABLE`, `sb_publishable_fixture`, `operador.a.sintetico`,
`Limpiar intentos` ni la moneda de prueba `XTS`. Solo se buscan cadenas ASCII
porque Hermes guarda en UTF-16 cualquier literal con acentos o `·`.

## A.8 Matriz de validación visual

Runtime: **Expo web (react-native-web)** con Metro local sobre Node 24.19.0,
conducido con un navegador real y el arnés (`MOBILE_VISUAL_HARNESS=1`). Todas
las respuestas son fixtures sintéticas locales; no se usó credencial, usuario ni
dato remoto, y el cliente, los parsers compartidos y la máquina de estados son
los reales.

| Caso | Viewport | Resultado |
| --- | --- | --- |
| Plano de mesas con dos zonas y tres mesas, seleccionables | 390×844 | ✅ Sin ocupación ni cuenta; el aviso lo dice explícitamente |
| Nombre de mesa largo (36 de 40 caracteres) | 390×844 y 1024×768 | ✅ Envuelve sin desbordar |
| Entrar al compositor desde una mesa | 390×844 | ✅ Encabezado con zona, mesa, capacidad y "Borrador local, sin orden creada" |
| Borrador vacío | 390×844 | ✅ Estado explícito con instrucción |
| Producto con grupo obligatorio sin cumplir | 390×844 | ✅ "«Término» requiere al menos 1." y acción deshabilitada (`aria-disabled=true`, opacidad 0.6) |
| Filtrado del catálogo | 390×844 | ✅ La opción inactiva, el producto inactivo, el grupo inactivo y la categoría inactiva no aparecen |
| Doble toque en `+` de cantidad | 390×844 | ✅ 1 → 3, no 1 → 2 |
| Tope por opción (`Queso extra`, máximo 2) | 390×844 | ✅ Tres toques rápidos quedan en 2 |
| Dos líneas con modificadores | 390×844 | ✅ Solo precios unitarios; ningún total en pantalla |
| Aislamiento entre sucursales | 1024×768 | ✅ Sucursal 1 `12,500 u.m. · XTS`, sucursal 2 `9,900 u.m. · XTS` |
| Editar una línea | 390×844 | ✅ Reabre con cantidad y modificadores; el botón pasa a "Guardar línea" |
| Descarte con confirmación | 390×844 | ✅ "¿Descartar el borrador?" · "Conservar borrador" mantiene la línea · "Sí, descartar" la elimina y **conserva la mesa** |
| Doble toque en "Enviar comanda" | 390×844 | ✅ La barra del arnés registra un solo `crear` + un `ítem` + un `abrir` |
| Intents ofrecidos | 390×844 | ✅ `crear table/XTS [channel,currency,scope,tableId]`, `ítem draft-line-1 ×1 [draftLineId,modifierGroups,productId,quantity,scope]`, `abrir [scope,tableId]` — sin ningún campo de auditoría |
| Envío: sin conexión de integración | 390×844 | ✅ "El envío de comandas todavía no está conectado con el servidor…" |
| Envío: enviando y éxito | 390×844 | ✅ "Enviando la comanda…" con la acción deshabilitada, luego "La comanda se entregó al servidor." |
| Envío: conflicto | 390×844 | ✅ "La comanda cambió en el servidor mientras la editabas…" |
| Envío: autorización / red / protocolo | 390×844 | ✅ Los tres mensajes compartidos del cliente |
| Cambiar turno con borrador abierto | 390×844 | ✅ Vuelve a turnos; al reentrar, el plano no tiene mesa seleccionada ni borrador |
| Cambiar sucursal con borrador abierto | 390×844 | ✅ Igual, y la sucursal 2 muestra su propio plano y precios |
| Dos columnas catálogo/borrador | 1024×768 | ✅ `row`, 476 px + 476 px con origen en 24 y 524 |
| Mesas en dos columnas | 1024×768 | ✅ 477 px + 477 px |
| Desbordamiento horizontal | 390×844 y 1024×768 | ✅ `scrollWidth == innerWidth` en cada paso del recorrido |
| Objetivos táctiles | 390×844 y 1024×768 | ✅ Todos los controles del app ≥ 48 px, incluidos los `−`/`+` (48×48). Los controles de 44 px que aparecen en la medición son de la barra del arnés, no del producto |
| Contraste medido sobre los elementos nuevos | 390×844 | ✅ 16.31 (nombre de grupo y opción), 8.68 (`+`, acciones), 7.03 (precio unitario, límites del grupo, mensajes de validación) — todos ≥ AA |
| Foco visible por teclado en un stepper | 390×844 | ✅ 1 px → 3 px `#0b3a7d` → 1 px, `tabIndex=0`, rol y etiqueta correctos |
| Etiquetas accesibles del stepper | 390×844 | ✅ `Disminuir Cantidad` · `Cantidad: 1` · `Aumentar Cantidad`, sin duplicar el nombre en la fila contenedora |
| Consola | ambos | ✅ Sin warnings ni errores del app durante todo el recorrido |
| Red | ambos | ✅ `performance.getEntriesByType('resource')` = 1 entrada, el bundle local; cero destinos externos y cero llamadas a `/api/v1/orders*` |

Notas de método:

- El panel del navegador de esta sesión queda oculto y no dibuja, así que —como
  en las rondas anteriores— la interfaz se condujo con eventos reales de
  puntero, clic e `input` y se midió sobre el DOM real (`innerText`,
  `getBoundingClientRect`, `getComputedStyle`, `scrollWidth` frente a
  `innerWidth`). No hay capturas de pantalla de esta unidad.
- **Reduced motion** no se pudo emular desde este panel. El único elemento
  animado del compositor es el `ActivityIndicator` de `LoadingBlock`, el mismo
  componente que ya respeta `AccessibilityInfo.isReduceMotionEnabled` y que
  quedó verificado en la unidad anterior; no se añadió ninguna animación nueva.
- La emulación de viewport del panel no dispara la actualización de
  `Dimensions` en la instancia de react-native-web ya montada, así que la vista
  tablet se verificó recargando la página con el viewport ya en 1024×768. Es un
  artefacto de la herramienta, no del app.
- `aria-busy` no aparece en el botón primario durante el envío: react-native-web
  mapea `accessibilityState.disabled` pero no `busy` en este `Pressable`. El
  estado sí se anuncia por texto en una región `accessibilityLiveRegion`
  ("Enviando la comanda…", rol `progressbar`). Queda anotado como limitación
  menor.

## A.9 Confirmación de fronteras

Comparado con `f1f8f27b4732810ee26c1bbab122016a7ede0dc1`, el diff del corte
`3061487a…` tocaba **exclusivamente 15 archivos bajo `apps/mobile/`** (2,364
inserciones, 44 eliminaciones), más este documento y `BACKEND_REQUESTS.md`. La
ronda de revisión añade dos archivos y mantiene la frontera: ver **A.R1**.
`pnpm-lock.yaml`
**no cambió**. No se modificó ni creó nada en `apps/api`, `apps/web`,
`apps/kds`, `packages/`, `supabase/`, migraciones, SQL, RLS, permisos,
credenciales, `.env`, configuración raíz —incluidos `package.json` raíz,
`pnpm-workspace.yaml` y `turbo.json`—, CI ni documentación operativa
(`AGENTS.md`, `TODO.md`, `PROJECT_NOTES.md`, `HANDOFF.md`).

Sobre esa última fila hay una contradicción que conviene dejar escrita:
`AGENTS.md` §3 y §21 piden actualizar `TODO.md`, `PROJECT_NOTES.md` y
`HANDOFF.md` al cerrar, mientras el mandato de la sección 0 y la instrucción
humana de esta sesión declaran los documentos operativos de solo lectura para
este workstream. Prevalece la instrucción humana explícita; el registro
equivalente queda aquí y el coordinador decidirá si lo traslada.

No se ejecutó ninguna operación contra Supabase, PostgreSQL, Data API o Vault,
ni ninguna E2E remota; no se crearon usuarios ni fixtures remotas; no se usó
EAS, publicación ni firma; y no se reutilizó ningún UUID documentado en el
historial del repositorio.

## A.10 Limitaciones, riesgos y solicitudes pendientes

1. **La comanda no se envía a ningún lado** y no puede hacerlo todavía. Tras la
   revisión 0.R1, SR-MOB-007 quedó **parcialmente resuelta en `main`** (lectura
   acotada de órdenes activas, sin líneas ni modificadores) y SR-MOB-010
   **resuelta para creación v2** vía `shiftId`; siguen abiertas SR-MOB-008 (zona
   horaria autoritativa), SR-MOB-009 (`deviceId` estable y quién acuña
   `eventId`/`idempotencyKey`) y SR-MOB-011 (importes calculados por el
   servidor). Esta rama no incorpora esos contratos: la integración es del
   coordinador, después del merge.
2. **Dos operadores pueden componer borradores para la misma mesa sin verse.**
   Es consecuencia directa de SR-MOB-007 y del alcance local de esta unidad.
3. **El borrador vive en memoria**: cerrar la app lo pierde, como la sesión
   (SR-MOB-001). No se implementó persistencia ni se afirmó ninguna.
4. **Sin verificación en Android/iOS reales**: no hay emulador ni SDK nativo en
   este entorno. El bundle Android se genera pero no se ejecutó en dispositivo.
5. **Reduced motion y `aria-busy`**: ver las notas de método de la sección A.8.
6. Siguen abiertas las solicitudes anteriores SR-MOB-001, SR-MOB-002,
   SR-MOB-004 y SR-MOB-005. SR-MOB-003 (turno) quedó resuelta por el
   coordinador y esta unidad la consume; SR-MOB-006 (expo 57.0.20) sigue
   cerrada.

## A.11 Siguiente acción mínima para el coordinador

1. Revisar el diff completo y confirmar que no sale de `apps/mobile/` y que
   `pnpm-lock.yaml` no cambió.
2. Ejecutar el arnés (`harness/README.md`, sección "Recorrer la comanda") para
   reproducir la matriz visual.
3. Decidir SR-MOB-008, SR-MOB-009 y SR-MOB-011, y completar SR-MOB-007 con las
   líneas y modificadores que la lectura acotada de `main` todavía no devuelve.
   SR-MOB-009 sigue siendo la que impide construir un comando de auditoría
   válido desde el cliente.
4. Solo con aprobación humana, integrar la rama y actualizar `TODO.md`. Este
   workstream no cambió el estado de ninguna tarea.
5. Después del merge, conectar `OrderDraftIntegration.deliver` —la **única**
   frontera de entrega— contra los contratos reales de `main` (creación v2 con
   `shiftId` y la lectura de órdenes activas). El punto de conexión es uno solo
   y está aislado por `order-delivery.ts`, que ya contiene reintentos, cambios
   de contexto y fallos del transporte.

---

# B. Unidad 1 — fundación frontend móvil (registro histórico)

Lo que sigue documenta la fundación ya integrada en `main` y aprobada como DONE
el 2026-09-05. Se conserva como evidencia y **no describe el corte actual**.

## 1. Punto de partida

- **Hash base del workstream**: `16f30f1fd3aa0cce3f47d7a7bac2dd5d0f354de1`
  (`docs: define isolated Claude frontend workstream`), descendiente del
  ancestro mínimo exigido `941293b1d4658f7f683f1591841a5ab101eebfef`.
- **Base de la quinta ronda**: `cd860728faba1c49a0c4bb14c31e58922d7dd44e`.
- **Base de la cuarta ronda**: `2bcd438ff269623d2ca21bf6cb901b4683dd7aa1`.
- **Base de la tercera ronda**: `541c00dd627f979c7d5ecfde32cf6b06e8af5b94`.
- **Rama**: `claude/super-restaurant-mobile-foundation-2acb73`.
- **Worktree**: `.claude/worktrees/super-restaurant-mobile-foundation-2acb73`.
- Árbol limpio al iniciar y al terminar (sin artefactos ni temporales).
- Archivos operativos leídos una sola vez: `AGENTS.md`, `TODO.md`,
  `PROJECT_NOTES.md`, `HANDOFF.md`, sección Fase 2 del plan maestro y este
  mandato.
- **CodeGraph**: reconsultado al abrir y al cerrar la quinta ronda; sigue sin
  estar disponible (no existe `.codegraph/` en el worktree ni herramienta de
  consulta en el entorno). Sustituto de la quinta ronda, antes y después de
  editar: barrido de consumidores de `MobileState`, `MobileAuthPort`,
  `MobileSession`, `reduceMobileState`, `endMobileSession`,
  `readInitialSession`, `closedSessionKey` y `gateMobileAuth` sobre todo el
  repositorio. Resultado: **cero consumidores fuera de `apps/mobile/**`**;
  dentro del app, los únicos consumidores de la compuerta son `src/ui/app.tsx` y
  `src/auth-gate.test.ts`, y `MobileAuthPort` sigue implementado solo por
  `src/supabase-auth.ts` y el doble del arnés. Sustituto de rondas anteriores:
  inspección dirigida de solo lectura de
  `packages/shared-types/src/index.ts`, `apps/api/src/*.controller.ts`,
  `apps/web/src/lib/branch-selection.ts`, `apps/kds/src/*`, y revisión manual de
  los consumidores de cada símbolo tocado (`MobileSession`, `toMobileSession`,
  `isSameOperator`, `MobileAuthPort`, `reduceMobileState`, `revalidateAccess`,
  `readInitialSession`, `App`, `Root`, `parseAuthorizedMobileBranch`). Queda
  registrado como limitación.

### Commits de la rama

| Hash | Mensaje |
| --- | --- |
| `7ee56ff5227e3216d6adb04790cb390fc42d494b` | `chore(mobile): scaffold Expo and TypeScript configuration` |
| `b1bdfbbf7509a2f9cb6a78ef3dedf6037c0a593f` | `feat(mobile): add fail-closed configuration, session and read-only API client` |
| `7f6cc1d2431c30279e5eeec9095820673a39dda2` | `feat(mobile): add sign-in, branch, tables and menu read-only screens` |
| `6ac5ccec8cd320a2a6853dbdde7da5c862504d07` | `docs(mobile): record delivery and backend requests` |
| `d78576eb3d3370fd31cb4d8309bab4ad768926e3` | `fix(mobile): renew the in-memory session without persisting it` |
| `bb7499445a90b1cafa50189ab8091ccf0858c6d7` | `fix(mobile): make keyboard focus visible on pressable controls` |
| `65d92dbc9cc80db437f67c972dbb4d3848f5a509` | `fix(mobile): revalidate session and branch scope on foreground` |
| `2ce2cd6a9258d0804e42ab0432dda4e6f1256302` | `fix(mobile): harden the authorized branch response parser` |
| `03adfd2b5187d5285e6a522936df9d87805c235b` | `test(mobile): add an isolated visual verification harness` |
| `541c00dd627f979c7d5ecfde32cf6b06e8af5b94` | `docs(mobile): record review fixes and evidence` |
| `1e4f09df2d09a342be08f5e58fc0f3665ad176ac` | `fix(mobile): identify the operator by the immutable Supabase user id` |
| `96dea5d8ef53fda29b16af94d06d0875aa333bf6` | `fix(mobile): fail closed on session errors and hide unconfirmed identity` |
| `dcf8b3b541277a46f97c30cb0e62d3d94725e3e5` | `test(mobile): drive session errors and app restarts from the harness` |
| `bfad1918a02bfe0ea41f07ec43dd53a49397f211` | `chore(mobile): declare the license and wire the new test file` |
| `2bcd438ff269623d2ca21bf6cb901b4683dd7aa1` | `docs(mobile): record the third review round` |
| `4056fd276b750521c7e6926a27d3cef0933595b7` | `fix(mobile): close the local session without waiting for the provider` |
| `05668b191a0df93083c66fef2acb4baa0044212e` | `chore(mobile): update expo to 57.0.20` |
| `09c3e461d870d3ec0da97305f1b814fb94d1e0f1` | `test(mobile): drive hanging and failing sign-outs from the harness` |
| `cd860728faba1c49a0c4bb14c31e58922d7dd44e` | `docs(mobile): record the fourth review round` |
| `91b1b98decc0710f0eef71e24c236b46f3b90fc2` | `fix(mobile): gate late authentication events behind an explicit generation` |
| `04bf0d67de406a563c5220f002d13ef2904269ff` | `test(mobile): replay historical sessions from the harness` |
| (este documento) | `docs(mobile): record the fifth review round` — su hash se reporta al cierre, porque un commit no puede contener el suyo |

## 2. Hallazgos de la quinta ronda

### El problema

`closedSessionKey` guardaba `${userId}|${accessToken}` en `MobileState` después
del cierre. Eso tenía tres defectos:

1. **conservaba el bearer**: una representación reutilizable del token seguía en
   el estado del cliente después de `signedOut`;
2. **solo recordaba un cierre**: tras A entra → A sale → B entra → B sale, la
   clave guardada era la de B, así que una notificación tardía de A **sí** era
   aceptada y devolvía a A a la sesión;
3. **no cubría la lectura inicial**: `sessionRestored` no consultaba la clave,
   de modo que un `currentSession()` pedido antes del cierre y resuelto después
   restauraba la sesión cerrada.

### La solución: una generación de autenticación explícita

`src/auth-gate.ts` envuelve el `MobileAuthPort` y es lo único que decide qué
eventos del proveedor sigue creyendo el proceso. No recuerda nada de la sesión
cerrada —ni token, ni hash, ni identidad—: solo un contador de generación y si
la compuerta está abierta.

- `signOut()` **cierra la compuerta antes** de pedirle nada al proveedor, así
  que una llamada colgada, rechazada o que lanza de forma síncrona no puede
  mantenerla abierta; la promesa del proveedor se devuelve tal cual;
- `signIn()` es lo único que abre una generación nueva: reingresar es siempre un
  acto deliberado. Un intento que no termina en `ok` la vuelve a cerrar;
- `closeGeneration()` la cierra cuando el proveedor informa que terminó la
  sesión que este dispositivo tenía; `src/ui/app.tsx` lo llama solo si había
  sesión, de modo que un evento inicial "sin sesión" no cancela una
  restauración legítima;
- con la compuerta cerrada **no se entrega ninguna sesión**, sea de quien sea;
- cada suscripción y cada `currentSession()` quedan **atados a la generación**
  en que se crearon: una respuesta o una notificación de otra anterior se
  descarta en lugar de reinterpretarse como actual. Al cambiar de generación la
  compuerta se resuscribe, así que un proveedor que siga llamando a un manejador
  ya liberado habla por una generación que ya pasó.

`MobileState` perdió `closedSessionKey` y no ganó ningún campo: tras
`signedOut` es el estado inicial más el motivo y `started`. El reducer ya no
decide nada sobre credenciales; solo qué hace en pantalla una sesión aceptada
—token renovado del operador vigente conserva sucursal y datos, operador
distinto arranca limpio—.

### Pruebas nuevas (`src/auth-gate.test.ts`, 8)

El arnés de prueba reproduce el cableado real de `App` (compuerta,
suscripción, lectura inicial y cierre local) sin React, y usa un proveedor
deliberadamente hostil que conserva **todas** las sesiones que emitió y
**todos** los manejadores que recibió, incluidos los liberados.

1. el cierre mueve la generación antes de que el proveedor conteste, y a partir
   de ahí toda sesión es rechazada;
2. un `signOut()` que rechaza y uno que lanza de forma síncrona también dejan la
   compuerta cerrada;
3. **A entra → A sale → B entra → B sale → notificación tardía de A**, replicada
   en la suscripción viva y en todos los manejadores liberados: sigue cerrado,
   sin sesión ni sucursal;
4. **lectura inicial de A pendiente → cierre → resolución tardía de A**: sigue
   cerrado, con su motivo;
5. **reingreso intencional** limpio y **renovación válida del token del operador
   vigente**, que conserva sucursal y datos;
6. un acceso rechazado no deja la compuerta abierta, y el siguiente sí entra;
7. un proveedor que conserva un manejador liberado queda ignorado en cuanto la
   generación avanza;
8. todo el ciclo de llamadas fallidas —cierre colgado, rechazado, que lanza,
   acceso rechazado y lectura de sesión ilegible— **sin ningún
   `unhandledRejection`**.

En `src/sign-out.test.ts` la prueba del cierre ahora recorre el estado completo
y verifica que **ningún campo** contiene el bearer y que no apareció ningún
campo nuevo para guardarlo.

### Arnés

El doble de identidad ahora tiene **dos operadores sintéticos** —el correo cuyo
parte local empieza por `b` entra como `FIXTURE_USER_B`; cualquier otro como
`FIXTURE_USER_A`—, conserva **todas** las sesiones que emitió (al menos dos tras
un ciclo de cada operador) y conserva los manejadores liberados. Los controles
`Notificar sesión histórica 1`, `Notificar sesión histórica 2` y
`Notificar todas las históricas` las replican a todos ellos. La barra de estado
muestra el operador vigente y cuántas sesiones históricas hay. El procedimiento
de varios ciclos está escrito en `harness/README.md`.

## 3. Hallazgos de la cuarta ronda

### Cierre de sesión local inmediato

`endSession()` ya no espera a `auth.signOut()`. `src/sign-out.ts` despacha
`signedOut` **de forma síncrona** y solo después pide al proveedor que borre su
copia, como mejor esfuerzo: una promesa pendiente, un rechazo o incluso un
puerto que lanza de forma síncrona no pueden bloquear la interfaz.

Para que una notificación tardía no deshiciera el cierre, el reducer recordaba
la identidad de la sesión cerrada en `closedSessionKey`. **Ese mecanismo se
eliminó en la quinta ronda** —conservaba el bearer y solo recordaba un cierre—;
ver la sección 2.

### `expo` 57.0.20 — compuerta cerrada

La compuerta que quedó pendiente en la ronda anterior está resuelta. Las cuatro
versiones implicadas cumplieron sus 24 h de antigüedad
(`expo@57.0.20` 2026-09-04T07:46:21Z, `@expo/cli@57.0.22` 07:47:45Z,
`expo-modules-jsi@57.0.8` 07:47:34Z y `expo-modules-core@57.0.16` 07:49:59Z),
así que a partir de las 00:50 de Sonora `pnpm install` las aceptó **sin
exclusiones**: no se relajó `minimumReleaseAge` y `pnpm-workspace.yaml` no
cambió. `expo install --check` responde ahora `Dependencies are up to date`
(exit 0).

El cambio se limita a `apps/mobile/package.json` (`expo` 57.0.19 → 57.0.20) y al
`pnpm-lock.yaml` derivado: `@expo/cli` 57.0.21 → 57.0.22,
`expo-modules-core` 57.0.15 → 57.0.16 y `expo-modules-jsi` 57.0.7 → 57.0.8.
Ningún otro paquete cambió de versión.

Pruebas nuevas (`src/sign-out.test.ts`, 5):

1. `signOut()` que nunca resuelve: la interfaz vuelve al acceso de inmediato y
   sigue cerrada tras varios turnos del bucle de eventos;
2. `signOut()` que rechaza: la sesión queda cerrada, con su motivo, y no se
   produce ningún `unhandledRejection`;
3. un puerto que lanza de forma síncrona tampoco impide el cierre local;
4. una notificación tardía con la sesión cerrada no repuebla sucursal,
   membresías, mesas ni menú;
5. un inicio de sesión posterior funciona, arranca limpio y sigue rechazando el
   token cerrado.

## 4. Hallazgos de la tercera ronda

### 1 — Identidad del operador por `user.id`

`MobileSession` ahora incluye `userId`, el identificador inmutable de Supabase,
validado fail-closed: `toMobileSession` exige el UUID que emite Auth y devuelve
`undefined` si falta, no es UUID o llega con espacios. El correo queda
declarado como dato de presentación.

`sessionObserved` decide con `isSameOperator`, que compara **solo** `userId`:
un token renovado del mismo actor conserva sucursal, membresías y datos; otro
actor —aunque comparta el correo— reinicia el estado completo; un correo
distinto del mismo actor no reinicia nada.

### 2 — `currentSession()` que rechaza

`src/revalidation.ts` concentra la orquestación y es puro respecto de React:

- `readInitialSession` convierte un rechazo de arranque en "sin sesión", así que
  la app muestra el acceso en vez de quedarse en "Abriendo superRestaurant…";
- `revalidateAccess` devuelve siempre un resultado explícito —`sessionLost`,
  `confirmed` o `failed`— y nunca revalida la sucursal si no pudo leer la
  sesión;
- la petición de autorización usa el token recién leído, no uno viejo.

Además se eliminaron las promesas sin controlar: `signOut`, `startAutoRefresh`,
`stopAutoRefresh` y el envío del formulario de acceso ya no pueden producir un
rechazo no manejado ni dejar un botón en "Ingresando…".

### 3 — Nada de identidad mientras el acceso no está confirmado

Mientras `revalidating` está activo o una revalidación falló, el encabezado del
espacio de trabajo no muestra restaurante, sucursal ni correo: presenta
"Acceso sin confirmar · No se muestra información hasta revalidar tu acceso.".
El par Restaurant/Branch permanece en el estado —es lo que se revalida— pero no
se renderiza, y mesas y menú ya estaban descartados desde la ronda anterior.

### 4 — `license`

`apps/mobile/package.json` declara `"license": "UNLICENSED"`.

### 5 — `expo install --check`

Quedó como compuerta pendiente en esta ronda porque `expo@57.0.20` aún no
cumplía la antigüedad mínima que exige pnpm y subirlo habría requerido tocar
`pnpm-workspace.yaml`. Se resolvió en la cuarta ronda sin tocar configuración
raíz; ver la sección 3.

### 6 — Espacio final

Eliminado el espacio al final de la línea 48 de este documento; `git diff
--check` no reporta errores de espacios en toda la rama.

## 5. Alcance implementado

Primer slice móvil **online y de solo lectura**:

- fundación Expo/React Native/TypeScript local al app;
- validación fail-closed de la configuración pública, con pantalla explícita
  cuando es inválida y sin ninguna llamada de red en ese estado;
- acceso con Supabase Auth (email/contraseña), sesión en memoria con renovación
  automática en primer plano y cierre de sesión **local e inmediato**;
- identidad del operador por `user.id` inmutable;
- revalidación de sesión y alcance al volver al primer plano, con resultado
  siempre explícito;
- listado de membresías activas y estado explícito de "sin sucursales asignadas";
- selección y **revalidación exacta** del par Restaurant/Branch;
- pantalla de zonas y mesas de la sucursal autorizada;
- pantalla del menú publicado con moneda tomada del contrato;
- estados de carga, vacío, error, reintento y éxito en cada lectura;
- cambio de sucursal, revocación y revalidación sin fuga de datos ni de
  identidad.

### Alcance omitido deliberadamente

- toda mutación: órdenes, comanda, pagos, caja, mesas y catálogo;
- offline, outbox, sincronización, Realtime, push e impresión;
- turno operativo (`BACKEND_REQUESTS.md`, SR-MOB-003);
- persistencia de sesión en el dispositivo (SR-MOB-001);
- cualquier cambio en backend, dominio, contratos compartidos, SQL, Web o KDS.

## 6. Archivos

Todos dentro de `apps/mobile/**`.

**Nuevos en la quinta ronda**: `src/auth-gate.ts`, `src/auth-gate.test.ts`.

**Modificados en la quinta ronda**: `src/mobile-state.ts`,
`src/mobile-state.test.ts`, `src/sign-out.test.ts`, `src/ui/app.tsx`,
`harness/harness-server.ts`, `harness/harness-root.tsx`, `harness/README.md`,
`package.json`, `tsconfig.test.build.json` y `CLAUDE_DELIVERY.md`. **Nada fuera
de `apps/mobile/**`**: `pnpm-lock.yaml` no cambió y no se tocó ninguna
dependencia (`expo` sigue en 57.0.20).

**Nuevos en la cuarta ronda**: `src/sign-out.ts`, `src/sign-out.test.ts`.

**Modificados en la cuarta ronda**: `src/mobile-state.ts`,
`src/mobile-state.test.ts`, `src/ui/app.tsx`, `harness/harness-server.ts`,
`harness/harness-root.tsx`, `harness/README.md`, `package.json`,
`tsconfig.test.build.json`, `CLAUDE_DELIVERY.md`, `BACKEND_REQUESTS.md`, y
`pnpm-lock.yaml` —el único archivo fuera de `apps/mobile/**`— por la subida de
`expo`.

**Nuevos en la tercera ronda**: `src/revalidation.ts`, `src/revalidation.test.ts`.

**Modificados en la tercera ronda**: `src/session.ts`, `src/session.test.ts`,
`src/mobile-state.ts`, `src/mobile-state.test.ts`, `src/test-fixtures.ts`,
`src/ui/app.tsx`, `src/ui/sign-in-screen.tsx`, `harness/harness-server.ts`,
`harness/harness-root.tsx`, `harness/README.md`, `package.json`,
`tsconfig.test.build.json`, `CLAUDE_DELIVERY.md`, `BACKEND_REQUESTS.md`.

**De rondas anteriores**: `index.ts`, `app.json`, `babel.config.js`,
`metro.config.js`, `tsconfig.json`, `.env.example`, `src/config.ts`,
`src/money.ts`, `src/lifecycle.ts`, `src/auth-port.ts`, `src/supabase-auth.ts`,
`src/mobile-client.ts`, `src/ui/*` y sus pruebas.

No se versionaron capturas: la evidencia visual se resume en la sección 9.

## 7. Contratos y endpoints consumidos

Todos existentes y autorizados por el mandato §6. El cliente móvil nunca accede
a PostgreSQL ni a la Data API.

| Capacidad | Uso | Validación |
| --- | --- | --- |
| Supabase Auth (URL + clave **publishable**) | `signInWithPassword`, `getSession`, `onAuthStateChange`, `signOut({ scope: "local" })`, `startAutoRefresh`, `stopAutoRefresh` | `toMobileSession` exige access token acotado y `user.id` UUID; el correo es solo presentación |
| `GET /api/v1/access/memberships` | Lista de membresías activas | `parseBranchMembershipListV1` |
| `POST /api/v1/access/branch` | Revalidación del par elegido, en la selección y al volver al primer plano | Parser local endurecido + el par devuelto debe ser idéntico al solicitado (SR-MOB-002) |
| `GET /api/v1/dining/layout?restaurantId=…&branchId=…` | Zonas y mesas | `parseDiningLayoutV1` + `scope` devuelto igual al solicitado |
| `GET /api/v1/catalog/menu?restaurantId=…&branchId=…` | Catálogo publicado | `parseMenuCatalogStateV1` + `scope` devuelto igual al solicitado |

`MOBILE_API_PATHS` sigue siendo la única lista de rutas permitidas; `request()`
rechaza cualquier otra antes de tocar la red y una prueba fija la superficie
exportada del cliente para que no aparezcan mutaciones.

Dinero: entero en unidad menor con la moneda ISO del contrato
(`"12,500 u.m. · XTS"`). Sin moneda por defecto, sin coma flotante, sin
impuestos, fiscalidad, CFDI, turnos, caja ni proveedor inventados.

## 8. Comandos ejecutados y resultados

Entorno de la quinta ronda: Windows 10, pnpm 11.19.0 vía Corepack y **Node
v24.19.0**, la versión que declara `engines.node`. La máquina solo tiene Node
v22.20.0 instalado y no hay gestor de versiones, así que —con autorización
explícita en esta sesión— se volvió a descargar el binario oficial de
`https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip` a un directorio
temporal de la sesión y se verificó por SHA-256
(`57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`, coincide
con `SHASUMS256.txt`). No se instaló nada en el sistema ni se cambió
configuración del repositorio. No aparece el aviso `Unsupported engine`.

Del app (quinta ronda):

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile lint` | ✅ 0 errores, 0 warnings |
| `pnpm --filter @super-restaurant/mobile typecheck` | ✅ sin errores |
| `pnpm --filter @super-restaurant/mobile test` | ✅ **82 pruebas, 0 fallos** (config 5, session 7, supabase-auth 2, lifecycle 4, revalidation 6, cierre de sesión 5, **compuerta de autenticación 8**, aislamiento de bundle 2, money 4, cliente 16, estado 23) |
| `pnpm --filter @super-restaurant/mobile build` | ✅ `tsc --noEmit` + `expo export --platform android` → bundle Hermes de 2.2 MB en `dist/` (ignorado por Git) |
| `pnpm --filter @super-restaurant/mobile exec expo install --check` | ✅ `Dependencies are up to date`, exit 0 (con `expo@57.0.20`) |

Globales, **sin caché** (`--force`):

| Comando | Resultado |
| --- | --- |
| `pnpm lint --force` | ✅ 8/8 tareas, 0 en caché, 11.9 s |
| `pnpm typecheck --force` | ✅ 11/11 tareas, 0 en caché, 11.9 s |
| `pnpm test --force` | ✅ 11/11 tareas, 0 en caché, 31.6 s |
| `pnpm build --force` | ✅ 8/8 tareas, 0 en caché, 21.9 s |

`git diff --check` contra `cd860728` y sobre el árbol de trabajo: sin errores de
espacios en ninguno de los dos.

En la cuarta ronda estas mismas órdenes dieron 74 pruebas con el mismo entorno.

Nota operativa: Turbo necesita el binario `pnpm` en `PATH`; en este entorno solo
existe Corepack, así que se usó un shim temporal en el directorio scratchpad de
la sesión. No se modificó ninguna configuración del repositorio.

## 9. Matriz de validación visual

Runtime: **Expo web (react-native-web)** con Metro local sobre Node 24.19.0,
controlado con navegador real y el arnés (`MOBILE_VISUAL_HARNESS=1`). Las
respuestas son fixtures sintéticas locales; no se usó ninguna credencial,
usuario o dato remoto, y el cliente, los parsers compartidos y la máquina de
estados son los reales.

| Caso | Viewport | Resultado |
| --- | --- | --- |
| Acceso: inicial, credenciales rechazadas y acceso correcto | 390×844 | ✅ |
| Selección de sucursal, mesas y menú (sucursal 1) | 390×844 | ✅ "Terraza", `12,500 u.m. · XTS` |
| Cambio a la sucursal 2 | 390×844 y 1024×768 | ✅ "Salón principal", `9,900 u.m. · XTS`, sin rastros de la sucursal 1 |
| Revalidación en curso (respuesta lenta) | 390×844 | ✅ "Acceso sin confirmar"; sin restaurante, sucursal, correo ni datos previos |
| Revalidación fallida (red caída) | 390×844 | ✅ "Acceso sin confirmar" + "No se pudo revalidar tu acceso" + "Reintentar"; sin identidad ni datos |
| Reintento tras la red caída | 390×844 | ✅ Restaura identidad y datos |
| Acceso revocado tras segundo plano | 390×844 | ✅ Vuelve a selección con "Tu acceso a la sucursal seleccionada fue revocado."; sin identidad ni datos |
| **Sesión ilegible** (el puerto rechaza) al volver al primer plano | 390×844 | ✅ Termina en el acceso con "Tu sesión se cerró en este dispositivo."; no queda revalidando |
| **Sesión ilegible** al reiniciar la app | 390×844 | ✅ Muestra el acceso; no queda en "Abriendo superRestaurant…" |
| Membresías vacías, red caída y reintento | 390×844 | ✅ Estados explícitos y recuperación |
| Ticker de sesión por ciclo de vida | 390×844 | ✅ montaje = 1, segundo plano = 0, primer plano = 1 |
| Desbordamiento horizontal | 390×844 y 1024×768 | ✅ `scrollWidth == innerWidth` |
| Objetivos táctiles | 390×844 y 1024×768 | ✅ 48 px |
| Contraste medido | 1024×768 | ✅ 7.03 · 7.45 · 8.68 · 16.31 · 17.79 : 1 — todos ≥ AA |
| Foco visible por teclado | 1024×768 | ✅ 1 px → 3 px `#0b3a7d` → 1 px en botones y pestañas |
| Consola | ambos | ✅ Sin warnings ni errores del app |
| Red | ambos | ✅ Solo el bundle local; ningún destino externo |
| Cierre de sesión con `signOut()` colgado | 390×844 | ✅ La interfaz vuelve al acceso mientras la llamada sigue en vuelo |
| Notificación tardía con la sesión cerrada | 390×844 | ✅ Sigue en el acceso: sin sucursal, membresías ni datos |
| Nuevo inicio de sesión tras el cierre local | 390×844 | ✅ Entra limpio a la selección de sucursal |
| Cierre de sesión con `signOut()` que rechaza | 390×844 | ✅ Cerrado a los 60 ms y estable; consola sin errores ni rechazos no manejados |
| **A entra → sucursal 1 → renovar token** | 390×844 | ✅ Conserva sucursal, mesas, menú y correo del operador A tras la renovación |
| **A sale → B entra → sucursal 2 → B sale** | 390×844 y 1024×768 | ✅ Cada ciclo entra limpio; el encabezado de B muestra su propio correo y "Salón principal" |
| **Replay de las sesiones históricas tras dos ciclos** | 390×844 y 1024×768 | ✅ `Notificar sesión histórica 1`, `2` y `todas` dejan la app en el acceso: sin sesión, sin sucursal, sin datos |
| **Reingreso intencional después del replay** | 390×844 y 1024×768 | ✅ Entra limpio a la selección de sucursal (tercer ciclo) |
| **Cierre colgado y replay posterior** | 390×844 | ✅ El acceso aparece con la llamada en vuelo; el proveedor sigue teniendo la sesión y la replica, y la app no la acepta |
| Aislamiento del arnés en el bundle distribuible | — | ✅ El `.hbc` contiene "Cambiar sucursal", "Acceso sin confirmar" y "Sin sucursales asignadas", y **no** contiene "Ir a segundo plano", "Reiniciar arn", "harness", "HARNESS_SESSION_UNREADABLE", "HARNESS_SIGN_OUT_FAILED", "operador.sintetico" ni `sb_publishable_fixture`. Las cadenas con acentos no se buscan porque Hermes las almacena en UTF-16; se usan controles ASCII de ambos lados |

Notas de método de la quinta ronda: el panel del navegador de esta sesión quedó
oculto y no dibuja, así que las filas nuevas se verificaron con el DOM real
(`innerText` de la aplicación tras cada paso) y con geometría medida
(`scrollWidth` frente a `innerWidth`, alturas de los controles), conduciendo la
interfaz con eventos reales de clic y de `input`. No hay capturas de pantalla de
esta ronda. Medido así: sin desbordamiento horizontal en 390×844 ni en 1024×768,
controles del app de 48 px o más, y la consola sin errores ni rechazos no
manejados durante toda la sesión.

Notas de método de rondas anteriores: el panel del navegador automatizado no
entrega foco real de ventana, así que el anillo se comprueba despachando
`focusin`/`focusout` y midiendo el borde. El estado transitorio de
revalidación se capturó por texto del DOM —dura menos de lo que tarda una
captura— mientras que el estado de fallo, que persiste hasta reintentar, sí
quedó capturado en pantalla.

## 10. Confirmación de fronteras

Comparado con `16f30f1fd3aa0cce3f47d7a7bac2dd5d0f354de1`, el diff toca
exclusivamente `apps/mobile/**` y `pnpm-lock.yaml` (este último solo por el
primer corte). Comparado con `cd860728faba1c49a0c4bb14c31e58922d7dd44e`, la
quinta ronda toca **solo `apps/mobile/**`**: el lockfile no cambió. No se
modificó ni creó nada en `apps/api`, `apps/web`,
`apps/kds`, `packages/domain`, `packages/shared-types`, `supabase/**`,
migraciones, SQL, RLS, permisos, credenciales, `.env`, configuración raíz
—incluido `pnpm-workspace.yaml`—, CI ni documentación operativa. No se ejecutó
ninguna operación contra Supabase, PostgreSQL, Data API o Vault, ni ninguna E2E
remota; no se crearon usuarios ni fixtures remotas, y no se reutilizó ningún
UUID documentado en el historial del repositorio. El flujo P1 Web/KDS/caja en
REVIEW quedó intacto.

## 11. Limitaciones, riesgos y solicitudes pendientes

1. **Sesión sin persistencia** (SR-MOB-001): al cerrar la app hay que volver a
   autenticarse. La renovación en memoria ya existe y es un asunto distinto.
2. **Sin verificación en Android/iOS reales**: no hay emulador ni SDK nativo en
   este entorno. El bundle Android se genera, pero no se ejecutó en dispositivo;
   `react-native-safe-area-context` y la entrega real de eventos de `AppState`
   siguen sin comprobarse en hardware.
3. **`user.id` se exige como UUID**: es lo que emite Supabase Auth. Un proveedor
   que emitiera otro formato haría fallar el acceso de forma visible, nunca
   silenciosa.
4. **CodeGraph no disponible**: análisis por inspección dirigida, reconsultada
   al abrir y al cerrar la quinta ronda.
5. **Réplica en la misma generación**: la compuerta ata cada suscripción a su
   generación, así que ignora al proveedor que llama a manejadores liberados. Un
   proveedor que entregara un evento **atrasado** en la suscripción **vigente**,
   después de un reingreso del mismo operador, se vería como una renovación:
   distinguirlo exigiría un orden entre tokens (por ejemplo `expires_at`) que
   hoy no se guarda. Supabase no emite eventos así; queda anotado.
6. **Reinicio del arnés con el doble aún autenticado**: si se reinicia la app
   del arnés después de un `signOut()` colgado —que por definición no borra la
   copia del proveedor—, el montaje nuevo estrena compuerta y restaura esa
   sesión. Es
   correcto (una app recién montada no hereda generaciones) y es un artefacto
   del doble: en el app real `persistSession: false` hace que no haya nada que
   restaurar al arrancar el proceso.
7. **Divergencia de versiones de React/React Native** respecto de Web/KDS,
   impuesta por Expo SDK 57 y aislada en este app.
8. **Parser local para `POST /api/v1/access/branch`** (SR-MOB-002).
9. **Turno operativo** (SR-MOB-003) y **origen de API para dispositivos
   físicos** (SR-MOB-004) siguen pendientes de decisión.
10. **Verificación contra Auth y Nest reales** (SR-MOB-005): el arnés la
   anticipa, no la sustituye.

## 12. Siguiente acción recomendada

1. Revisar el diff completo y confirmar que `pnpm-lock.yaml` solo cambió en el
   primer corte y solo por `apps/mobile`.
2. Ejecutar el arnés (`harness/README.md`) para reproducir la matriz visual y
   después la app real contra un entorno propio.
3. Decidir SR-MOB-001 a SR-MOB-005 por separado; la comanda móvil no debe
   abrirse antes de resolver SR-MOB-001 y SR-MOB-003.
4. Solo con aprobación humana, integrar la rama y actualizar `TODO.md`. Este
   workstream no cambió el estado de ninguna tarea.
