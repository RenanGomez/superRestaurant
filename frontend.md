# Plan de frontend de superRestaurant

## Propósito y coordinación

Este plan permite que un agente trabaje en frontend sin competir con el trabajo de API, esquema o dominio. Su área de escritura predeterminada es `apps/web/**`; cualquier cambio en `packages/ui`, `packages/shared-types`, `apps/api`, migraciones o archivos operativos requiere coordinación previa con el agente integrador. El agente frontend debe inspeccionar contratos ya publicados antes de proponer uno nuevo y nunca duplicar reglas de dinero, estados, permisos o sincronización.

### Protocolo activo para trabajo simultáneo

Estas delimitaciones son obligatorias, no orientativas.

> **Contrato de ownership vigente (2026-08-31):** Claude tiene asignado exclusivamente FE-0.1 —selector autorizado de Restaurant/Branch— dentro de `apps/web/**`. FE-0 quedó cerrado en su parte automatizada y el integrador asumió el checkpoint. FE-1 a FE-7 siguen siendo solo contexto de planificación. Todo lo que no pertenezca a FE-0.1 se considera reservado a Codex y Claude debe detenerse antes de tocarlo.

#### Instrucción ejecutiva para Claude

| Situación | Acción obligatoria |
| --- | --- |
| Corregir sesión, proxy, cookies o sus pruebas de FE-0 | Detenerse: ese slice ya no tiene trabajo automatizado pendiente ni ownership activo. |
| Tocar cualquier archivo fuera de `apps/web/**` | Prohibido: detenerse y solicitarlo al integrador. |
| Cambiar dependencias o regenerar `pnpm-lock.yaml` | Prohibido: informar la dependencia exacta y detenerse. |
| Implementar FE-0.1 dentro de `apps/web/**` | Autorizado desde el checkpoint publicado `610613e`, sujeto a esta lista blanca. |
| Empezar FE-1 o una fase posterior | Prohibido hasta recibir una asignación nueva y explícita. |
| Encontrar un archivo cambiado, nuevo o eliminado por otro agente | No restaurarlo, borrarlo ni sobrescribirlo; detenerse y reportar la ruta. |
| Necesitar un endpoint, DTO, parser, migración o cambio compartido | No improvisarlo en frontend; documentar el contrato requerido y esperar a Codex. |
| Terminar FE-0.1 y sus verificaciones acotadas | Entregar el reporte y detenerse; no elegir por cuenta propia la siguiente tarea. |

**Regla de interpretación:** leer no concede propiedad de escritura. Que un archivo sea necesario para compilar, que aparezca modificado en Git o que una fase figure en este plan tampoco autoriza a Claude a editarlo. Solo la lista blanca de FE-0 y una asignación explícita posterior amplían el alcance.

#### Propiedad y lista blanca de escritura de Claude

Mientras tenga una tarea frontend activa, Claude puede leer todo el repositorio para consultar contratos, pero solo puede escribir dentro de `apps/web/**`. Dentro de esa carpeta solo puede cambiar fuentes, pruebas y configuración local estrictamente necesarias para FE-0. No puede ampliar el producto ni aprovechar el trabajo para iniciar el siguiente slice.

Aunque `apps/web/package.json` esté dentro de esa carpeta, Claude no puede añadir, quitar ni actualizar dependencias, `devDependencies`, versiones o campos que obliguen a regenerar `pnpm-lock.yaml`. El conjunto de dependencias reconstruido y ya integrado queda congelado durante esta tarea. Si una prueba o corrección requiere otra dependencia, debe solicitarla y detenerse.

Claude no puede modificar, crear, eliminar, mover, renombrar, formatear ni regenerar:

- `apps/api/**`, `packages/**`, `supabase/**`, `spikes/**`, `docs/**` o cualquier otra aplicación;
- `TODO.md`, `PROJECT_NOTES.md`, `HANDOFF.md`, `frontend.md`, `AGENTS.md`, planes o ADRs;
- `pnpm-lock.yaml`, `package.json` raíz, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore` o configuración compartida;
- ramas, commits, tags, worktrees, stashes o historia Git;
- variables `.env` reales, certificados, secretos o configuración remota de Supabase.

No debe ejecutar `git clean`, restauraciones/reverts, borrados fuera de `apps/web/**`, instalación raíz ni comandos que regeneren el monorepo. Tampoco puede hacer push, merge, rebase o force-push.

Claude tampoco puede borrar o reemplazar archivos que no reconozca, aunque aparezcan sin seguimiento, ni asumir que un cambio concurrente es descartable. Antes de editar debe revisar `git status --short`; si un archivo que necesita tocar cambió desde su última lectura o parece estar siendo editado por otro agente, se detiene y reporta la colisión sin restaurarlo.

Si necesita una dependencia, cambio de contrato, DTO, parser, endpoint, componente compartido o ajuste de configuración raíz:

1. no implementa ese cambio fuera de su lista blanca;
2. registra la necesidad en su reporte con archivo, paquete, versión o contrato exacto;
3. se detiene en ese punto hasta que Codex integre la dependencia;
4. continúa solo después de confirmación humana o del integrador.

#### Propiedad de Codex mientras Claude está activo

Codex es propietario de backend, dominio, esquema, contratos compartidos y archivos operativos. Durante una tarea frontend activa no edita, elimina, formatea ni regenera `apps/web/**`; puede inspeccionarla, ejecutar verificaciones de solo lectura y reportar hallazgos a Claude. Codex tampoco actualiza el lockfile mientras Claude esté cambiando `apps/web/package.json`.

La integración global es responsabilidad exclusiva de Codex: cambios de contratos, instalación de dependencias, regeneración del lockfile, pipeline raíz, actualización de documentación operativa y transición de estados. Claude entrega su slice sin realizar esas acciones.

#### Comandos frontend permitidos

Claude puede ejecutar únicamente verificaciones acotadas que no cambien contratos compartidos:

- `pnpm --filter @super-restaurant/web lint`;
- `pnpm --filter @super-restaurant/web typecheck`;
- `pnpm --filter @super-restaurant/web test`;
- `pnpm --filter @super-restaurant/web build`;
- inspecciones de solo lectura como CodeGraph, `rg`, `git diff` y `git status`.

`pnpm install`, actualizaciones de versiones, generación del lockfile y el pipeline raíz pertenecen exclusivamente a Codex.

#### Slice autorizado ahora

Claude queda autorizado a implementar exclusivamente FE-0.1 —selector autorizado de Restaurant/Branch— dentro de `apps/web/**`. Antes de editar debe releer este archivo, confirmar `HEAD=origin/main=610613eebfa0536e3ef94f349d8b2de0b84435ff` y revisar `git status --short`; si el checkout ya contiene cambios dentro de `apps/web/**`, debe detenerse y reportar la colisión. No puede tocar el lockfile, dependencias, contratos compartidos, backend, esquema ni documentos operativos.

Codex confirmó los cinco prerrequisitos el 2026-08-31:

1. `20260830000200` aplicada en el proyecto correcto;
2. `app_api` aprovisionado y la E2E remota de membresías verde;
3. `GET /api/v1/access/memberships` y `POST /api/v1/access/branch` disponibles en runtime;
4. `@super-restaurant/shared-types` enlazado a `apps/web` por el integrador;
5. checkpoint Git `610613e` publicado y checkout limpio al emitir la asignación.

Esta asignación habilita únicamente las cinco tareas y pruebas descritas en FE-0.1. No autoriza menú, mesas, órdenes, KDS, pagos, caja, backoffice, trabajo offline, commits ni Git remoto. Si falta un endpoint/DTO/parser o surge una necesidad fuera de `apps/web/**`, Claude debe documentarla y detenerse.

La entrega de Claude no autoriza commits, limpieza del checkout ni una siguiente tarea. Codex inspeccionará el diff, ejecutará la integración global cuando ya no haya escritura frontend concurrente y actualizará los archivos operativos.

Este protocolo evita interferencias lógicas dentro del checkout compartido. Para aislamiento físico en trabajo prolongado se usarán ramas/worktrees separados cuando el estado acumulado actual haya sido integrado de forma segura.

La secuencia respeta el plan maestro: Fases 0–2 son online-first; offline durable empieza en Fase 3. Supabase se usa en web únicamente para Auth SSR. NestJS es el BFF de negocio y la única frontera para escrituras críticas. No se copia código del prototipo histórico.

## Dependencias y trabajo reutilizable

- `apps/api`: usar REST versionado y OpenAPI. El primer contrato disponible es `GET /api/v1/session`; la selección de sucursal deberá consumir el endpoint de acceso de Branch cuando el integrador lo publique como contrato de producto.
- `packages/shared-types`: usar sus parsers versionados de `RestaurantScope` y `BranchScope` en las fronteras de transporte. Si falta un DTO, solicitarlo al integrador; no crear una copia local con semántica divergente.
- `packages/domain`: reutilizar `Money`, Menu, Order/OrderItem, modificadores, Payment/Refund y CashRegister solo para presentación o interacción local pura donde corresponda. El servidor vuelve a validar toda mutación.
- `packages/ui`: extraer componentes únicamente cuando existan dos consumidores reales y con coordinación explícita; hasta entonces mantener componentes locales en `apps/web`.
- API futura: usar access token únicamente desde el servidor Next hacia Nest. No entregar secretos de servidor ni conexión PostgreSQL al cliente.

## Fase FE-0 — Identidad y shell protegido (P0)

Estado: IN_PROGRESS. Implementación y verificación automatizada cerradas; pendiente únicamente el smoke humano real contra Supabase Auth y Nest. No está en REVIEW ni DONE.

Implementado en `apps/web/**`:

- Next.js App Router con `/login`, `/app`, shell y `proxy.ts`;
- Supabase Auth exclusivamente server-side, cookies host-only, `HttpOnly`, `SameSite=Lax` y `Secure` fuera de localhost HTTP;
- login por contraseña y logout mediante Server Actions, errores genéricos y destinos fijos;
- comprobación server-to-server contra `GET /api/v1/session` antes de renderizar el shell;
- configuración fail-closed sin variables `NEXT_PUBLIC_`; `API_BASE_URL` admite HTTP solo para localhost/127.0.0.1 fuera de producción;
- estados visuales de carga y 11 pruebas de configuración.
- validación Nest ejecutada una sola vez por request protegido desde `proxy.ts`, con `signOut()` en una frontera capaz de persistir cookies;
- parser exacto de `{ actorId: UUID }` y siete pruebas locales de sesión remota/respuestas hostiles.

Verificación integrada confirmada el 2026-08-30: lint, typecheck, 23/23 pruebas y build de producción de `apps/web` verdes. Son 11 pruebas de entorno, siete de sesión/parser y cinco pruebas funcionales directas del proxy. El harness del proxy usa `node:test`, `NextRequest`/`NextResponse` reales y un cargador ESM/doble de Supabase exclusivos de pruebas; no añadió dependencias ni modificó imports productivos. CodeGraph enlaza `proxy` y `redirectPreservingCookies` directamente con `proxy.test.ts`.

Correcciones automatizadas cerradas:

1. La invalidación rechazada por Nest vive en `proxy.ts`; el layout ya no intenta escribir cookies ni llama a `signOut()`.
2. La comprobación remota ocurre una vez por request protegido y el layout solo hace lectura defensiva de `getUser()`.
3. Las pruebas de sesión cubren rechazo remoto, API inaccesible, JSON inválido, campos extra y UUID exacto.
4. Las pruebas del proxy demuestran limpieza efectiva de cookies, redirect fijo, ausencia de ciclo, una sola llamada Nest y `Cache-Control: private, no-store`.

Asignación actual de Claude: **FE-0.1 exclusivamente**. FE-0 no debe modificarse salvo el ajuste mínimo inevitable para integrar el selector; cualquier regresión de sesión/proxy se reporta al integrador. Esta autorización consta en la sección "Slice autorizado ahora" y no se extiende a fases posteriores.

Alcance:

- Next.js App Router con `/login` y `/app`.
- Supabase Auth SSR mediante cookies host-only, `HttpOnly`, `SameSite=Lax` y `Secure` bajo HTTPS.
- login por contraseña, refresh en `proxy`, logout local por Server Action y destinos fijos.
- validación server-to-server de la sesión contra `GET /api/v1/session`.
- configuración fail-closed solo con `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `API_BASE_URL` y `WEB_ORIGIN`.
- estados accesibles de espera/error; error de autenticación genérico.

Criterios de salida:

- [x] lint, typecheck, pruebas de configuración y build de `apps/web` verdes;
- [x] contrato estático sin cliente Supabase de navegador, `NEXT_PUBLIC_`, Data API, RPC ni signup;
- [x] pruebas funcionales directas de proxy, sesión remota, limpieza de cookies, redirect fijo y `no-store`;
- [x] smoke humano en navegador para login válido/inválido, refresh, rechazo/revocación y logout;
- [x] confirmación runtime de respuestas protegidas `private, no-store` y ausencia de ciclo de redirección.

## Fase FE-0.1 — Contexto autorizado de restaurante/sucursal (P0)

Estado: REVIEW. Claude completó el alcance local asignado en `apps/web/**` y devolvió ownership al integrador. Backend, migración de membresías, runtime `app_api`, E2E remota base y enlace del contrato están disponibles desde el checkpoint `610613e`.

Dependencias satisfechas: `GET /api/v1/access/memberships`, `POST /api/v1/access/branch`, parsers de `packages/shared-types` y enlace workspace. El frontend debe consumir esos contratos publicados sin redefinirlos localmente.

Tareas:

1. Mostrar membresías efectivas devueltas por Nest, nunca deducidas desde metadatos de Auth.
2. Permitir elegir Restaurant y Branch solo entre pares autorizados y volver a verificarlos en Nest.
3. Persistir la preferencia como referencia no autoritativa; revalidar al abrir sesión, cambiar sucursal o recuperar foco.
4. Incorporar al shell el nombre de sucursal, estado de sesión y un bloqueo explícito si la membresía fue revocada.
5. Añadir pruebas de false pairs, revocación con token vivo, respuestas hostiles y navegación por teclado.

No incluye turno, caja, Data API ni escritura PostgreSQL directa.

Integración 2026-08-31: el shell consume el directorio Nest, permite seleccionar
solo pares Restaurant/Branch revalidados por `POST /api/v1/access/branch`, guarda
una preferencia HTTP-only no autoritativa, refresca al recuperar foco y bloquea
una preferencia revocada. El integrador añadió binding exacto entre respuesta y
scope solicitado y rechazo de roles duplicados. Web pasó lint, typecheck, 36
pruebas y build; el smoke local confirmó `/login` en escritorio y 390×844 sin
errores de consola. Sigue IN_PROGRESS hasta probar el selector protegido con
Auth/API reales y revisar sus breakpoints en una sesión autorizada.

Preparación 2026-09-01: el harness remoto de tenancy incorpora hooks vivos
antes y después de revocar la membresía `amber`, un API local de puerto fijo y
un coordinador de navegador con lease/ack temporales ignorados. Las credenciales
no se imprimen, la fase posterior a revocación no las conserva y cualquier
timeout o fallo vuelve al cleanup FK-safe/Auth existente.

Ejecución 2026-09-01: el run final
`694b7e52-1e64-4c95-b509-a5215dfed425` completó 119 checks, observó la
sucursal exacta y roles `manager/waiter`, sobrevivió a recarga, mostró “Sin
sucursales asignadas” tras revocación con token vivo y eliminó todas las filas
y dos usuarios Auth. El logout se restringió a la sesión local y el proxy deja
continuar Server Actions rechazados con cookies limpiadas para que el action
pueda redirigir correctamente. FE-0.1 pasa a REVIEW.

## Fase FE-1 — Shell operativo y menú online (P1)

Dependencias: endpoints Nest de catálogo/menu y contrato de disponibilidad por Branch.

Tareas:

1. Construir navegación táctil y responsive preservando siempre Restaurant/Branch visibles.
2. Consumir lecturas mediante BFF Next→Nest con `no-store` donde sean específicas de sesión.
3. Renderizar categorías, productos, variantes y modificadores usando los contratos compartidos y snapshots definidos por dominio.
4. Implementar carga, vacío, error y reintento sin afirmar soporte offline.
5. Instrumentar correlation ID y errores sanitizados sin registrar tokens o datos personales completos.

## Fase FE-1.1 — Mesas, zonas y layout (P1)

Dependencias: API de mesas/zonas con scope obligatorio e invariantes de Branch.

Tareas:

1. Vista táctil de zonas y mesas con estados comunicados por texto, forma y color.
2. Editor de layout con guardado versionado e indicador de conflicto; Nest valida pertenencia a Branch.
3. Pruebas responsive, teclado, foco, targets táctiles y aislamiento entre sucursales.

## Fase FE-1.2 — Captura de orden y KDS online (P1)

Dependencias: API transaccional de Order/OrderItem, contratos de Menu y transporte KDS con recuperación durable por cursor.

Tareas:

1. Crear órdenes por mesa, mostrador, para llevar y delivery usando comandos Nest idempotentes.
2. Reutilizar el modelo de modificadores y snapshots de `packages/domain`; nunca recalcular históricos desde catálogo actual.
3. Mostrar estados y transiciones permitidas por dominio, pero aceptar al servidor como autoridad.
4. Solicitar motivo/autorización para acciones sensibles y mostrar rechazos recuperables.
5. Integrar actualización KDS más recuperación por cursor; no depender solo de Realtime.
6. Probar doble envío, pérdida de respuesta, revocación, cambio de Branch y rehidratación hostil.

## Fase FE-1.3 — Cobro y caja online (P1, alto riesgo)

Dependencias: endpoints Nest de Payment/Refund/CashRegister, idempotencia y autorización de supervisor.

Tareas:

1. Presentar importes desde `Money` en unidad menor/código ISO sin floats.
2. Ejecutar efectivo, refund y cortes X/Z exclusivamente por Nest.
3. Mantener una idempotency key estable durante reintentos y diferenciar pendiente, confirmado, rechazado y ambiguo.
4. Mostrar actor, turno, caja y Branch; no almacenar PAN/CVV ni datos de terminal.
5. Probar doble cobro, timeout ambiguo, compensación, autorización y reapertura prohibida.

Ninguna tarea financiera puede quedar en REVIEW sin pruebas de integración del backend correspondiente.

## Fase FE-2 — Backoffice online y adaptación mobile (P2)

Dependencias: contratos API por módulo y decisiones de RBAC.

Tareas web:

- CRUD administrativo no financiero solo por endpoints expresamente autorizados; preferir Nest para mantener una frontera consistente.
- gestión de menú, disponibilidad, usuarios y permisos con confirmaciones internas y auditoría visible;
- paneles operativos con estados vacíos/error y exportaciones server-side;
- extraer a `packages/ui` únicamente controles compartidos comprobados con mobile/KDS.

El frontend web puede preparar contratos y componentes puros para Expo, pero no debe escribir `apps/mobile` sin asignación explícita.

## Fase FE-3 — PWA y offline por dispositivo (P3)

Bloqueada hasta ADR/contrato de almacenamiento local y `packages/sync-engine` implementable.

Tareas futuras:

1. Elegir IndexedDB/Dexie/RxDB mediante ADR, cifrado y estrategia de migración.
2. Añadir Service Worker y app shell instalable sin confundir cache de UI con operación offline.
3. Integrar outbox durable, cursores versionados, tombstones, reintentos y conflictos por entidad desde `packages/sync-engine`.
4. Mostrar conexión, pendientes, fallos, conflictos y acciones que requieren red.
5. Probar reinicio/cierre forzado, cliente atrasado, duplicados y pérdida/restauración de red.

Los pagos ambiguos nunca se fusionan automáticamente. Sin servidor LAN no se promete coordinación entre dispositivos durante una caída total.

## Fases FE-4 a FE-7 — Expansión

- FE-4 inventario/compras: vistas sobre ledger y compensaciones autoritativas, conteos y alertas; sin mutar existencias localmente.
- FE-5 fiscal/pagos avanzados: estados PAC/pasarela y recuperación idempotente; webhooks permanecen server-side.
- FE-6 reportes/CRM/personal: datos minimizados, RBAC y exportaciones auditadas.
- FE-7 lanzamiento multi-sucursal: cambio de scope seguro, accesibilidad WCAG, rendimiento, observabilidad, runbooks y matriz real de navegadores/dispositivos.

## Reglas de entrega para cada slice

1. Leer TODO/plan y consultar CodeGraph; si no está disponible, documentar búsqueda manual dirigida.
2. Confirmar contratos API/shared/domain y consumidores antes de editar.
3. Limitar la escritura a la carpeta asignada y pedir coordinación para contratos transversales.
4. Implementar el mínimo end-to-end, con estados carga/vacío/error/reintento y accesibilidad.
5. Añadir unit tests, contract tests y E2E proporcionales al riesgo.
6. Reconsultar dependencias, ejecutar lint/typecheck/test/build del alcance y luego entregar al integrador para pipeline global.
7. Verificar visualmente breakpoints reales sin controlar el navegador del usuario; pedir smoke humano cuando sea necesario.
8. Dejar trabajo sustancial en REVIEW, nunca DONE sin aprobación humana.

## Exclusiones permanentes salvo nueva decisión

- conexión PostgreSQL, claves secret/service-role o lógica de autorización en el navegador;
- escritura crítica vía Supabase Data API/RPC;
- cálculos monetarios o máquinas de estados duplicados;
- redirects abiertos, signup público, recuperación de contraseña o MFA improvisados;
- offline, Realtime-only o LAN anunciados sin sus contratos y pruebas;
- cambios de esquema, migraciones, infraestructura, API o archivos operativos sin ownership coordinado.
