VEREDICTO: APROBAR (sin P1; 1×P2 y 3×P3 para `docs/agentic/debt.md`)

Hallazgos
- **P2 · `apps/api/src/operations/run-capture-schema-verification.ts:15` (+`:105`)** — `localOnly` compara la cadena exacta `process.argv.slice(2).join(" ")`; cualquier argumento extra (p. ej. `pnpm run verify:capture-schema:rollback -- --x`) cae silenciosamente en `verifyRemote()` contra `process.env` en vez de rechazar con `LOCAL_CONFIRMATION_REQUIRED` como hacen el resto de runners. Footgun de destino remoto, no fuga de datos (el modo remoto es rollback-only).
- **P3 · `run-capture-schema-verification.ts:26`** — `CUSTOMER_ADAPTER_VERIFICATION` se consulta también en modo local; una variable residual en el shell cambia la corrida (intenta adaptadores `app_api` contra el cluster desechable). Corrida no hermética, sin efecto remoto.
- **P3 · `docs/architecture/P2_MULTICHANNEL_CAPTURE_SLICE.md:7`** — sigue documentando `npm run verify:capture-schema:rollback` como verificador remoto server-only; tras el PR el script es local-only y `verifyRemote()` queda sin entrada npm.
- **P3 (observación) · `run-menu-shared-modifier-groups-schema-verification.ts:133`** — el set histórico omite `20260917000100` y aplica `20260920000100`; verifiqué que esta solo redefine `search_customer_directory` (la `17000100` redefina `mutate_customer_directory`), así que el conjunto es coherente. El pineado solo alimenta verificadores históricos; las fixtures vivas siguen corriendo (locked usa las vivas de halves; `schema-contract` la viva de grupos).

Comprobaciones con evidencia (comandos reales de esta revisión)
```
$ git diff --no-index --numstat $env:TEMP\h_halves.sql $env:TEMP\p2_halves.sql
4       0       "...h_halves.sql" => "...p2_halves.sql"      # solo 4 líneas de cabecera; ídem product_level y directory
$ git ls-tree -r --name-only origin/harness/o4-historical-verifiers supabase/tests | Select-String pre_
supabase/tests/historical/catalog_halves_invariants_pre_20261102000100.sql
supabase/tests/historical/catalog_halves_product_level_invariants_pre_20261102000100.sql
supabase/tests/historical/customer_directory_invariants_pre_20260917000100.sql
$ git show origin/...:supabase/migrations/20261102000100_menu_locked_ingredients.sql | Select-String btrim
  and pg_catalog.lower(pg_catalog.btrim(opt.name)) = pg_catalog.lower(pg_catalog.btrim(label_val));
```
- Pineados: `322e2f45`/`ff2f30bf`/`dad5e516^` (=`3f48c933`) más 4 líneas de comentario, 0 bajas → fieles.
- `menu_shared_modifier_groups_invariants.sql`: única diferencia `-rollback; +commit;`; `schema-contract.test.ts:flutter` actualizado a `commit` y prohíbe `rollback;`.
- `'CEBOLLA'` conserva ambigüedad: `lower(btrim())` casa con `0005 'Cebolla'` y `0006 'CEBOLLA'` (2 matches) → se excluyen ambos → `EXPECTED_BACKFILL.ambiguous = ["…0007"]` intacto, sin literales huérfanos.
- CI: `for file in supabase/tests/*.sql` es no recursivo, por eso `867c002d` mueve los pineados a `historical/`; `targetSummary` 35/5/41 y `baseSummary` sin cambios; local aplica todo lo previo a `20260916000100`, siembra `auth.users`, para el cluster en `finally` y fija `exitCode=1`.

NO VERIFICADO: las tres ejecuciones (shared 62, locked 63, capture 27/5/36→35/5/41) — no ejecuté PostgreSQL por instrucción del brief; las reporto como dato del orquestador, no como propio. NO VERIFICADO: `pg-verify` en CI.