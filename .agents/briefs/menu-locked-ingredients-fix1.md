# menu-locked-ingredients-fix1 — corregir error de sintaxis en la migración (escribe código)
Agente: Gemini   Nivel de rigor: A   Complejidad: Estándar

## Objetivo
La migración `supabase/migrations/20261102000100_menu_locked_ingredients.sql` de la rama `gemini/menu-locked-ingredients` falla al ejecutarse contra PostgreSQL (prueba remota con rollback hecha por el orquestador): `SQLSTATE 42601 syntax error at or near "then"` en el carácter ~78766 (≈ línea 1253). Justo después del `$function$;` que cierra `confirm_capture_draft_v3` quedó un fragmento suelto que empieza con ` then select * into extra_option from app.menu_modifier_options where restaurant_id = p_restaurant_id and catalog_id = catalog and group …`. Parece un trozo de la lógica de validación de exclusiones que debía ir **dentro** de `confirm_capture_draft_v3` (o de la función que valida la línea) y quedó fuera.

## Dónde trabajar (obligatorio)
- Worktree existente `C:\tmp\sr-wt\menu-locked-ingredients-g` (rama `gemini/menu-locked-ingredients`). No edites el checkout principal.

## Tarea
1. Abre la migración, localiza el fragmento suelto tras el cierre de `confirm_capture_draft_v3` y decide: si es código duplicado, elimínalo; si es la validación que falta (exclusiones de línea deben ser opciones del grupo de ingredientes **no** bloqueadas, con fallback a etiquetas legadas), colócala dentro del cuerpo de la función en el lugar correcto, con `if … then … end if;` bien balanceado.
2. Revisa el archivo completo buscando otros desbalances: cuenta `if`/`end if`, `loop`/`end loop`, `begin`/`end`, `$function$`/`$$`, y que cada `create or replace function` termine con su `language plpgsql` y `;`.
3. Vuelve a comprobar que `save_menu_catalog`, `normalize_menu_catalog_payload`, `build_menu_catalog_state` y `confirm_capture_draft_v3` conservan `security definer`, `set search_path = ''`, `owner to postgres` y los grants de la versión vigente (`20261101000200`).
4. Verifica también `supabase/tests/menu_locked_ingredients_invariants.sql` con el mismo criterio (empieza `begin;`, termina `rollback;`, sin `commit`).
5. Corre `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js" turbo run lint typecheck test --filter=@super-restaurant/api` (los tests de `schema-contract` leen el SQL) y `git diff --check`.
6. Commit en la misma rama: `fix(db): close confirm_capture_draft_v3 body in locked ingredients migration`.

## Restricciones
No tocar otras capas; no aplicar nada en remoto; no push ni merge.

## Formato de salida: reporte §8 en .agents/reports/menu-locked-ingredients-fix1.md
Qué era el fragmento, dónde quedó, conteos de balance, salida de puertas, hash. Máximo 40 líneas.
