# Runbook de rollback

Procedimiento de reversión para **superRestaurant** ante fallos de despliegue,
regresiones en `main` o incidencias de migración SQL. Cubre código, aplicaciones
desplegadas y base de datos.

> **Autonomía y puertas (`AGENTS.md` §19.6).** El orquestador ejecuta el rollback
> sin esperar aprobación humana, pero con el protocolo de seguridad: revertir
> primero lo reversible, nunca reescribir historia compartida, nunca editar una
> migración aplicada, y restaurar datos solo desde un respaldo verificado y con
> alcance acotado. Ante un resultado ambiguo se detienen los reintentos y se
> inspecciona en solo lectura.
>
> **Reglas inviolables (`AGENTS.md` §12, §17, §19.6):** nada de
> `git push --force` ni `reset --hard` sobre `main` o cambios ajenos; nada de DDL
> destructivo ni restauración sobre producción sin respaldo verificado; los
> registros financieros y de auditoría son inmutables y se corrigen con
> movimientos compensatorios, no borrando.

## 1. Disparadores y criterios de decisión

**Disparadores:**

- `GET /api/v1/health` falla o `GET /ready` devuelve `503` tras el corte.
- Tasa anormal de `5xx`, timeouts o errores en cobro, caja, confirmación de
  orden o KDS.
- Sospecha de fuga entre restaurantes o sucursales.
- CI rojo en `main` (`verify`, `pg-verify` o `e2e-smoke`).
- Smoke posterior al despliegue falla en un punto bloqueante.

**Antes de actuar, reunir:**

1. SHA/tag bueno conocido (`<good-sha>`).
2. Migraciones aplicadas en el corte y estado real del historial, en solo
   lectura (`preflight:migrations`).
3. **Matriz de compatibilidad esquema ↔ binario:**

| Cambio del corte | ¿Bajar el binario? | Acción |
|---|---|---|
| Migraciones aditivas y compatibles hacia atrás (columnas/tablas/funciones nuevas que el binario anterior ignora) | Sí | Ruta B (aplicaciones) sin tocar la base |
| Cambio solo de aplicación, sin SQL | Sí | Ruta B |
| Migración que elimina o cambia la firma de algo que el binario anterior usa | **No** a ciegas | Ruta C3: migración compensatoria hacia adelante |
| `NOT NULL` o restricción nueva que rompe escrituras del binario anterior | **No** a ciegas | Ruta C3 o desplegar un binario compatible |
| Corrupción de datos o DDL irreversible | No | Ruta C4: restaurar respaldo verificado |
| Fallo antes de aplicar la migración | Sí | Ruta C1/B |

4. **Ensayo en staging:** cuando exista staging, ensayar allí el rollback antes
   de ejecutarlo en producción. Sin staging, el rollback se ejecuta con la matriz
   anterior y se registra como no ensayado.

## 2. Ventana de servicio y topología

`apps/api` corre con **una sola réplica** (ADR-011). No hay blue-green ni
balanceo entre versiones: revertir la aplicación implica una ventana breve de
indisponibilidad. Se anota la hora de inicio y fin en America/Phoenix y UTC.
El KDS reconecta y recupera por cursor al volver la API; un cliente atrasado no
es autoridad y el servidor revalida contratos y totales.

## 3. Ruta A — Revertir código en `main`

Un `main` roto se corrige con `git revert` a través de un PR, nunca con
`reset --hard` ni push directo (`docs/plans/plan-autonomo-100.md` §5.5):

```bash
git fetch origin main
git checkout -b revert/<short-sha> origin/main
git revert --no-edit <bad-sha>
pnpm lint && pnpm typecheck && pnpm test
git push -u origin revert/<short-sha>
gh pr create --base main --title "revert: <motivo breve>" \
  --body "Revierte <bad-sha> por <causa>. Incidente <hora Phoenix/UTC>."
```

Merges con CI verde y revisión que exija `AGENTS.md` §19.6. Revertir un hito
completo al tag anterior se hace con una rama de reversión contra ese tag y PR.

## 4. Ruta B — Revertir aplicaciones desplegadas (esquema compatible)

Solo si la matriz de §1 lo permite.

```bash
# 1) Volver al artefacto bueno conocido
git fetch origin --tags
git checkout --detach <good-sha>
pnpm install --frozen-lockfile
pnpm build

# 2) Reiniciar API (una réplica) y verificar antes de publicar clientes
NODE_ENV=production pnpm --filter @super-restaurant/api start
curl -fsS https://<api-host>/ready
```

- **Web:** arrancar el build de `<good-sha>` y confirmar `/login` y consola
  limpia antes de dar por cerrada la reversión.
- **KDS:** republicar `apps/kds/dist` generado desde `<good-sha>` y purgar la
  caché del host estático.
- **Mobile:** publicar el build/actualización de `<good-sha>` por el canal
  aprobado; mientras tanto el servidor sigue revalidando contratos y totales.
- No se edita el esquema en esta ruta.

## 5. Ruta C — Migraciones y base de datos

### C1 — Fallo antes de aplicar (preflight, sonda o `--dry-run`)

No se modificó el remoto. Descartar el staging temporal, corregir la migración en
una rama nueva y repetir `docs/runbooks/migration-apply.md`. No hay rollback que
ejecutar.

### C2 — Resultado ambiguo durante `supabase db push`

**Detener los reintentos de inmediato.**

```powershell
$env:SCHEMA_VERIFICATION_CONFIRMATION = "READ_ONLY"
$env:SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF = "<project-ref>"
$env:SCHEMA_VERIFICATION_DATABASE_URL = "<url-admin sslmode=verify-full>"
$env:SCHEMA_VERIFICATION_CA_CERT_PATH = (Resolve-Path ".certs/<ca>.crt").Path
pnpm --filter @super-restaurant/api run preflight:migrations
```

Comparar `remoteVersions`, `lastRemote` y las candidatas. Decidir con el estado
real: si la migración quedó aplicada completa, continuar con postcheck; si quedó
parcial o incierta, tratarla como aplicada defectuosa (C3) o restaurar (C4)
según el daño. No repetir el apply a ciegas.

### C3 — Migración aplicada defectuosa (camino estándar)

1. **No** editar el archivo aplicado ni modificar a mano
   `supabase_migrations.schema_migrations`.
2. Crear una **migración nueva** versionada
   `supabase/migrations/<nuevo-timestamp>_revert_<slug>.sql` que restaure
   funciones `app_private.*`, vistas, políticas o columnas previas preservando
   los registros financieros y de auditoría. Si hay que corregir datos, usar
   movimientos compensatorios auditados, no `DELETE`/`UPDATE` masivo.
3. Validar la compensatoria en local y con
   `probe:migration:rollback` (`ROLLBACK_ONLY`) antes de tocar el remoto.
4. Aplicarla con `docs/runbooks/migration-apply.md` (staging primero,
   `--dry-run`, apply único, `postcheck:migrations`) y verificar que el binario
   anterior vuelve a operar.
5. Registrar versión compensatoria y evidencia en `HANDOFF.md`.

### C4 — Corrupción o DDL irreversible

1. Detener `apps/api` para frenar escrituras y anotar la hora UTC exacta.
2. Restaurar el respaldo verificado más reciente según
   `docs/runbooks/backup-restore.md` (PITR preferido; restauración lógica en
   destino controlado como alternativa).
3. Ejecutar las verificaciones posteriores del §7 de este runbook y del §7 de
   `backup-restore.md`, incluida la conciliación financiera.
4. Documentar la pérdida real frente al RPO y cualquier registro irrecuperable.
   Nunca reconstruir ventas, pagos o movimientos "a mano" sin evidencia.

## 6. Rollback parcial de datos (sin restaurar todo)

Si el daño está acotado a un restaurante, sucursal u operación:

- Acotar por ids y por `restaurant_id`/`branch_id`; nunca por patrones amplios.
- Preferir una migración compensatoria o un comando de dominio auditado antes
  que SQL manual.
- Tomar respaldo verificable del estado actual antes de corregir.
- Registrar exactamente qué filas se tocaron (conteo antes/después) y el motivo.
- No modificar pagos, caja ni asientos financieros: se compensan con nuevos
  movimientos que referencian el original.

## 7. Verificación posterior (obligatoria)

1. **Versión y salud:**

```bash
git rev-parse HEAD
curl -fsS https://<api-host>/api/v1/health   # {"status":"ok"}
curl -fsS https://<api-host>/ready            # {"status":"ready"}
curl -s -o /dev/null -w "%{http_code}\n" https://<api-host>/api/v1/access/memberships
# Esperado: 401
```

2. **Métricas:** `GET /metrics` con `Authorization: Bearer <METRICS_TOKEN>` si el
   token está configurado (`401` sin token, `404` si no hay token definido).
3. **Esquema y seguridad:** `preflight:migrations` o `postcheck:migrations` en
   `READ_ONLY`; revisar `securedTables`, `policies`,
   `securityDefinerFunctions` y privilegios `app_api`.
4. **Smoke operativo:** `/login`, órdenes activas, caja del turno y KDS con
   recuperación por cursor (`GET /api/v1/kds/events`) y consola limpia.
5. **Integridad financiera:** conciliar órdenes, pagos, movimientos de caja y
   cancelaciones contra el último corte conocido; documentar diferencias.
6. **Aplicación coherente:** confirmar que el binario activo y el esquema
   pertenecen a la combinación declarada en la matriz de §1.

## 8. Registro y post-mortem

Registrar en `HANDOFF.md` y, si aplica, en `docs/agentic/LESSONS.md`:

- causa raíz y disparador;
- ventana de impacto en America/Phoenix y UTC;
- ruta aplicada (A, B, C1–C4) y comandos ejecutados;
- migraciones o datos afectados, con alcance por ids;
- verificaciones y su resultado, incluido lo que no se pudo probar;
- RTO real de la reversión y pérdida frente al RPO;
- regla preventiva o prueba que evita la repetición;
- deuda o decisión pendiente si el rollback no fue ensayado.

## 9. Brechas conocidas (no ocultar)

- No hay despliegue automatizado ni estrategia blue-green: la reversión de
  aplicación es un cambio in-place con ventana breve de indisponibilidad (una
  réplica, ADR-011).
- El rollback de migraciones es **hacia adelante** (compensatoria); no se
  "desaplica" una migración ni se reescribe el historial.
- No hay ensayo automatizado de rollback en CI; se registra como manual.
- Mientras no exista staging, el rollback no puede ensayarse antes de producción
  y un cambio riesgoso queda BLOCKED por §19.6.
- La restauración de Auth y Storage no está cubierta por el dump lógico; ver
  `docs/runbooks/backup-restore.md` §9.
