## Estado
done — pestaña «Recetas» en `/app/inventario?tab=recetas`: selector de producto, versiones activa/históricas y publicación contra el API.
## Qué hice
- Editor de líneas con insumo, cantidad entera positiva y unidad del insumo; publicar abre diálogo accesible, valida duplicados/cantidades, resume y recarga versiones del servidor.
- Decisiones: listado con `includeInactive=true` para traer históricas, catálogo vía el mismo endpoint de menú con timeout de 10 s, borrador sembrado desde la versión activa, sin cálculo de costos.
## Archivos tocados
- `apps/web/src/app/app/inventario/{actions.ts,inventory-workspace.tsx,recipes-panel.tsx}`, `apps/web/src/lib/inventory-ui.ts(+test)`; `git status --short`: ` M .../actions.ts`, ` M .../inventory-workspace.tsx`, ` M .../inventory-ui.test.ts`, ` M .../inventory-ui.ts`, `?? .../recipes-panel.tsx`.
## Verificación
```
$ pnpm --filter @super-restaurant/web lint && pnpm --filter @super-restaurant/web typecheck && pnpm --filter @super-restaurant/web test && pnpm --filter @super-restaurant/web build
✔ recipe version labels separate the active version from history (0.1434ms) … ✔ recipe drafts require at least one complete line (0.3705ms) ℹ tests 15 ℹ pass 15 ℹ fail 0; ✓ Compiled successfully in 2.1s ƒ /app/inventario
```
## Riesgos / dudas
- NO VERIFICADO: navegador real, breakpoints 390×844 ni endpoints reales (los hace el orquestador); sin cambios de esquema ni migraciones.
## Notas propuestas
- El catálogo de productos reutiliza `/api/v1/catalog/menu` mediante el `send` de inventario, así el timeout de 10 s aplica también a esa carga.