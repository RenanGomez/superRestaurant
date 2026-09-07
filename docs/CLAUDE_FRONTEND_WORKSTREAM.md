# Workstream frontend para Claude — fundación móvil aislada

## 0.R7 Revisión del coordinador 2026-09-07 — pertenencia de órdenes activas a la mesa

Resultado del relevo Codex: R7 quedó implementada y verificada en `codex/p2-mobile-r6-review`. `activeOrders` conserva como propietario el scope Restaurant/Branch, el turno, la mesa y el intento; el cambio o abandono de mesa invalida el recurso antes de renderizar la transición, y la frontera de presentación vuelve a comprobar la mesa vigente. Las respuestas success/failure/401 tardías de A no pueden poblar, fallar ni revocar B, una lectura colgada de A no bloquea B y una lista vacía de B permanece `ready`. Las regresiones controladas, la matriz de navegador real y las compuertas R7 pasaron. La P2 permanece `IN_PROGRESS`: este cierre no integra la rama a `main`, no aplica las migraciones pendientes ni sustituye la validación nativa posterior.

La entrega R6 `0454f18470831ab3dd505f4dd0c98f69ae79adf7` no queda aceptada todavía. El flujo de mutación, la identidad de dispositivo y los contratos pasan sus pruebas, pero `activeOrders` pertenece solo al scope y al intento: la mesa seleccionada vive fuera de `MobileState`. Después de cargar la mesa A, salir y seleccionar B, el recurso continúa `ready` con A, `activeOrdersReadTarget(state, B)` no inicia otra lectura y la pantalla de B muestra el snapshot de A. Si la lectura de A estaba en vuelo, su success tardío también se acepta y bloquea B. La prueba R6 existente solo rechaza una respuesta cuyo `list.tableId` contradice el `tableId` del mismo evento; no cubre que la selección haya cambiado desde que comenzó el intento.

Continuar desde el HEAD R6 limpio en el mismo worktree de integración. No incorporar historia, abrir otra implementación de lecturas ni modificar contratos o backend. Extender el patrón único de ownership de R4/R5 para que el recurso de órdenes activas esté ligado simultáneamente a Restaurant/Branch, turno, mesa e intento; la selección vigente debe formar parte de la autoridad que decide tanto el inicio como la aplicación de success, failure y 401. Cambiar o abandonar mesa debe invalidar sincrónicamente el intento anterior, permitir de inmediato la lectura de la mesa nueva aunque la anterior cuelgue y evitar que un resultado tardío cambie datos, estado de error o sesión. No basta con limpiar el valor renderizado si la respuesta anterior todavía puede repoblarlo.

Criterios exactos de aceptación R7:

1. A cargada → volver a mesas → seleccionar B: B inicia su propia lectura y nunca renderiza la lista de A.
2. A cargando → seleccionar B → success tardío de A: se ignora; B puede cargar y queda como único snapshot visible.
3. Failure o 401 tardío de A después de seleccionar B: no altera el recurso de B, no cierra la sesión y no emite un aviso ajeno.
4. Una promesa colgada de A no bloquea B; volver a seleccionar la misma mesa no duplica una lectura vigente.
5. Lista vacía de B permanece una respuesta `ready` explícita y una respuesta cuyo scope, turno, mesa o intento no coincide falla cerrada.
6. Añadir pruebas deterministas con promesas controladas para los cinco casos anteriores y una regresión pura del reductor para `ready(A) → seleccionar B` y `loading(A) → seleccionar B`.
7. Repetir la matriz con clics de confianza y `Respuesta lenta` en 390×844 y 1024×768, usando respuestas distinguibles por mesa; comprobar ausencia de datos de A en B, consola limpia y ninguna mutación duplicada.
8. Ejecutar con Node 24.19.0 lint, typecheck, pruebas, `expo install --check`, export Android, las cuatro compuertas globales `--force`, `git diff --check` y aislamiento del bundle. Reindexar CodeGraph en el worktree exacto: no reportar como local un índice que advierte pertenecer a otro working tree.

El alcance sigue limitado a `apps/mobile/**`; `pnpm-lock.yaml` solo puede cambiar si una dependencia declarada de Mobile cambia justificadamente. P2 permanece `IN_PROGRESS` y ninguna migración puede aplicarse persistentemente.

## 0.R6 Integración autorizada 2026-09-06 — contexto, identidad de dispositivo y Order v2

Emmanuel autorizó la decisión faltante: cada Restaurant tiene una zona IANA autoritativa en PostgreSQL y Mobile conserva un `deviceId` estable mediante `expo-secure-store`; los totales permanecen fuera de este corte. El mínimo server-side es `3ce02dfe1db6032da6ad392585925c311041c5ac`. El corte Mobile R5 aceptado está limpio en `0fcd61d22c07d32ae47b0780992182f800f1d60f` y parte del ancestro común `f1f8f27b4732810ee26c1bbab122016a7ede0dc1`.

Crear un worktree y rama de integración nuevos desde el HEAD limpio que entregue el coordinador y confirmar que contiene `3ce02df`. No modificar el worktree R5. Incorporar localmente, en orden, el rango Mobile ya revisado `f1f8f27b4732810ee26c1bbab122016a7ede0dc1..0fcd61d22c07d32ae47b0780992182f800f1d60f` mediante cherry-pick; esta es la única incorporación histórica autorizada. No usar pull, merge, rebase, reset ni push. Resolver cualquier conflicto únicamente dentro de `apps/mobile/**`; si aparece fuera de esa ruta, detenerse y reportarlo.

Después implementar solo en `apps/mobile/**` (y `pnpm-lock.yaml` como consecuencia exacta de dependencias Expo) lo siguiente:

1. Consumir `POST /api/v1/access/branch/context` con el mismo body de scope y validar exclusivamente con `parseBranchOperationalContextV1`. Sustituir la autorización local anterior en el flujo operativo sin copiar el contrato. La zona usada por `CreateOrderCommandV2` debe venir de esa respuesta y quedar ligada al mismo operador, token, Restaurant, Branch e intento; una respuesta tardía no puede poblar otro contexto.
2. Instalar con `expo install` las dependencias oficiales mínimas para almacenamiento/generación criptográfica (`expo-secure-store` y, si hace falta para UUID v4, `expo-crypto`). Crear o cargar una sola identidad UUID por instalación bajo una clave versionada. Validarla al leer, serializar concurrencia para que dos llamadas iniciales no generen valores distintos, no registrarla y fallar explícitamente si SecureStore no está disponible o devuelve datos corruptos. No usar email, token, hardware ID, advertising ID ni un UUID constante.
3. Por cada entrega lógica construir una vez un plan inmutable: `orderId`, un `orderItemId` por línea, `eventId` e `idempotencyKey` distintos por mutación, `occurredAt` UTC canónico, `deviceId`, scope, `shiftId`, moneda del catálogo y zona del contexto. Un reintento ambiguo debe reutilizar byte por byte ese plan; una entrega nueva debe generar identidades nuevas. No persistir tokens ni el borrador completo en SecureStore y no anunciar offline.
4. Ejecutar exactamente `CreateOrderCommandV2 → AddOrderItemCommandV1[] → OpenOrderCommandV1`, validar cada respuesta con `parseOrderMutationSummaryV1`, encadenar `expectedVersion` desde las respuestas autoritativas y aceptar replay idempotente sin duplicar pasos. Detenerse ante conflicto/autorización/red/protocolo con estado recuperable; nunca continuar parcialmente a `open` si una línea no fue confirmada.
5. Consumir `GET /api/v1/orders/active` con `ActiveTableOrderListV2` y su parser compartido. Tratar la respuesta como lista acotada: una mesa puede tener más de una Order activa; `shiftId:null` es histórico válido. Mostrar líneas/modificadores snapshot recibidos sin recalcular totales, impuestos o descuentos y sin asumir ocupación exclusiva por mesa.
6. Mantener las garantías R1–R5: salida segura, cero reenvío de líneas aceptadas, intentos ligados al contexto, validación fail-closed contra catálogo completo, una sola frontera de efecto, layout usable y lecturas pertenecientes a operador/scope/intento. El arnés puede simular los endpoints, pero sus datos/cadenas no deben entrar al bundle distribuible. No ejecutar contra PostgreSQL/Data API ni aplicar migraciones.

Pruebas mínimas deterministas: creación y replay exacto; fallo ambiguo en cada paso y retry sin UUID/timestamp nuevo; dos entregas consecutivas sin reutilización; turno/sucursal/operador cambiando durante la secuencia; SecureStore vacío/corrupto/rechazado y dos cargas concurrentes; contexto tardío/ajeno; active list vacía, múltiple y `shiftId:null`; límites de líneas/modificadores; doble toque; lanzamiento síncrono y promesa colgada sin rechazo no manejado. El HTTP mock debe afirmar rutas, métodos, Bearer, bodies exactos y ausencia de llamadas posteriores al primer fallo.

Ejecutar con Node 24.19.0 lint, typecheck, tests, `expo install --check`, export Android, compuertas globales `--force`, matriz visual 390×844 y 1024×768, aislamiento del bundle, `git diff --check` y CodeGraph final. Actualizar solo `apps/mobile/CLAUDE_DELIVERY.md` y `apps/mobile/BACKEND_REQUESTS.md`. P2 permanece IN_PROGRESS: la integración local no equivale a evidencia remota y las migraciones continúan sin aplicar.

## 0.R5 Revisión del coordinador 2026-09-06 — pertenencia de lecturas de membresías

El coordinador revisó de forma independiente el corte limpio `9d1aa64c6d790f66af866832ae79eb45eb4e5917` (árbol `4201508719c15aca488de6783db682f1c022342b`) sobre la base exacta `5bb97233bf96acc31088cd2b1c353d76bea3fe75`. Los dos commits y las ocho rutas permanecen dentro de `apps/mobile/**`; la identidad de intento incorporada para `shifts`, `layout` y `menu` corrige la cancelación por el propio despacho y queda aceptada. El corte todavía no debe integrarse porque la lectura de membresías conserva un guard independiente basado solo en un serial local.

Claude debe hacer un único retrabajo acotado: **ligar cada lectura de membresías al operador inmutable y al intento que la originó**. Hoy `membershipRequest.current` no se invalida sincrónicamente cuando `sessionObserved` cambia de `userId`, y `membershipsLoaded`/`membershipsFailed` no llevan identidad que el reductor pueda comprobar. Una respuesta del operador A puede, por tanto, asentarse después de que el estado ya pertenece al operador B. La regresión del coordinador cambió A→B mientras la lectura estaba en vuelo y esperaba `memberships.value === undefined`; falló porque recibió las dos membresías de A. Los otros 29 casos de `mobile-state.test` pasaron.

Criterios exactos de aceptación R5:

- extender el patrón vigente de pertenencia de intento, sin crear otro sistema paralelo, para que success, failure y 401 de membresías solo tengan efecto si coinciden con el `userId` actual y el intento que el recurso espera;
- invalidar sincrónicamente la lectura en vuelo al cerrar sesión, cambiar de operador y renovar el token mientras se está leyendo; dejar un estado que permita iniciar una lectura fresca, sin spinner colgado;
- garantizar que un success tardío de A nunca muestra membresías en B, un failure tardío de A no altera B y un 401 tardío de A no cierra la sesión de B; la lectura vigente de B debe poder completarse aunque la de A quede colgada;
- cubrir con promesas controladas las respuestas de A antes y después de iniciar la lectura de B, renovación del mismo operador, rechazo, 401, lanzamiento síncrono y ausencia de `unhandledrejection`; conservar los casos existentes de sign-out y rama;
- repetir el recorrido real en 390×844 y 1024×768 con respuesta lenta y cambio de operador si el arnés lo permite sin editar DOM/CSS; si no lo permite, registrar esa limitación y sostener la garantía con la prueba determinista de integración/reductor;
- ejecutar con Node 24.19.0 lint, typecheck, pruebas Mobile, `expo install --check`, export Android, compuertas globales `--force`, `git diff --check`, aislamiento del bundle y CodeGraph final; actualizar solo la documentación Mobile correspondiente;
- modificar únicamente `apps/mobile/**`; preservar R1–R4, no copiar contratos, no tocar `pnpm-lock.yaml`, API, Supabase, Web o KDS, y no hacer reset, pull, merge, rebase ni push.

La P2 continúa `IN_PROGRESS`. Este retrabajo solo corrige aislamiento Mobile; la conexión productiva con Order y la aplicación de migraciones permanecen en el corte coordinado posterior.

## 0.R3 Revisión del coordinador 2026-09-06 — interacción táctil estrecha

El coordinador revisó de forma independiente el corte limpio `59b26ca15628e3c9ed847efe6dae549e74592eaf` (árbol `a7ac9de413944607bb9002bc75825ad073b1fc2b`). El diff sigue limitado a once rutas de `apps/mobile/**`; lint, typecheck, las 150 pruebas, `expo install --check`, el export Android de 660 módulos y las compuertas globales sin caché quedaron verdes. El bundle de 2,232,339 bytes contiene las acciones de producto y no contiene cadenas del arnés. La separación `activeProductGroups`/`orderableGroups`, la categoría fail-closed, las confirmaciones, el retiro de líneas aceptadas y el envío ligado al contexto quedan aceptados para esta revisión.

Queda un único retrabajo acotado antes de integrar el slice Mobile:

1. **Hacer operable la comanda a 390×844 con eventos táctiles reales.** Contraer los controles del arnés sí deja 740 px para la app, pero en la pantalla de comanda las dos `column` verticales conservan `flexBasis: 0`/`flexGrow: 1`: el `ScrollView` del catálogo termina con `clientHeight=0` y su producto desborda detrás de `DraftPane`. En la reproducción, Playwright llevó el documento hasta su `scrollTop` máximo y el centro del producto seguía resolviendo por `elementFromPoint` al encabezado/banner del borrador; el clic semántico no abrió el compositor. Corregir el layout estrecho con el cambio mínimo para que catálogo y borrador sean desplazables/alcanzables sin superposición, sin alterar la disposición de dos columnas de 1024×768.

Criterios exactos de aceptación R3:

- desde un arnés reiniciado, recorrer a 390×844 `login → sucursal → turno → mesa → producto → modificador requerido → agregar línea` con clics/taps normales, sin `force`, coordenadas contra elementos tapados ni edición de DOM/CSS;
- demostrar que el producto tiene un área táctil alcanzable de al menos 48 px y que `elementFromPoint` dentro de esa área pertenece al propio botón, no a `DraftPane`;
- conservar `scrollWidth == innerWidth`, consola sin errores y cero llamadas a `/api/v1/orders*`;
- repetir 1024×768 y conservar las dos columnas, las confirmaciones distintas y un doble envío equivalente a exactamente `crear + un ítem por línea + abrir`;
- añadir una regresión proporcional del layout/estructura si el patrón de pruebas vigente puede fijar la causa sin inventar otro arnés; después ejecutar lint, typecheck, 150+ pruebas, `expo install --check`, Android export, compuertas globales `--force`, `git diff --check`, aislamiento del bundle y CodeGraph final;
- modificar solo `apps/mobile/**`; no conectar mutaciones reales, no copiar contratos, no tocar `pnpm-lock.yaml`, server/API/esquema, Web o KDS, y no hacer push, merge o rebase.

La P2 continúa `IN_PROGRESS`: este retrabajo solo cerrará la operabilidad visual Mobile. La lectura server-side v2 de líneas de la orden activa ya está preparada en el workstream de Codex, pero su aplicación de esquema, integración productiva y prueba conjunta siguen siendo un slice coordinado separado.

## 0.R2 Revisión del coordinador 2026-09-06 — catálogo completo y arnés reproducible

El coordinador revisó de forma read-only el retrabajo de código `27e787c9fb559ca697030b1660eedbe4a9edb216`. Durante el cierre, la rama avanzó únicamente con la corrección documental `16a5e65460e0796470997bccd8103243316ad84b`, sin cambiar el código revisado. El árbol de Claude estaba limpio, el diff permanecía limitado a `apps/mobile/**`, CodeGraph dejó las cinco fronteras de R1 dentro de Mobile y se reprodujeron con Node 24.19.0 lint, typecheck, 141 pruebas, `expo install --check` y el export Android de 660 módulos. Los cinco hallazgos originales de R1 están corregidos, pero el corte todavía no debe integrarse por estas dos brechas nuevas:

1. **Fail-closed contra todo el catálogo, no solo contra los primeros 50 grupos.** El contrato compartido acepta hasta 2,000 grupos de modificadores. `orderableGroups` recorta a `DRAFT_MAX_GROUPS` antes de que `draftLineIssues` valide, por lo que un grupo obligatorio agregado después de los primeros 50 no se observa y el handoff se acepta. La regresión directa devolvió `requiredGroupAfterLimitAccepted=true`. Separar los grupos presentables de los grupos usados para validar o fallar como `stale` cuando el producto ya no puede representarse dentro del límite del comando. Además, retirar la categoría activa del producto debe invalidar el handoff: la regresión directa actual devolvió `inactiveProductCategoryAccepted=true`. Añadir pruebas para ambos cambios y conservar cero entregas cuando fallen.
2. **Matriz visual reproducible en el viewport declarado.** En el arnés vigente, a 390×844 el `ScrollView` de controles consume la altura y deja el contenedor operativo/lista de sucursales con `clientHeight=0`; el flujo no puede recorrerse con eventos reales sin una manipulación externa no documentada. Proveer un control accesible para contraer el panel o un layout acotado que mantenga la aplicación interactuable, y repetir 390×844 y 1024×768 sin editar el DOM ni CSS desde el navegador.

Mantener el retrabajo dentro de `apps/mobile/**`, sin incorporar `main`, merge/rebase/push, lockfile o conexión productiva a Order. La integración contra `CreateOrderCommandV2`, `shiftId` y la lectura activa sigue a cargo del coordinador después de aprobar este corte. Repetir las compuertas Mobile, globales sin caché, CodeGraph, aislamiento del bundle, matriz visual, `git diff --check` y árbol limpio.

## 0.R1 Revisión del coordinador 2026-09-06 — retrabajo previo a integración

El coordinador revisó el corte `3061487a8b5568c32afc7730099182ffb09da774` de la rama `claude/mobile-order-entry-ui-20260905`. El alcance, CodeGraph, lint, typecheck y 118 pruebas se reprodujeron, pero el corte no debe integrarse todavía. Claude debe corregir únicamente los puntos siguientes dentro de `apps/mobile/**`, sobre su rama y worktree actuales; no debe incorporar `main`, hacer merge/rebase/push ni conectar endpoints Order.

1. **Salida segura a mesas.** `onBackToTables` despacha hoy `tableReleased`, que elimina el borrador sin confirmación, aunque la ayuda accesible afirma que se conserva. Con líneas o una composición no confirmada, volver al plano debe pasar por una confirmación dentro de la pantalla que diga exactamente qué se perderá; con borrador realmente vacío puede salir directamente. La confirmación de “descartar y permanecer en la mesa” no debe confundirse con “descartar y volver a mesas”. Probar ambos destinos, cancelar la salida y doble toque.
2. **Éxito sin reenvío de líneas.** Después de `submissionSucceeded` las líneas aceptadas no pueden quedar reenviables. Un segundo toque, editar después del éxito o agregar una línea nueva no debe volver a ofrecer líneas ya aceptadas. Elegir el estado mínimo coherente —por ejemplo, limpiar solo las líneas entregadas conservando la mesa y el aviso de éxito— y probar una segunda comanda local que contenga únicamente líneas nuevas.
3. **Ciclo asíncrono acotado al contexto.** Un `submit` pendiente no puede bloquear para siempre una sucursal/turno/operador posterior, y su resolución tardía no puede modificar el borrador nuevo. Sustituir el booleano global por identidad/generación de intento ligada al contexto; cubrir promesa colgada, cambio de contexto, nuevo envío, resolución tardía y rechazo. Capturar también implementaciones que lancen sincrónicamente, sin dejar `sending`, bloqueo o rechazo no manejado.
4. **Handoff fail-closed contra el catálogo vigente.** Validar al construir el handoff el producto activo y todas las líneas: cantidades enteras acotadas, grupos/opciones todavía activos y pertenecientes al producto, ausencia de duplicados, máximos por opción/grupo y mínimos requeridos. No basta con comprobar `knownProductIds`. Un cambio de catálogo entre composición y envío debe producir `stale` y cero callbacks. Añadir pruebas adversariales para grupo/opción retirados, nuevo requisito mínimo, duplicados y cantidades inválidas.
5. **Una sola frontera de efecto.** `App` no debe invocar callbacks con forma de mutación y después llamar además a `submit` sobre el mismo objeto. Dejar una única llamada de entrega con semántica inequívoca; el arnés puede inspeccionar el handoff dentro de esa llamada. Así se evita que la integración productiva futura ejecute crear/agregar/abrir dos veces. Mantener cero HTTP y cero identificadores de auditoría inventados en este slice.

Actualizar las pruebas, arnés, `CLAUDE_DELIVERY.md` y `BACKEND_REQUESTS.md` solo dentro de la lista blanca existente. En la entrega, tratar SR-MOB-007 como **resuelta server-side pero todavía no integrada en Mobile**: el contrato aditivo `ActiveTableOrderListV2` devuelve la lectura acotada con líneas y modificadores históricos, aunque la migración sigue local y no aplicada. Tratar SR-MOB-010 como **resuelta para creación v2** mediante `shiftId`, dejando explícito que el coordinador hará la integración contra esos contratos después del merge; no copiar ni redefinirlos en la rama antigua. SR-MOB-008, SR-MOB-009 y SR-MOB-011 permanecen abiertos. Repetir Node 24.19.0, lint, typecheck, tests, `expo install --check`, export Android, compuertas globales sin caché, matriz visual, aislamiento del arnés, CodeGraph final, diff de rutas y árbol limpio.

## 0. Mandato vigente desde 2026-09-05 — mesas y borrador de comanda

Esta sección sustituye cualquier instrucción contradictoria del mandato histórico que aparece debajo. La fundación Expo/Auth/Restaurant/Branch/turno y sus cinco rondas de corrección ya fueron integradas en `main` y están **DONE**. No reabrirlas ni reconstruirlas.

### 0.1 Objetivo y división paralela

Claude debe implementar exclusivamente la capa de presentación e interacción mobile para la siguiente P2: **vista de mesas y toma de comanda online**. Codex trabaja en paralelo fuera de `apps/mobile/**` y conserva:

- contratos compartidos y parsers;
- reglas de dominio y cálculos;
- endpoints, servicios y adaptadores Nest;
- esquema, migraciones, RLS, permisos y verificación PostgreSQL;
- integración productiva final entre UI, estado, cliente y backend.

El entregable de Claude debe ser útil e integrable, pero no puede asumir capacidades server-side no integradas o no aplicadas. Codex ya preparó creación v2 ligada a turno y lectura activa v2 con líneas, pero siguen en una rama/migración local separada. Por ello Claude construirá la UI y sus estados mediante la frontera tipada vigente, pero **no conectará todavía mutaciones productivas de Order**.

### 0.2 Base, rama y aislamiento

1. Crear un worktree nuevo; no reutilizar el worktree de la fundación.
2. Partir del hash exacto de `main` indicado en el prompt humano, confirmar árbol limpio y comprobar que contiene este mandato. El ancestro mínimo es `c6f87961b2afddaef0c84fec50e8fa5ae4abbbc2`; no incorporar commits posteriores por cuenta propia.
3. Rama sugerida: `claude/mobile-order-entry-ui-20260905`.
4. Leer una sola vez los archivos operativos exigidos por `AGENTS.md`, este documento completo y la sección Fase 2 del plan.
5. Consultar CodeGraph antes de editar y después de terminar.
6. No incorporar cambios posteriores de `main`, hacer merge, rebase, push o modificar otra rama. Reportar cualquier divergencia.

### 0.3 MCP autorizado y obligatorio

Emmanuel autorizó instalar y usar los MCP necesarios para esta unidad. Antes de editar:

1. Instalar CodeGraph MCP para Claude en configuración global de usuario, sin crear ni versionar configuración dentro del repositorio:
   - `codegraph install --target claude --location global`
2. Instalar el plugin oficial de Expo para Claude Code:
   - `claude plugin install expo@claude-plugins-official`
3. Abrir `/mcp`, confirmar que CodeGraph y Expo estén disponibles y usar CodeGraph para el análisis estructural.

La autorización cubre únicamente instalación/configuración de usuario y consultas necesarias. No autoriza Supabase MCP, acceso a cuentas o secretos del proyecto, EAS Build, publicación, deployment, firma, creación de credenciales ni cambios remotos. Si Expo pide iniciar sesión, detener ese paso y reportarlo: este slice local no necesita una cuenta Expo.

### 0.4 Rutas y fronteras

Claude puede modificar únicamente:

- `apps/mobile/**`;
- `pnpm-lock.yaml` solo si una dependencia de `apps/mobile/package.json` es imprescindible, está justificada y no existe ya una alternativa instalada.

Todo lo demás es de solo lectura. En especial, no modificar `apps/api/**`, `packages/**`, `supabase/**`, documentos operativos, configuración raíz, Web o KDS. No añadir una librería de estado, navegación, formularios o UI sin demostrar que los recursos actuales no bastan y solicitar decisión primero.

Codex no modificará `apps/mobile/**` mientras este mandato esté activo. Si Claude necesita una capacidad fuera de esa frontera, debe registrarla en `apps/mobile/BACKEND_REQUESTS.md` y continuar con trabajo independiente.

### 0.5 Contratos existentes que debe reutilizar

Confirmar nombres y formas exactas con CodeGraph; no copiarlos ni redefinirlos:

- `DiningLayoutV1` y sus zonas/mesas;
- `MenuCatalogStateV1`, `MenuCatalogV1`, productos, modificadores y precios;
- `CreateOrderCommandV1`;
- `AddOrderItemCommandV1`;
- `OpenOrderCommandV1`;
- `OrderMutationSummaryV1`;
- contrato de turno operativo v1 integrado en `main`.

Los endpoints `POST /api/v1/orders`, `POST /api/v1/orders/items`, `POST /api/v1/orders/open` y `GET /api/v1/orders/active` existen y pueden inspeccionarse, pero en este slice son **solo referencia**. No llamarlos desde el producto ni simular que una orden quedó guardada o recuperada hasta que el coordinador integre y autorice el contrato v2; no cubrir esa frontera con estado autoritativo inventado.

### 0.6 Entregable funcional

Implementar componentes y flujo visual mobile para:

- convertir la vista de mesas existente en una selección táctil accesible;
- mostrar zona, nombre y capacidad provenientes del contrato, sin inventar ocupación, disponibilidad o cuenta;
- entrar a un compositor de borrador para la mesa seleccionada;
- explorar el catálogo por categorías y seleccionar un producto;
- elegir únicamente modificadores permitidos por el contrato y una cantidad entera válida;
- presentar las líneas del borrador y permitir edición/eliminación local;
- mostrar estados explícitos `idle`, vacío, cargando, listo, enviando, éxito, conflicto, autorización, red y protocolo;
- exponer callbacks claros para `crear orden`, `agregar ítem` y `abrir/enviar comanda`, sin implementar la escritura HTTP;
- ofrecer salida segura a mesas y descarte del borrador mediante confirmación dentro de la pantalla, nunca `alert()`, `confirm()` o `prompt()`.

No calcular subtotal, impuestos, descuentos, propina o total en mobile. Puede mostrar el precio unitario recibido, siempre con entero en unidad menor y moneda ISO explícita mediante el helper existente. Usar `MXN` solo cuando llegue en el contrato; nunca como fallback. No incluir CFDI, fiscalidad, pagos, caja, impresión, notificaciones push u offline.

Los tipos locales permitidos son exclusivamente estado efímero de presentación y props de componentes; no pueden convertirse en una segunda entidad Order ni duplicar reglas del dominio.

### 0.7 Calidad y pruebas

- Reutilizar el sistema visual y componentes actuales de `apps/mobile`; no crear otro design system.
- Targets primarios de 48 px, foco visible, labels/roles accesibles, contraste AA, texto largo y reduced motion.
- Verificar 390×844 y 1024×768, sin overflow y con consola limpia.
- Ampliar el arnés visual aislado; sus cadenas, fixtures y controles no pueden aparecer en el bundle distribuible.
- Usar UUID generados durante pruebas o UUID nuevos no documentados; nunca repetir los UUID de evidencias existentes.
- Probar selección/cambio de mesa, borrador vacío, producto/modificadores/cantidad, eliminación, descarte, doble toque, estados de envío/error/conflicto y limpieza al cambiar sucursal/turno o cerrar sesión.
- Demostrar que ningún gesto llama endpoints Order y que ninguna regla monetaria se calcula localmente.
- Ejecutar lint, typecheck, tests, `expo install --check`, export Android y las cuatro compuertas globales con Node 24.19.0. No publicar builds.

### 0.8 Entrega

Entregar commits convencionales pequeños, hash final y árbol limpio. Actualizar `apps/mobile/CLAUDE_DELIVERY.md` con base/rama, alcance, archivos, pruebas, matriz visual, resultado de CodeGraph/MCP, limitaciones y diff de rutas. Actualizar `apps/mobile/BACKEND_REQUESTS.md` solo para necesidades reales, conservando los identificadores existentes y creando identificadores nuevos sin reutilizar ninguno.

No integrar la rama. El coordinador revisará el diff, resolverá la frontera backend y pedirá autorización humana antes de cualquier merge.

## 1. Mandato

Claude debe implementar una unidad frontend independiente para `superRestaurant` sin interferir con el curso principal del repositorio.

El único alcance autorizado es crear la fundación de `apps/mobile` con Expo, React Native y TypeScript, y conectar pantallas de solo lectura a capacidades backend que ya existen y están consolidadas. Este documento no autoriza cambios backend, de dominio, esquema, seguridad, contratos compartidos ni clientes Web/KDS existentes.

La tarea P1 Web/KDS/caja ya está en `REVIEW` y queda congelada. No debe reabrirse, refactorizarse ni “mejorarse” como parte de este trabajo.

## 2. Inicio aislado obligatorio

1. Partir del `origin/main` más reciente que contenga este documento. El ancestro mínimo esperado es `941293b1d4658f7f683f1591841a5ab101eebfef`.
2. Confirmar árbol limpio y registrar el hash base exacto.
3. Leer una sola vez `AGENTS.md`, `TODO.md`, `PROJECT_NOTES.md`, `HANDOFF.md`, este documento y la sección Fase 2 del plan maestro.
4. Consultar CodeGraph antes de implementar para localizar contratos y consumidores existentes.
5. Trabajar en una rama y worktree propios, sugerencia: `claude/mobile-frontend-foundation`.
6. No trabajar directamente sobre `main`. No hacer merge, rebase, force-push ni modificar la historia de otra rama.
7. Si el repositorio principal tiene cambios posteriores, no incorporarlos por cuenta propia. Reportar la divergencia al coordinador antes de integrar.

## 3. Rutas con permiso de escritura

Claude puede escribir únicamente:

- `apps/mobile/**`;
- `pnpm-lock.yaml`, solo cuando el cambio sea consecuencia directa de dependencias declaradas en `apps/mobile/package.json`;
- su rama Git dedicada y sus commits locales.

El workspace ya incluye `apps/*`; no se requiere modificar `pnpm-workspace.yaml` para incorporar `apps/mobile`.

No modificar ningún otro archivo sin una autorización humana o del coordinador que nombre expresamente la ruta y el cambio. Si una herramienta genera cambios fuera de las rutas permitidas, descartarlos de forma segura sin tocar cambios ajenos.

## 4. Rutas de solo lectura

Puede inspeccionar, pero nunca modificar:

- `apps/web/**`;
- `apps/kds/**`;
- `apps/api/**`;
- `packages/shared-types/**`;
- `packages/domain/**`;
- `packages/sync-engine/**`;
- `packages/ui/**`;
- `supabase/**`;
- `docs/**`, salvo este documento como instrucción de solo lectura;
- `AGENTS.md`, `TODO.md`, `PROJECT_NOTES.md`, `HANDOFF.md` y el plan maestro;
- configuración raíz, CI y archivos Git.

Web y KDS sirven como referencias de interacción y consumo de contratos, no como código a copiar ciegamente ni como superficies editables.

## 5. Archivos y acciones absolutamente prohibidos

Claude no tiene permiso para:

- escribir código en `apps/api` o crear otro backend;
- modificar o crear endpoints, controllers, servicios, adaptadores, guards, permisos o DTOs del servidor;
- modificar `packages/domain` o duplicar sus reglas en el cliente;
- modificar `packages/shared-types`, inventar tipos equivalentes o relajar sus parsers;
- crear o editar migraciones, tablas, funciones SQL, RLS, grants, roles o seeds;
- acceder directamente a PostgreSQL, Data API, Vault o Storage para datos de negocio;
- modificar credenciales, secretos, archivos `.env`, claves, usuarios, permisos o configuración remota;
- ejecutar migraciones, provisioning, recovery, E2E remotas o mutaciones contra Supabase;
- implementar pagos, caja, reembolsos, fiscalidad, impuestos, CFDI, impresión o proveedores externos;
- implementar sincronización offline, outbox, resolución de conflictos, Service Worker o un servidor LAN;
- modificar Web o KDS, aunque detecte oportunidades de refactor o accesibilidad;
- cambiar `package.json` raíz, `pnpm-workspace.yaml`, `turbo.json`, configuraciones TypeScript/ESLint raíz o workflows;
- introducir Storybook, un design system paralelo, un ORM, una nueva librería de estado global o abstracciones transversales sin solicitud aprobada;
- almacenar o transmitir PAN, CVV, secretos o credenciales reales;
- afirmar que el cliente funciona offline;
- asumir moneda, impuestos, zona horaria, reglas fiscales o proveedor;
- hacer push a `main`, abrir un merge automático o integrar su propia rama.

## 6. Backend consolidado que sí puede consumir

Toda operación de negocio debe pasar por la API Nest existente con access token Bearer. El cliente móvil nunca accede directamente a PostgreSQL.

Capacidades autorizadas para este primer entregable:

1. Supabase Auth existente, usando únicamente URL y clave **publishable** proporcionadas por el entorno:
   - inicio de sesión con email/contraseña;
   - lectura del estado de sesión;
   - cierre de sesión local;
   - nunca usar claves `secret` o `service_role`.
2. `GET /api/v1/access/memberships`:
   - listar membresías activas;
   - validar la respuesta con `parseBranchMembershipListV1` de `@super-restaurant/shared-types`.
3. `POST /api/v1/access/branch`:
   - revalidar el par Restaurant/Branch elegido;
   - nunca confiar solo en estado local o en una opción mostrada.
4. `GET /api/v1/dining/layout?restaurantId=...&branchId=...`:
   - mostrar zonas y mesas de la sucursal autorizada;
   - validar con `parseDiningLayoutV1` de `@super-restaurant/shared-types`.
5. `GET /api/v1/catalog/menu?restaurantId=...&branchId=...`:
   - mostrar el catálogo publicado en modo de solo lectura;
   - validar con `parseMenuCatalogStateV1` de `@super-restaurant/shared-types`;
   - usar precios en enteros de unidad menor y la moneda explícita recibida;
   - no usar una moneda predeterminada.

Todos estos contratos ya existen. Antes de consumirlos, Claude debe confirmar sus nombres exactos en `packages/shared-types` y observar los clientes Web/KDS existentes en modo de solo lectura.

Los endpoints de mutación de Order existen, pero **no están autorizados en este entregable**. La toma de comanda móvil se activará en una unidad posterior después de revisar esta fundación.

## 7. Regla obligatoria ante una necesidad backend

Si una pantalla o interacción necesita un dato, permiso, endpoint, parser, evento o comportamiento que no aparece explícitamente en la sección anterior:

1. detener únicamente esa capacidad;
2. no inventar endpoint, payload, estado, mock productivo, fallback silencioso ni regla de dominio;
3. buscar una sola vez en CodeGraph y en los contratos compartidos para confirmar si ya existe;
4. si no existe o no tiene acceso explícito, registrar una solicitud en `apps/mobile/BACKEND_REQUESTS.md`;
5. continuar solo con trabajo independiente que no dependa de esa solicitud.

Cada solicitud debe contener:

- capacidad exacta requerida;
- pantalla o caso de uso bloqueado;
- contrato o endpoint buscado;
- evidencia de que no está disponible o no está autorizado;
- datos mínimos de entrada/salida que necesita la UI, descritos como necesidad y no como diseño impuesto;
- impacto si se difiere;
- decisión requerida del coordinador.

Claude no debe resolver su propia solicitud modificando backend o contratos. Solo puede consumirla después de que el coordinador la implemente, la consolide y autorice por escrito.

## 8. Entregable funcional autorizado

Construir un primer slice móvil online y de solo lectura con:

### 8.1 Fundación

- `apps/mobile/package.json` y configuración Expo/TypeScript local al app;
- navegación mínima y estructura de pantallas;
- validación fail-closed de configuración pública;
- cliente HTTP pequeño y local al app, sin abstraer otros clientes;
- ningún secreto versionado;
- sin artefactos generados en Git.

### 8.2 Autenticación y scope

- estados de carga inicial, login, credenciales rechazadas, error de red y sesión válida;
- cierre de sesión local;
- listado de membresías activas;
- selección y revalidación exacta Restaurant/Branch;
- estado explícito de membresías vacías o revocadas;
- cambio de sucursal sin mezclar datos de la anterior;
- tokens y datos de una sucursal nunca deben mostrarse en otra.

No inventar persistencia segura de refresh tokens. Si Supabase/Expo requiere elegir un adaptador de almacenamiento no aprobado, mantener la sesión en memoria para este slice y registrar la decisión en `BACKEND_REQUESTS.md` como solicitud de arquitectura.

### 8.3 Mesas y menú de solo lectura

- pantalla de zonas/mesas para la sucursal seleccionada;
- pantalla del menú publicado con categorías, productos, modificadores y precios históricos disponibles;
- moneda visible y proveniente del contrato;
- estados de carga, vacío, error, reintento y éxito;
- no crear, editar, abrir o cerrar mesas;
- no crear, modificar, abrir o cobrar órdenes;
- no editar ni publicar catálogo.

### 8.4 Calidad de interfaz

- targets táctiles de al menos 44×44 px, preferiblemente 48 px para acciones primarias;
- etiquetas accesibles, orden de foco coherente y contraste AA;
- soporte de texto largo sin overflow;
- respeto a reduced motion;
- diseño usable en 390×844 y en una vista tablet razonable;
- mensajes operativos en español coherentes con Web/KDS;
- ningún `alert()`, `confirm()` o `prompt()`.

## 9. Pruebas mínimas

Claude debe añadir y ejecutar pruebas dentro de `apps/mobile` para:

- configuración pública válida e inválida;
- rechazo de clave secret/service-role;
- parsing fail-closed de respuestas;
- aislamiento del par Restaurant/Branch;
- selección, cambio y revocación de sucursal;
- estados de carga, vacío, red y protocolo;
- moneda explícita y cantidades monetarias enteras;
- navegación autenticada/no autenticada;
- cierre de sesión local;
- ausencia de llamadas a endpoints no autorizados.

También debe ejecutar, desde su worktree:

- lint del app;
- typecheck del app;
- tests del app;
- build o export local soportado por Expo sin publicar;
- `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` globales antes de entregar.

Si una compuerta global falla por una causa previa o ajena, debe demostrarlo con el hash base y reportarlo; no modificar el módulo ajeno para hacerla pasar.

## 10. Verificación visual

Verificar en un emulador/simulador o runtime real soportado:

- 390×844;
- una vista tablet;
- teclado y foco cuando la plataforma lo permita;
- contraste;
- reduced motion;
- consola/logs sin warnings o errores del app;
- red sin solicitudes a destinos no autorizados;
- cambio de sucursal sin fuga visual de datos;
- login, revocación, vacío, error y reintento.

No usar una E2E remota ni crear usuarios/fixtures remotos. Si necesita datos poblados, usar fixtures de prueba locales, inequívocamente sintéticas y ubicadas únicamente en archivos de test.

## 11. Entrega obligatoria

Claude debe entregar una rama lista para revisión, no integrada, con:

1. commits convencionales pequeños y el hash de cada uno;
2. diff limitado a las rutas autorizadas;
3. `apps/mobile/CLAUDE_DELIVERY.md` con:
   - hash base y nombre de rama;
   - alcance implementado y alcance omitido;
   - archivos creados/modificados;
   - contratos y endpoints existentes consumidos;
   - dependencias añadidas y justificación;
   - comandos exactos ejecutados y sus resultados;
   - matriz visual por viewport/plataforma;
   - confirmación de que no tocó backend, Web, KDS, dominio, contratos, SQL ni secretos;
   - riesgos, limitaciones y solicitudes pendientes;
   - siguiente acción mínima para el coordinador.
4. `apps/mobile/BACKEND_REQUESTS.md` solo si existe una necesidad real no cubierta; no crearlo vacío;
5. capturas de la verificación visual en `apps/mobile/test-artifacts/` únicamente si son pequeñas y útiles para revisión; no versionar videos o artefactos pesados;
6. árbol limpio al terminar;
7. una comparación final contra el hash base que pruebe que el diff no sale de `apps/mobile/**` y el cambio permitido de `pnpm-lock.yaml`.

Puede crear commits locales en su rama. Solo puede hacer push de esa rama si el humano lo autoriza expresamente en su sesión. Nunca puede hacer push a `main` ni fusionar su trabajo.

## 12. Criterio de aceptación del coordinador

La entrega no se considera integrada ni `DONE` por el solo reporte de Claude. El coordinador debe:

- inspeccionar el diff completo;
- reconsultar CodeGraph;
- verificar que el lockfile cambió solo por `apps/mobile`;
- ejecutar las compuertas globales;
- revisar accesibilidad y comportamiento visual;
- confirmar aislamiento Restaurant/Branch;
- decidir cualquier solicitud backend por separado;
- integrar únicamente con autorización humana.

Si Claude encuentra una contradicción entre este documento y una instrucción humana posterior, debe detenerse y pedir una decisión explícita. No debe interpretar ambigüedad como permiso de ampliar el alcance.
