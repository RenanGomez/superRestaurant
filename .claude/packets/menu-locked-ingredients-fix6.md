# menu-locked-ingredients-fix6 · `->` seguido de `-` sin paréntesis en la migración: «operator is not unique: unknown - unknown»

Nivel A · Codex (`tools/agentic/codex-task.ps1 -Task menu-locked-ingredients-fix6 -Packet .claude/packets/menu-locked-ingredients-fix6.md -Base codex/menu-locked-ingredients-fix5 -Effort low`). Archivos: `supabase/migrations/20261102000100_menu_locked_ingredients.sql` y `supabase/tests/menu_locked_ingredients_invariants.sql`. El orquestador hace el commit si el sandbox no puede. **Este cambio toca la migración**: el orquestador repetirá la sonda remota.

## Fallo observado (ejecución remota con rollback)
`SQLSTATE 42725 operator is not unique: unknown - unknown` en `app_private.save_menu_catalog` (la versión que crea esta migración), línea 27 del cuerpo, dentro del `if` de validación del payload. En PostgreSQL el operador `-` tiene mayor precedencia que `->`, así que `entry.value->'fraction' - 'lockedIngredientOptionIds' - 'excludableIngredientIds'` se evalúa como `entry.value -> (('fraction' - 'lockedIngredientOptionIds') - 'excludableIngredientIds')` y `'fraction' - 'locked…'` es `unknown - unknown`. Las migraciones aplicadas escriben `entry.value - 'color' - 'imagePath'` (sin `->`), que sí funciona.

## Tarea
1. En la migración, líneas ~353 y ~396 (y cualquier otra con el mismo patrón `->'…' - '…'`): envuelve el acceso en paréntesis y castea las claves: `((entry.value->'fraction') - 'lockedIngredientOptionIds'::text) - 'excludableIngredientIds'::text`. Haz `grep -n "' - '" supabase/migrations/20261102000100_menu_locked_ingredients.sql` y revisa cada ocurrencia.
2. Mismo barrido en `supabase/tests/menu_locked_ingredients_invariants.sql`.
3. No cambies nada más de la migración. Mantén `begin;`/`rollback;` en las invariantes.
4. Commit `fix(db): parenthesize jsonb accessors before minus in locked ingredients migration`.

## Salida
Líneas cambiadas; hash o motivo de no commitear.
