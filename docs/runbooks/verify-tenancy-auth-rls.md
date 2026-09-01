# Verificación remota de tenancy, Auth y RLS

Este runbook demuestra el primer slice productivo de Restaurant/Branch en un
proyecto Supabase aislado. Crea dos usuarios y una matriz 2×2 temporal, ejecuta
las comprobaciones y limpia los fixtures en `finally`.

## Requisitos y límites

- Nunca usar `cxcnnhafchqslvgvkeye`.
- Rotar primero cualquier contraseña que haya aparecido en una salida o chat.
- Guardar contraseñas, claves y URLs privadas solo en un archivo local ignorado
  o en un gestor de secretos; no pegarlas en Git, logs ni conversaciones.
- No cerrar a la fuerza el proceso durante la ejecución. El runner imprime un
  `runId` no sensible al inicio para facilitar una recuperación manual si el
  host se apaga.
- La ejecución remota todavía requiere autorización humana en la sesión donde
  se vaya a realizar.

## Preparación privada

1. Copiar `apps/api/.env.tenancy.example` a un archivo local ignorado y llenar
   sus valores sin publicarlos.
2. Configurar en Supabase la autenticación email/password para los dos usuarios
   desechables.
3. Aplicar la migración productiva versionada y ejecutar
   `supabase/tests/tenancy_memberships_catalog.sql` antes de habilitar el login
   del rol privado.
4. Exponer únicamente el schema `app` en Data API. No exponer `app_private` ni
   `app_rls`.
5. Aprovisionar `app_api` con el comando fail-closed documentado en
   `supabase/migrations/README.md`; usar otra contraseña distinta de la
   administrativa y conservarla solo en el entorno privado y después en
   `DATABASE_URL` del servidor. El password nunca se pasa por argumentos.
6. Ejecutar `supabase/tests/tenancy_memberships_runtime_catalog.sql`. Esta
   auditoría acepta `LOGIN` como capacidad operativa necesaria, pero rechaza
   privilegios elevados, membresías distintas de la concesión administrativa
   inerte de PostgreSQL 16, grants extra, owners inseguros y políticas distintas
   del contrato.

El aprovisionamiento del rol y la exposición Data API son cambios separados.
El comando de `app_api` no ejecuta `config push`, no cambia Auth y no expone
schemas. Exponer únicamente `app` requiere autorización humana propia y una
comparación de configuración remota antes/después.

La exposición se realiza con el endpoint dirigido de Management API para
PostgREST; no se usa `supabase config push`. Cargar en memoria un
`SUPABASE_ACCESS_TOKEN` limitado a `data_api_config_read` y
`data_api_config_write`, `DATA_API_EXPOSURE_RUN=REMOTE_CONFIG_WRITE` y el ref
exacto, y ejecutar:

```text
pnpm --filter @super-restaurant/api configure:data-api-exposure:remote -- --confirm=EXPOSE_ONLY_APP_DATA_API_FOR:<project-ref>
```

El runner consulta la configuración antes de escribir, acepta únicamente los
estados conocidos `public,graphql_public`, el histórico con `adr010_b`, o el
estado final, y envía un `PATCH` cuyo único campo es
`db_schema=public,graphql_public,app`. Después reconsulta y exige exactamente el
estado final sin cambios en `db_extra_search_path`, `max_rows`, `db_pool` o el
timeout del pool. Rechaza cualquier schema desconocido, `app_private`,
`app_rls`, drift o respuesta malformada. La salida solo incluye estado,
booleanos y los nombres públicos de los schemas; nunca cuerpos del proveedor,
tokens ni `jwt_secret`.

Si el aprovisionamiento termina de forma ambigua, usar únicamente con otra
autorización humana `recover:app-api:remote` y la confirmación exacta documentada
en `supabase/migrations/README.md`. La herramienta confirma `NOLOGIN` y elimina
la credencial antes de terminar sesiones supervivientes; después revalida el
OID y catálogo desde una conexión administrativa nueva. La expiración temporal
por sí sola no termina sesiones ni elimina el hash SCRAM.

## Ejecución

Con las variables cargadas únicamente en el proceso local:

```text
pnpm --filter @super-restaurant/api verify:tenancy:remote
```

Después de aplicar `20260831000100`, ejecutar el perfil ampliado con los mismos
opt-ins y secretos efímeros:

```text
pnpm --filter @super-restaurant/api verify:dining-zones:remote
```

Este perfil reutiliza exactamente los usuarios y el grafo 2×2 marcados. Además
prueba creación 201, replay idempotente, conflicto 409, viewer/false pair 403,
revocación con el token todavía válido y conteos administrativos sin efectos
para cada solicitud rechazada.

Una ejecución válida demuestra:

- `anon` y `service_role` sin acceso a las tablas de producto;
- usuarios autenticados aislados por Restaurant/Branch mediante RLS;
- escrituras Data API denegadas;
- conexión real de `app_api` con privilegio mínimo;
- NestJS real con respuestas 200/401/403;
- false pairs Restaurant/Branch rechazados;
- revocación de un rol y una membresía con el mismo access token;
- constraints de scope, duplicados, roles y evidencia de revocación;
- cleanup FK-safe y postcheck sin usuarios o filas temporales.

El resultado solo contiene etapa, códigos allowlisted, conteos y `runId`. Un
fallo no imprime errores crudos del proveedor, URLs, tokens o contraseñas.

## Smoke protegido de `apps/web`

El runner `verify:web-protected-smoke:remote` reutiliza el mismo grafo 2×2,
usuarios Auth marcados, advisory locks, auditoría post-zonas y cleanup del
harness anterior. Añade dos pausas acotadas, de hasta diez minutos cada una:

1. `selection`: mantiene Nest en `127.0.0.1:4311` y publica en
   `.web-protected-smoke-lease.tmp` la credencial temporal de `amber`, el
   `runId` y la sucursal exacta que el navegador debe seleccionar;
2. `revoked`: después de recibir una confirmación exacta, el harness revoca la
   membresía con el access token aún vigente y espera que el navegador recupere
   foco/recargue y muestre el bloqueo autoritativo.

Los archivos de coordinación terminan en `.tmp`, están ignorados y se eliminan
en `finally`. La segunda fase ya no contiene email ni contraseña. El runner
rechaza artefactos previos, acknowledgements con campos extra, otro `runId` o
una fase distinta; no imprime credenciales ni tokens.

La ejecución requiere los opt-ins de tenancy habituales y, además:

```text
WEB_PROTECTED_SMOKE_RUN=REMOTE_BROWSER_SMOKE
WEB_PROTECTED_SMOKE_CONFIRM_PROJECT_REF=<project-ref>
```

Con `apps/web` servido localmente en `http://127.0.0.1:3010`, usando
`API_BASE_URL=http://127.0.0.1:4311`, ejecutar:

```text
pnpm --filter @super-restaurant/api verify:web-protected-smoke:remote
```

El operador del navegador lee el lease sin imprimirlo, prueba login inválido y
válido, confirma `private, no-store`, selecciona únicamente el par esperado y
verifica nombre/roles y refresh sin ciclo. Escribe un acknowledgement exacto
para `selection`; tras la revocación recupera foco y exige el estado “Sin
sucursales asignadas” antes de confirmar `revoked`. Solo entonces el harness
prueba el rechazo de escritura con el token vivo, ejecuta constraints y cleanup
final. El logout se prueba después del resumen `ok`: hacerlo antes puede revocar
la sesión independiente del harness y convertir el 403 esperado en 401. El
producto usa logout con scope local para no cerrar sesiones de otros dispositivos.

Si el proceso se interrumpe, usar primero la recuperación remota por `runId`
descrita abajo. Después de confirmar cero usuarios/filas, eliminar únicamente
los tres archivos locales `.web-protected-smoke-*.tmp`; nunca reutilizar su
contraseña temporal.

## Recuperación tras una interrupción

Si el proceso termina antes del cleanup, conservar el `runId` que imprimió. No
eliminar usuarios o filas a mano. Con las variables administrativas cargadas y
`TENANCY_FIXTURE_RECOVERY_RUN=REMOTE_FIXTURE_DELETE`, ejecutar exactamente:

```text
pnpm --filter @super-restaurant/api recover:tenancy:remote -- --run-id=<UUID> --confirm=DELETE_TENANCY_E2E_FIXTURES_FOR_RUN:<UUID>
```

Los dos `<UUID>` deben ser idénticos. La recuperación toma el mismo advisory
lock que el runner, vuelve a comprobar metadata, email, grafo 2×2, prefijos de
revocación/deshabilitación y, cuando existan, la zona y auditoría marcadas; solo
elimina IDs exactos con `RETURNING`. Acepta una repetición
cuando no queda nada y también el caso en que solo sobreviven uno o dos usuarios
Auth. Cualquier fila parcial, tercer usuario marcado, relación inesperada o
cambio entre descubrimiento y borrado aborta sin intentar una limpieza amplia.
La herramienta no necesita `DATABASE_URL` de `app_api` ni la publishable key.

## Evidencia que aún no cubre

`POST /api/v1/access/branch` acepta cualquiera de los nueve roles conocidos;
el 403 por permiso de acción se cubre ahora en `POST /api/v1/dining/zones`, que
exige `tables.manage`. La suite todavía no prueba la carrera entre revocación y
una escritura financiera, porque esa ruta productiva aún no existe.
