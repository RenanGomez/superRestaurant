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

## Recuperación tras una interrupción

Si el proceso termina antes del cleanup, conservar el `runId` que imprimió. No
eliminar usuarios o filas a mano. Con las variables administrativas cargadas y
`TENANCY_FIXTURE_RECOVERY_RUN=REMOTE_FIXTURE_DELETE`, ejecutar exactamente:

```text
pnpm --filter @super-restaurant/api recover:tenancy:remote -- --run-id=<UUID> --confirm=DELETE_TENANCY_E2E_FIXTURES_FOR_RUN:<UUID>
```

Los dos `<UUID>` deben ser idénticos. La recuperación toma el mismo advisory
lock que el runner, vuelve a comprobar metadata, email, grafo 2×2 y prefijos de
revocación, y solo elimina IDs exactos con `RETURNING`. Acepta una repetición
cuando no queda nada y también el caso en que solo sobreviven uno o dos usuarios
Auth. Cualquier fila parcial, tercer usuario marcado, relación inesperada o
cambio entre descubrimiento y borrado aborta sin intentar una limpieza amplia.
La herramienta no necesita `DATABASE_URL` de `app_api` ni la publishable key.

## Evidencia que aún no cubre

`POST /api/v1/access/branch` acepta cualquiera de los nueve roles conocidos;
por ello esta prueba no inventa un 403 por permiso de acción específico. Ese
caso debe probarse en el primer endpoint real con una allowlist de roles más
estrecha. Tampoco prueba todavía la carrera entre revocación y una escritura
financiera, porque esa ruta productiva aún no existe.
