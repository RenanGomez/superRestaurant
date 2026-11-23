# Runbook de rollback

Procedimiento de reversión segura para **superRestaurant** ante fallos de despliegue, regresiones en `main` o incidencias de migración SQL.

> **Reglas inviolables (`AGENTS.md` §3.1, §12 y §17):** nunca hacer `git push --force` ni reescribir historia compartida, nunca editar o borrar una migración SQL ya aplicada, y nunca ejecutar DDL destructivo o restauración sobre producción sin autorización humana explícita.

## 1. Prerrequisitos y criterios de disparo

**Disparadores:** `GET /api/v1/health` falla tras el corte, tasa anormal de `5xx`, errores en cobro/caja/confirmación/KDS, sospecha de fuga entre restaurantes/sucursales o CI rojo en `main` (`verify`, `pg-verify`, `e2e-smoke`).

Antes de actuar, reunir:
1. Último tag o SHA bueno conocido (`<good-tag-o-sha>`).
2. Lista de migraciones aplicadas en el corte (si hubo) y estado actual en modo solo lectura (`preflight:migrations`).
3. **Matriz de compatibilidad esquema ↔ binario:**
   - Si las migraciones del corte son **aditivas y compatibles hacia atrás**, revertir primero la aplicación (Escenario B).
   - Si una migración rompió firmas o columnas que necesita la versión previa, **no** bajar el binario a ciegas: aplicar migración compensatoria (Escenario C3) o restaurar respaldo (Escenario C4).

## 2. Escenario A — Rollback de código en Git (`main` roto)

Conforme a `docs/plans/plan-autonomo-100.md` §5.5, todo rollback en `main` entra por `git revert` en un PR (nunca `reset --hard` ni push directo a `main`):

```bash
git fetch origin main
git checkout -b revert/<short-sha> origin/main
git revert --no-edit <bad-commit-sha>
pnpm lint && pnpm typecheck && pnpm test
git push -u origin revert/<short-sha>
gh pr create --base main --title "revert: <motivo breve>" --body "Revierte <bad-commit-sha> por <causa>."
```

Para revertir un hito completo al tag previo (`m<N-1>-rc<k>`), generar una rama de reversión contra ese tag y fusionarla vía PR tras CI verde.

## 3. Escenario B — Rollback de aplicaciones desplegadas

Cuando el esquema es compatible con `<good-tag-o-sha>`:

```bash
# 1) Congelar despliegues y volver al artefacto bueno conocido
git fetch origin --tags
git checkout --detach <good-tag-o-sha>
pnpm install --frozen-lockfile
pnpm build

# 2) Reiniciar apps/api (1 réplica, ADR-011) y apps/web con la versión previa
NODE_ENV=production pnpm --filter @super-restaurant/api start
NODE_ENV=production pnpm --filter @super-restaurant/web start
```

- **KDS (`apps/kds`):** republicar `apps/kds/dist` generado desde `<good-tag-o-sha>` y purgar caché del host estático.
- **Mobile (`apps/mobile`):** publicar build/actualización de `<good-tag-o-sha>` por el canal de distribución configurado; el servidor sigue revalidando contratos y totales.

## 4. Escenario C — Rollback de migraciones y base de datos

### C1 — Fallo antes de aplicar (preflight, sonda o `--dry-run`)

No se modificó el remoto. Descartar el staging temporal, corregir la migración en una rama nueva y repetir `docs/runbooks/migration-apply.md`.

### C2 — Resultado ambiguo durante `supabase db push`

**Detener reintentos de inmediato** (`AGENTS.md` §3.1). Inspeccionar el estado real sin escribir:

```powershell
$env:SCHEMA_VERIFICATION_CONFIRMATION = "READ_ONLY"
$env:SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF = "<project-ref>"
$env:SCHEMA_VERIFICATION_DATABASE_URL = "<url-admin sslmode=verify-full>"
$env:SCHEMA_VERIFICATION_CA_CERT_PATH = (Resolve-Path ".certs/prod-ca-2021.crt").Path
pnpm --filter @super-restaurant/api run preflight:migrations
```

Revisar `remoteVersions` y `lastRemote`, y solicitar dirección humana antes de emitir cualquier cambio adicional.

### C3 — Migración aplicada defectuosa (camino estándar: migración compensatoria)

1. **No** editar el archivo ya aplicado ni alterar manualmente `supabase_migrations.schema_migrations`.
2. Crear una **nueva migración versionada** `supabase/migrations/<nuevo-timestamp>_revert_<slug>.sql` que restaure funciones `app_private.*`, vistas o reglas previas preservando íntegros los registros financieros y de auditoría.
3. Validar la compensatoria con `probe:migration:rollback` (`SCHEMA_VERIFICATION_CONFIRMATION="ROLLBACK_ONLY"`) y pruebas locales (`pnpm --filter @super-restaurant/api test` + `verify:*:rollback`).
4. Aplicar siguiendo `docs/runbooks/migration-apply.md` con autorización humana explícita.

### C4 — Corrupción de datos o DDL irreversible

Detener `apps/api` y ejecutar restauración PITR o respaldo verificado según `docs/runbooks/backup-restore.md` (requiere autorización humana explícita).

## 5. Verificación posterior

1. **Versión activa y salud del API:**

```bash
git rev-parse HEAD
curl -fsS https://<api-host>/api/v1/health
# Esperado: {"status":"ok"}

curl -s -o /dev/null -w "%{http_code}\n" https://<api-host>/api/v1/access/memberships
# Esperado: 401
```

2. **Integridad de esquema y seguridad:** ejecutar `preflight:migrations` (o `postcheck:migrations`) en `READ_ONLY` y verificar conteos `securedTables`, `policies`, `securityDefinerFunctions` y privilegios `app_api`.
3. **Smoke operativo:** probar en navegador `/login`, consulta de órdenes activas, apertura/corte de caja y reconexión de KDS con recuperación por cursor (`GET /api/v1/kds/events`) con consola limpia.
4. **Post-mortem:** registrar causa raíz, ventana de impacto (hora local America/Phoenix y UTC), acción aplicada y regla preventiva en `HANDOFF.md` y `docs/agentic/LESSONS.md`.
