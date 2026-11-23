# Runbook de despliegue (deploy)

Procedimiento de liberación para **superRestaurant** sobre la arquitectura base ADR-010 opción B (Supabase PostgreSQL/Auth/Storage + NestJS `apps/api` como única frontera de escrituras críticas + Next.js `apps/web` + Vite `apps/kds` + Expo `apps/mobile`).

> **Alcance y puertas humanas:** este documento es solo guía operativa. La elección de hosting, dominios, TLS de borde, credenciales reales y el despliegue a producción requieren autorización humana explícita (`AGENTS.md` §3.1; `docs/agentic/DECISIONS_PENDING.md`). Nunca despliegues ni apliques migraciones remotas sin autorización para el corte.

## 1. Prerrequisitos

- **Runtime:** Node `24.19.0` y pnpm `11.19.0` (`package.json` `engines`). En Windows activar Node 24 con `. .\tools\agentic\use-node24.ps1` (ver `docs/agentic/NODE.md`).
- **Calidad previa:** CI en verde sobre `main` (`verify`, `pg-verify`, `e2e-smoke` de `.github/workflows/ci.yml`), cero hallazgos P1 abiertos y commit/tag congelado (`m<N>-rc<k>` o SHA exacto).
- **Topología v1.0 (ADR-011):** `apps/api` se despliega con **1 sola réplica** (Socket.IO `/realtime/v1` sin backplane multi-réplica).
- **Certificado y secretos:** CA de Supabase vigente fuera de Git (`.certs/prod-ca-2021.crt` o ruta montada en el host) y variables cargadas desde gestor de secretos (nunca en logs ni en `.env` versionado).

### Variables requeridas por aplicación

| App | Variables obligatorias / relevantes | Notas de validación (fail-closed) |
|---|---|---|
| `apps/api` | `PORT` (default `3000`), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DATABASE_CA_CERT_PATH`, `SUPABASE_SECRET_KEY` (opcional al arranque; requerida para subir imágenes al bucket `catalog-images`) | `DATABASE_URL` debe usar rol `app_api`, `?sslmode=verify-full` y apuntar al `project_ref` de `SUPABASE_URL`; `SUPABASE_SECRET_KEY` (`sb_secret_*`) solo existe en servidor. |
| `apps/web` | `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `API_BASE_URL`, `WEB_ORIGIN`, `RECEIPT_COOKIE_SECRET` (≥ 32 chars) | Ninguna variable `NEXT_PUBLIC_*`; `API_BASE_URL` y `WEB_ORIGIN` exigen `https://` en producción (cookies `Secure`). |
| `apps/kds` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` | Inyectadas en build; solo clave `sb_publishable_*`. |
| `apps/mobile` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_API_BASE_URL` | Rechaza `sb_secret_*`, `service_role` o JWT; solo `https://` fuera de loopback. |

## 2. Procedimiento de despliegue

### Paso 1 — Congelar versión y validar build local

```bash
git fetch origin --tags
git checkout --detach <tag-o-sha>
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### Paso 2 — Respaldo previo y migraciones SQL (si existen candidatas)

1. Confirmar respaldo vigente en Supabase o generar respaldo lógico pre-corte (`docs/runbooks/backup-restore.md`).
2. Inspeccionar migraciones pendientes en modo solo lectura (`docs/runbooks/migration-apply.md` §1):

```powershell
$env:SCHEMA_VERIFICATION_CONFIRMATION = "READ_ONLY"
$env:SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF = "<project-ref>"
$env:SCHEMA_VERIFICATION_DATABASE_URL = "<url-admin sslmode=verify-full>"
$env:SCHEMA_VERIFICATION_CA_CERT_PATH = (Resolve-Path ".certs/prod-ca-2021.crt").Path
pnpm --filter @super-restaurant/api run preflight:migrations
```

3. Si `localMissingInRemote` tiene candidatas, ejecutar **todo** `docs/runbooks/migration-apply.md` (sonda `probe:migration:rollback` con `SCHEMA_VERIFICATION_CONFIRMATION="ROLLBACK_ONLY"`, staging hash-idéntico, `supabase db push --dry-run`, apply único autorizado, `postcheck:migrations` y segundo `--dry-run` `upToDate`) **antes** de encender el binario nuevo.

### Paso 3 — Construir e iniciar `apps/api` (1 réplica)

```bash
pnpm --filter @super-restaurant/api... build
NODE_ENV=production pnpm --filter @super-restaurant/api start
```

Esperar confirmación de salud del API antes de publicar los clientes (ver §3).

### Paso 4 — Construir y publicar `apps/web`, `apps/kds` y `apps/mobile`

```bash
# 1) Backoffice y POS web (Next.js)
pnpm --filter @super-restaurant/web... build
NODE_ENV=production pnpm --filter @super-restaurant/web start

# 2) KDS (estático Vite -> apps/kds/dist para servir por el host configurado)
pnpm --filter @super-restaurant/kds... build

# 3) Mobile (bundle Android -> apps/mobile/dist; publicación en tiendas/EAS sujeta a decisión humana)
pnpm --filter @super-restaurant/mobile... build
```

## 3. Verificación posterior

1. **Salud y guardia de autenticación del API** (prefijo global `/api/v1`):

```bash
curl -fsS https://<api-host>/api/v1/health
# Esperado: {"status":"ok"}

curl -s -o /dev/null -w "%{http_code}\n" https://<api-host>/api/v1/access/memberships
# Esperado: 401
```

*(Nota: `/ready` y métricas de latencia/errores entran con `m1-obs-health`; mientras tanto, confirmar acceso a BD y privilegios `app_api` con `preflight:migrations` o `postcheck:migrations` en `READ_ONLY`.)*

2. **Web y KDS en navegador real:**
   - Abrir `https://<web-host>/login`: HTTP `200`, consola sin errores, cookies de sesión `HttpOnly` + `Secure`.
   - Autenticarse con cuenta de verificación, elegir sucursal y comprobar lectura de menú, órdenes activas y caja (sin errores `5xx`).
   - Abrir KDS, verificar suscripción en `/realtime/v1` y recuperación por cursor (`GET /api/v1/kds/events` y `GET /api/v1/kds/tickets`).
3. **Cierre del corte:** registrar tag/SHA desplegado, versiones de migración aplicadas y hora local/UTC en `HANDOFF.md`. Ante cualquier fallo bloqueante, ejecutar `docs/runbooks/rollback.md`.
