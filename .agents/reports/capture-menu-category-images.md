# capture-menu-category-images — hecha
Cambios: las pestañas de categoría pintan `entry.category.imagePath` con `menuImagePublicUrl` como miniatura decorativa sobre el color de la categoría; sin imagen o si falla, queda sólo el color.
Archivos: apps/web/src/app/app/capture/capture-menu.tsx
Verificación: `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test` (desde apps/web)
```
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
$ tsc --noEmit --project tsconfig.json
# tests 7
# pass 7
# fail 0
```
Riesgos/pendientes: Ninguno. Verificación visual en navegador pendiente del orquestador.
Notas: reutiliza `menuImagePublicUrl` y el estado `failedImages` ya existentes; alt vacío y target de 44 px (`min-h-11`) intacto.
