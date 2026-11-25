# Revisión 1 · m3-api-grants (nivel A, foco SQL/seguridad)

Revisa el cambio SIN modificarlo. No ejecutes PostgreSQL ni la suite; el orquestador ya corrió `verify:inventory-schema:rollback` (80 migraciones, baseline `policies:10`, verde). No hagas commit ni push.

## Qué revisar (lee los archivos completos)
- `supabase/migrations/20261126000600_inventory_api_grants.sql` (nuevo)
- `supabase/tests/inventory_api_grants_invariants.sql` (nuevo)
- `git diff -- supabase/tests/inventory_catalog_invariants.sql`
- `apps/api/src/operations/inventory-schema-verification.ts` y `run-inventory-schema-verification.ts` (`git diff`)

## Contexto
- P1 original: `items.service.ts` escribe como `app_api` y `20261126000100_inventory_catalog.sql` revoca todo a `app_api`; el API fallaba con 42501.
- Decisión: `app_api` es rol server-only (NOLOGIN, sin BYPASSRLS, sin Data API); el API revalida `Restaurant`/`Branch` en cada consulta. Se concede USAGE del esquema + SELECT/INSERT/UPDATE con políticas `USING(true)` y sin DELETE.
- Invariantes del repo: AGENTS §10 (aislamiento revalidado en servidor), §12 (migraciones), ADR-013 §13.

## Preguntas concretas
1. ¿Los grants son el mínimo necesario y no abren `anon`/`authenticated`/`service_role`/`public`?
2. ¿Las políticas nuevas se suman a las de `authenticated` sin relajarlas (RLS con FORCE)?
3. ¿La prueba demuestra de verdad el permiso (insert/update/select como `app_api`) y el rechazo de DELETE, y falla si la migración faltara?
4. ¿La aserción positiva añadida a `inventory_catalog_invariants.sql` es segura con el orden real de CI/verificador (todas las migraciones antes de los tests)?
5. ¿Riesgos de seguridad o de migración no cubiertos (nombre de políticas, idempotencia de la migración, COMMENT, `search_path`)?

## Salida
Informe corto: veredicto `APROBAR` o `CORREGIR`, y hallazgos numerados P1/P2/P3 con archivo:línea y corrección propuesta. Sin reescribir el código.
