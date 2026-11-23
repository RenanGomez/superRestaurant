# Brief menu-photos-recent (M3, nivel C)

## Objetivo
Una sola lista «Fotos recientes», sin desfase de una foto, e indicador de guardado (smoke menu-cat puntos 2 y 3).

## Alcance
- Editar `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (`MenuPhoto` ~1141-1306, `UsedPhotos` ~1409, efecto ~206-209; ubica por símbolo), `apps/web/src/lib/menu-used-images.ts` y su test `menu-used-images.test.ts`.
- Prohibido: API, SQL, git commit/push.

## Contexto mínimo
- `retainImagePaths` (`menu-used-images.ts` ~25-28) sólo agrega rutas, y la lista se alimenta con un efecto que va un render atrasado. Deriva la lista con `useMemo` desde lo retenido más lo actual, sin efecto atrasado: la ruta nueva aparece en el mismo render del `onChange`.
- Unifica en una sola lista «Fotos recientes».
- Indicador visible «Guardado en el borrador ✓» tras cada cambio de foto, junto al botón «Listo» del modal.

## Hecho cuando
- Test en `menu-used-images.test.ts` que reproduce la secuencia: subir A, reemplazar por B, subir C (la lista contiene A, B, C sin retraso). lint, typecheck y test web en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/menu-photos-recent.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
