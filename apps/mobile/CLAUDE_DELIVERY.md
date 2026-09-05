# Entrega — fundación frontend móvil (`apps/mobile`)

Mandato: `docs/CLAUDE_FRONTEND_WORKSTREAM.md`. Entrega lista para revisión, **no
integrada**. No hubo merge, rebase, push ni publicación de rama.

## 1. Punto de partida

- **Hash base del workstream**: `16f30f1fd3aa0cce3f47d7a7bac2dd5d0f354de1`
  (`docs: define isolated Claude frontend workstream`), descendiente del
  ancestro mínimo exigido `941293b1d4658f7f683f1591841a5ab101eebfef`.
- **Base de esta ronda de correcciones**: `6ac5ccec8cd320a2a6853dbdde7da5c862504d07`.
- **Rama**: `claude/super-restaurant-mobile-foundation-2acb73`.
- **Worktree**: `.claude/worktrees/super-restaurant-mobile-foundation-2acb73`.
- Árbol limpio al iniciar y al terminar (sin artefactos ni temporales).
- Archivos operativos leídos una sola vez: `AGENTS.md`, `TODO.md`,
  `PROJECT_NOTES.md`, `HANDOFF.md`, sección Fase 2 del plan maestro y este
  mandato.
- **CodeGraph**: sigue sin estar disponible en este entorno. Se verificó de
  nuevo antes y después de editar: no existe `.codegraph/` en el worktree (está
  ignorado por `.gitignore`), no hay índice ni herramienta de consulta, y por lo
  tanto `apps/mobile` no puede estar indexado. Sustituto aplicado: inspección
  dirigida de solo lectura de `packages/shared-types/src/index.ts`,
  `apps/api/src/*.controller.ts`, `apps/web/src/lib/branch-selection.ts`,
  `apps/kds/src/*` y, dentro de `apps/mobile`, revisión manual de consumidores
  de cada símbolo tocado (`MOBILE_AUTH_OPTIONS`, `MobileAuthPort`,
  `reduceMobileState`, `MobileState`, `parseAuthorizedMobileBranch`,
  `App`, `Root`). Queda registrado como limitación.

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
| (este documento) | `docs(mobile): record review fixes and evidence` — su hash se reporta al cierre, porque un commit no puede contener el suyo |

## 2. Hallazgos de revisión resueltos en esta ronda

### P1-1 — Revalidación al volver al primer plano

`src/lifecycle.ts` (puro, sin React Native) decide la política; 
`src/ui/app-state-lifecycle.ts` la conecta a `AppState`. Al volver al primer
plano:

1. `revalidationStarted` **descarta mesas y menú antes de cualquier petición**, y
   bloquea toda lectura de sucursal (`canReadBranchData`);
2. se relee la sesión: si ya no existe, la sesión termina localmente con el
   estado explícito `sessionEnded`;
3. si existe, se revalida el par exacto Restaurant/Branch contra
   `POST /api/v1/access/branch`;
4. un rechazo de autorización termina en `branchRevoked`, sin sucursal activa y
   con la lista de membresías forzada a releerse;
5. un fallo de red o protocolo deja un estado explícito con reintento y mantiene
   los datos descartados;
6. los eventos repetidos no duplican peticiones: `shouldRevalidateOnForeground`
   solo acepta `background|inactive → active`, y `revalidationStarted` es
   idempotente mientras hay una revalidación en curso.

Además, un token renovado ya no reinicia la aplicación: `sessionObserved`
conserva sucursal y datos cuando el operador es el mismo, y limpia todo cuando
cambia.

### P1-2 — Renovación de sesión en memoria

`src/session.ts` mantiene `persistSession: false` y sigue sin adaptador de
almacenamiento, pero ahora usa `autoRefreshToken: true`. El ticker lo controla el
ciclo de vida: `MobileAuthPort` expone `startAutoRefresh`/`stopAutoRefresh` y
`src/supabase-auth.ts` los delega en `client.auth.startAutoRefresh()` /
`stopAutoRefresh()`, presentes en la API instalada
(`@supabase/auth-js` 2.112.4, `GoTrueClient.d.ts` líneas 2321 y 2352). El
adaptador arranca el ticker al montar, lo detiene al desmontar y lo pausa o
reanuda con cada transición de `AppState`.

### P1-3 — Evidencia visual autenticada

`harness/` contiene un arnés local con fixtures sintéticas. Metro solo lo
resuelve con `MOBILE_VISUAL_HARNESS=1`; ver sección 7 y la prueba de aislamiento.

### P2-4 — Parser fail-closed

`parseAuthorizedMobileBranch` iguala las garantías del parser de `apps/web`:
prototipo `Object.prototype`/`null`, claves exactas por `Reflect.ownKeys`,
solo descriptores de datos (un getter se rechaza sin invocarse), cualquier
excepción de proxy termina en `undefined`, `roles` denso, no vacío, sin
duplicados ni códigos desconocidos, y UUID normalizados a minúsculas de forma
consistente con la comparación de scope.

## 3. Alcance implementado

Primer slice móvil **online y de solo lectura**:

- fundación Expo/React Native/TypeScript local al app;
- validación fail-closed de la configuración pública, con pantalla explícita
  cuando es inválida y sin ninguna llamada de red en ese estado;
- acceso con Supabase Auth (email/contraseña), sesión en memoria con renovación
  automática en primer plano y cierre de sesión **local**;
- revalidación de sesión y alcance al volver al primer plano;
- listado de membresías activas y estado explícito de "sin sucursales asignadas";
- selección y **revalidación exacta** del par Restaurant/Branch;
- pantalla de zonas y mesas de la sucursal autorizada;
- pantalla del menú publicado con moneda tomada del contrato;
- estados de carga, vacío, error, reintento y éxito en cada lectura;
- cambio de sucursal y revocación sin fuga de datos de la sucursal anterior.

### Alcance omitido deliberadamente

- toda mutación: órdenes, comanda, pagos, caja, mesas y catálogo;
- offline, outbox, sincronización, Realtime, push e impresión;
- turno operativo (`BACKEND_REQUESTS.md`, SR-MOB-003);
- persistencia de sesión en el dispositivo (SR-MOB-001);
- cualquier cambio en backend, dominio, contratos compartidos, SQL, Web o KDS.

## 4. Archivos

Todos dentro de `apps/mobile/**`. `pnpm-lock.yaml` **no cambió en esta ronda**
(no se añadieron ni movieron dependencias).

**Nuevos en esta ronda**: `src/lifecycle.ts`, `src/lifecycle.test.ts`,
`src/ui/app-state-lifecycle.ts`, `src/supabase-auth.test.ts`,
`src/bundle-isolation.test.ts`, `harness/harness-server.ts`,
`harness/harness-root.tsx`, `harness/README.md`.

**Modificados en esta ronda**: `src/session.ts`, `src/session.test.ts`,
`src/auth-port.ts`, `src/supabase-auth.ts`, `src/mobile-state.ts`,
`src/mobile-state.test.ts`, `src/mobile-client.ts`, `src/mobile-client.test.ts`,
`src/test-fixtures.ts`, `src/ui/app.tsx`, `src/ui/root.tsx`,
`src/ui/components.tsx`, `src/ui/branch-screen.tsx`, `metro.config.js`,
`package.json`, `tsconfig.json`, `tsconfig.test.build.json`,
`CLAUDE_DELIVERY.md`, `BACKEND_REQUESTS.md`.

**Del corte anterior, sin cambios**: `index.ts`, `app.json`, `babel.config.js`,
`.env.example`, `src/config.ts`, `src/money.ts`, `src/ui/theme.ts`,
`src/ui/sign-in-screen.tsx`, `src/ui/tables-screen.tsx`,
`src/ui/menu-screen.tsx` y sus pruebas.

No se versionaron capturas: la evidencia visual se resume en la sección 7.

## 5. Contratos y endpoints consumidos

Todos existentes y autorizados por el mandato §6. El cliente móvil nunca accede
a PostgreSQL ni a la Data API.

| Capacidad | Uso | Validación |
| --- | --- | --- |
| Supabase Auth (URL + clave **publishable**) | `signInWithPassword`, `getSession`, `onAuthStateChange`, `signOut({ scope: "local" })`, `startAutoRefresh`, `stopAutoRefresh` | `toMobileSession` acepta solo un access token no vacío y acotado |
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

## 6. Comandos ejecutados y resultados

Entorno: Windows 10, pnpm 11.19.0 vía Corepack, **Node v22.20.0**. El
repositorio declara `engines.node: 24.19.0`; pnpm emite `[WARN] Unsupported
engine` en cada comando. Es una condición previa del entorno, no la introduce
este trabajo, y todas las compuertas pasaron igualmente.

Del app:

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile lint` | ✅ 0 errores, 0 warnings |
| `pnpm --filter @super-restaurant/mobile typecheck` | ✅ sin errores |
| `pnpm --filter @super-restaurant/mobile test` | ✅ **59 pruebas, 0 fallos** (config 5, session 5, supabase-auth 2, lifecycle 4, aislamiento de bundle 2, money 4, cliente 16, estado 21) |
| `pnpm --filter @super-restaurant/mobile build` | ✅ `tsc --noEmit` + `expo export --platform android` → bundle Hermes de 2.17 MB en `dist/` (ignorado por Git) |
| `pnpm --filter @super-restaurant/mobile exec expo install --check` | ⚠️ 1 aviso: `expo@57.0.19 - expected version: ~57.0.20`. Todo lo demás alineado. Evidencia de por qué no se subió: `expo@57.0.20` y `@expo/cli@57.0.22` se publicaron hace menos de 24 h y pnpm exige registrarlos en `minimumReleaseAgeExclude` de `pnpm-workspace.yaml` (comprobado en un proyecto aislado fuera del repositorio, que añadió `@expo/cli@57.0.22`, `expo-modules-core@57.0.16`, `expo-modules-jsi@57.0.8` y `expo@57.0.20`). Ese archivo es configuración raíz y está fuera del alcance autorizado. |

Globales, **sin caché** (`--force`), desde el worktree:

| Comando | Resultado |
| --- | --- |
| `pnpm lint --force` | ✅ 8/8 tareas, 0 en caché |
| `pnpm typecheck --force` | ✅ 11/11 tareas, 0 en caché |
| `pnpm test --force` | ✅ 11/11 tareas, 0 en caché |
| `pnpm build --force` | ✅ 8/8 tareas, 0 en caché |

Nota operativa: Turbo necesita el binario `pnpm` en `PATH`; en este entorno solo
existe Corepack, así que se usó un shim temporal en el directorio scratchpad de
la sesión. No se modificó ninguna configuración del repositorio.

## 7. Matriz de validación visual

Runtime: **Expo web (react-native-web)** con Metro local, controlado con
navegador real, usando el arnés (`MOBILE_VISUAL_HARNESS=1`). Las respuestas son
fixtures sintéticas locales; no se usó ninguna credencial, usuario o dato
remoto, y el cliente, los parsers compartidos y la máquina de estados son los
reales.

| Caso | Viewport | Resultado |
| --- | --- | --- |
| Acceso: estado inicial y botón deshabilitado sin credenciales | 390×844 | ✅ |
| Acceso: credenciales rechazadas | 390×844 | ✅ "Correo o contraseña incorrectos." en `role="alert"` |
| Acceso correcto → selección de sucursal | 390×844 | ✅ Dos membresías sintéticas con rol visible |
| Mesas de la sucursal 1 | 390×844 | ✅ Zona "Terraza", mesa, capacidad y forma |
| Menú de la sucursal 1 | 390×844 | ✅ "Precios en XTS, expresados en unidades menores enteras", `12,500 u.m. · XTS` |
| Cambio a la sucursal 2 | 390×844 | ✅ "Salón principal" y `9,900 u.m. · XTS`; **cero rastros** de "Terraza" o `12,500` |
| Segundo plano → revocación → primer plano | 390×844 | ✅ Termina en "Tu acceso a la sucursal seleccionada fue revocado." + "Sin sucursales asignadas"; sin fuga de datos previos |
| Segundo plano → sesión expirada → primer plano | 390×844 | ✅ Vuelve a la pantalla de acceso con "Tu sesión se cerró en este dispositivo."; sin fuga |
| Revalidación en curso (escenario lento) | 390×844 | ✅ "Revalidando tu acceso a esta sucursal…" + "Confirmando sesión y sucursal…", sin datos anteriores en pantalla |
| Revalidación con red caída + reintento | 390×844 | ✅ "No se pudo revalidar tu acceso" + "Reintentar"; el reintento restaura mesas |
| Membresías vacías, red caída y reintento | 390×844 | ✅ Estados "Sin sucursales asignadas", "No se pudieron cargar tus sucursales" y recuperación |
| Ticker de sesión por ciclo de vida | 390×844 | ✅ montaje = 1, segundo plano = 0, primer plano = 1 |
| Token renovado con sucursal abierta | 390×844 | ✅ Sucursal y datos intactos tras `sessionObserved` |
| Vista tablet (mesas y menú) | 1024×768 | ✅ Dos columnas de mesas, sin desbordamiento |
| Desbordamiento horizontal | 390×844 y 1024×768 | ✅ `scrollWidth == innerWidth` en ambos |
| Objetivos táctiles (pantalla autenticada) | 390×844 | ✅ Todos los controles 48 px |
| Contraste medido sobre el render autenticado | 390×844 | ✅ 7.03 · 7.45 · 7.66 · 8.68 · 16.31 · 17.79 : 1 — todos ≥ AA |
| Foco visible por teclado | 390×844 | ✅ Anillo de 3 px `#0b3a7d` en botones, filas de sucursal y pestañas |
| Etiquetas accesibles y orden de foco | 390×844 | ✅ `aria-label` en cada control; orden encabezado → acciones → pestañas |
| Consola | ambos | ✅ Sin warnings ni errores del app (solo los avisos de desarrollo de React/RN) |
| Red | ambos | ✅ Solo el bundle local; ningún destino externo |
| Aislamiento del arnés en el bundle distribuible | — | ✅ El `.hbc` de `expo export` contiene "Cambiar sucursal" y "Sin sucursales asignadas", y **no** contiene "Ir a segundo plano", "DATOS SINT", "Reiniciar arn", "harness" ni `sb_publishable_fixture` |

Detalle sobre el foco: la verificación automatizada ejecuta el navegador en un
panel sin foco real de ventana, por lo que `element.focus()` no entrega el
evento; el anillo se comprobó despachando `focusin`/`focusout` reales sobre cada
control y midiendo el borde resultante (1 px → 3 px → 1 px). Este hallazgo
corrigió un defecto propio: `Pressable` solo informa `pressed`, y
react-native-web elimina el `outline` del navegador, de modo que antes de esta
ronda los botones y pestañas **no** mostraban foco visible. Ahora
`useFocusRing()` lo hace explícito.

## 8. Confirmación de fronteras

Comparado con `16f30f1fd3aa0cce3f47d7a7bac2dd5d0f354de1`, el diff toca
exclusivamente `apps/mobile/**` y `pnpm-lock.yaml` (este último solo por el
corte anterior; en esta ronda no cambió).

No se modificó ni creó nada en `apps/api`, `apps/web`, `apps/kds`,
`packages/domain`, `packages/shared-types`, `supabase/**`, migraciones, SQL, RLS,
permisos, credenciales, `.env`, configuración raíz (incluido
`pnpm-workspace.yaml`), CI ni documentación operativa. No se ejecutó ninguna
operación contra Supabase, PostgreSQL, Data API o Vault, ni ninguna E2E remota.
No se crearon usuarios ni fixtures remotas, y no se reutilizó ningún UUID
documentado en el historial del repositorio: las fixtures locales son
identificadores fabricados propios de este app. El flujo P1 Web/KDS/caja en
REVIEW quedó intacto.

## 9. Limitaciones, riesgos y solicitudes pendientes

1. **Sesión sin persistencia** (SR-MOB-001): al cerrar la app hay que volver a
   autenticarse. La renovación en memoria ya existe y es un asunto distinto.
2. **Sin verificación en Android/iOS reales**: no hay emulador ni SDK nativo en
   este entorno. El bundle Android se genera correctamente, pero no se ejecutó
   en dispositivo; `react-native-safe-area-context` es un módulo nativo y su
   comportamiento en dispositivo sigue sin comprobarse.
3. **La revalidación por `AppState` se validó con un puerto controlado** en el
   arnés y con pruebas puras de la política. La entrega real de eventos de
   `AppState` en Android/iOS depende del punto 2.
4. **CodeGraph no disponible**: análisis por inspección dirigida.
5. **`expo install --check` reporta `expo@57.0.19` frente a `~57.0.20`**: subirlo
   exige tocar `pnpm-workspace.yaml`, fuera de alcance (ver sección 6).
6. **Divergencia de versiones de React/React Native** respecto de Web/KDS,
   impuesta por Expo SDK 57 y aislada en este app.
7. **Parser local para `POST /api/v1/access/branch`** (SR-MOB-002): ahora
   equivalente al de `apps/web`, pero sigue siendo una segunda copia.
8. **Turno operativo** (SR-MOB-003) y **origen de API para dispositivos
   físicos** (SR-MOB-004) siguen pendientes de decisión.
9. **Node 22.20.0 frente a `engines.node` 24.19.0**: todas las compuertas
   pasaron, pero no en la versión declarada.

## 10. Siguiente acción recomendada

1. Revisar el diff completo y confirmar que `pnpm-lock.yaml` solo cambió en el
   corte anterior y solo por `apps/mobile`.
2. Ejecutar las compuertas globales en el entorno del coordinador (Node
   24.19.0) y, si lo desea, subir `expo` a `57.0.20` con el ajuste
   correspondiente de `pnpm-workspace.yaml`.
3. Ejecutar el arnés (`harness/README.md`) para reproducir la matriz visual, y
   después la app real contra un entorno propio.
4. Decidir SR-MOB-001 a SR-MOB-005 por separado; la comanda móvil no debe
   abrirse antes de resolver SR-MOB-001 y SR-MOB-003.
5. Solo con aprobación humana, integrar la rama y actualizar `TODO.md`. Este
   workstream no cambió el estado de ninguna tarea.
