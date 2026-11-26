# Brief o4-rev-historical

NO escribas archivos fuera de tu informe `.agents/reports/o4-rev-historical.md`. NO edites código, NO commitees, NO hagas push. NO ejecutes PostgreSQL ni Playwright. Trabaja en la raíz del repo y lee con `git show`.

## Objetivo
Revisión de la rama `harness/o4-historical-verifiers` (PR #130, nivel B): verificadores históricos de esquema.

Tiempo estimado: 12 min

## Qué revisar
`git diff main...origin/harness/o4-historical-verifiers` y, si necesitas el fichero completo, `git show origin/harness/o4-historical-verifiers:<ruta>`. Son 7 archivos:
- `supabase/tests/menu_shared_modifier_groups_invariants.sql` (rollback→commit)
- `supabase/tests/catalog_halves_invariants_pre_20261102000100.sql` y `..._product_level_...` (nuevos, pineados)
- `supabase/tests/customer_directory_invariants_pre_20260917000100.sql` (nuevo, pineado)
- `apps/api/src/operations/run-menu-shared-modifier-groups-schema-verification.ts`
- `apps/api/src/operations/run-menu-locked-ingredients-schema-verification.ts`
- `apps/api/src/operations/run-capture-schema-verification.ts` (modo local)
- `apps/api/package.json`, `apps/api/src/schema-contract.test.ts`, `apps/api/src/operations/post-p2-catalog.test.ts`

## Qué comprobar
1. **Fidelidad de los pineados**: ¿el contenido pineado es realmente la versión histórica (compara `git show 322e2f45:<ruta>` / `git show ff2f30bf:<ruta>`), o se colaron cambios funcionales? Un pineado que altere aserciones invalida la prueba.
2. **Runner de capture**: el modo local crea su propio cluster, aplica exactamente las migraciones anteriores a `20260916000100`, siembra el actor, y en `finally` para el cluster; sin rutas fuera del repo, sin tocar configuración remota, y el modo sin argumento conserva el comportamiento previo. Busca fugas: variables de entorno remotas usadas en local, cleanup que no corre en error, o un fallo que se reporte como `ok`.
3. **Sin tolerancias nuevas**: ninguna aserción relajada, ningún `|| true`, ningún `expectedSummary` cambiado, ningún fixture vigente editado (salvo la normalización `commit;` del fixture de grupos compartidos, que solo cambia la última sentencia).
4. **Seed de locked ingredients**: `'CEBOLLA'` conserva la ambigüedad que la prueba exige y no hay aserciones huérfanas del literal anterior.
5. Riesgo de que el pineado oculte una regresión real del esquema (¿la prueba histórica sigue siendo significativa?).

## Reporte
`.agents/reports/o4-rev-historical.md`, máximo 20 líneas:
1. `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
2. Hallazgos `P1`/`P2`/`P3` con `archivo:línea` y una frase de por qué.
3. Qué no pudiste verificar (las tres ejecuciones las corrió el orquestador: shared 62 previas ok, locked 63 ok, capture 16 previas 27/5/36→35/5/41 ok).
