# Consola local y recuperación del administrador sin correo

Destino fijo: proyecto `zwbyiefqeujstyzysydn`, usuario existente `rgafrog@gmail.com`, consola `http://localhost:8082`, API `http://127.0.0.1:3000`. Reservar 8081 para Expo. No ejecutar el arnés remoto Mobile que usa 8082.

## Configuración local

`apps/web/.env.local` debe contener exactamente `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `API_BASE_URL` y `WEB_ORIGIN`. La URL Supabase corresponde al proyecto fijado; los destinos locales son los anteriores. Nunca colocar una clave administrativa en web. No imprimir valores.

`apps/api/.env.local` contiene `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DATABASE_CA_CERT_PATH` y `PORT`. La conexión usa exclusivamente `app_api`, TLS con verificación y el certificado `.certs/prod-ca-2021.crt`; no contiene una clave administrativa de Auth. Estos archivos están ignorados por Git y no viajan a otro equipo con el push.

Desde la raíz, regenerar contratos y API si sus artefactos faltan o están desactualizados:

```powershell
pnpm --filter @super-restaurant/shared-types build
pnpm --filter @super-restaurant/domain build
pnpm --filter @super-restaurant/api build
```

Web: `pnpm --filter @super-restaurant/web dev --hostname localhost --port 8082`. En el equipo de este corte existe el lanzador local ignorado `tmp/start-local-api.mjs`: `node tmp/start-local-api.mjs` carga la configuración y fija el listener a `127.0.0.1:3000`. No se publica ese archivo temporal; en otro equipo preparar el arranque equivalente de `AppModule` con bind loopback y la configuración anterior. No iniciar servicios duplicados ni detener procesos ajenos. `GET /api/v1/health` debe responder 200; las rutas protegidas sin sesión, 401. Comprobar además la conexión PostgreSQL como `app_api`: health por sí solo no la verifica.

## Gate remoto y operación única

1. Abrir Supabase Authentication → URL Configuration del proyecto exacto. El último estado observado fue Site URL `http://localhost:3000` y ninguna Redirect URL. Está pendiente autorización humana para añadir **únicamente** `http://localhost:8082/auth/callback`; no cambiar Site URL ni añadir comodines. La autorización de commit/push no autoriza este cambio.
2. Tras aprobación, guardar esa URL y verificarla en el listado. No pasar la bandera de preflight verificado mientras falte esta evidencia.
3. Ejecutar `node tools/local-admin-recovery.mjs --preflight`. Solo consulta el usuario existente y su alta activa en `app.system_admins`, con transacción de lectura/ROLLBACK y comprobación Auth. Emite booleanos, nunca credenciales. Requiere las credenciales existentes de `.env.adr010.local` y el certificado local.
4. Comprobar que `tmp/local-admin-recovery.attempt.json` no existe. Si existe, **no borrarlo ni reintentar**: examinar únicamente su estado sanitizado y resolver el intento anterior con el humano. El estado `delivered` significa que se emitió la transferencia, no que se guardó la contraseña.
5. Con web/API verificadas y el destino aprobado, iniciar:

```powershell
node tools/local-admin-recovery.mjs --serve --confirm=RECOVER_EXISTING_GLOBAL_ADMIN --redirect-preflight=verified
```

6. Abrir `http://127.0.0.1:4319` y activar una vez **Abrir recuperación de contraseña**. GET no genera nada; el POST está limitado por nonce/origen y un journal exclusivo previo a la generación. El broker vence a los 15 minutos. No solicitar un correo paralelo.
7. La herramienta genera un recovery para el usuario comprobado, verifica el enlace contra el proyecto exacto y transfiere los tokens al callback en memoria. No copia enlaces en conversación, archivos, argumentos, capturas de red ni logs. No hay reintentos automáticos, tampoco tras errores ambiguos.
8. Verificar llegada a `/reset-password` con URL limpia. Entregar el control al humano para introducir, confirmar y guardar la nueva contraseña. No inspeccionar valores de los campos. Luego el humano inicia sesión y se revisa `/app/system-admin/restaurants`.

La excepción autorizada permite utilizar la clave administrativa existente solo en esta herramienta local para el recovery acotado. No permite rotarla, aprovisionar usuarios, migrar, modificar roles ni crear el tenant. Si el flujo falla, conservar evidencia sanitizada y detener la generación; nunca presentar el error bruto del proveedor.

## Verificación y continuación

Pruebas locales: `pnpm --filter @super-restaurant/web test`, `node tools/local-admin-recovery.test.mjs`, lint/typecheck/build web y lint explícito de ambos archivos de `tools`. Cubren replay, ausencia de tipo, errores de proveedor/red, identidad incorrecta, enlaces de otro destino, CSRF y colisiones del journal, sin E2E remotas.

Antes de crear Vittorinos Pizza: presentar preflight y payload exacto para autorización humana, con Sucursal Navojoa, `America/Hermosillo`, `MXN`, manager `emmanuel.rgomez@gmail.com`. Conservar P2 `IN_PROGRESS`: aún faltan la reautenticación del manager y el segundo reinicio nativo. No reutilizar los dos UUID prohibidos registrados en HANDOFF.
