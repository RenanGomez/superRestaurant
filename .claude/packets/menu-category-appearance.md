# menu-category-appearance · color pastel e imagen para categorías del menú (nivel A)

Riesgo alto · Capa L1 `implementer-claude` · Rama `claude/menu-category-appearance` desde `main` (≥ 977caec) · 2026-11-01. Decisión humana: pedido explícito de Emmanuel el 2026-11-01 (retroalimentación de /app/menu), aunque esté fuera de la lista «Día operable».

## 1. Objetivo
Añadir a las categorías `color` (paleta cerrada de 8 tokens pastel, nunca hex) e `imagePath` (misma regla que `image_path` de productos, con segmento `categories`). Aceptar `target: "category"` en la subida de imágenes. UI: el círculo de 40 px a la izquierda del nombre muestra la imagen y abre el selector; fila de muestras de color; el color tiñe la tarjeta de categoría en el editor y la pestaña de categoría en captura.

## 2. Archivos de entrada
Contratos `packages/shared-types/src/index.ts`:
- 293-298 `MenuCategoryV1` (active, categoryId, displayOrder, name); 1068-1078 `parseMenuCategoryV1` (exact keys → pasar a claves opcionales como `parseMenuProductV1` 1081-1084); 993-1015 `parseMenuCatalogPayload`.
- 406-422 constantes de imagen y `UploadMenuImageCommandV1` (420 `target: "option" | "product"`); 430-472 `parseUploadMenuImageCommandV1` (447 valida target).
- `configured-catalog.ts` 4-9 `ConfiguredCatalogCategoryV2`: **no tocar** salvo que la captura lo necesite para pintar el color; si lo necesita, añadir los dos campos como opcionales también ahí y documentarlo.

API `apps/api/src/`:
- `menu-catalog-images.ts` 44-99 `upload`: segmento 65 (`product ? "products" : "options"`) y ruta 76 → rama `category → categories`.
- `menu-catalog-images.controller.ts` 21-35 sin cambios.
- `menu-catalog.ts` 40-43 port, 63-101 `save`, `catalogMatchesCommand`: comparar también `color` e `imagePath`.
- `menu-catalog-domain.ts` `validDomainCatalog`: confirmar que acepta los campos nuevos.

SQL `supabase/`:
- Última versión de `build_menu_catalog_state` (80-100, categorías 91-98) y `save_menu_catalog` (213-; validación de categorías 244-246 con `jsonb_has_exact_keys(..., ['categoryId','name','active','displayOrder'])`; inserción 359-360) en `migrations/20261008000200_catalog_halves_product_level.sql`.
- Tabla `app.menu_categories` en `migrations/20260902000100_create_menu_catalog.sql` 17-30.
- Patrón de `image_path` en `migrations/20261004000100_catalog_images.sql` 57-79 (regex + `split_part` de restaurant e id). Bucket y políticas (1-56): no tocar.
- Verificador modelo: `apps/api/src/operations/run-catalog-halves-product-level-schema-verification.ts` + `supabase/tests/catalog_halves_product_level_invariants.sql`.

Web `apps/web/src/`:
- `app/app/menu/menu-catalog-editor.tsx`: tipo de draft (34), estado (49-50), `addCategory` (148-150), sección de categorías (252-265; 259 círculo vacío), agrupación (280-285). Reutilizar `MenuPhoto` con `target="category"`.
- `app/app/menu/actions.ts` 25-29 y 40-58: target `"category"`.
- `app/app/capture/capture-menu.tsx`: 11 `categoryButton`, 16 y 22-26 `categoryColor` (hash a `bg-category-1..8`, queda como fallback), 55-61 nav de categorías.
- `lib/capture-selection.ts` `groupProductsByCategory`: propagar color e imagen si la pestaña los necesita.
- Mobile `apps/mobile/src/ui/menu-screen.tsx` y `src/test-fixtures.ts` sólo si el tipo lo exige. KDS sin consumidores.

Blast radius (CodeGraph 2026-11-01): `MenuCategoryV1` → editor web, `menu-removal.ts`, `menu-draft-storage(.test).ts`, `menu-duplicate.test.ts`, `capture-selection(.test).ts`, `menu-fraction.test.ts`, mobile (`menu-screen`, `test-fixtures`), tests de API `menu-catalog.test.ts`, `orders.test.ts`, `captures.test.ts`, `app.smoke.test.ts`. Reconsultar al terminar.

## 3. Alcance por archivo
- shared-types: `MENU_CATEGORY_COLORS` (8 tokens, p. ej. `rose|peach|sand|mint|sky|lilac|butter|sage`), tipo `MenuCategoryColorV1`; `MenuCategoryV1.color: MenuCategoryColorV1 | null`, `imagePath: string | null`, ambos opcionales en entrada y `null` normalizados; `target: "category"`; regex de `imagePath` con segmento `categories`. Tests.
- api: rama `category` en `menu-catalog-images.ts`; `catalogMatchesCommand` compara los campos nuevos; tests.
- Migración nueva `supabase/migrations/20261101000100_menu_category_appearance.sql`: columnas `color text null`, `image_path text null` en `app.menu_categories`; checks `menu_categories_color_valid` (lista exacta) y `menu_categories_image_path_valid` (`^[0-9a-f-]{36}/categories/[0-9a-f-]{36}/[0-9a-f-]{32}\.(jpg|png|webp)$` con restaurant e id de la fila); `create or replace` de `build_menu_catalog_state` y `save_menu_catalog` con `alter function ... owner to postgres`, validación de categorías con claves opcionales (`entry.value - 'color' - 'imagePath'`), inserción y lectura de los campos. Sin backfill, sin NOT NULL. **No aplicar en remoto.**
- `supabase/tests/menu_category_appearance_invariants.sql` + `apps/api/src/operations/run-menu-category-appearance-schema-verification.ts` + script `verify:menu-category-appearance-schema:rollback` en `apps/api/package.json`, modelados en halves-product-level.
- web: `actions.ts` target; editor con círculo `MenuPhoto` y fila de muestras (botones ≥ 44 px, `aria-pressed`, nombre del color en `aria-label`); clases Tailwind para los 8 tokens en un helper puro `lib/menu-category-color.ts` con test; `capture-menu.tsx` usa el color si existe y el hash si no.
- Fuera de alcance: `packages/domain`, KDS, Storage bucket/políticas, `menu-photo-focus` (irá después e incluirá categorías).

## 4. Invariantes
- Dinero: no aplica.
- Aislamiento: la ruta lleva `restaurantId`; el CHECK fuerza que el segundo segmento sea el id de la fila; subida exige `catalog.manage` por scope.
- Compatibilidad: campos opcionales en entrada, `null` por defecto; borradores locales antiguos (`menu-draft-storage`) se leen con `null`; despliegue API antes que web.
- Migración: nueva; nunca editar aplicadas; sólo local/rollback-only.
- Paleta: fuente única en shared-types; test de paridad TS↔SQL (leer la migración y comparar la lista).
- `save` sigue idempotente con `idempotencyKey` y `expectedVersion`; sin eventos de auditoría nuevos.

## 5. Criterios de aceptación
1. Categoría sin `color` ni `imagePath` se parsea, guarda y devuelve igual que hoy.
2. Color fuera de paleta o hex rechazado por parser y por CHECK.
3. Ruta de otra categoría o de otro restaurante rechazada por CHECK.
4. `target: "category"` produce `{restaurantId}/categories/{categoryId}/{hash}.ext`.
5. Replay de `save` coincide con los campos nuevos.
6. Editor y pestaña de captura usan el color si existe; si no, el fallback actual.
7. Círculo de 40 px con imagen que abre el diálogo de `MenuPhoto`; muestras ≥ 44 px; sin `alert/confirm/prompt`; español; LF; sin `any`.

## 6. Tests
- shared-types: parse con/sin campos; color inválido; hex; `imagePath` con `products` en vez de `categories`; target `category` aceptado, `other` rechazado; paridad paleta.
- api `menu-catalog-images.test.ts`: caso categoría y replay. `menu-catalog.test.ts`: save/replay con campos nuevos; `catalogMatchesCommand` detecta divergencia.
- SQL invariants: CHECK color y ruta; save antiguo sin campos; `build_menu_catalog_state` devuelve los campos; fuga entre restaurantes rechazada.
- web: helper de paleta; `menu-draft-storage` con borrador antiguo.

## 7. Verificación (Node 24 en `%LOCALAPPDATA%\Programs\node24`, pnpm vía corepack)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/api --filter=@super-restaurant/web`; `pnpm --filter @super-restaurant/mobile typecheck`.
- `pnpm --filter @super-restaurant/api run verify:menu-category-appearance-schema:rollback` contra PostgreSQL local desechable si el arnés existe (ver cómo lo hace el verificador modelo y `docs/runbooks`); si no hay Postgres local disponible, documentar la brecha exacta.
- CodeGraph antes y después.
- Navegador: sin sesión Playwright disponible; documentar brecha.

## 8. Riesgos
Paleta duplicada TS/SQL (mitigado con test de paridad); replay de `save` sin comparar campos nuevos; fotos huérfanas de categorías no guardadas (igual que productos); orden de despliegue API→web; `menu-photo-focus` posterior cambia `imagePath` a objeto.

## Formato de salida
Resumen, archivos, salida literal de las puertas y del verificador, CodeGraph después, brechas, riesgos. Commit local `feat(menu): ...`. Sin merge, sin push, sin aplicar migración remota.
