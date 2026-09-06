# Entregas del workstream frontend móvil (`apps/mobile`)

Mandato: `docs/CLAUDE_FRONTEND_WORKSTREAM.md`. Cada unidad queda lista para
revisión y **no integrada**: no hubo merge, rebase, push ni publicación de rama.

- **Unidad 2 — mesas y borrador de comanda (2026-09-05)**: sección A, abajo. Es
  el corte vigente y responde al mandato de la sección 0 del documento.
  **Retrabajada el 2026-09-06** según la revisión 0.R1 del coordinador: la
  sección **A.R1** describe esa ronda y es la que prevalece donde contradiga a
  las secciones A.1 a A.11, escritas para el corte anterior `3061487a…`.
- **Unidad 1 — fundación Expo/Auth/sucursal**: ya integrada en `main` y marcada
  DONE. Su registro histórico se conserva a partir de la sección B y no describe
  el corte actual.

---

# A. Unidad 2 — mesas y borrador de comanda

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
| `f8f1f8422e91ee1a3ac6a4d1a9d5b6dbb2eb6cf7` | `fix(mobile): rework the comanda hand-over after the coordinator review` |
| (este documento) | `docs(mobile): record the coordinator rework` — su hash se reporta al cierre |

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
