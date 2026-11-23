# Runbook de respaldo, restauración y RPO/RTO

Procedimiento operativo para respaldar, restaurar y **demostrar** que el respaldo
sirve en **superRestaurant**: Supabase administrado (PostgreSQL + Auth + Storage)
bajo ADR-010 opción B, con `apps/api` como única frontera de escrituras críticas y
`supabase/migrations/*.sql` como única autoridad del esquema.

> **Autonomía y puertas (`AGENTS.md` §19.6).** El orquestador ejecuta respaldos y
> restauraciones sin esperar aprobación humana, pero con el protocolo de
> seguridad: respaldo verificable antes de cualquier operación destructiva,
> alcance acotado, staging/entorno desechable primero y registro de lo afectado.
> Una restauración sobre datos reales sin respaldo verificado previo está
> prohibida. Si el resultado de una restauración es ambiguo, se detiene y se
> inspecciona en solo lectura.
>
> Las decisiones de plan de Supabase (Daily Backups vs PITR), almacén cifrado
> fuera del proveedor, retención legal y credenciales de producción siguen
> abiertas (`docs/agentic/DECISIONS_PENDING.md`; `docs/plans/mvp-cierre-2026-11-22.md`).
> Los objetivos de §1 son la línea base conservadora hasta su ratificación.

## 1. Objetivos de RPO y RTO

| Activo | RPO objetivo | RTO objetivo | Mecanismo y condición |
|---|---|---|---|
| **PostgreSQL** (`app`, `app_private`, `app_rls`, `supabase_migrations`) | **≤ 15 min** con PITR | **≤ 60 min** | PITR + respaldos administrados de Supabase, más dump lógico cifrado pre-release. **Sin PITR el RPO se degrada a ≤ 24 h**, inaceptable para operación comercial multi-turno con dinero; en ese caso el go-live requiere aceptación explícita del riesgo registrada en `DECISIONS_PENDING.md`. |
| **Imágenes de catálogo** (bucket `catalog-images`) | **≤ 24 h** | **≤ 120 min** | Copia diaria cifrada; las rutas son inmutables por UUID y la UI degrada a iniciales/color si falta una imagen. |
| **Código, migraciones y configuración no secreta** | **0** | **≤ 15 min** | Git `main` + tags `m<N>-rc<k>`; secretos en gestor externo con copia cifrada bajo custodia. |
| **Colas durables (`pgmq`)** | Igual que PostgreSQL | Igual que PostgreSQL | Solo cuando ADR-012 habilite `pgmq`; las tablas `logged` entran en el mismo respaldo y en el mismo ensayo. |

El RPO/RTO real se **mide** en cada ensayo (sección 6) y se registra en
`HANDOFF.md`. Un objetivo no medido se reporta como no verificado.

## 2. Alcance del respaldo

**Incluido en el dump lógico:** esquemas `app`, `app_private`, `app_rls` y
`supabase_migrations` (estructura, datos y ACL cuando el destino tiene los mismos
roles). Incluye las tablas financieras inmutables (`app.orders`,
`app.payments`, `app.cash_movements`, `app.order_cancellations`,
`app.financial_audit_events`), auditoría, catálogo, miembros y el libro de sync.

**Fuera del dump lógico, con tratamiento propio:**

- **Auth (`auth.users`, identidades):** administrado por Supabase Auth. Las
  tablas de `app` referencian `auth.users(id)`; una restauración lógica a un
  proyecto distinto exige restaurar identidades por el mecanismo de Supabase o
  usar PITR/backup físico. No se inventan usuarios.
- **Storage:** bucket `catalog-images`, respaldado aparte (sección 4.3).
- **Secretos:** nunca en el dump ni en Git; viven en el gestor de secretos.

## 3. Prerrequisitos

- Cliente PostgreSQL 17 (`psql`, `pg_dump`, `pg_restore`). En Windows local se
  usan los binarios portátiles ignorados por Git en `.cache/postgres-local/pgsql/bin`;
  en Linux/CI, `postgresql-client-17` o la imagen `postgres:17`.
- Para el remoto: conexión administrativa con TLS `verify-full`, CA vigente y
  variables de sesión (`BACKUP_DATABASE_URL`, `TARGET_DATABASE_URL`). Nunca
  imprimir la URL ni guardar dumps dentro del repositorio.
- Espacio temporal suficiente para dump + restauración, y almacén cifrado fuera
  del proveedor para la copia final.
- Autorización del alcance ya cubierta por §19.6; aun así, toda restauración
  sobre un entorno con datos reales exige respaldo verificado previo y alcance
  acotado por ids cuando aplique.

## 4. Procedimiento de respaldo

### 4.1 Respaldo administrado (primario en producción)

1. Confirmar en Supabase Dashboard → **Database → Backups** que los respaldos
   diarios están activos y, en producción, que **PITR** está habilitado.
2. Verificar que el último punto sano cae dentro del RPO objetivo.
3. Registrar el identificador del respaldo y su hora UTC **antes** de cualquier
   migración o despliegue.

### 4.2 Respaldo lógico pre-release (portable, solo lectura)

```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $env:TEMP "sr-backup-$ts"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$dumpFile = Join-Path $outDir "superrestaurant-$ts.dump"

$env:PGSSLMODE = "verify-full"
$env:PGSSLROOTCERT = (Resolve-Path ".certs/<ca>.crt").Path

pg_dump "$env:BACKUP_DATABASE_URL" `
  --format=custom `
  --schema=app --schema=app_private --schema=app_rls --schema=supabase_migrations `
  --file "$dumpFile"

# Validación mínima antes de cifrar
pg_restore --list "$dumpFile" | Select-String "TABLE DATA app\." | Measure-Object
Get-FileHash "$dumpFile" -Algorithm SHA256
```

- El dump es de solo lectura y no modifica el origen.
- Se conservan ACL/owner por defecto; usar `--no-owner --no-privileges` solo si el
  destino no tiene los roles y se documentará la pérdida de grants, que luego
  debe recuperarse con las migraciones y `postcheck:migrations`.
- Cifrar antes de subir al almacén externo y **eliminar la copia temporal sin
  cifrar** después de validar el hash. Registrar el SHA-256 y la ruta cifrada.

### 4.3 Respaldo de imágenes de catálogo

Sincronizar el bucket `catalog-images` al almacén cifrado con una herramienta
propia del proveedor o `supabase storage` (según el plan elegido), conservando
las rutas. Verificar al menos un objeto conocido por fecha y registrar el conteo.
La pérdida de una imagen no bloquea el POS: la UI muestra iniciales/color.

## 5. Procedimiento de restauración (entorno autorizado)

### Vía A — PITR o respaldo administrado (preferida en producción)

1. Detener `apps/api` (ventana de mantenimiento) para frenar escrituras y anotar
   la hora UTC exacta del corte.
2. En Supabase Dashboard → **Database → Backups / PITR**, restaurar al instante
   inmediatamente anterior al incidente. Si se requiere auditoría forense de
   pagos/caja, clonar a un proyecto separado en lugar de sobrescribir el actual.
3. Validar privilegios de `app_api`, RLS forzada en las tablas de `app` y
   esquemas expuestos por Data API (`supabase/config.toml`: `public`,
   `graphql_public`, `app`).

### Vía B — Restauración lógica en destino vacío controlado (`pg_restore`)

```powershell
$env:PGSSLMODE = "verify-full"
$env:PGSSLROOTCERT = (Resolve-Path ".certs/<ca>.crt").Path

pg_restore --clean --if-exists --exit-on-error `
  --dbname "$env:TARGET_DATABASE_URL" "$dumpFile"
```

- Usar `--no-owner --no-privileges` solo cuando el destino no tenga los roles de
  Supabase; en ese caso, reaplicar grants con las migraciones y verificar con
  `postcheck:migrations`.
- Las tablas de `app` referencian `auth.users(id)`: restaurar primero las
  identidades por el mecanismo de Supabase o usar PITR. Un restore lógico sin
  identidades fallará por integridad referencial, y está bien que falle cerrado.
- `--exit-on-error` es obligatorio: una restauración parcial no se declara exitosa.

### Vía C — Restauración de imágenes

Restaurar el bucket desde la copia cifrada, verificar el conteo y abrir una
pantalla de menú para confirmar que las imágenes públicas responden. Un fallo de
imagen se trata como degradación, no como corrupción de datos.

## 6. Ensayo de restauración verificable (obligatorio)

Objetivo: demostrar que el respaldo produce una base **consistente y segura**, y
medir el RTO. Se ejecuta al menos **cada trimestre**, **antes del go-live** y
**tras cambios mayores de esquema**. Nunca toca Supabase remoto.

```bash
set -euo pipefail

# 1) PostgreSQL 17 desechable en loopback
docker run -d --rm --name sr-restore-drill \
  -e POSTGRES_PASSWORD=drill-only -p 127.0.0.1:55432:5432 postgres:17
export PGPASSWORD=drill-only
trap 'rm -f /tmp/sr-drill.dump; docker stop sr-restore-drill >/dev/null 2>&1 || true' EXIT

# 2) Roles de clúster y bases origen/destino con shim mínimo de auth
psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE DATABASE sr_src;
CREATE DATABASE sr_dst;
SQL

for db in sr_src sr_dst; do
  psql -h 127.0.0.1 -p 55432 -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, deleted_at timestamptz, raw_user_meta_data jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
SQL
done

# 3) Reconstruir el esquema canónico desde las migraciones
for f in supabase/migrations/*.sql; do
  psql -h 127.0.0.1 -p 55432 -U postgres -d sr_src -v ON_ERROR_STOP=1 -f "$f"
done

# 4) Dump y restore midiendo RTO
START_TS=$(date +%s)
pg_dump -h 127.0.0.1 -p 55432 -U postgres -d sr_src -Fc \
  --schema=app --schema=app_private --schema=app_rls -f /tmp/sr-drill.dump
pg_restore --list /tmp/sr-drill.dump > /tmp/sr-drill.list
pg_restore -h 127.0.0.1 -p 55432 -U postgres -d sr_dst --exit-on-error /tmp/sr-drill.dump
END_TS=$(date +%s)
echo "restore_seconds=$((END_TS - START_TS))"

# 5) Comparar inventario de seguridad y datos financieros (debe coincidir)
CHECK_SQL="SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='app' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) AS secured_tables,
  (SELECT count(*) FROM pg_policies WHERE schemaname='app') AS policies,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname IN ('app_rls','app_private') AND p.prosecdef) AS secdef_fns;"
DATA_SQL="SELECT
  (SELECT count(*) FROM app.orders) AS orders,
  (SELECT count(*) FROM app.payments) AS payments,
  (SELECT count(*) FROM app.cash_movements) AS cash_movements,
  (SELECT count(*) FROM app.order_cancellations) AS cancellations,
  (SELECT count(*) FROM app.financial_audit_events) AS financial_audit_events;"
for db in sr_src sr_dst; do
  echo "$db security: $(psql -h 127.0.0.1 -p 55432 -U postgres -d "$db" -tAc "$CHECK_SQL")"
  echo "$db data:     $(psql -h 127.0.0.1 -p 55432 -U postgres -d "$db" -tAc "$DATA_SQL")"
done
```

**Criterios de aprobación del ensayo:**

1. `pg_restore` termina con exit 0 y `--exit-on-error`.
2. El inventario de seguridad coincide entre origen y destino.
3. Los conteos de las tablas financieras y de auditoría coinciden.
4. `restore_seconds` se registra y se compara con el RTO (≤ 60 min base).
5. No queda contenedor, dump ni dato temporal tras la limpieza.
6. Se repite con el flujo transaccional local:
   `pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only`.

Complementario (Windows): la misma secuencia puede ejecutarse con los binarios
portátiles de `.cache/postgres-local/pgsql/bin` y un servicio local desechable;
el criterio es el mismo, no una variante laxa.

## 7. Verificación posterior a una restauración real

1. `preflight:migrations` en `READ_ONLY` contra la base restaurada: historial,
   `securedTables`, `policies`, `securityDefinerFunctions`.
2. `postcheck:migrations -- <ultima-version> --functions save_menu_catalog,confirm_capture_draft_v3`
   para confirmar `EXECUTE` solo en `app_api` para funciones críticas de
   `app_private`.
3. Arrancar `apps/api` y comprobar `GET /api/v1/health` (`200`),
   `GET /ready` (`200`) y `GET /api/v1/access/memberships` (`401`).
4. Cuadre funcional en navegador: órdenes activas, caja del turno y KDS
   recuperando por cursor; consola limpia.
5. Conciliar registros financieros inmutables (órdenes, pagos, movimientos de
   caja, cancelaciones) contra el último corte conocido. Cualquier diferencia se
   documenta y no se "corrige" a mano.
6. Registrar en `HANDOFF.md`: hora del incidente y de la restauración
   (America/Phoenix y UTC), punto elegido, RTO real, pérdida real vs RPO,
   verificaciones y desviaciones.

## 8. Frecuencia y evidencia

| Actividad | Frecuencia mínima | Evidencia |
|---|---|---|
| Verificar respaldo administrado/PITR | Semanal y antes de cada corte | Captura/registro del punto sano y hora UTC |
| Dump lógico pre-release | Antes de cada release | SHA-256 y ruta cifrada |
| Ensayo de restauración completo | Trimestral, antes de go-live y tras cambios mayores de esquema | Salida de la sección 6 y RTO medido |
| Copia de imágenes | Diaria | Conteo y fecha |
| Revisión de RPO/RTO | Trimestral | Entrada en `HANDOFF.md` |

## 9. Brechas conocidas (no ocultar)

- PITR, almacén cifrado externo y retención legal **no están ratificados**; sin
  PITR el RPO real es el del respaldo diario.
- No existe automatización de respaldo ni de ensayo en el repositorio ni en CI;
  hoy son procedimientos manuales.
- La restauración lógica no cubre identidades de Auth ni Storage por sí sola;
  PITR/backup administrado sigue siendo la vía preferida en producción.
- `pgmq` (ADR-012) aún no está habilitado; cuando lo esté, sus colas `logged`
  deben añadirse a este runbook y al ensayo.
- Los conteos del ensayo validan consistencia estructural y de filas, no la
  semántica de cada total; la conciliación financiera del §7 sigue siendo
  obligatoria tras una restauración real.
