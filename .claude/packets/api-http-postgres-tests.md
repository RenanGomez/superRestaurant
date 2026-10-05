# api-http-postgres-tests · flujo crítico por HTTP contra PostgreSQL local desechable

## Tarea
api-http-postgres-tests · **nivel B** (`implementer-claude`, razonamiento alto por tocar el arranque de Nest y fixtures de tenancy; infraestructura de pruebas en `apps/api`, sin cambiar producto ni SQL). §19.3: hasta dos rondas Codex; Sonnet si marca P1. Deuda registrada desde el 2026-10-04 («sin pruebas HTTP contra Postgres»).

## Objetivo
Un script `test:http:local` que levante PostgreSQL 17 desechable desde `.cache/postgres-local`, aplique todas las migraciones, provisione un restaurante/sucursal/actores de prueba con roles, arranque **Nest real** con el cliente Postgres apuntando a esa base y el verificador de auth sustituido, y recorra por HTTP el flujo: abrir caja → crear orden (plan de selección + confirmar o `/orders/open` + addItem) → enviar a cocina → cobrar en efectivo con cambio y propina → corte X, comprobando totales, 409 de replay divergente e idempotencia de replay idéntico, y **aislamiento** (un actor de otro restaurante recibe 403 en la misma orden). Nunca contra remoto.

## Hechos verificados (researcher 2026-10-05)
- Patrón de PG local: `apps/api/src/operations/run-capture-selection-plan-schema-verification.ts:1-140` (`run()` spawnSync initdb/pg_ctl validando ruta en `.cache`, `availablePort()`, password aleatoria, migraciones, marcador `LOCAL_*_ONLY`, flag `--local-disposable-only`, sólo win32, cleanup); ya hay más de 20 verificadores con el mismo esqueleto: **extraer un helper compartido** `apps/api/src/operations/local-postgres.ts` y que al menos dos verificadores existentes lo reutilicen sin cambiar su salida.
- Nest: `main.ts:1-22` (`NestFactory.create(AppModule)`, prefijo `api/v1`), `app.module.ts:282`; `database.ts` `DATABASE_CLIENT`/`DatabaseClientPort { query }`; `auth/authentication.ts` `AUTH_PRINCIPAL_VERIFIER` (sustituible). Prueba HTTP existente de referencia: `customer-directory.test.ts:39-80` (`Test.createTestingModule`, `overrideProvider`, `app.listen(0)`, `fetch` con Bearer).
- Fixtures SQL de tenancy: `supabase/tests/*.sql` (restaurante, sucursal, membresías, actor por rol); el verificador de caja `run-cash-transfer-method-schema-verification.ts` y `cash_collect_change_invariants.sql` muestran cómo abrir caja y cobrar en SQL.
- `apps/api/package.json:28-107`: runner `node .test-dist/*.test.js` tras `tsc --project tsconfig.test.build.json`.

## Diseño (seguir salvo razón documentada)
1. `operations/local-postgres.ts`: `startLocalPostgres({ marker })` → `{ adminUrl, appApiUrl, port, stop() }` (initdb, pg_ctl, migraciones en orden, rol `app_api` con password aleatoria como en los verificadores); reutilizado por dos verificadores existentes (refactor sin cambio de comportamiento, puertas iguales).
2. `operations/http-test-fixtures.ts`: provisiona en SQL (vía `adminUrl`) restaurante A y B, sucursal, catálogo publicado mínimo con un producto, caja, y actores `manager`, `cashier`, `courier`, `other_restaurant_manager` con membresías; devuelve ids.
3. `operations/http-test-app.ts`: `bootstrapHttpApp(appApiUrl, principals)` → `Test.createTestingModule({ imports: [AppModule] })` con `DATABASE_CLIENT` sobre `pg.Pool` real y `AUTH_PRINCIPAL_VERIFIER` que mapea `Bearer <nombre-de-actor>` al principal; prefijo `api/v1`; `listen(0)`.
4. `http-flow.local.test.ts` (fuera de la cadena `test` normal): el flujo del objetivo con aserciones de montos (enteros), replay idéntico (misma respuesta), replay divergente (409), aislamiento (403), y corte X con esperado = fondo + ventas efectivo + propinas `tip_in`. Guard: sólo corre con `HTTP_TEST_MODE=local` y `--local-disposable-only`; si no hay PG en `.cache`, falla con mensaje claro `LOCAL_POSTGRES_MISSING`.
5. Script `test:http:local` en package.json; documentar en `docs/runbooks/` (sección corta) cómo correrlo; añadir al HANDOFF la salida literal.

## Criterios de aceptación
- [ ] `pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only` pasa en esta máquina con salida literal.
- [ ] Verificadores refactorizados siguen pasando (correr al menos `verify:cash-transfer-method-schema:rollback` y `verify:branch-order-work-tray-delivery-state-schema:rollback`).
- [ ] Puertas: api lint/typecheck/test/build (la suite normal no debe depender de PG).
- [ ] Commits por unidad (helper + refactor, fixtures + app, flujo); **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\api-http-postgres-tests\apps\api\src\operations\run-capture-selection-plan-schema-verification.ts, run-cash-transfer-method-schema-verification.ts (completos).
- C:\tmp\sr-wt\api-http-postgres-tests\apps\api\src\main.ts, app.module.ts (260-300), database.ts, auth\authentication.ts, customer-directory.test.ts (1-90), payments.controller.ts, orders.controller.ts, captures.controller.ts, cash-registers*.
- C:\tmp\sr-wt\api-http-postgres-tests\supabase\tests\cash_collect_change_invariants.sql (fixtures).

## Invariantes
Sólo PG local desechable con marcador y cleanup en `finally`; nunca `ADR010_DATABASE_URL`; sin cambios de producto ni SQL; dinero en enteros; sin push.

## Fuera de alcance
CI remoto, cobertura, flujos de entregas y mitades (segunda iteración).

## Formato de salida
Resumen, archivos y hashes, salida literal de `test:http:local`, puertas, riesgos.
