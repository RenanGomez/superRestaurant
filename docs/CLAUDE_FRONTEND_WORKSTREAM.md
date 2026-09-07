# Workstream frontend para Claude — fundación móvil aislada

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
