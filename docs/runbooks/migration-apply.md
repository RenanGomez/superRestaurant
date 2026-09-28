# Aplicar migraciones nuevas al remoto (procedimiento 2026-09-27)

Procedimiento verificado para aplicar migraciones SQL nuevas de `supabase/migrations` al proyecto remoto, tal como se ejecutó el 2026-09-27. Requiere autorización humana explícita para el apply persistente (AGENTS.md 3.1); los pasos de preflight, sonda y dry-run son de sólo lectura.

## 1. Preflight

```powershell
$env:SCHEMA_VERIFICATION_CONFIRMATION = "READ_ONLY"
$env:SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF = "<project-ref>"
$env:SCHEMA_VERIFICATION_DATABASE_URL = "<url sslmode=verify-full>"
$env:SCHEMA_VERIFICATION_CA_CERT_PATH = ".certs/prod-ca-2021.crt"
pnpm --filter @super-restaurant/api run preflight:migrations
```

Reporta `remoteVersions`, `lastRemote`, `localFiles`, `localMissingInRemote` (candidatas a aplicar) y `remoteMissingLocally` (las cinco migraciones ADR históricas sin archivo local; esperado, no un error). BEGIN READ ONLY / ROLLBACK siempre; exit 1 si falla la conexión o el project ref no coincide.

## 2. Sonda rollback-only por candidata

```powershell
pnpm --filter @super-restaurant/api run probe:migration:rollback -- supabase/migrations/<version>_<slug>.sql
```

Ejecuta cada statement dentro de BEGIN/ROLLBACK contra el remoto; nunca aplica. Repetir por cada candidata de `localMissingInRemote`.

## 3. Staging temporal hash-idéntico

Crear un directorio temporal fuera del repo con: `config.toml`, los 5 SQL de las migraciones ADR históricas (copiados de `tmp/capture-tray-apply-staging`, hash-idénticos a los remotos) y el resto de `supabase/migrations` **excluyendo** `20260908000100` (ya aplicada de forma distinta remotamente). No editar ningún archivo copiado.

## 4. Dry-run

```powershell
npx --yes supabase@2.118.0 db push --db-url "<URL con sslmode=verify-full y sslrootcert absoluto>" --skip-vault --dry-run
```

Debe anunciar únicamente las candidatas de `localMissingInRemote`. Si anuncia algo más, detenerse y revisar el staging antes de continuar.

## 5. Apply único

Ejecutar el mismo comando sin `--dry-run` sólo con autorización humana explícita para el corte. Un solo apply; no reintentar automáticamente ante ambigüedad.

## 6. Postcheck

```powershell
pnpm --filter @super-restaurant/api run postcheck:migrations -- <version1> <version2> -- --functions fn_a,fn_b
```

Confirma que cada versión aplicada aparece exactamente una vez y que la última del historial es la mayor pedida; reporta el resumen de catálogo y, si se pidieron funciones, `EXECUTE` para `app_api`/`authenticated`/owner. Exit 1 si falta o está duplicada alguna versión.

## 7. Segundo dry-run y limpieza

Repetir el paso 4: debe reportar `upToDate` sin candidatas nuevas. Borrar el staging temporal. Reiniciar la API local para recoger el esquema aplicado.

## Advertencia sobre runners de catálogo fijo

`run-capture-schema-verification` y `run-delivery-zones-schema-verification` fijan conteos esperados de catálogo (tablas/policies/funciones) que no se actualizan solos; no sirven para verificar el remoto actual sin editar antes sus expectativas, y usan `SET ROLE` temporal que no aplica a esta sonda de sólo lectura. Usar siempre `preflight:migrations`/`postcheck:migrations`/`probe:migration:rollback` para inspección genérica.
