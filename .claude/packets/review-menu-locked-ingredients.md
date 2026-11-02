# Revisión de código (sólo lectura) · rama `gemini/menu-locked-ingredients` · nivel A

Estás en un worktree de la rama `gemini/menu-locked-ingredients`. No modifiques archivos. Revisa `git diff main...HEAD` contra `.claude/packets/menu-locked-ingredients.md`, `.agents/reports/p2-locked-ingredients-research.md` y `AGENTS.md` (§9 dinero, §10 aislamiento, §11 compatibilidad, §12 migraciones).

Enfócate en:
1. `supabase/migrations/20261102000100_menu_locked_ingredients.sql`: columnas `uuid[] not null default '{}'` con CHECK de cardinalidad; backfill determinista e idempotente (bloqueado = opción del grupo de ingredientes cuyo nombre normalizado no está en las etiquetas excluibles; etiquetas sin opción o duplicadas sólo se reportan con `raise notice`, nunca se inventan ids); `save_menu_catalog`, `normalize_menu_catalog_payload`, `build_menu_catalog_state` y `confirm_capture_draft_v3` reemplazados desde su versión vigente (`20261101000200` para las tres primeras y `confirm_capture_draft_v3`) sin perder campos ni grants, con `security definer`, `set search_path = ''`, owner postgres; validación de exclusiones de línea «opciones del grupo − bloqueadas» y compatibilidad con payloads/capturas antiguas con etiquetas.
2. `supabase/tests/menu_locked_ingredients_invariants.sql`: `begin;` … `rollback;`, sin `commit`; cubre backfill mapeadas/no mapeadas/duplicadas, exclusión bloqueada rechazada, no bloqueada aceptada con el mismo precio, payload antiguo y replay, snapshot confirmado intacto.
3. Dominio `fraction-pricing.ts` / `menu.ts`: «Sin X» sigue a precio 0; precio de mitades sin cambios; snapshots antiguos con etiquetas se decodifican; ningún `any`.
4. API `fraction-halves.ts`: derivación del nombre a partir de `exclude:<half>:<optionId>` con fallback a etiquetas; `describeHalvesFromSnapshot` no rompe órdenes históricas.
5. Web `menu-catalog-editor.tsx` (`FractionEditor`), `product-sheet.tsx`, `line-halves.ts`: casillas 44 px con `aria-checked`, poda de bloqueados al cambiar de grupo, chips «Sin {nombre}» con el id de opción, textos en español, sin `alert/confirm/prompt`.
6. Mobile: compila y sus tests pasan.

Salida: hallazgos P1/P2/P3 con archivo:línea y propuesta concreta; cierre `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`. Máximo 60 líneas.
