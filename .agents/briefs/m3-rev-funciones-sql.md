# Revisión SQL · m3-api-functions (nivel A, solo lectura)

No modifiques nada, no ejecutes comandos de test/PG y no leas `.agents/reports/*` ni rutas fuera del repo. Responde en ≤ 20 líneas.

Lee SOLO estos archivos:
- `supabase/migrations/20261126000600_inventory_api_functions.sql`
- `supabase/tests/inventory_api_functions_invariants.sql`
- `git diff -- apps/api/src/operations/inventory-schema-verification.ts apps/api/src/operations/run-inventory-schema-verification.ts`

Contexto: el P1 de PR #90 (API escribe como `app_api` sin privilegios) se cierra con 8 funciones `app_private` SECURITY DEFINER; el orquestador ya corrió `verify:inventory-schema:rollback` (80 migraciones, `policies:4`, verde) y typecheck/lint/test API verdes.

Busca, en este orden:
1. Que `app_api` siga SIN `USAGE` del esquema `app` y sin privilegios directos (el invariante de `app-api-recovery` depende de eso).
2. Fugas entre restaurantes/sucursales: ¿alguna función devuelve o actualiza filas sin verificar membresía? ¿`read_..._for_manage` distingue ajeno de inexistente?
3. Corrección SQL: `security definer`, `search_path=''`, dueño postgres, `revoke all` + `grant execute` solo a `app_api`, `stable` vs `volatile`, `return query`/`returning` coherentes con la forma `table(...)`.
4. La prueba cubre de verdad: privilegios, DML real como `app_api`, rol sin manage, aislamiento y borrado lógico.

Salida: primera línea `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`; luego hallazgos numerados P1/P2/P3 con `archivo:línea` y corrección propuesta. Si no hay hallazgos, dilo.
