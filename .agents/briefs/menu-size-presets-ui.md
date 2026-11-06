# menu-size-presets-ui · pestaña «Tamaños y presets» real y selector en la tarjeta de producto (Nivel C)

Depende de `menu-size-presets-backend` (contratos `MenuSizePresetV1`, `MenuCatalogPayloadV1.sizePresets`, `MenuProductVariantV1.sizePresetId`) y de `menu-tabs-p3`, ambos ya en tu base. Diseño de UI: `.agents/reports/size-presets-research.md` §4.

Archivos: `apps/web/src/app/app/menu/**`, `apps/web/src/lib/menu-*.ts` y tests. No tocar `apps/api`, `packages/*`, SQL ni `capture/**`.

## Cambios
- Pestaña Tamaños: reemplaza el aviso «Pronto podrás…» por CRUD de presets (nombre, activo, orden con `DragReorderList`, «+ Agregar tamaño»). Quitar un preset en uso muestra confirmación dentro de la app con el número de productos afectados y, al confirmar, los deja como «Tamaño personalizado» (con su nombre actual). Sin `alert/confirm/prompt`.
- Tarjeta de producto, sección de tamaños: cada variante tiene un desplegable «Tamaño» con los presets activos + «Personalizado». Con preset, el nombre se fija (no editable) al del preset; con personalizado, campo de texto libre como hoy. Precio, clave y activo siguen por producto.
- Renombrar un preset actualiza en el borrador el nombre de las variantes que lo usan.
- Borrador local (`localStorage`) y publicar incluyen `sizePresets`.
- Helper puro con test (p. ej. en `lib/menu-variants.ts`): aplicar renombre/eliminación de preset a variantes.
- Español, 44 px, sin `any`, LF, `prefers-reduced-motion`.

## Hecho cuando
`pnpm turbo run lint typecheck test build --filter=@super-restaurant/web` verde (si no puedes, dilo). Commits `feat(web-menu): …`. Informe con bloque ``` de comando y salida real.
