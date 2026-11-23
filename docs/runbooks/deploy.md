# Runbook de despliegue (deploy)

Procedimiento de liberación de **superRestaurant** sobre la arquitectura base de
ADR-010 opción B: Supabase administrado (PostgreSQL + Auth + Storage) como
persistencia, **NestJS `apps/api`** como única frontera de escrituras críticas,
Next.js `apps/web` para backoffice y POS web/PWA, Vite `apps/kds` para cocina y
Expo `apps/mobile`.

> **Autonomía y puertas (`AGENTS.md` §19.6).** Desde 2026-11-23 el orquestador no
> espera aprobación humana: despliega solo, pero **solo** si pasa las puertas
> automáticas de este runbook: staging primero, migraciones probadas y
> postcheckeadas, respaldo verificable, health/readiness verdes, smoke en
> navegador real y rollback documentado y disponible (`docs/runbooks/rollback.md`).
> Ninguna puerta se baja para destrabar un corte. Si una puerta falla dos veces,
> el corte queda BLOCKED con evidencia y se registra en `HANDOFF.md`.
>
> Este documento es la guía operativa; **no** sustituye las decisiones de
> producto sobre hosting, dominios, TLS de borde y política de respaldo, que
> siguen abiertas (`docs/plans/mvp-cierre-2026-11-22.md`, ola 2). Mientras no
> exista un destino de hosting elegido y un entorno de staging provisionado, el
> despliegue a producción queda bloqueado por diseño (sección 9).

## 0. Estado real del repositorio (verificado 2026-11-23)

- **Aplicaciones:** `apps/api` (NestJS, escrituras críticas), `apps/web` (Next.js),
  `apps/kds` (Vite) y `apps/mobile` (Expo). `packages/*` son librerías de workspace.
- **CI:** `.github/workflows/ci.yml` ejecuta tres jobs sobre cada PR y sobre `main`:
  `verify` (lint, typecheck, test, build), `pg-verify` (migraciones desde cero,
  invariantes SQL y verificadores rollback sobre PostgreSQL 17) y `e2e-smoke`
  (Playwright). **No hay job de despliegue**: el despliegue es manual y este
  runbook es el procedimiento.
- **Hosting:** el repositorio **no** contiene `Dockerfile`, `docker-compose`,
  `vercel.json`, `fly.toml` ni manifiesto equivalente. El destino se decide fuera
  del repo; este runbook es agnóstico de proveedor y describe los pasos comunes.
- **Esquema:** `supabase/migrations/*.sql` es la única autoridad del esquema; los
  cambios se aplican con `docs/runbooks/migration-apply.md`. Nunca se edita una
  migración ya aplicada.
- **Salud implementada** en `apps/api/src/app-setup.ts` y
  `apps/api/src/health.controller.ts`:
  - `GET /health` (raíz) y `GET /api/v1/health` → `200 {"status":"ok"}`.
  - `GET /ready` (raíz) → `200 {"status":"ready"}` si `select 1` responde en
    2 s; `503 {"status":"unavailable"}` si la base no responde.
  - `GET /metrics` (raíz) → `404` si `METRICS_TOKEN` no está definido; `401` con
    token incorrecto; `200 {requests, errors, latencyMsTotal}` con
    `Authorization: Bearer <METRICS_TOKEN>`.
- **Topología v1.0 (ADR-011):** `apps/api` corre con **una sola réplica**; el
  Socket.IO `/realtime/v1` no tiene backplane multi-réplica. El despliegue
  reinicia la instancia (ventana de mantenimiento breve asumida).
- **Runtime:** Node `24.19.0` y pnpm `11.19.0` (`package.json` `engines`). En
  Windows: `. .\tools\agentic\use-node24.ps1`. En CI se usa exactamente esa
  versión.

## 1. Prerrequisitos

- CI en verde sobre el SHA exacto a desplegar (`verify`, `pg-verify`,
  `e2e-smoke`).
- SHA o tag congelado (`m<N>-rc<k>` o SHA completo). No desplegar una rama móvil.
- Entorno de **staging** con su propio proyecto Supabase (`project_ref` distinto)
  y su propio host de API/web. Sin staging no hay producción (sección 4 y 9).
- Respaldo vigente y verificado del entorno destino
  (`docs/runbooks/backup-restore.md`).
- CA de Supabase (`prod-ca-2021.crt` o la que corresponda) fuera de Git, en una
  ruta montada en el host. `.certs/` está ignorado; nunca se versiona.
- Secretos cargados desde el gestor de secretos del proyecto. Nunca en Git, en
  `.env` versionado, en logs ni en prompts.
- Rollback preparado: SHA bueno anterior identificado y matriz de compatibilidad
  esquema/binario revisada (`docs/runbooks/rollback.md` §1).

### Variables por aplicación (nombres reales del código)

| App | Variables | Validación fail-closed observada en el código |
|---|---|---|
| `apps/api` | `PORT` (default `3000`), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DATABASE_CA_CERT_PATH`, `SYSTEM_ONBOARDING_INVITE_REDIRECT_URL`, `SUPABASE_SECRET_KEY` (opcional), `METRICS_TOKEN` (opcional) | `SUPABASE_URL` debe ser HTTPS raíz sin ruta/query; `DATABASE_URL` debe apuntar al `project_ref` de `SUPABASE_URL`, usar rol `app_api`, `sslmode=verify-full` como único parámetro y no llevar otros query params; la CA se lee, se parsea como X509 y debe estar vigente. Sin `SUPABASE_SECRET_KEY`, la subida de imágenes a `catalog-images` responde `unconfigured` (el resto del POS sigue). `METRICS_TOKEN` ausente deja `/metrics` en `404`. |
| `apps/web` | `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `API_BASE_URL`, `WEB_ORIGIN`, `RECEIPT_COOKIE_SECRET` (opcional, ≥ 32 caracteres) | Sin variables `NEXT_PUBLIC_*`: el cliente Supabase no se envía al navegador. `API_BASE_URL` debe usar `https://` en producción (`http://localhost`/`127.0.0.1` solo fuera de producción). `WEB_ORIGIN` define si las cookies de sesión son `Secure`. Sin `RECEIPT_COOKIE_SECRET`, el cobro funciona pero el recibo no se muestra. |
| `apps/kds` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` | Se inyectan en el build; solo clave `sb_publishable_*`. |
| `apps/mobile` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_API_BASE_URL` | Solo `EXPO_PUBLIC_*` llega al bundle; se rechaza una clave secreta o `service_role` al arrancar. |

Reglas de secretos: la clave privada de base de datos y `SUPABASE_SECRET_KEY`
existen solo en el servidor. Ningún cliente recibe cadena de conexión ni
secretos de servidor. No imprimir valores de variables en logs del corte.

## 2. Congelar versión y ensayo local (pre-flight)

```bash
git fetch origin --tags
git checkout --detach <sha-o-tag>
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Opcional pero recomendado cuando el corte toca dinero, caja o sync: ejecutar el
flujo HTTP local contra PostgreSQL 17 desechable para repetir el recorrido
crítico antes de tocar staging:

```bash
pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only
```

El ensayo local **no** sustituye a staging: valida el artefacto, no el entorno.

## 3. Orden del corte

El orden es fijo: respaldo → migraciones → API → clientes → verificación. Nunca
se enciende un binario nuevo contra un esquema que no lo soporta, ni se publican
clientes contra una API que aún no responde.

## 4. Staging primero (puerta obligatoria)

Objetivo: repetir el corte completo en un entorno equivalente, con datos no
reales y secretos distintos, antes de producción.

1. **Preflight de esquema en staging** (solo lectura), con el `project_ref` de
   staging y su CA:

   ```powershell
   $env:SCHEMA_VERIFICATION_CONFIRMATION = "READ_ONLY"
   $env:SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF = "<staging-project-ref>"
   $env:SCHEMA_VERIFICATION_DATABASE_URL = "<url-admin-staging sslmode=verify-full>"
   $env:SCHEMA_VERIFICATION_CA_CERT_PATH = (Resolve-Path ".certs/<ca>.crt").Path
   pnpm --filter @super-restaurant/api run preflight:migrations
   ```

2. **Respaldo de staging** o confirmación de que staging es desechable y se
   reconstruye desde `supabase/migrations` (registrar cuál de las dos).
3. **Aplicar las migraciones candidatas** si `localMissingInRemote` las anuncia,
   siguiendo `docs/runbooks/migration-apply.md`: sonda `probe:migration:rollback`,
   staging hash-idéntico, `supabase db push --dry-run`, apply único,
   `postcheck:migrations` y segundo `--dry-run` con `upToDate`. El paso de
   "apply" de ese runbook conserva una nota antigua de autorización humana
   sustituida por §19.6; el protocolo de seguridad (rollback-only previo,
   postcheck, sin reintentos ante ambigüedad) sigue siendo obligatorio.
4. **Desplegar `apps/api` en staging** con las variables de staging y esperar
   `/ready`.
5. **Desplegar `apps/web` y publicar `apps/kds`** con `API_BASE_URL` apuntando a
   la API de staging.
6. **Smoke de staging** (sección 6). Si algo falla, corregir en una rama nueva,
   repetir CI y volver al paso 1. Nunca "probar en producción".

Registrar el resultado de staging antes de continuar: SHA, versiones de
migración aplicadas, hora de inicio/fin, health/readiness, smoke y cualquier
desviación.

## 5. Producción

### Paso 1 — Respaldo previo

Confirmar el punto de restauración sano más reciente (PITR o respaldo diario) y
generar el respaldo lógico pre-corte si la política lo exige
(`docs/runbooks/backup-restore.md`). Registrar el identificador del respaldo y
su hora UTC.

### Paso 2 — Migraciones SQL (si hay candidatas)

Repetir exactamente el procedimiento validado en staging y en
`docs/runbooks/migration-apply.md`, contra el `project_ref` de producción:

1. `preflight:migrations` en `READ_ONLY`.
2. Sonda `probe:migration:rollback` por cada candidata.
3. `supabase db push --dry-run` que anuncia **solo** las candidatas esperadas.
4. Un único apply, sin reintentos.
5. `postcheck:migrations` con las versiones aplicadas.
6. Segundo `--dry-run` que reporta `upToDate`.

Si el dry-run anuncia algo distinto de staging, **detenerse** y comparar
staging contra producción antes de aplicar. Un resultado ambiguo durante el
apply se trata como incidente (`docs/runbooks/rollback.md` §5.2): no reintentar,
inspeccionar en solo lectura.

### Paso 3 — `apps/api` (una réplica)

```bash
pnpm --filter @super-restaurant/api... build
NODE_ENV=production pnpm --filter @super-restaurant/api start
```

Esperar `GET /ready` → `200 {"status":"ready"}` antes de continuar. Un `503`
significa que la API no alcanza la base: no publicar clientes.

### Paso 4 — Clientes

```bash
# Backoffice y POS web
pnpm --filter @super-restaurant/web... build
NODE_ENV=production pnpm --filter @super-restaurant/web start

# KDS (estático; publicar dist en el host configurado)
pnpm --filter @super-restaurant/kds... build

# Mobile (bundle Android; la publicación en tiendas/EAS sigue una decisión aparte)
pnpm --filter @super-restaurant/mobile... build
```

- Publicar `apps/kds/dist` y purgar la caché del host estático.
- `apps/mobile` distribuye por el canal aprobado; el servidor sigue revalidando
  contratos y totales aunque el cliente esté atrasado.

### Paso 5 — Verificación de salud

```bash
curl -fsS https://<api-host>/api/v1/health
# Esperado: {"status":"ok"}

curl -fsS https://<api-host>/ready
# Esperado: {"status":"ready"}   (503 => no publicar clientes)

curl -s -o /dev/null -w "%{http_code}\n" https://<api-host>/api/v1/access/memberships
# Esperado: 401 (guardia de autenticación activa)
```

`/metrics` es privado: si `METRICS_TOKEN` está definido, comprobar
`200` con `Authorization: Bearer <token>` y `401` sin él. No exponer `/metrics`
a Internet; si el host no puede restringirlo, dejar `METRICS_TOKEN` sin definir
(devuelve `404`).

### Paso 6 — Smoke en navegador real

Ejecutar la guía operativa vigente (`docs/runbooks/guia-de-pruebas-operador.md`)
y el smoke HTML de la ronda (`docs/smoke/smoke-2026-11-21.html`) en escritorio y
390×844, con consola y red limpias:

1. `https://<web-host>/login` responde `200`; cookies de sesión `HttpOnly` y
   `Secure` cuando `WEB_ORIGIN` es HTTPS; sin errores de consola.
2. Autenticación con cuenta de verificación, selección de sucursal y lectura de
   menú, órdenes activas y caja sin `5xx`.
3. KDS: suscripción a `/realtime/v1` y recuperación por cursor
   (`GET /api/v1/kds/events`, `GET /api/v1/kds/tickets`) tras recargar.
4. Un recorrido de operador sin efectos irreversibles en producción (abrir
   pantalla, consultar, no cobrar real). Los recorridos con cobro solo en
   staging o con datos de prueba.

No declarar el corte exitoso sin captura o registro de estos puntos. Lo no
probado se reporta como no probado.

### Paso 7 — Cierre y registro

Registrar en `HANDOFF.md`: SHA/tag desplegado, hosts y `project_ref` de
staging/producción, versiones de migración aplicadas, resultado de
health/readiness/metrics, smoke ejecutado (y lo que quedó sin probar), hora de
inicio y fin en **America/Phoenix y UTC**, incidentes y rollback si hubo.
Actualizar el smoke de la ronda según §19.5.

## 6. Lista mínima de smoke (staging y producción)

| # | Comprobación | Criterio |
|---|---|---|
| 1 | `GET /api/v1/health` | `200 {"status":"ok"}` |
| 2 | `GET /ready` | `200 {"status":"ready"}` |
| 3 | `GET /api/v1/access/memberships` sin token | `401` |
| 4 | `/metrics` | `404` sin token, `401` token inválido, `200` con token (si está configurado) |
| 5 | `/login` | `200`, consola limpia, cookies correctas |
| 6 | Login + sucursal + menú | datos autoritativos, sin `5xx` |
| 7 | Órdenes activas y caja (lectura) | responde con el scope correcto |
| 8 | KDS realtime + cursor | eventos y recuperación tras recarga |
| 9 | Migraciones | `postcheck` sin faltantes ni duplicados; segundo dry-run `upToDate` |

## 7. Manejo de fallos durante el corte

- Fallo de salud o del smoke → no continuar y evaluar rollback
  (`docs/runbooks/rollback.md`). Con una sola réplica, la reversión de
  aplicación implica una ventana breve de indisponibilidad.
- Apply ambiguo o error de conexión a mitad de migración → **detener
  reintentos**, inspeccionar en `READ_ONLY` y decidir con el estado real.
- Migración aplicada defectuosa → migración compensatoria nueva; nunca editar
  la aplicada ni tocar `supabase_migrations.schema_migrations` a mano.
- Corrupción o DDL irreversible → restaurar respaldo verificado
  (`docs/runbooks/backup-restore.md`), nunca improvisar datos.

## 8. Decisiones y supuestos conservadores

- Hosting, dominios y TLS de borde: sin decidir; el runbook no elige proveedor.
- Política de respaldo (PITR vs diario): sin ratificar; se asume PITR para
  producción por el riesgo financiero (`docs/runbooks/backup-restore.md` §1).
- Publicación de mobile: canal sin decidir; el corte web/KDS no depende de ella.
- Una réplica de API: restricción vigente de ADR-011, no una elección del corte.

## 9. Brechas conocidas (no ocultar en el reporte del corte)

- No existe manifiesto de despliegue ni job de CD en el repositorio; el host se
  opera fuera de Git y este runbook debe adaptarse al proveedor elegido.
- **No hay entorno de staging provisionado todavía.** Hasta que exista, la
  sección 4 no puede cumplirse y un despliegue a producción queda BLOCKED por
  la puerta de §19.6, no por falta de runbook.
- No hay ensayo automatizado de rollback ni de restauración en CI; se ejecutan
  como procedimientos manuales documentados y se registran en `HANDOFF.md`.
- `/metrics` expone contadores en proceso, no por ruta ni percentiles; sirve
  como señal mínima de §16, no como panel completo.
- La observabilidad distribuida (trazas, alertas, dashboards) no está
  implementada; los logs estructurados con `correlationId`, `restaurantId`,
  `branchId`, `orderId` y latencia sí existen en la API.
