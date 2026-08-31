# Migraciones productivas de Supabase

Esta carpeta es la única autoridad del esquema PostgreSQL productivo. Las
migraciones del spike `spikes/adr-010` son evidencia experimental y no se
copian ni se aplican desde aquí.

Reglas operativas:

- aplicar cambios hacia adelante; después de publicar, contener revocando
  grants/rutas y crear una migración correctiva;
- no ejecutar `db push` sin revisar el proyecto enlazado y tener autorización
  explícita para modificarlo;
- no incluir contraseñas, URLs privadas, tokens ni certificados;
- `config.toml` documenta el schema de API local, pero no se ejecuta
  `config push` hasta auditar y declarar también la configuración Auth real del
  proyecto destino; `db push` no autoriza ese cambio de configuración;
- `app` es el único schema candidato a Data API y solo para lecturas RLS
  expresamente permitidas;
- `app_private` y `app_rls` nunca se agregan a los schemas expuestos;
- el rol `app_api` nace `NOLOGIN`. Su habilitación y contraseña son un paso
  privado posterior y nunca se registran en Git o en el chat. La migración
  rechaza cualquier rol preexistente con ese nombre. PostgreSQL 16+ concede
  al creador `postgres` una membresía administrativa que no puede revocar un
  usuario `CREATEROLE`; las auditorías aceptan exclusivamente esa fila con
  grantor `supabase_admin`, `ADMIN OPTION` y `INHERIT`/`SET` deshabilitados;

## Verificación y aplicación de `20260830000200`

La segunda migración productiva puede verificarse de forma reproducible sin
persistirla mediante:

`pnpm --filter @super-restaurant/api verify:membership-directory-schema:rollback`

El comando exige las cuatro variables `SCHEMA_VERIFICATION_*` del ejemplo de
API, valida el proyecto/host/puerto/CA y TLS `verify-full`, aplica únicamente
`20260830000200` dentro de una transacción, ejecuta la auditoría de catálogo,
exige cinco funciones protegidas y siempre finaliza con `ROLLBACK`. No habilita
`app_api` ni escribe el historial de migraciones.

La aplicación persistente no se hace con SQL directo ni con `db push` desde la
raíz. El remoto conserva cinco migraciones válidas del spike que no pertenecen
a esta carpeta productiva, por lo que el CLI raíz interpreta el historial como
incompleto. Se repite el procedimiento ya demostrado para `20260830000100`:

1. rotar la credencial administrativa si pudo quedar expuesta y cargarla solo
   en el entorno local ignorado;
2. recibir autorización humana exacta para la versión, proyecto y operación;
3. crear un staging temporal fuera del árbol versionado con copias byte a byte
   de las cinco migraciones históricas remotas y las dos productivas;
4. confirmar hashes, orden e historial remoto, y ejecutar primero
   `supabase db push --dry-run --skip-vault` contra la conexión privada;
5. continuar solo si el dry-run anuncia exclusivamente `20260830000200`, sin
   reparación, seed, roles, Vault o push de configuración;
6. ejecutar el mismo `db push`, comprobar las siete versiones, auditoría de
   catálogo y ausencia de cambios en `LOGIN` de `app_api`, y eliminar el
   staging temporal.

Si el estado remoto o el dry-run difiere, se detiene sin reparar historial. La
autorización de la migración tampoco autoriza aprovisionar `app_api`.

## Aprovisionamiento privado de `app_api`

Solo después de aplicar y auditar la migración:

1. generar una contraseña nueva y larga, distinta de la administrativa, en un
   gestor de contraseñas;
2. cargarla solo en `APP_API_PROVISIONING_PASSWORD`, junto con las variables
   privadas del ejemplo `apps/api/.env.tenancy.example`; nunca pasarla como
   argumento ni escribirla en logs;
3. ejecutar el aprovisionador con confirmación exacta del project ref:
   `pnpm --filter @super-restaurant/api provision:app-api:remote --
   --confirm=PROVISION_APP_API_LOGIN_FOR:<project-ref>`;
4. el aprovisionador toma un advisory lock compartido con el runner, revalida
   `NOLOGIN`/password nula/sin sesiones, crea SCRAM mediante un parámetro dentro
   de una función `pg_temp`, activa una validez de diez minutos, conecta como
   `app_api`, prueba el lookup productivo permitido y denegaciones, y solo
   entonces promueve la validez a `infinity` y ejecuta la auditoría runtime;
5. si una comprobación falla después de intentar el cambio, cierra la sesión de
   aplicación y compensa desde una conexión administrativa nueva a
   `NOLOGIN PASSWORD NULL`; confirma el cambio antes de terminar cualquier
   sesión `app_api` superviviente y la auditoría pre-provisioning debe volver a
   pasar;
6. formar y guardar la misma URL derivada únicamente como `DATABASE_URL` del
   servidor, con `sslmode=verify-full` + `DATABASE_CA_CERT_PATH`. El comando no
   imprime ni persiste la URL o la contraseña.

La allowlist cubre los schemas productivos `app`, `app_private` y `app_rls`; no
afirma exclusividad sobre funciones de sistema/extensiones que PostgreSQL pueda
conceder mediante `PUBLIC`. La auditoría también exige SCRAM, validez final
infinita, `rolconfig` vacío, cero objetos propiedad de `app_api` y cero sesiones
durante el corte de verificación. Si el proceso muere tras la primera activación
y antes de promoverla, la credencial deja de aceptar conexiones nuevas en diez
minutos; la expiración no elimina el hash SCRAM ni termina sesiones existentes.

### Inspección read-only del estado

Antes de aprovisionar o al retomar una ejecución incierta, cargar únicamente
`SUPABASE_URL`, `DATABASE_CA_CERT_PATH` y las dos variables
`APP_API_STATE_VERIFICATION_*` del ejemplo, y ejecutar:

`pnpm --filter @super-restaurant/api verify:app-api-state:remote`

El comando no acepta argumentos ni necesita la contraseña de `app_api`. Toma el
lock compartido y reporta solo el estado clasificado, si la auditoría aplicable
pasó y si existe alguna sesión activa. `safe_disabled` y `runtime` se auditan
contra sus contratos pinneados; `temporary`, `expired` y `partial` se reportan
como atención y nunca se corrigen automáticamente. No imprime URL, credenciales,
expiraciones, PIDs ni errores nativos.

Las auditorías pinneadas requieren una ventana sin sesiones `app_api`. Si el
verificador detecta una sesión activa en cualquier estado, conserva esa evidencia
y devuelve `attention` con `catalogAudit=false`, sin presentar un fallo genérico.

Todas las operaciones administrativas de ciclo de vida exigen conexión directa
o pooler de sesión en puerto 5432. El puerto 6543 de transaction pooling se
rechaza porque no puede preservar de forma fiable el advisory lock de sesión.

### Recuperación de `app_api`

Ante un resultado ambiguo o cierre forzado, no repetir el aprovisionador. Con
autorización humana independiente, cargar solo `SUPABASE_URL`,
`DATABASE_CA_CERT_PATH` y las tres variables `APP_API_RECOVERY_*` del ejemplo, y
ejecutar:

`pnpm --filter @super-restaurant/api recover:app-api:remote -- --confirm=DISABLE_APP_API_LOGIN_AFTER_AMBIGUOUS_PROVISIONING_FOR:<project-ref>`

La recuperación correlaciona URL/ref/conexión administrativa, toma el mismo
lock global, verifica el fingerprint inmutable y OID del rol, confirma primero
`NOLOGIN PASSWORD NULL`, termina después las sesiones existentes y exige desde
una conexión nueva el mismo OID, cero sesiones y la auditoría pre-provisioning.
Es idempotente si el rol ya estaba deshabilitado. No imprime URL, contraseña,
PID ni detalle del proveedor.

`supabase/tests/tenancy_memberships_catalog.sql` audita el estado seguro
inmediatamente posterior a la migración (`NOLOGIN`). Después del
aprovisionamiento, usar
`supabase/tests/tenancy_memberships_runtime_catalog.sql`: exige `LOGIN` porque
es una capacidad necesaria del servidor, pero sigue rechazando privilegios
elevados, membresías distintas de la concesión administrativa inerte de
PostgreSQL 16, grants adicionales, credenciales no SCRAM, sesiones residuales y
cualquier objeto propiedad de `app_api`.

El rollback ordinario es forward-only. Eliminar estas tablas solo es aceptable
antes de datos reales, con verificación de vaciedad y respaldo explícito.
