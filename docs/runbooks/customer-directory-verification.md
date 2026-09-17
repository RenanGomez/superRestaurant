# Customer: verificación HTTP rollback-only

Estado del corte: REVIEW. Las migraciones 20260916000100–20260916000800 siguen candidatas, sin aplicar persistentemente. Registrar Customer en AppModule no vuelve operativa la persistencia del directorio en la base actual.

## Ensayo verificado

El runner `run-capture-schema-verification` admite `CUSTOMER_ADAPTER_VERIFICATION=ROLLBACK_ONLY_APP_API_HTTP`. Conserva baseline read-only, una transacción PostgreSQL, migraciones/fixtures temporales, ROLLBACK en éxito/fallo y postcheck del catálogo/permisos originales. El hook reutiliza exactamente la sesión existente; Nest no abre un pool alternativo.

Se compila AppModule completo con el DATABASE_CLIENT de esa sesión y un verificador Auth controlado que acepta sólo un token efímero generado en memoria. APP_GUARD, parsers, servicios, lookup de membresías, RBAC y adapters SQL son los productivos. El socket HTTP escucha únicamente en 127.0.0.1 con puerto efímero; peticiones secuenciales tienen timeout y el servidor se cierra en finally. No crea usuarios Auth ni envía comunicaciones.

Cobertura: aliases useExisting; las cinco rutas profile/address/address/validate/search/detail exigen autenticación; token rechazado y falta de token devuelven 401; body inválido 400; scope inválido 403; actor inyectado 400; alta y replay 200; divergencia 409; dirección y validación explícita; búsqueda y detalle con identidad elegida; missing 404; viewer 403 en las cinco rutas; restaurar cashier recupera lectura; revocar la membresía deniega las cinco rutas con el mismo token. Respuestas autenticadas incluyen private, no-store.

No equivale a un nuevo ensayo de login/revocación Supabase Auth. La autoridad Auth externa se sustituye sólo dentro del arnés; no se cambia la configuración productiva.

## Reproducción desde la raíz

Requiere el secreto administrativo local ignorado `.env.adr010.local` y la CA `.certs/prod-ca-2021.crt`. Nunca imprimir su contenido. El destino exacto verificado es zwbyiefqeujstyzysydn, pooler de sesión 5432, base postgres, TLS verify-full. Eliminar sslrootcert de la copia de URL sólo evita duplicar el parámetro: la CA se carga/valida y se entrega explícitamente al driver con rejectUnauthorized=true.

```powershell
npm.cmd run build --prefix apps/api
node --env-file=.env.adr010.local --input-type=module -e "const u=new URL(process.env.ADR010_DATABASE_URL); u.searchParams.delete('sslrootcert'); process.env.SCHEMA_VERIFICATION_CONFIRMATION='ROLLBACK_ONLY'; process.env.SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF='zwbyiefqeujstyzysydn'; process.env.SCHEMA_VERIFICATION_DATABASE_URL=u.toString(); process.env.SCHEMA_VERIFICATION_CA_CERT_PATH='.certs/prod-ca-2021.crt'; process.env.CUSTOMER_ADAPTER_VERIFICATION='ROLLBACK_ONLY_APP_API_HTTP'; await import('./apps/api/dist/operations/run-capture-schema-verification.js');"
```

El permiso SET temporal ya autorizado se limita a la misma transacción; guard exige postgres y membresía original ADMIN=true/INHERIT=false/SET=false antes del GRANT temporal. RESET ROLE y SET=false preceden al catálogo candidato. El postcheck exige también opciones/grantor originales. Ninguna autorización persistente se infiere de este ensayo.

Resultado 2026-09-16: customer_http ok como app_api; catálogo 27/5/36 → 35/5/41 → 27/5/36. El primer lanzamiento se rechazó antes de conectar por sslrootcert; el siguiente falló en connect bajo sandbox, antes de efectos; la ejecución con acceso acotado pasó.

## Siguiente corte: concurrencia

Una segunda conexión no ve DDL ni fixtures no confirmadas de la primera. pg_export_snapshot tampoco comparte cambios no confirmados; Promise.all sobre un único pg.Client no demuestra concurrencia. No ampliar el hook actual para abrir otra sesión ni hacer COMMIT remoto.

Hace falta PostgreSQL 17 desechable local con baseline+candidatos y fixtures confirmados exclusivamente allí. No se detectaron Docker/PostgreSQL ejecutables ni servicios locales durante la auditoría. El arnés separado debe restringir destino a localhost/base dedicada, usar dos pg.Client como app_api, deadlines y barreras verificadas con pg_blocking_pids. A retiene el lock con BEGIN; B espera; COMMIT A local permite observar replay/conflict de B. Verificar journal, versiones e identidades tras ambos resultados.

Emmanuel eligió PostgreSQL local desechable durante este corte. El runner `run-local-customer-concurrency.ts` crea un cluster único en `.cache/postgres-local/<runId>`, con password aleatorio, SCRAM y escucha 127.0.0.1 en puerto libre. No instala servicios, modifica PATH ni lee URLs/env remotas. Arranca procesos con windowsHide y detiene el cluster en finally; elimina el archivo individual de password. Conserva los datos locales ignorados para inspección, sin borrado recursivo.

Binarios portátiles PostgreSQL 17.11-3: [archivo oficial EDB](https://get.enterprisedb.com/postgresql/postgresql-17.11-3-windows-x64-binaries.zip), publicado en [descargas de binarios EDB](https://www.enterprisedb.com/download-postgresql-binaries). Descomprimir en `.cache/postgres-local/`, de modo que exista `pgsql/bin/postgres.exe`. El runner exige versión 17 antes de crear cluster. No versionar archivo ZIP/binarios/data ni distribuirlos como parte del producto.

```powershell
npm.cmd run build --prefix apps/api
node apps/api/dist/operations/run-local-customer-concurrency.js --local-disposable-only
```

Bootstrap aplica las 24 migraciones fuente existentes, en base única `superrestaurant_concurrency_<runId>` y cluster propios. Un shim Auth local mínimo aporta únicamente `auth.users` para FK y `auth.uid()` nulo; no prueba el proveedor Supabase Auth. Los writers usan SET LOCAL ROLE app_api y lo comprueban; el observer local verifica locks/estado. Se exigen PG17, dirección loopback, base exacta y marcador inequívoco antes de comandos. El rol postgres es superuser sólo en este cluster; no se infiere equivalencia de configuración administrativa con Supabase remoto.

Resultado local 2026-09-16 (`runId=6022f921bdf946a4bd3420170ff9b269`): Customer pasó 11 checks con cinco pares bloqueados observados, perfil v3/dirección v3, seis eventos aceptados de esa identidad y un evento único de la colisión UUID separada. Ningún replay/conflict sumó eventos; la edición vigente limpió la atestación. Capture pasó ocho checks con tres pares bloqueados, versión 5 y cinco eventos: create/replay exacto, claim y resume concurrentes entre dos actores y replay exacto de resume. Cleanup confirmó `stopped=true`. El shim Auth local y superuser local siguen siendo límites explícitos de esta evidencia.

Casos: misma key/payload aplicado+replay; key divergente aplicado+conflict; keys distintas y misma expectedVersion un éxito/un conflicto; creación con mismo UUID sin huérfanos; validate contra edición Address con CAS/limpieza; claim/resume Capture con único dueño/lease; reloj autoritativo después de espera y vencimiento. Rollback A seguido de éxito B no prueba replay tras commit.

## Prueba humana

La interfaz `/app/customers` ya existe y pasó navegador real con un fixture local sintético: búsqueda/selección, dirección incompleta, validación, invalidación al editar y replay de resultado ambiguo; 1280×800 y 390×844 sin overflow ni consola. No pedir todavía prueba humana funcional contra datos reales: el schema candidato no está aplicado.

Después de una autorización separada para aplicar exactamente 20260916000100–20260916000800 y completar postchecks/E2E, la prueba manual será: iniciar sesión con rol operativo; elegir sucursal; buscar un teléfono compartido y seleccionar una identidad explícita; dar de alta nombre+teléfono; guardar dirección incompleta; completar calle/localidad/país y validarla; editar calle y comprobar que vuelve a pendiente; abrir dos estaciones y provocar conflicto/reload. Confirmar que kitchen/viewer/auditor no acceden y que ninguna búsqueda cruza Restaurant. No incluir datos personales reales en el ensayo inicial.
