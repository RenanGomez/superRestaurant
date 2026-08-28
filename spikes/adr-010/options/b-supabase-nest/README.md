# ADR-010 — opción B: Supabase + NestJS (runner remoto opt-in)

Este directorio es un spike aislado, no un backend productivo ni una decisión de ADR-010. La migración usa el esquema `adr010_b` y nunca toca un schema de producto. `SupabaseNestAdr010Adapter` implementa el contrato común, pero solo puede ejecutarse con opt-in explícito contra el proyecto desechable confirmado.

Se verificaron antes de añadir dependencias las versiones actuales del registry npm: `@nestjs/common@11.2.3`, `@supabase/supabase-js@2.112.4`, junto con sus pares mínimos `rxjs@7.8.2` y `reflect-metadata@0.2.2`.

## Frontera crítica

`src/nest-boundary.ts` expone `SupabaseAdr010CriticalOrderService` como la única entrada de aplicación *scaffolded* para crear una orden del thin slice. Su request externo contiene el access token y el alcance solicitado, pero nunca `actorId`. Antes de construir el comando interno, `SupabaseAuthPrincipalVerifier` usa `supabase.auth.getUser(accessToken)` del SDK oficial para obtener un principal verificado y deriva su `actorId` únicamente de `user.id`; no decodifica JWTs localmente. Un token inválido no llega al puerto de escritura y ningún token ni detalle del proveedor se registra. Esto es un preflight local con fakes, no evidencia de Auth remoto ni del gate Auth/scope; no se conecta a un endpoint productivo.

`SupabaseCriticalOrderPostgresPort` es para proceso Nest/CI y llama exclusivamente a `adr010_b_private.adr010_b_create_order` mediante `pg` y `ADR010_DATABASE_URL`, una conexión PostgreSQL privada de servidor/CI. No usa Supabase Data API para una escritura crítica. La clave moderna queda limitada a Auth Admin, verificación y fixtures desechables. Ningún archivo de web, mobile o KDS debe importarlo, ni recibir la URL de base de datos.

La función SQL pretende escribir orden, líneas, snapshots, idempotencia, auditoría y evento KDS en una sola transacción. La restricción única tenant+branch+idempotency y `ON CONFLICT` están diseñados para serializar reintentos concurrentes. La orden conserva el request canónico (actor, scope y líneas): reutilizar la misma clave con una solicitud diferente se rechaza en lugar de devolver silenciosamente el resultado anterior. `induceFailureAfterOrder` lanza dentro de la función para ensayar rollback. Estas propiedades **no están demostradas** hasta ejecutar concurrencia y fallo inducido contra PostgreSQL real.

El thin slice financiero añade captura en efectivo y reembolso compensatorio inmutable. La autorización del reembolso usa un segundo token supervisor verificado por Nest; el `actorId` y el aprobador se derivan de Auth y se persisten/auditan. `localSequence` se reclama en `adr010_b_private.device_sequences` por `deviceId` global, bajo lock transaccional: la primera secuencia es 1 y las siguientes son exactamente `+1`, incluso al cambiar de actor o sucursal. El replay idempotente retorna el movimiento `cash_payment` y no consume el cursor.

La migración revoca escritura genérica de tablas, secuencias y funciones también a `service_role`. `adr010_b` solo contiene las tablas de lectura RLS y se expone expresamente para esa superficie. Todas las funciones `SECURITY DEFINER` (orden crítica, bootstrap y limpieza) viven en `adr010_b_private`, que no se añade a Exposed schemas, no concede `EXECUTE` a `PUBLIC`, `anon`, `authenticated` ni `service_role`, y fija `search_path = ''`; los objetos de las consultas se califican con schema. La conexión PostgreSQL privada es la única que puede invocarlas. Aun así, la ausencia de rutas paralelas requiere inspección humana y pruebas remotas; administradores/owners de PostgreSQL permanecen fuera de esta frontera de aplicación.

## RLS y fixture

La migración habilita y fuerza RLS en todas las tablas. Los usuarios `authenticated` reciben únicamente `SELECT`, limitado por membership activa y por restaurant/branch; no hay políticas de `INSERT`, `UPDATE` ni `DELETE`. Esto todavía es intención SQL, no evidencia de aislamiento.

`memberships.user_id`, `orders.actor_id` y `audit_log.actor_id` tienen FK a `auth.users(id)`. `fixtures/adr010-b-structural-fixtures.sql` carga únicamente dos restaurantes y dos sucursales por restaurante. No inventa identidades ni aparenta Auth real. El bootstrap admin reproducible de `supabase/bootstrap/README.md` crea usuarios desechables mediante Admin API y luego memberships con los UUID reales, sin imprimir credenciales. Cada usuario recibe además un marcador aleatorio de ejecución (`bootstrap_run_id`) en `app_metadata`, visible solo por Admin API: si falla la RPC antes de crear `bootstrap_users`, el cleanup de esa ejecución aún puede descubrir y borrar el usuario huérfano sin colisionar con otra ejecución concurrente. Esto sigue siendo limpieza de un proyecto aislado, no evidencia del gate Auth/scope.

## Data API y schema expuesto

Solo los clientes de lectura/RLS usan `.schema("adr010_b")`, por lo que `adr010_b` debe añadirse explícitamente a **API Settings → Exposed schemas** del proyecto aislado. `adr010_b_private` no debe añadirse nunca. Sin la exposición de `adr010_b`, los checks de lectura/RLS fallarán aunque la migración exista; sin `ADR010_DATABASE_URL`, el transporte Nest/CI no puede invocar la función privada. Exponer el schema de lectura publica su superficie a PostgREST; grants y RLS son entonces controles obligatorios y deben probarse por rol y operación.

Una alternativa más estrecha para una iteración posterior es conservar `adr010_b` sin exponer y publicar wrappers mínimos en `public`. No se adopta silenciosamente aquí porque cambiaría la superficie que deben evaluar los gates. El scaffold actual requiere exposición completa del schema aislado y jamás debe reutilizarse como schema productivo.

## Configuración y comandos

1. Copia `.env.example` a `.env` localmente y usa un proyecto Supabase aislado; nunca subas ni pegues la clave secret.
2. En API Settings, añade solo `adr010_b` a Exposed schemas; nunca `adr010_b_private`. Esto habilita lecturas RLS y sus grants deben mantener todas las escrituras inexequibles para `anon`, `authenticated` y `service_role` mediante Data API.
3. Enlaza el proyecto aislado: `supabase link --project-ref <project-ref>`.
4. Revisa el orden y rollback seguro en `supabase/migrations/README.md`; después aplica la serie B/C desde este directorio con `supabase db push`.
5. Ejecuta el runner común. Valida y completa idempotentemente los fixtures estructurales, crea sesiones Auth reales desechables, ejecuta los gates y limpia sus datos en `finally`.

Preflight local, sin red ni credenciales:

```sh
pnpm install --frozen-lockfile
pnpm --filter @super-restaurant/adr-010-spike lint
pnpm --filter @super-restaurant/adr-010-spike typecheck
pnpm --filter @super-restaurant/adr-010-spike test
pnpm --filter @super-restaurant/adr-010-spike build
```

El runner remoto nunca se ejecuta en CI normal. Exige URL, publishable, secret, conexión PostgreSQL y `ADR010_RUN_SUPABASE=1`. Además, `ADR010_CONFIRM_ISOLATED_PROJECT` debe repetir exactamente el project ref de 20 caracteres de la URL HTTPS hospedada. `ADR010_DATABASE_URL` debe ser la conexión directa `db.<ref>.supabase.co` con usuario `postgres`, o un pooler oficial `*.pooler.supabase.com` con usuario exacto `postgres.<ref>`, base `/postgres` y `sslmode=require` (o verificación más estricta); una coincidencia parcial o TLS deshabilitado no autoriza el borrado:

```sh
ADR010_RUN_SUPABASE=1 ADR010_CONFIRM_ISOLATED_PROJECT=<project-ref> pnpm --filter @super-restaurant/adr-010-spike test:option-b:gates
```

En PowerShell, define las seis variables de la sesión que muestra `.env.example` antes de ejecutar ese mismo comando.

### Push de migraciones en proyecto remoto fresco

El script `test:option-b:fresh-push` no crea proyectos, no enlaza cuentas y
no borra datos. Requiere además `ADR010_RUN_SUPABASE_FRESH_PUSH=1`, valida la
URL, el project ref y la conexión PostgreSQL, comprueba que `adr010_b`,
`adr010_b_private` y las cinco versiones de migración estén ausentes, y
ejecuta primero `supabase db push --linked --dry-run --yes`.

Para una previsualización local/CI, enlaza previamente el proyecto aislado con
el CLI usando el project ref confirmado y ejecuta:

```sh
ADR010_RUN_SUPABASE=1 ADR010_RUN_SUPABASE_FRESH_PUSH=1 ADR010_CONFIRM_ISOLATED_PROJECT=<project-ref> pnpm --filter @super-restaurant/adr-010-spike test:option-b:fresh-push
```

El push real exige un segundo opt-in explícito:

```sh
ADR010_RUN_SUPABASE=1 ADR010_RUN_SUPABASE_FRESH_PUSH=1 ADR010_APPLY_FRESH_REMOTE_PUSH=1 ADR010_CONFIRM_ISOLATED_PROJECT=<project-ref> pnpm --filter @super-restaurant/adr-010-spike test:option-b:fresh-push
```

Las credenciales deben venir del gestor de secretos o del entorno de CI; no se
incluyen en comandos, archivos versionados ni reportes. Conserva fuera de Git
la salida del dry-run, `supabase migration list`, la auditoría de catálogo y
el reporte del runner. Si el push falla, no edites la historia de migraciones:
deja el proyecto en modo fail-closed, conserva la salida y aplica una
migración correctiva versionada tras revisar la causa. El rollback operativo
está documentado en `supabase/migrations/README.md`.

El runner ejecuta los gates comunes con Auth y PostgreSQL reales y emite un reporte JSON sin credenciales. Los tests etiquetados `[preflight/non-evidence]` continúan siendo comprobaciones locales; no sustituyen la ejecución remota ni la revisión humana. Consulta `REMOTE_EVIDENCE.md` y `WRITE_FRONTIER.md`.

El backup lógico lee todas las tablas y el cursor privado de dispositivos dentro de una única transacción `REPEATABLE READ READ ONLY`. `restore` acepta solo el formato/version y project ref esperados, usa listas fijas de tablas/columnas y exige que todas las tablas de negocio y cursores del destino estén vacíos; nunca los borra implícitamente. El runner cumple esa precondición mediante su reset explícito y separado.

## Evidencia pendiente / bloqueo

Las cinco migraciones ya se aplicaron y auditaron en el proyecto aislado actual. El Gate 7 sigue parcial hasta que el runner protegido aplique la serie completa en un segundo proyecto vacío autorizado o en CI y se conserve esa evidencia fuera de Git. El Gate 4 sigue pendiente de inspección humana de la frontera de escritura.

El restore lógico del dataset del spike ya demostró el Gate 8. La recuperación física ante desastre, con RPO/RTO, permanece como evidencia operacional de producción separada y no es la causa de `eligibleForAdr010Go: false` en este spike. Aunque el thin slice financiero ya cubre efectivo, compensación y cursor por dispositivo, la opción B todavía no es una base autorizada para backend productivo hasta cerrar Gates 4 y 7, completar el scoring y recibir la decisión humana.
