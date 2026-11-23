# Runbook de respaldo, restauración y RPO/RTO

Procedimiento operativo de respaldo, restauración y verificación reproducible para **superRestaurant** (Supabase PostgreSQL/Auth/Storage bajo ADR-010 opción B).

> **Decisiones humanas pendientes:** el plan de Supabase (Daily Backups vs PITR), el almacén cifrado fuera del proveedor, la retención legal y las credenciales de producción son decisiones humanas (`docs/agentic/DECISIONS_PENDING.md`; `ADR-010` §Consequences). Los objetivos de abajo son la línea base conservadora propuesta hasta su ratificación para go-live.

## 1. Objetivos de RPO y RTO (línea base)

| Activo | RPO objetivo | RTO objetivo | Mecanismo base y notas |
|---|---|---|---|
| **PostgreSQL (`app`, `app_private`, `app_rls`, `auth`, `supabase_migrations`)** | **≤ 15 min** (con PITR activo) | **≤ 60 min** | PITR + respaldos diarios administrados en Supabase, más dump lógico cifrado pre-release. *Sin PITR el RPO se degrada a ≤ 24 h (riesgo financiero inaceptable para operación comercial multi-turno).* |
| **Imágenes de catálogo (bucket `catalog-images`)** | **≤ 24 h** | **≤ 120 min** | Sincronización diaria cifrada; rutas inmutables por UUID en BD. La UI opera degradada con iniciales/color si falta una imagen. |
| **Código, migraciones y configuración no secreta** | **0** | **≤ 15 min** | Git `main` + tags `m<N>-rc<k>`. Secretos en gestor externo con copia cifrada bajo custodia humana. |

*(ADR-012: cuando se habilite `pgmq` con tablas `logged`, sus mensajes pendientes quedan incluidos en el mismo respaldo transaccional y en el ensayo de restauración.)*

## 2. Prerrequisitos

- Herramientas cliente PostgreSQL 17 (`psql`, `pg_dump`, `pg_restore`). En Windows local existen binarios portátiles en `.cache/postgres-local/pgsql/bin` (ignorados por Git); en Linux/CI usar `postgresql-client-17` o contenedor `postgres:17`.
- Para respaldos remotos: conexión administrativa con TLS `verify-full` y certificado `.certs/prod-ca-2021.crt` en variables de sesión (`BACKUP_DATABASE_URL`). Nunca imprimir URLs ni guardar dumps dentro del repositorio Git.
- Para cualquier restauración en entorno remoto o sobre datos reales: **autorización humana explícita** (`AGENTS.md` §3.1).

## 3. Procedimiento de respaldo

### 3.1 Respaldo administrado (primario en Supabase)

1. Confirmar en Supabase Dashboard → **Database → Backups** que los respaldos diarios y **PITR** (en producción) están activos y con último punto sano dentro del RPO.
2. Registrar el identificador del último respaldo sano antes de cualquier migración o despliegue.

### 3.2 Respaldo lógico pre-release (portable, solo lectura)

```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $env:TEMP "sr-backup-$ts"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$dumpFile = Join-Path $outDir "superrestaurant-$ts.dump"

$env:PGSSLMODE = "verify-full"
$env:PGSSLROOTCERT = (Resolve-Path ".certs/prod-ca-2021.crt").Path

pg_dump "$env:BACKUP_DATABASE_URL" `
  --format=custom --no-owner --no-privileges `
  --schema=app --schema=app_private --schema=app_rls --schema=supabase_migrations `
  --file "$dumpFile"

Get-FileHash "$dumpFile" -Algorithm SHA256
```

Cifrar `$dumpFile` antes de subirlo al almacén externo y eliminar la copia temporal sin cifrar tras validar el hash SHA-256.

## 4. Procedimiento de restauración (entorno autorizado)

### Vía A — PITR o respaldo administrado en Supabase (preferida en producción)

1. Detener `apps/api` (ventana de mantenimiento) para frenar escrituras y registrar la hora UTC exacta del corte.
2. En Supabase Dashboard → **Database → Backups / PITR**, restaurar al instante inmediatamente anterior al incidente (o clonar a proyecto separado si se requiere auditoría forense de pagos/caja).
3. Validar privilegios del rol `app_api`, RLS forzada y esquemas expuestos en Data API (`supabase/config.toml`: `public`, `graphql_public`, `app`).

### Vía B — Restauración lógica en destino vacío controlado (`pg_restore`)

```powershell
$env:PGSSLMODE = "verify-full"
$env:PGSSLROOTCERT = (Resolve-Path ".certs/prod-ca-2021.crt").Path

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error `
  --dbname "$env:TARGET_DATABASE_URL" "$dumpFile"
```

*Nota:* las tablas de `app` referencian `auth.users(id)`. En producción usar PITR/backup físico administrado o restaurar primero identidades en el proyecto destino para preservar integridad referencial.

## 5. Prueba de restauración reproducible (PostgreSQL 17 desechable)

Ejecutar al menos trimestralmente, antes de go-live y tras cambios mayores de esquema. Nunca toca Supabase remoto:

```bash
# 1) Levantar PostgreSQL 17 desechable en loopback
docker run -d --rm --name sr-restore-drill \
  -e POSTGRES_PASSWORD=drill-only -p 127.0.0.1:55432:5432 postgres:17
export PGPASSWORD=drill-only

# 2) Crear roles (alcance de clúster) y bases origen/destino con shim mínimo de auth (igual que CI pg-verify)
psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE DATABASE sr_src; CREATE DATABASE sr_dst;
SQL
for db in sr_src sr_dst; do
  psql -h 127.0.0.1 -p 55432 -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, deleted_at timestamptz, raw_user_meta_data jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
SQL
done

# 3) Reconstruir esquema en sr_src desde supabase/migrations
for f in supabase/migrations/*.sql; do
  psql -h 127.0.0.1 -p 55432 -U postgres -d sr_src -v ON_ERROR_STOP=1 -f "$f"
done

# 4) Dump lógico y restore en sr_dst midiendo tiempo (RTO)
START_TS=$(date +%s)
pg_dump -h 127.0.0.1 -p 55432 -U postgres -d sr_src -Fc \
  --schema=app --schema=app_private --schema=app_rls -f /tmp/sr-drill.dump
pg_restore -h 127.0.0.1 -p 55432 -U postgres -d sr_dst --exit-on-error /tmp/sr-drill.dump
END_TS=$(date +%s); echo "restore_seconds=$((END_TS - START_TS))"

# 5) Comparar inventario de seguridad (sr_src vs sr_dst deben coincidir)
CHECK_SQL="SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='app' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) AS secured_tables,
  (SELECT count(*) FROM pg_policies WHERE schemaname='app') AS policies,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('app_rls','app_private') AND p.prosecdef) AS secdef_fns;"
psql -h 127.0.0.1 -p 55432 -U postgres -d sr_src -tAc "$CHECK_SQL"
psql -h 127.0.0.1 -p 55432 -U postgres -d sr_dst -tAc "$CHECK_SQL"

# 6) Limpieza obligatoria
rm -f /tmp/sr-drill.dump && docker stop sr-restore-drill
```

Complementar con el flujo transaccional local sobre PG 17 desechable: `pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only`.

## 6. Verificación posterior

1. Correr `preflight:migrations` en modo `READ_ONLY` contra la base restaurada para confirmar historial, `securedTables`, `policies` y `securityDefinerFunctions`.
2. Verificar privilegios `EXECUTE` solo para `app_api` en funciones críticas de `app_private` (`postcheck:migrations -- <ultima-version> --functions save_menu_catalog,confirm_capture_draft_v3`).
3. Confirmar cuadre de registros financieros inmutables (órdenes, pagos, movimientos de caja, cancelaciones) y probar `GET /api/v1/health` (`200`) y `GET /api/v1/access/memberships` (`401`).
4. Registrar tiempo medido vs RTO, pérdida real vs RPO y fecha del ensayo en `HANDOFF.md`.
