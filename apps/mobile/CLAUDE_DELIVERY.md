# Entrega — fundación frontend móvil (`apps/mobile`)

Mandato: `docs/CLAUDE_FRONTEND_WORKSTREAM.md`. Entrega lista para revisión, **no
integrada**. No hubo merge, rebase, push ni publicación de rama.

## 1. Punto de partida

- **Hash base**: `16f30f1fd3aa0cce3f47d7a7bac2dd5d0f354de1`
  (`docs: define isolated Claude frontend workstream`), descendiente del
  ancestro mínimo exigido `941293b1d4658f7f683f1591841a5ab101eebfef`.
- **Rama**: `claude/super-restaurant-mobile-foundation-2acb73`.
- **Worktree**: `.claude/worktrees/super-restaurant-mobile-foundation-2acb73`.
- Árbol limpio al iniciar y al terminar (sin artefactos ni temporales).
- Archivos operativos leídos una sola vez: `AGENTS.md`, `TODO.md`,
  `PROJECT_NOTES.md`, `HANDOFF.md`, sección Fase 2 del plan maestro y este
  mandato.
- **CodeGraph**: no está disponible en este entorno (`.codegraph/` está ignorado
  y no existe índice ni herramienta en el worktree). En su lugar se hizo
  inspección dirigida y de solo lectura de `packages/shared-types/src/index.ts`,
  `apps/api/src/*.controller.ts`, `apps/web/src/lib/*` y `apps/kds/src/*` para
  confirmar nombres de contrato, rutas y patrones de cliente. Queda registrado
  como limitación.

### Commits de la rama

| Hash | Mensaje |
| --- | --- |
| `7ee56ff5227e3216d6adb04790cb390fc42d494b` | `chore(mobile): scaffold Expo and TypeScript configuration` |
| `b1bdfbbf7509a2f9cb6a78ef3dedf6037c0a593f` | `feat(mobile): add fail-closed configuration, session and read-only API client` |
| `7f6cc1d2431c30279e5eeec9095820673a39dda2` | `feat(mobile): add sign-in, branch, tables and menu read-only screens` |
| (este documento) | `docs(mobile): record delivery and backend requests` — su hash se reporta al cierre, porque un commit no puede contener el suyo |

## 2. Alcance implementado

Primer slice móvil **online y de solo lectura**:

- fundación Expo/React Native/TypeScript local al app;
- validación fail-closed de la configuración pública, con pantalla explícita
  cuando es inválida y sin ninguna llamada de red en ese estado;
- acceso con Supabase Auth (email/contraseña), estado de sesión y cierre de
  sesión **local**;
- listado de membresías activas desde Nest y estado explícito de "sin sucursales
  asignadas";
- selección y **revalidación exacta** del par Restaurant/Branch contra Nest;
- pantalla de zonas y mesas de la sucursal autorizada;
- pantalla del menú publicado (categorías, productos, impuestos declarados,
  grupos de modificadores y opciones) con moneda tomada del contrato;
- estados de carga, vacío, error, reintento y éxito en cada lectura;
- cambio de sucursal que descarta los datos de la anterior en la misma
  transición.

### Alcance omitido deliberadamente

- toda mutación: órdenes, comanda, pagos, caja, mesas y catálogo;
- offline, outbox, sincronización, Realtime, push e impresión;
- turno operativo (ver `BACKEND_REQUESTS.md`, SR-MOB-003);
- persistencia de sesión en el dispositivo (SR-MOB-001);
- cualquier cambio en backend, dominio, contratos compartidos, SQL, Web o KDS.

## 3. Archivos creados

Todos dentro de `apps/mobile/**` (30 archivos), más `pnpm-lock.yaml`.

**Configuración del app**: `package.json`, `tsconfig.json`,
`tsconfig.test.build.json`, `app.json`, `babel.config.js`, `metro.config.js`,
`.env.example`, `index.ts`.

**Lógica (probada)**: `src/config.ts`, `src/money.ts`, `src/session.ts`,
`src/auth-port.ts`, `src/supabase-auth.ts`, `src/mobile-client.ts`,
`src/mobile-state.ts`.

**Pruebas y fixtures sintéticas**: `src/config.test.ts`, `src/money.test.ts`,
`src/session.test.ts`, `src/mobile-client.test.ts`, `src/mobile-state.test.ts`,
`src/test-fixtures.ts` (solo lo consumen las pruebas; no lo importa ningún
módulo de la aplicación).

**Interfaz**: `src/ui/root.tsx`, `src/ui/app.tsx`, `src/ui/sign-in-screen.tsx`,
`src/ui/branch-screen.tsx`, `src/ui/tables-screen.tsx`, `src/ui/menu-screen.tsx`,
`src/ui/components.tsx`, `src/ui/theme.ts`.

**Documentos**: `CLAUDE_DELIVERY.md` (este archivo), `BACKEND_REQUESTS.md`.

No se crearon `apps/mobile/test-artifacts/`: la evidencia visual se resume en la
matriz de la sección 7 y no se versionaron capturas para no agregar binarios.

## 4. Contratos y endpoints consumidos

Todos existentes y autorizados por el mandato §6. El cliente móvil nunca accede
a PostgreSQL ni a la Data API.

| Capacidad | Uso | Validación |
| --- | --- | --- |
| Supabase Auth (URL + clave **publishable**) | `signInWithPassword`, `getSession`, `onAuthStateChange`, `signOut({ scope: "local" })` | `toMobileSession` acepta solo un access token no vacío y acotado |
| `GET /api/v1/access/memberships` | Lista de membresías activas | `parseBranchMembershipListV1` |
| `POST /api/v1/access/branch` | Revalidación del par elegido | Parser local estricto + el par devuelto debe ser idéntico al solicitado (ver SR-MOB-002) |
| `GET /api/v1/dining/layout?restaurantId=…&branchId=…` | Zonas y mesas | `parseDiningLayoutV1` + `scope` devuelto igual al solicitado |
| `GET /api/v1/catalog/menu?restaurantId=…&branchId=…` | Catálogo publicado | `parseMenuCatalogStateV1` + `scope` devuelto igual al solicitado |

`MOBILE_API_PATHS` es la única lista de rutas permitidas y `request()` rechaza
cualquier otra antes de tocar la red. Una prueba fija la superficie exportada del
cliente para que no aparezcan mutaciones de Order, pago o caja.

Dinero: se muestra el entero en unidad menor con la moneda ISO que entrega el
contrato (`formatMinorAmount` → `"12,500 u.m. · XTS"`, misma convención que
`apps/web`). No hay moneda por defecto, no hay coma flotante y un valor no
entero se rechaza en lugar de redondearse.

## 5. Dependencias añadidas y justificación

Declaradas solo en `apps/mobile/package.json`:

| Paquete | Versión | Motivo |
| --- | --- | --- |
| `expo` | 57.0.19 | SDK y runtime del app |
| `react-native` | 0.86.3 | Versión que empaqueta Expo SDK 57 |
| `react` / `react-dom` | 19.2.3 | Versiones que empaqueta Expo SDK 57 |
| `react-native-web` | 0.21.2 | Runtime web de Expo, usado para la verificación visual |
| `react-native-safe-area-context` | 5.7.0 | Áreas seguras (notch); versión de SDK 57 |
| `expo-status-bar` | 57.0.1 | Estilo de barra de estado |
| `@supabase/supabase-js` | 2.112.4 | Misma versión que `apps/api` y `apps/kds` |
| `@super-restaurant/shared-types` | workspace | Parsers y tipos versionados |
| `@super-restaurant/config`, `@types/node` 26.3.0, `@types/react` 19.2.18 (dev) | — | Configuración compartida y tipos, iguales a `apps/kds` |

Notas:

- primero se fijaron `react-native` 0.87.1 y `react` 19.2.8 (la versión que usan
  Web/KDS); `@expo/metro-config` de SDK 57 falla con RN 0.87 porque busca
  `react-native/rn-get-polyfills`, que ya no existe en ese paquete. Se alinearon
  las versiones a `bundledNativeModules.json` de Expo 57. Es la única divergencia
  de versión respecto de los otros clientes y está aislada en este app;
- se probó `@expo/metro-runtime` y se retiró: arrastra `whatwg-fetch`, que no
  está declarado y no resuelve bajo pnpm. No hace falta para `expo start --web`;
- no se añadió librería de navegación ni de estado global: la navegación se deriva
  del estado autorizado (`mobileScreen`) y el estado vive en un reducer puro.

**Lockfile**: `pnpm-lock.yaml` es el único archivo modificado fuera de
`apps/mobile/**`. Comparado con el hash base: 395 paquetes añadidos, **0
eliminados**, y ningún otro importer cambió de especificador o de versión; sus
líneas solo ganaron sufijos de peers que ahora existen en el árbol
(`supports-color`, `terser`, `yaml`, `@babel/core`, `babel-plugin-react-compiler`).
Todo el cambio deriva de las dependencias declaradas por
`apps/mobile/package.json`.

## 6. Comandos ejecutados y resultados

Entorno: Windows 10, pnpm 11.19.0 vía Corepack, Node **v22.20.0**. El repositorio
declara `engines.node: 24.19.0`; pnpm emite `[WARN] Unsupported engine` en cada
comando. Es una condición previa del entorno, no la introduce este trabajo, y
todas las compuertas pasaron igualmente.

Del app:

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @super-restaurant/mobile lint` | ✅ 0 errores, 0 warnings |
| `pnpm --filter @super-restaurant/mobile typecheck` | ✅ sin errores |
| `pnpm --filter @super-restaurant/mobile test` | ✅ 36 pruebas, 0 fallos (config 5, session 4, money 4, cliente 11, estado 12) |
| `pnpm --filter @super-restaurant/mobile build` | ✅ `tsc --noEmit` + `expo export --platform android` → bundle Hermes de 2.2 MB en `dist/` (ignorado por Git) |

Globales, desde el worktree:

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | ✅ 8/8 tareas |
| `pnpm typecheck` | ✅ 11/11 tareas |
| `pnpm test` | ✅ 11/11 tareas, 0 fallos |
| `pnpm build` | ✅ 8/8 tareas |

Nota operativa: Turbo necesita el binario `pnpm` en `PATH`; en este entorno solo
existe Corepack, así que se usó un shim temporal en el directorio scratchpad de
la sesión. No se modificó ninguna configuración del repositorio.

## 7. Matriz de validación visual

Runtime: **Expo web (react-native-web)** servido por Metro en local, controlado
con navegador real. No hubo emulador Android/iOS disponible en este entorno (ver
limitaciones).

| Caso | Viewport | Resultado |
| --- | --- | --- |
| Configuración pública ausente → pantalla "Configuración no válida" | 390×844 | ✅ Explica el fallo; **cero** solicitudes de red además del bundle local |
| Acceso, estado inicial | 390×844 | ✅ Botón "Ingresar" deshabilitado hasta que hay correo y contraseña |
| Acceso, credenciales capturadas | 390×844 | ✅ Campos con etiqueta accesible; sin desbordamiento |
| Acceso, servicio inalcanzable | 390×844 | ✅ Banner `role="alert"`: "No se pudo contactar al servicio de acceso…" |
| Acceso, vista tablet | 1024×768 | ✅ Contenido centrado, `maxWidth` 520, sin desbordamiento horizontal |
| Desbordamiento horizontal | 390×844 y 1024×768 | ✅ `scrollWidth == innerWidth` en ambos |
| Objetivos táctiles | 390×844 | ✅ Botón primario 48 px; campos 48 px |
| Contraste (medido sobre el render) | 390×844 | ✅ Texto principal 16.31:1, secundario 7.03:1, acción 8.68:1, error 6.63:1 — todos ≥ AA |
| Teclado y foco | 390×844 | ✅ Orden Correo → Contraseña → Ingresar; foco visible; etiquetas accesibles correctas |
| Movimiento | 390×844 | ✅ Cero animaciones propias; el único `transition` de la página (0.05 s de padding) lo inyecta el contenedor raíz de react-native-web. El indicador de carga se sustituye por texto cuando el sistema pide reduced motion |
| Consola | ambos | ✅ Sin warnings ni errores del app; el único `error` es el `ERR_NAME_NOT_RESOLVED` provocado a propósito con un host Supabase sintético |
| Red | ambos | ✅ Solo `http://localhost:<puerto>` (bundle) y el origen Supabase configurado. Ningún destino no autorizado |

**No verificadas visualmente**: `BranchScreen`, `TablesScreen` y `MenuScreen`
requieren una sesión de Auth válida y respuestas de Nest; ver limitaciones y
`BACKEND_REQUESTS.md` SR-MOB-005. Su comportamiento sí está cubierto por pruebas
(aislamiento de sucursal, cambio, revocación, vacío, error, reintento, moneda).

## 8. Confirmación de fronteras

Comparado contra `16f30f1fd3aa0cce3f47d7a7bac2dd5d0f354de1`, el diff toca
exclusivamente:

- `apps/mobile/**` (30 archivos nuevos);
- `pnpm-lock.yaml`, por dependencias declaradas en `apps/mobile/package.json`.

No se modificó ni creó nada en `apps/api`, `apps/web`, `apps/kds`,
`packages/domain`, `packages/shared-types`, `supabase/**`, migraciones, SQL, RLS,
permisos, credenciales, `.env`, configuración raíz, CI ni documentación
operativa (`AGENTS.md`, `TODO.md`, `PROJECT_NOTES.md`, `HANDOFF.md`, plan
maestro, `docs/**`). No se ejecutó ninguna operación contra Supabase, PostgreSQL,
Data API o Vault, ni ninguna E2E remota. No se crearon usuarios ni fixtures
remotas. El flujo P1 Web/KDS/caja en REVIEW quedó intacto.

## 9. Limitaciones, riesgos y solicitudes pendientes

1. **Sesión solo en memoria** (SR-MOB-001): al cerrar la app hay que volver a
   autenticarse y no hay renovación automática del access token.
2. **Pantallas autenticadas sin verificación visual** (SR-MOB-005): validadas por
   pruebas, no por observación directa.
3. **Sin verificación en Android/iOS reales**: no hay emulador ni SDK nativo en
   este entorno. El bundle Android se genera correctamente (`expo export`), pero
   no se ejecutó en dispositivo. `react-native-safe-area-context` es un módulo
   nativo: su comportamiento en dispositivo queda pendiente de comprobación.
4. **CodeGraph no disponible**: el análisis de contratos y consumidores se hizo
   por inspección dirigida de solo lectura.
5. **Divergencia de versiones de React/React Native** respecto de Web/KDS,
   impuesta por Expo SDK 57 y aislada en este app.
6. **Parser local para `POST /api/v1/access/branch`** (SR-MOB-002): duplica la
   validación que ya mantiene `apps/web`.
7. **Turno operativo ausente** (SR-MOB-003) y **origen de API para dispositivos
   físicos** (SR-MOB-004) siguen pendientes de decisión.
8. **Node 22.20.0 vs `engines.node` 24.19.0**: todas las compuertas pasaron, pero
   la verificación no se ejecutó en la versión declarada.

## 10. Siguiente acción recomendada

1. Revisar el diff completo y confirmar que el cambio de `pnpm-lock.yaml`
   corresponde únicamente a `apps/mobile`.
2. Ejecutar las compuertas globales en el entorno del coordinador (Node
   24.19.0).
3. Ejecutar el app con configuración propia (`.env.example` documenta las tres
   variables) y validar visualmente sucursales, mesas y menú, incluido el cambio
   de sucursal sin fuga de datos.
4. Decidir SR-MOB-001 a SR-MOB-005 por separado; la comanda móvil no debe
   abrirse antes de resolver SR-MOB-001 y SR-MOB-003.
5. Solo con aprobación humana, integrar la rama y actualizar `TODO.md`
   ("Inicializar `apps/mobile` con Expo/React Native y tipos compartidos").
   Este workstream no cambió el estado de ninguna tarea.
