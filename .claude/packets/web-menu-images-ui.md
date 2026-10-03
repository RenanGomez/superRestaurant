# web-menu-images-ui · subir y mostrar fotos de productos y opciones

## Tarea
web-menu-images-ui · capa: L2 (Codex) · riesgo: bajo · nivel C (`apps/web`: editor de menú, server action nueva, tarjeta de producto en captura). Ritmo: **configuración** (editor de menú, formulario con opciones claras) y **operación** (la tarjeta en captura sólo muestra la foto). Sin cambios en `apps/api`, `packages/*` ni SQL. Lote `lote-feedback-20261001` #12 #15.

## Objetivo
Que el administrador pueda poner una foto a cada producto y a cada opción de modificador desde `/app/menu` con un toque («Foto» → elegir archivo → se sube y se ve), y que el menú táctil de captura muestre esa foto en la tarjeta; sin foto, se mantienen las iniciales con color de categoría.

## Hechos verificados (main 9e3b44b, migración `20261004000100` aplicada, API local en 3000 con el código)
- Contratos: producto y opción del catálogo tienen `imagePath: string | null` (opcional en entrada, siempre presente en salida). `UploadMenuImageCommandV1 { schemaVersion: 1, scope, target: "product" | "option", targetId, contentType: "image/jpeg" | "image/png" | "image/webp", dataBase64, eventId, idempotencyKey, deviceId, occurredAt }` → `POST /menu/images` → `MenuImageUploadResultV1 { schemaVersion: 1, imagePath, publicUrl }` (`packages/shared-types/src/index.ts`, buscar `UploadMenuImageCommandV1`). Límite 2 MB decodificados; el API valida magic bytes; 503 `MENU_IMAGES_UNCONFIGURED` si el servidor no tiene Storage configurado.
- URL pública: `publicUrl` del resultado, o `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/catalog-images/${imagePath}` (confirmar la variable pública que ya usa la web para Supabase en `apps/web/src/env.ts`).
- Editor: `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (`ProductEditor`, opciones de modificador; `addProduct`/`addOption` ya crean `imagePath: null`); server actions en `apps/web/src/app/app/menu/actions.ts` (patrón `saveMenuCatalogAction` con token y `apiBaseUrl`). El guardado del catálogo persiste `imagePath` tal cual.
- Captura: tarjeta de producto en `apps/web/src/app/app/capture/capture-menu.tsx` (bloque de iniciales `productInitials`/`categoryColor`).

## Criterios de aceptación (verificables)
- [ ] En el editor, cada producto y cada opción muestran una miniatura (o las iniciales) y un botón «Foto» (≥44 px) que abre el selector de archivo (`accept="image/jpeg,image/png,image/webp"`). Al elegir: validación en cliente de tipo y tamaño (≤ 2 MB, mensaje claro si no), lectura a base64, llamada a una server action `uploadMenuImageAction(target, targetId, file)` que acuña `eventId`/`idempotencyKey`/`occurredAt`/`deviceId` y hace `POST /menu/images`; estados «Subiendo…», éxito (miniatura actualizada y `imagePath` en el borrador) y error con el texto del código (`unconfigured` → «El servidor no tiene almacenamiento de fotos configurado; avisa al administrador»). Botón «Quitar foto» pone `imagePath: null`.
- [ ] El borrador del catálogo guarda `imagePath` en el `save` (ya lo hace el contrato; verificar que el editor no lo pierda al reordenar o duplicar).
- [ ] En captura, la tarjeta muestra la foto (`<img>` con `alt=""`, `loading="lazy"`, `object-cover`, misma altura que el bloque de iniciales) cuando `imagePath` no es nulo; si la imagen falla al cargar, vuelve a las iniciales.
- [ ] Helpers puros con prueba: validación de tipo/tamaño, construcción de la URL pública.
- [ ] Sin `alert/confirm/prompt`; 390×844 sin scroll horizontal; consola limpia. Toques del flujo principal: «Foto» → archivo → listo (2).

## Invariantes
El servidor valida contenido y tamaño; la web no decide rutas (usa `imagePath` devuelto); contratos intactos; no tocar `product-sheet.tsx` ni `capture-workspace.tsx` (otra tarea en paralelo).

## Fuera de alcance
Recorte o redimensionado, borrado en Storage, mobile, API.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
Resumen, archivos tocados, salida literal, riesgos. No hagas commit.
