# Workstream frontend para Claude — fundación móvil aislada

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
