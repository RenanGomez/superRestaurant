# menu-photo-copy · copiar una foto del catálogo a otro producto, opción o categoría desde el servidor

Nivel B · Capa L2 Codex (`tools/agentic/codex-task.ps1 -Task menu-photo-copy -Packet .claude/packets/menu-photo-copy.md -Effort medium`) · riesgo medio · rama `codex/menu-photo-copy` desde `main` (≥ 61fd846). Pedido de Emmanuel (2026-11-01): poder elegir una foto ya usada en el menú y que al duplicar un producto se conserve la foto. Hoy es imposible porque los CHECK `menu_products_image_path_valid`, `menu_modifier_options_image_path_valid` y `menu_categories_image_path_valid` (`supabase/migrations/20261004000100_catalog_images.sql:57-79`, `20261101000100_menu_category_appearance.sql`) exigen que `image_path` sea `{restaurantId}/{products|options|categories}/{idPropio}/{hash32}.{jpg|png|webp}`.

## Contexto que debes leer antes de escribir
- `apps/api/src/menu-catalog-images.ts` (servicio `upload`, cómo se construye la ruta y el hash), `menu-catalog-images.controller.ts` (`POST` de subida, 400/403), `catalog-image-storage.ts` (`put`; ver si el cliente de Storage expone `copy` o hay que `download`+`put`), `menu-catalog-images.test.ts`, `catalog-image-storage.test.ts`.
- `packages/shared-types/src/index.ts`: `UploadMenuImageCommandV1`, `parseUploadMenuImageCommandV1`, `MenuImageUploadResultV1`, `MENU_IMAGE_PATH_PATTERN`, target `"product" | "option" | "category"`.
- `apps/web/src/app/app/menu/actions.ts` (`uploadMenuImageAction`), `apps/web/src/lib/menu-images.ts`, `menu-catalog-editor.tsx` (`MenuPhoto`, diálogo de foto, «Fotos quitadas de este producto», `duplicateProduct` en `apps/web/src/lib/menu-duplicate.ts` con `imagePath: null` y el aviso «La foto no se copia»), `apps/web/src/lib/menu-used-images.ts` (`collectUsedImagePaths`, `imagePathsOfEntity`).
- Autorización: la subida exige `catalog.manage` por scope; reutiliza exactamente el mismo guard.

## Cambios
1. **Contrato** (`packages/shared-types/src/index.ts`): `CopyMenuImageCommandV1 { schemaVersion: 1; scope; target: "product"|"option"|"category"; targetId; sourceImagePath; eventId; idempotencyKey; deviceId; occurredAt }` con parser estricto (`sourceImagePath` debe cumplir `MENU_IMAGE_PATH_PATTERN` y pertenecer al mismo `restaurantId` del scope). Resultado: `MenuImageUploadResultV1` (mismo `{ imagePath }`). Tests runtime.
2. **API**: `POST /api/v1/menu/images/copy` en el mismo controller; el servicio comprueba que el objeto origen existe en el bucket del restaurante, copia el objeto a `{restaurantId}/{segmento}/{targetId}/{hash}.{ext}` (si el SDK de Storage ofrece `copy`, úsalo; si no, `download` + `put`), conserva la extensión, calcula el hash del contenido igual que `upload`, y es idempotente por `idempotencyKey` como la subida. 403 si el origen es de otro restaurante, 404/400 si no existe. Tests con el fake de storage existente.
3. **Web**: `copyMenuImageAction(target, targetId, sourceImagePath)` en `actions.ts`; el diálogo de `MenuPhoto` vuelve a ofrecer «Fotos ya usadas en este menú» (todas las de `collectUsedImagePaths`) además de «Fotos quitadas de este producto»: elegir una ajena llama a la acción de copia y asigna la ruta devuelta; `duplicateProduct` sigue dejando `imagePath: null`, pero tras crear la copia la UI dispara la copia de la foto del original (producto y opciones) y actualiza el borrador; si falla, muestra el aviso actual.
4. No tocar SQL ni los CHECK; no tocar `apps/web/src/app/app/capture/**`.

## Invariantes
Aislamiento por restaurante en el origen y el destino; `catalog.manage`; sin secretos en el cliente; sin `any`; LF; textos en español; sin `alert/confirm/prompt`; targets de 44 px; el borrador local (`menu-draft-storage`) sigue siendo válido.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/api --filter=@super-restaurant/web`.
- Contract test HTTP del endpoint nuevo si existe arnés (`apps/api/src/*http-verification*` como modelo) o test unitario del controller.
- Navegador: sin sesión Playwright disponible; documenta la brecha.

## Formato de salida
Resumen, archivos, salida literal de puertas, brecha, riesgos. Commits locales `feat(menu-images): …`. Sin merge ni push.
