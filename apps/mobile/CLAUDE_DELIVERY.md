# Entrega — fundación frontend móvil (`apps/mobile`)

Mandato: `docs/CLAUDE_FRONTEND_WORKSTREAM.md`. Entrega lista para revisión, **no
integrada**. No hubo merge, rebase, push ni publicación de rama.

## 1. Punto de partida

- **Hash base del workstream**: `16f30f1fd3aa0cce3f47d7a7bac2dd5d0f354de1`
  (`docs: define isolated Claude frontend workstream`), descendiente del
  ancestro mínimo exigido `941293b1d4658f7f683f1591841a5ab101eebfef`.
- **Base de la cuarta ronda**: `2bcd438ff269623d2ca21bf6cb901b4683dd7aa1`.
- **Base de la tercera ronda**: `541c00dd627f979c7d5ecfde32cf6b06e8af5b94`.
- **Rama**: `claude/super-restaurant-mobile-foundation-2acb73`.
- **Worktree**: `.claude/worktrees/super-restaurant-mobile-foundation-2acb73`.
- Árbol limpio al iniciar y al terminar (sin artefactos ni temporales).
- Archivos operativos leídos una sola vez: `AGENTS.md`, `TODO.md`,
  `PROJECT_NOTES.md`, `HANDOFF.md`, sección Fase 2 del plan maestro y este
  mandato.
- **CodeGraph**: sigue sin estar disponible (no existe `.codegraph/` ni
  herramienta de consulta en el worktree). Sustituto aplicado antes y después de
  editar: inspección dirigida de solo lectura de
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
| (este documento) | `docs(mobile): record the fourth review round` — su hash se reporta al cierre, porque un commit no puede contener el suyo |

## 2. Hallazgos de la cuarta ronda

### Cierre de sesión local inmediato

`endSession()` ya no espera a `auth.signOut()`. `src/sign-out.ts` despacha
`signedOut` **de forma síncrona** y solo después pide al proveedor que borre su
copia, como mejor esfuerzo: una promesa pendiente, un rechazo o incluso un
puerto que lanza de forma síncrona no pueden bloquear la interfaz.

Para que una notificación tardía no deshaga el cierre, el reducer recuerda la
identidad de la sesión cerrada (`closedSessionKey`, nunca renderizada) y rechaza
cualquier `sessionObserved` que la traiga de vuelta, incluso después de un
inicio de sesión posterior. Un acceso nuevo emite un token nuevo y entra
limpio.

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

## 3. Hallazgos de la tercera ronda

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
raíz; ver la sección 2.

### 6 — Espacio final

Eliminado el espacio al final de la línea 48 de este documento; `git diff
--check` no reporta errores de espacios en toda la rama.

## 4. Alcance implementado

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

## 5. Archivos

Todos dentro de `apps/mobile/**`.

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

No se versionaron capturas: la evidencia visual se resume en la sección 8.

## 6. Contratos y endpoints consumidos

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

## 7. Comandos ejecutados y resultados

Entorno: Windows 10, pnpm 11.19.0 vía Corepack y **Node v24.19.0**, la versión
que declara `engines.node`. El binario oficial se descargó de
`https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip` a un directorio
temporal de la sesión y se verificó por SHA-256
(`57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`, coincide
con `SHASUMS256.txt`). No se instaló nada en el sistema ni se cambió
configuración del repositorio. Ya no aparece el aviso `Unsupported engine`.

Del app:

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile lint` | ✅ 0 errores, 0 warnings |
| `pnpm --filter @super-restaurant/mobile typecheck` | ✅ sin errores |
| `pnpm --filter @super-restaurant/mobile test` | ✅ **74 pruebas, 0 fallos** (config 5, session 7, supabase-auth 2, lifecycle 4, revalidation 6, cierre de sesión 5, aislamiento de bundle 2, money 4, cliente 16, estado 23) |
| `pnpm --filter @super-restaurant/mobile build` | ✅ `tsc --noEmit` + `expo export --platform android` → bundle Hermes de 2.17 MB en `dist/` (ignorado por Git) |
| `pnpm --filter @super-restaurant/mobile exec expo install --check` | ✅ `Dependencies are up to date`, exit 0 (con `expo@57.0.20`) |

Globales, **sin caché** (`--force`):

| Comando | Resultado |
| --- | --- |
| `pnpm lint --force` | ✅ 8/8 tareas, 0 en caché |
| `pnpm typecheck --force` | ✅ 11/11 tareas, 0 en caché |
| `pnpm test --force` | ✅ 11/11 tareas, 0 en caché |
| `pnpm build --force` | ✅ 8/8 tareas, 0 en caché |

`git diff --check` contra el hash base: sin errores de espacios.

Nota operativa: Turbo necesita el binario `pnpm` en `PATH`; en este entorno solo
existe Corepack, así que se usó un shim temporal en el directorio scratchpad de
la sesión. No se modificó ninguna configuración del repositorio.

## 8. Matriz de validación visual

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
| Aislamiento del arnés en el bundle distribuible | — | ✅ El `.hbc` contiene "Cambiar sucursal", "Acceso sin confirmar" y "Sin sucursales asignadas", y **no** contiene "Ir a segundo plano", "Reiniciar arn", "harness", "HARNESS_SESSION_UNREADABLE", "HARNESS_SIGN_OUT_FAILED", "operador.sintetico" ni `sb_publishable_fixture`. Las cadenas con acentos no se buscan porque Hermes las almacena en UTF-16; se usan controles ASCII de ambos lados |

Notas de método: el panel del navegador automatizado no entrega foco real de
ventana, así que el anillo se comprueba despachando `focusin`/`focusout` y
midiendo el borde. El estado transitorio de revalidación se capturó por texto
del DOM —dura menos de lo que tarda una captura— mientras que el estado de
fallo, que persiste hasta reintentar, sí quedó capturado en pantalla.

## 9. Confirmación de fronteras

Comparado con `16f30f1fd3aa0cce3f47d7a7bac2dd5d0f354de1`, el diff toca
exclusivamente `apps/mobile/**` y `pnpm-lock.yaml` (este último solo por el
primer corte). No se modificó ni creó nada en `apps/api`, `apps/web`,
`apps/kds`, `packages/domain`, `packages/shared-types`, `supabase/**`,
migraciones, SQL, RLS, permisos, credenciales, `.env`, configuración raíz
—incluido `pnpm-workspace.yaml`—, CI ni documentación operativa. No se ejecutó
ninguna operación contra Supabase, PostgreSQL, Data API o Vault, ni ninguna E2E
remota; no se crearon usuarios ni fixtures remotas, y no se reutilizó ningún
UUID documentado en el historial del repositorio. El flujo P1 Web/KDS/caja en
REVIEW quedó intacto.

## 10. Limitaciones, riesgos y solicitudes pendientes

1. **Sesión sin persistencia** (SR-MOB-001): al cerrar la app hay que volver a
   autenticarse. La renovación en memoria ya existe y es un asunto distinto.
2. **Sin verificación en Android/iOS reales**: no hay emulador ni SDK nativo en
   este entorno. El bundle Android se genera, pero no se ejecutó en dispositivo;
   `react-native-safe-area-context` y la entrega real de eventos de `AppState`
   siguen sin comprobarse en hardware.
3. **`user.id` se exige como UUID**: es lo que emite Supabase Auth. Un proveedor
   que emitiera otro formato haría fallar el acceso de forma visible, nunca
   silenciosa.
4. **CodeGraph no disponible**: análisis por inspección dirigida.
5. **Divergencia de versiones de React/React Native** respecto de Web/KDS,
   impuesta por Expo SDK 57 y aislada en este app.
6. **Parser local para `POST /api/v1/access/branch`** (SR-MOB-002).
7. **Turno operativo** (SR-MOB-003) y **origen de API para dispositivos
   físicos** (SR-MOB-004) siguen pendientes de decisión.
8. **Verificación contra Auth y Nest reales** (SR-MOB-005): el arnés la
   anticipa, no la sustituye.

## 11. Siguiente acción recomendada

1. Revisar el diff completo y confirmar que `pnpm-lock.yaml` solo cambió en el
   primer corte y solo por `apps/mobile`.
2. Ejecutar el arnés (`harness/README.md`) para reproducir la matriz visual y
   después la app real contra un entorno propio.
3. Decidir SR-MOB-001 a SR-MOB-005 por separado; la comanda móvil no debe
   abrirse antes de resolver SR-MOB-001 y SR-MOB-003.
4. Solo con aprobación humana, integrar la rama y actualizar `TODO.md`. Este
   workstream no cambió el estado de ninguna tarea.
