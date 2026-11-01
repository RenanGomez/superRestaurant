# menu-products-ui-r1 · nueva disposición de producto, foto por clic, secciones plegadas, copiar producto, fotos ya usadas, borrador local

## Tarea
menu-products-ui-r1 · capa L1 `implementer-claude` · nivel C (`apps/web/src/app/app/menu/menu-catalog-editor.tsx` sección de productos y `PublishButton`, `apps/web/src/app/app/menu/reorder-controls.tsx` sólo si hace falta, helpers puros nuevos en `apps/web/src/lib/menu-*.ts`) · riesgo medio por tamaño (689 líneas). Rama `claude/menu-products-ui-r1` desde `main` **después** de integrar `claude/menu-categories-r1`. No tocar `apps/api`, `packages/*` ni SQL. Lo que exige cambios de contrato (grupos de modificadores compartidos, «especialidades», ingredientes bloqueados, color e imagen de categoría, posición y zoom de la foto) va en `menu-modifier-model-v2` y `menu-category-appearance`; aquí no se simula nada de eso.

## Hallazgos de Emmanuel (2026-11-01, /app/menu)
1. La foto del producto tiene un botón aparte. Debe funcionar al tocar la propia foto: sin foto abre el selector de archivo de inmediato; con foto, abre una capa (fondo difuminado) con la foto grande y botones «Reemplazar», «Quitar» y «Cancelar».
2. Disposición deseada (captura de Emmanuel): fila 1 → miniatura redonda · Producto · Precio (con el total con impuesto debajo) · Unidad · casilla Activo · botón «×» a la derecha; fila 2 → Categoría · Clave interna (opcional, con su ayuda) · Estación; fila 3 → casillas «Grupos de modificadores», «Permitir mitades», «Aplicar impuesto» y botón «+ Añadir tamaño». Cada casilla o botón abre su sección **sólo** cuando está activa; con todo apagado la tarjeta ocupa tres filas.
3. Permite copiar un producto para no empezar de cero.
4. Al quitar una foto por error hay que volver a buscarla y subirla; mostrar abajo una lista de fotos ya usadas en este menú para elegir una.
5. Los cambios deben guardarse en automático; junto al botón «Publicar» indicar si hay cambios guardados y no publicados, con una animación en el botón cuando los haya.

## Cambios
1. **Foto por clic.** El `<button>` de la miniatura (44 px mínimo, `aria-label="Foto de {nombre}"`) abre el `<input type="file">` oculto cuando `imagePath === null`; con foto abre un `<dialog>` modal con `backdrop-filter: blur` sobre la página, la imagen a tamaño grande, «Reemplazar» (abre el selector), «Quitar» (`imagePath = null`) y «Cancelar». `Escape` cierra. Quitar el botón de foto anterior. Lo mismo para las opciones de modificador si hoy tienen botón aparte.
2. **Disposición.** Reorganizar `ProductCard` en tres filas como se describe arriba usando CSS grid con `minmax(0,1fr)`; a 390 px las filas se apilan en una columna. Las secciones de grupos de modificadores, mitades, impuesto y tamaños se renderizan sólo si su casilla está marcada o existen datos (si un producto ya tiene tamaños, la sección se muestra abierta). Desmarcar «Permitir mitades» o «Aplicar impuesto» vacía ese dato como hoy; desmarcar «Grupos de modificadores» con grupos existentes pide confirmación con el `RemovalDialog` que ya existe.
3. **Copiar producto.** Botón «Duplicar» en la tarjeta: crea un producto nuevo con `crypto.randomUUID()` para `productId`, nombre «{nombre} (copia)», `displayOrder` siguiente dentro de la categoría, `sku: null`, mismas variantes y fracción con ids nuevos, y copia de sus grupos de modificadores con `groupId`/`optionId` nuevos y `productId` del nuevo. Helper puro `duplicateProduct(product, groups, newId)` en `apps/web/src/lib/menu-duplicate.ts` con tests.
4. **Fotos ya usadas.** En el diálogo de foto y al pie del selector, lista «Fotos ya usadas en este menú»: todos los `imagePath` distintos de productos y opciones del borrador actual, con miniatura; elegir una asigna ese `imagePath` (mismo bucket, ninguna subida). Helper puro `collectUsedImagePaths(products, groups)` con test. Las fotos que se quitaron durante la sesión se conservan en esa lista hasta recargar.
5. **Borrador local y estado de publicación.** Guardar el borrador (categorías, productos, grupos y `expectedVersion`) en `localStorage` bajo `menu-draft:{restaurantId}:{branchId}:{expectedVersion}` con debounce de 500 ms; al cargar la página, si hay un borrador para la misma `expectedVersion`, ofrecer «Recuperar cambios sin publicar» / «Descartar». Junto a «Publicar nueva versión» mostrar «Cambios sin publicar · guardados localmente» o «Todo publicado»; el botón lleva un anillo pulsante (`animate-pulse` o `@keyframes` propio) sólo cuando hay cambios y `prefers-reduced-motion` no está activo. Al publicar con éxito se borra el borrador local. Nunca publicar automáticamente.
6. Textos de ayuda (`FieldHint`) se conservan.

## Invariantes
Sin `any`, LF, sin `alert/confirm/prompt`, targets de 44 px, textos en español. No cambiar la forma del `draft` que envía `saveMenuCatalogAction`. `localStorage` siempre dentro de `try/catch`.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`)
- `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build`.
- Tests de `menu-duplicate.ts` y `collectUsedImagePaths`.
- Navegador con sesión (copiar `apps/web/playwright/.auth/user.json`, borrar al final) en 1366×800 y 390×844: tarjeta en tres filas, secciones plegadas, foto por clic con diálogo, duplicar, elegir foto usada, recargar y recuperar borrador, indicador y animación del botón. Documentar la brecha si no se pudo.

## Formato de salida
Resumen, archivos, salida literal de las puertas, brecha de verificación, riesgos. Commit local `feat(web-menu): ...`. Sin merge ni push.

## Añadido 2026-11-01 · P3 heredados de la revisión de `menu-categories-r1` (ya en `main`)
- `reorder-controls.tsx` `DragReorderList.begin`: ignorar un segundo puntero mientras hay un arrastre activo (`if (dragRef.current !== null) return;`).
- El `aria-label` del asidero debe incluir el nombre del ítem («Arrastrar Pizzas para reordenar»): `DragReorderList` recibe una etiqueta por ítem.
- En el `useEffect` de desmontaje llamar a la misma limpieza que libera la captura del puntero.
- Si al reorganizar la tarjeta de producto conviene, usar `DragReorderList` también para productos y quitar `ReorderButtons` de productos; tamaños y grupos pueden conservar los botones.
