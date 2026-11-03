# menu-locked-ingredients-fix1 — hecha
Cambios: Se resolvió duplicación y truncamiento en `confirm_capture_draft_v3`: el fragmento suelto era la rama `then ...` de validación de exclusiones por UUID (con corrección de `p_restaurant_id` a `restaurant`) integrado en su loop; se podaron 208 líneas duplicadas del cierre prematuro de la función.
Archivos: supabase/migrations/20261102000100_menu_locked_ingredients.sql
Verificación: turbo run lint typecheck test --filter=@super-restaurant/api --force → Pasa (15 exitosas, 0 cacheadas); git diff --check → Pasa limpio; balances SQL: $backfill$=2, $function$=6, 0 IF/LOOP desbalanceados; invariants SQL: begin/rollback sin commit.
Riesgos/pendientes: Ninguno.
Notas: Commit 4cffad389ddfbb9f15bcd4548eae9adcea757bf0 en gemini/menu-locked-ingredients (worktree C:\tmp\sr-wt\menu-locked-ingredients-g).
