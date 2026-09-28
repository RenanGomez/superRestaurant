# Customer: verificación HTTP rollback-only

Estado del corte: REVIEW. Las migraciones 20260916000100–20260916000800 y la corrección 20260917000100 quedaron aplicadas persistentemente al proyecto `zwbyiefqeujstyzysydn` con autorización explícita. La API Customer y la UI autenticada están verificadas; falta el enlace con Capture/Order.

## Ensayo verificado

El runner `run-capture-schema-verification` admite `CUSTOMER_ADAPTER_VERIFICATION=ROLLBACK_ONLY_APP_API_HTTP`. Conserva baseline read-only, una transacción PostgreSQL, migraciones/fixtures temporales, ROLLBACK en éxito/fallo y postcheck del catálogo/permisos originales. El hook reutiliza exactamente la sesión existente; Nest no abre un pool alternativo.

Se compila AppModule completo con el DATABASE_CLIENT de esa sesión y un verificador Auth controlado que acepta sólo un token efímero generado en memoria. APP_GUARD, parsers, servicios, lookup de membresías, RBAC y adapters SQL son los productivos. El socket HTTP escucha únicamente en 127.0.0.1 con puerto efímero; peticiones secuenciales tienen timeout y el servidor se cierra en finally. No crea usuarios Auth ni envía comunicaciones.

Cobertura: aliases useExisting; las cinco rutas profile/address/address/validate/search/detail exigen autenticación; token rechazado y falta de token devuelven 401; body inválido 400; scope inválido 403; actor inyectado 400; alta y replay 200; divergencia 409; dirección y validación explícita; búsqueda y detalle con identidad elegida; missing 404; viewer 403 en las cinco rutas; restaurar cashier recupera lectura; revocar la membresía deniega las cinco rutas con el mismo token. Respuestas autenticadas incluyen private, no-store.

No equivale a un nuevo ensayo de login/revocación Supabase Auth. La autoridad Auth externa se sustituye sólo dentro del arnés; no se cambia la configuración productiva.

## Reproducción desde la raíz

Requiere el secreto administrativo local ignorado `.env.adr010.local` y la CA `.certs/prod-ca-2021.crt`. Nunca imprimir su contenido. El destino exacto verificado es zwbyiefqeujstyzysydn, pooler de sesión 5432, base postgres, TLS verify-full. Eliminar sslrootcert de la copia de URL sólo evita duplicar el parámetro: la CA se carga/valida y se entrega explícitamente al driver con rejectUnauthorized=true.

`run-capture-schema-verification` fija conteos de catálogo (`SUMMARY_SQL` esperado) que ya no coinciden con el catálogo actual tras las migraciones posteriores; no reproducir el ensayo HTTP con este runner sin actualizar antes sus expectativas. Para inspección de sólo lectura contra el catálogo vigente, usar la sonda genérica `pnpm --filter @super-restaurant/api run probe:migration:rollback` (ver `docs/runbooks/migration-apply.md`) o los nuevos `preflight:migrations`/`postcheck:migrations`.

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

Bootstrap aplica las 25 migraciones fuente existentes, en base única `superrestaurant_concurrency_<runId>` y cluster propios. Un shim Auth local mínimo aporta únicamente `auth.users` para FK y `auth.uid()` nulo; no prueba el proveedor Supabase Auth. Los writers usan SET LOCAL ROLE app_api y lo comprueban; el observer local verifica locks/estado. Se exigen PG17, dirección loopback, base exacta y marcador inequívoco antes de comandos. El rol postgres es superuser sólo en este cluster; no se infiere equivalencia de configuración administrativa con Supabase remoto.

Resultado local 2026-09-16 (`runId=6022f921bdf946a4bd3420170ff9b269`): Customer pasó 11 checks con cinco pares bloqueados observados, perfil v3/dirección v3, seis eventos aceptados de esa identidad y un evento único de la colisión UUID separada. Ningún replay/conflict sumó eventos; la edición vigente limpió la atestación. Capture pasó ocho checks con tres pares bloqueados, versión 5 y cinco eventos: create/replay exacto, claim y resume concurrentes entre dos actores y replay exacto de resume. Cleanup confirmó `stopped=true`. El shim Auth local y superuser local siguen siendo límites explícitos de esta evidencia.

Casos: misma key/payload aplicado+replay; key divergente aplicado+conflict; keys distintas y misma expectedVersion un éxito/un conflicto; creación con mismo UUID sin huérfanos; validate contra edición Address con CAS/limpieza; claim/resume Capture con único dueño/lease; reloj autoritativo después de espera y vencimiento. Rollback A seguido de éxito B no prueba replay tras commit.

## Corrección de dirección incompleta

La prueba autenticada del 2026-09-17 encontró que el SQL publicado devolvía `conflict` tanto para CAS obsoleto como para datos incompletos. La candidata `20260917000100` devuelve `rejected` cuando falta calle, localidad o país; Nest responde 400 y conserva 409 para concurrencia real. Verificación rollback-only exacta:

```powershell
npm.cmd run build --prefix apps/api
node --env-file=.env.adr010.local --input-type=module -e "const u=new URL(process.env.ADR010_DATABASE_URL); u.searchParams.delete('sslrootcert'); process.env.SCHEMA_VERIFICATION_CONFIRMATION='ROLLBACK_ONLY'; process.env.SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF='zwbyiefqeujstyzysydn'; process.env.SCHEMA_VERIFICATION_DATABASE_URL=u.toString(); process.env.SCHEMA_VERIFICATION_CA_CERT_PATH='.certs/prod-ca-2021.crt'; await import('./apps/api/dist/operations/run-customer-address-validation-schema-verification.js');"
```

Resultado rollback-only: base/migrated/postcheck 35/5/41. La fixture comprueba `rejected`, versión sin cambio, ausencia de evento y la ruta completa todavía aplicable. Después se aplicó persistentemente sólo `20260917000100`: dry-run previo anunció una versión, post-dry-run quedó al día e historial final 29. Un postcheck `READ ONLY` confirmó la función persistida. La UI autenticada mostró la instrucción de completar calle/localidad/país; cleanup eliminó 1 Customer, 1 teléfono, 1 dirección y 2 eventos, con residuo cero.

## Prueba humana

La interfaz `/app/customers` ya existe y pasó navegador real con un fixture local sintético: búsqueda/selección, dirección incompleta, validación, invalidación al editar y replay de resultado ambiguo; 1280×800 y 390×844 sin overflow ni consola. La E2E remota `a8d4a8ba-101e-4e70-ba86-587fdb1b3e98` añadió 14 checks con Auth/RBAC/API/PostgreSQL reales y cleanup completo. La prueba autenticada del 2026-09-17 completó también alta, persistencia, búsqueda y conflicto entre dos estaciones; tras aplicar `20260917000100`, el rechazo incompleto mostró el mensaje correcto. Ambos cleanups terminaron con residuo cero.

Prueba manual: iniciar sesión con rol operativo; elegir sucursal; buscar un teléfono compartido y seleccionar una identidad explícita; dar de alta nombre+teléfono; guardar dirección incompleta; completar calle/localidad/país y validarla; editar calle y comprobar que vuelve a pendiente; abrir dos estaciones y provocar conflicto/reload. Confirmar que kitchen/viewer/auditor no acceden y que ninguna búsqueda cruza Restaurant. No incluir datos personales reales en el ensayo inicial.

## Aplicación persistente 2026-09-16

El historial previo tenía 20 versiones. `20260908000100` no figuraba en `supabase_migrations` aunque su catálogo ya existe, por lo que se excluyó del staging y no se reejecutó ni reparó. El staging temporal reunió copias hash-idénticas de las 20 registradas y las ocho autorizadas; el dry-run anunció sólo 001–008, sin seed, roles ni Vault. El apply finalizó con código 0 y el historial quedó en 28 versiones. Auditoría posterior: 35 tablas RLS+FORCE, 5 políticas, 41 funciones `SECURITY DEFINER`, `app_api` LOGIN/SCRAM/vigencia infinita, membresía postgres ADMIN=true/INHERIT=false/SET=false, cero sesiones y lint SQL limpio. El post-dry-run reportó remoto al día y el staging se eliminó.
# S2.1: enlace Capture/Customer (2026-09-17)

## S2.2: dirección validada de Capture

`POST /api/v1/captures/fulfillment` selecciona o quita una dirección para el party snapshot actual. La selección requiere `customerSnapshotRef`, `addressId` y `expectedAddressVersion`; el servidor rechaza otra sucursal/cliente, dirección editada, eliminada, incompleta o sin validación vigente. `20260917000300` fue aplicada como única pendiente: historial 31, catálogo 35/5/43. El runner local exacto ahora exige 27 migraciones y prueba rollback 42→43→42 más carreras `app_api`; corrida final `d00b050929c9450bb5edb5faf7649889`. No existe aún UI Capture para prueba manual.

Actualización de cierre: rollback remoto y postcheck pasaron; se aplicó únicamente `20260917000200`, historial 30 versiones, catálogo persistido 35/5/42. Las notas siguientes de migración pendiente son evidencia histórica superada. El usuario postgres administrado no puede SET ROLE app_api; el runner remoto elimina sólo esas instrucciones de la fixture y conserva la auditoría de grants, mientras el runner local sí ejerce los writers como app_api. El tiempo de conexión del verificador es 15 s.

`POST /api/v1/captures/customer` requiere autenticación, `captures.update`, `customers.read` al seleccionar, versión/lease/propietario Capture y versión Customer. El comando v1 extiende la mutación con lease e incluye `customerId`, `contactId`, `expectedCustomerVersion`; los tres null quitan el cliente. No acepta nombre, teléfono ni referencias arbitrarias de snapshot. Seleccionar/reemplazar crea snapshot nuevo; replay devuelve exactamente el resultado anterior; quitar conserva el histórico. No confirma una captura ni entrega/cobra un pedido.

Verificación local reproducible desde raíz:

```powershell
npm.cmd run build --prefix packages/shared-types
npm.cmd run build --prefix apps/api
node apps/api/dist/operations/run-local-customer-concurrency.js --local-disposable-only
```

El runner exige PostgreSQL 17 portable en `.cache/postgres-local/pgsql/bin`, loopback, base nueva marcada y conjunto exacto de 26 migraciones. Ignora URLs remotas. Audita baseline 25, aplica 002 + invariantes dentro de transacción, hace rollback y postcheck `35/5/41 → 35/5/42 → 35/5/41`; después aplica 002 sólo a ese clúster desechable para carreras reales como `app_api`. Detiene el clúster en `finally`. Corrida final `17b9bb2cbece48a8ac386f338e37e3d9`: Customer 11/5 bloqueos y Capture 24/6, cleanup detenido.

El runner remoto `npm.cmd run verify:capture-customer-schema:rollback --prefix apps/api` usa la configuración `SCHEMA_VERIFICATION_*` habitual: destino exacto `zwbyiefqeujstyzysydn`, `ROLLBACK_ONLY`, TLS verify-full y CA aprobada. No imprime URL/secretos. Corridas de esta sesión fallaron en conexión antes de efectos: esta evidencia no sustituye una prueba remota exitosa. La nueva migración sigue pendiente. Con autorización de migraciones vigente, recuperar conexión, verificar rollback y usar staging exacto/dry-run de sólo `20260917000200` antes de aplicar/postcheck. No ejecutar push raíz ni reejecutar la versión administrativa 20260908000100 ausente del historial.

No se añadieron controles Capture a la UI en S2.1. Las pruebas manuales de selección dentro de Capture se solicitarán cuando exista esa pantalla; `/app/customers` conserva el flujo ya revisado.

## Smoke protegido de continuidad Capture

`verify:capture-continuity-protected-smoke:remote` reutiliza el tenant Auth/RBAC 2×2 y la API Nest del arnés de tenancy. Antes de la pausa de navegador crea por HTTP, con el token manager temporal, un Customer marcado por `runId`, un teléfono, una Address completa/validada y un Capture `draft` con snapshots Customer/Address. Publica en `.capture-continuity-smoke-lease.tmp` sólo la credencial temporal, scope e identidades esperadas; nunca publica access token, URL PostgreSQL ni secretos administrativos.

El navegador debe recuperar el mismo folio, comprobar los snapshots congelados, cambiar origen de Teléfono a WhatsApp manual, esperar la versión guardada, recargar y recuperar otra vez. Antes de aceptar el ack, revisar D2 en `/app/customers` y abrir/cancelar `+ Nueva dirección` con “Datos adicionales” colapsado en escritorio y 390×844. El ack exacto es `{ "phase": "capture_continuity", "runId": "<runId>" }`. Después del ack el runner exige journal continuo de seis operaciones (`created`, Customer, fulfillment, claim, autosave, claim), versión 6, ambos snapshots, `delivery`, origen `whatsapp_manual` y ausencia de Order.

El cleanup normal valida ownership y borra dentro de una transacción, en este orden: `capture_command_events`, `capture_drafts`, fulfillment snapshots, party snapshots, `customer_command_events`, addresses, phones y Customer. Sólo después el arnés base elimina grants, memberships, branches, restaurants y usuarios Auth. El postcheck exige cero residuos.

Si el proceso se interrumpe después de emitir `runId`, no repetir el smoke. Ejecutar el recovery específico con la misma confirmación fuerte del recovery de tenancy:

```text
npm.cmd run recover:capture-continuity-smoke:remote --prefix apps/api -- --run-id=<UUID> --confirm=DELETE_TENANCY_E2E_FIXTURES_FOR_RUN:<UUID>
```

Ese recovery toma el mismo advisory lock, acepta sólo prefijos legítimos del flujo (Customer, Address v1/v2, Capture versiones 1–6), rechaza actor/tenant ajeno, filas extra, journal no prefijo o Capture confirmado, elimina primero las ocho superficies de continuidad y delega después al recovery 2×2 existente. Al terminar, retirar únicamente los tres `.capture-continuity-smoke-*.tmp` si aún existen.
