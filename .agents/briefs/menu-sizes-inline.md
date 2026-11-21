# Brief menu-sizes-inline (M1, nivel C)

## Objetivo
Quitar la pestaña «Tamaños» y los presets: cada producto define sus tamaños libremente (smoke menu-prod).

## Alcance
- Editar `apps/web/src/lib/menu-tabs.ts` (+ `menu-tabs.test.ts`), `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (pestaña `tamanos` ~548-575 y selector de preset por variante ~758-762; ubica por símbolo, M0 ya movió líneas), `apps/web/src/lib/menu-draft-storage.ts` (+ test).
- Prohibido: API, SQL, migraciones, git commit/push.

## Contexto mínimo
- Quita la pestaña `tamanos` y el selector de preset por variante. Cada variante edita su nombre libremente, como en «Personalizado».
- **Invariante:** al guardar, toda variante sale con `sizePresetId: null` (si no, el SQL sobrescribe el nombre con el del preset). Los presets quedan en la base sin uso; sin migración.
- Un borrador local viejo con `sizePresets` debe cargar sin error (migra en `menu-draft-storage.ts`). Test de esa migración.

## Hecho cuando
- Test de que `sizePresetId` sale null en el payload de guardado; test de carga de borrador viejo; lint, typecheck y test web en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/menu-sizes-inline.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
