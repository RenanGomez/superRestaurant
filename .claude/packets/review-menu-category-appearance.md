# Revisión de código (sólo lectura) · rama `claude/menu-category-appearance` · nivel A

Estás en un worktree de la rama `claude/menu-category-appearance`. No modifiques archivos. Revisa `git diff main...HEAD` contra el paquete `.claude/packets/menu-category-appearance.md` y las reglas de `AGENTS.md` (§9 dinero, §10 aislamiento por restaurante, §12 migraciones, §13 seguridad).

Enfócate en:
1. `supabase/migrations/20261101000100_menu_category_appearance.sql`: que los CHECK sean correctos (paleta exacta igual a `MENU_CATEGORY_COLORS` en `packages/shared-types/src/index.ts`; `image_path` con el restaurant y el id de la propia fila y segmento `categories`), que `create or replace` de `build_menu_catalog_state`, `save_menu_catalog` y `normalize_menu_catalog_payload` conserve `security definer`, `set search_path`, owner, grants y revokes exactamente como en `20261008000200_catalog_halves_product_level.sql`, que la validación de claves de categoría acepte sólo las conocidas y que un payload sin `color`/`imagePath` siga siendo válido y su replay idempotente.
2. `supabase/tests/menu_category_appearance_invariants.sql`: casos cubiertos y que termina en rollback.
3. `packages/shared-types/src/index.ts`: parsers estrictos, campos opcionales en entrada normalizados a `null`, regex de imagen, target `category`.
4. `apps/api/src/menu-catalog-images.ts` y `menu-catalog.ts`: ruta de almacenamiento, idempotencia del replay con los campos nuevos.
5. `apps/web`: `menu-catalog-editor.tsx`, `capture-menu.tsx`, `menu-category-color.ts`: accesibilidad (44 px, `aria-pressed`), fallback cuando `color` es `null`, nada de `any`, textos en español.

Salida: lista de hallazgos con severidad P1/P2/P3, archivo:línea y propuesta concreta; al final una línea `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`. Máximo 60 líneas.
