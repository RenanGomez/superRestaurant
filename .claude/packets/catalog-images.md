# catalog-images · fotos de productos y opciones con Supabase Storage

## Tarea
catalog-images · capa: L1 (`implementer-claude`, razonamiento alto) · riesgo: alto · **nivel A** (migración SQL con bucket y políticas de Storage, cambio de contrato de catálogo consumido por web y mobile, endpoint con service key). La parte web (subir foto desde el editor y mostrarla en la captura) es nivel C y se hace después en otro paquete.

## Objetivo
Que un producto y una opción de modificador puedan tener una foto: el API la recibe, la guarda en un bucket de Supabase Storage bajo el restaurante, devuelve una ruta estable que se persiste en el catálogo y que cualquier cliente puede convertir en URL pública de solo lectura.

## Hechos verificados (main 7047fbe, researcher 2026-10-01)
- Contratos: `SaveMenuCatalogCommandV1 extends MenuCatalogPayloadV1` (`packages/shared-types/src/index.ts` ~340-390; parser `parseSaveMenuCatalogCommandV1` ~373); payload con `categories`, `products`, `modifierGroups`, `currency`, `catalogVersion`. Localizar `MenuProductV1` y la opción de modificador (`MenuModifierOptionV1` o equivalente) y sus parsers exactos.
- SQL: `supabase/migrations/20260902000100_create_menu_catalog.sql` crea `app.menu_catalogs`, `app.menu_products` (columnas normalizadas: name, sku, active, unit_price_minor, tax_*), `app.menu_modifier_groups` y las opciones; `app_private.save_menu_catalog(actor, restaurant, branch, eventId, idempotencyKey, deviceId, occurredAt, expectedVersion, catalogVersion, currency, payload jsonb)` recibe el JSON y lo normaliza. Ver también migraciones posteriores que la reemplacen (grep `save_menu_catalog`), y usar la última definición como base.
- API: `apps/api/src/menu-catalog.ts` (`PostgresMenuCatalogAdapter`, `MenuCatalogPort`); el API no tiene cliente de Supabase Storage. `SUPABASE_SECRET_KEY` y `SUPABASE_URL` ya se cargan en `tmp/start-authorized-local-api.ps1` (ver `apps/api/src/*env*`/config para cómo se leen las variables).
- ADR-001: Storage se decide por módulo; NestJS es la frontera de escritura; los clientes nunca suben directo.
- Web: el release del menú llega a la captura por `apps/web/src/lib/*` (buscar `MenuCatalogReleaseV1`/`menu release`) y el editor guarda vía `apps/web/src/app/app/menu/actions.ts:22-51`.

## Diseño (seguir salvo razón documentada)
1. **Migración** `supabase/migrations/20261004000100_catalog_images.sql`:
   - `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('catalog-images','catalog-images', true, 2097152, array['image/jpeg','image/png','image/webp']) on conflict (id) do nothing;` (lectura pública: fotos de menú no son datos personales y los tablets las cachean; la escritura queda sólo en el API).
   - Políticas en `storage.objects` para el bucket: `select` para `anon` y `authenticated`; **ninguna** política de `insert/update/delete` para `authenticated`/`anon` (sólo service role, que las omite). Comentarios que lo expliquen.
   - Columna aditiva `image_path text null` en `app.menu_products` y en la tabla de opciones de modificador, con CHECK de forma: `image_path ~ '^[0-9a-f-]{36}/(products|options)/[0-9a-f-]{36}/[0-9a-f-]{32}\.(jpg|png|webp)$'` y que el primer segmento sea el `restaurant_id` de la fila (`split_part(image_path,'/',1) = restaurant_id::text`).
   - `create or replace` de `app_private.save_menu_catalog` para leer `imagePath` (string|null) de cada producto y opción del payload, validarlo con la misma forma y persistirlo; releases/lecturas del catálogo (función que arma el release para clientes) lo devuelven.
   - Prueba `supabase/tests/catalog_images_invariants.sql`: bucket existe con límites; `authenticated` no puede insertar en `storage.objects` del bucket; `image_path` de otro restaurante → rechazado por CHECK; guardar y leer catálogo con `imagePath` nulo y no nulo; forma inválida → rechazada. Verificación local con la sonda PG17 efímera (como `run-send-order-to-kitchen-schema-verification.ts`; Storage: si el cluster local no tiene el esquema `storage`, la prueba de bucket/políticas se marca como sólo-remoto y se documenta; la sonda rollback-only remota la ejecuta el orquestador).
2. **Contratos** (shared-types): `imagePath: string | null` aditivo en producto y opción del payload y del release, parser exacto con la misma forma; `UploadMenuImageCommandV1 { schemaVersion:1, scope, target: "product"|"option", targetId: uuid, contentType: "image/jpeg"|"image/png"|"image/webp", dataBase64: string (≤ 2 MB decodificados), eventId, idempotencyKey, deviceId, occurredAt }` y `MenuImageUploadResultV1 { schemaVersion:1, imagePath, publicUrl }`. Mobile y KDS deben seguir compilando (campo opcional en lectura: tratar ausencia como `null`).
3. **API**: puerto `CatalogImageStoragePort { put(path, bytes, contentType): Promise<void> }` con adaptador Supabase Storage por HTTP (`fetch` a `${SUPABASE_URL}/storage/v1/object/catalog-images/<path>` con `Authorization: Bearer <SUPABASE_SECRET_KEY>`, `x-upsert: false`), sin SDK nuevo si `fetch` basta. Endpoint `POST /menu/images` (permiso de gestión de catálogo que ya use `save`), valida magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`), tamaño ≤ 2 MB, genera `path = <restaurantId>/<products|options>/<targetId>/<uuid32>.<ext>`, sube y devuelve `imagePath` y `publicUrl = ${SUPABASE_URL}/storage/v1/object/public/catalog-images/${imagePath}`. No persiste en el catálogo: el editor guardará `imagePath` en el siguiente `save`. Pruebas: scope ajeno → denied; MIME/magic inválido → request; tamaño → request; adaptador falso. Rate limit si el módulo ya tiene patrón.
4. **Docs**: ADR corta `docs/architecture/ADR-011-catalog-images-storage.md` (bucket público de lectura, escritura sólo API, forma del path, límites).

## Criterios de aceptación
- [ ] Migración candidata reproducible con prueba SQL; sonda local ok o limitación documentada.
- [ ] Contratos aditivos; mobile/kds/web typecheck verdes sin cambios funcionales.
- [ ] Endpoint con pruebas de aislamiento, validación y tamaño; nunca registra el contenido ni la clave.
- [ ] Puertas: `pnpm --filter @super-restaurant/shared-types test && typecheck && lint && build`; `pnpm --filter @super-restaurant/api test && typecheck && lint && build`; `pnpm --filter @super-restaurant/web typecheck && build`; `pnpm --filter @super-restaurant/mobile typecheck && pnpm --filter @super-restaurant/kds typecheck`.
- [ ] Commits por unidad: `feat(db)` → `feat(shared-types)` → `feat(api)` → `docs(adr)`. Informe parcial a los ~35 turnos; commitear antes de cualquier informe.

## Archivos de entrada
- C:\tmp\sr-wt\catalog-images\supabase\migrations\20260902000100_create_menu_catalog.sql (completo) y la migración más reciente que redefina `save_menu_catalog`.
- C:\tmp\sr-wt\catalog-images\packages\shared-types\src\index.ts (330-400) y el archivo donde vivan los tipos del catálogo.
- C:\tmp\sr-wt\catalog-images\apps\api\src\menu-catalog.ts, menu-catalog.controller.ts, el módulo de configuración de entorno del API.
- C:\tmp\sr-wt\catalog-images\supabase\migrations\20261003000100_send_order_to_kitchen.sql y apps\api\src\operations\run-send-order-to-kitchen-schema-verification.ts (patrón reciente de migración + sonda).

## Invariantes
Aislamiento por restaurante en el path y en el CHECK; escritura sólo vía API con service key, nunca expuesta; contratos aditivos; sin dinero; no editar migraciones aplicadas; sin push ni remoto.

## Fuera de alcance
UI de subida y de tarjetas (paquete C posterior), borrado/reemplazo de imágenes, redimensionado, mobile.

## Formato de salida
Resumen, archivos y hashes, resultado final de cada puerta y de la prueba SQL, riesgos.
