# ADR-011: Fotos de catálogo en Supabase Storage

Estado: propuesta (candidata; la migración `20261004000100_catalog_images.sql` no está aplicada en remoto).

## Contexto
Productos y opciones de modificador necesitan foto para la captura táctil. ADR-001 deja Storage a decisión por módulo y fija a NestJS como frontera de escritura.

## Decisión
- Bucket `catalog-images`, público de lectura (fotos de menú no son datos personales y las tablets las cachean), límite 2 MB, MIME `image/jpeg|png|webp`.
- Escritura sólo desde el API con la secret key de servidor (`SUPABASE_SECRET_KEY`, bypass de RLS). No existe política `insert/update/delete` para `anon` ni `authenticated`; los clientes nunca suben directo.
- Ruta estable `<restaurantId>/<products|options>/<targetId>/<uuid32>.<jpg|png|webp>`, siempre con UUID nuevo (`x-upsert: false`). La URL pública es `${SUPABASE_URL}/storage/v1/object/public/catalog-images/<ruta>`.
- `POST /menu/images` (permiso `catalog.manage`, scope validado en servidor) recibe base64, valida tamaño decodificado y magic bytes (JPEG, PNG, WebP) contra el MIME declarado, sube y devuelve `imagePath` y `publicUrl`. No toca el catálogo: el editor persiste `imagePath` en el siguiente `PUT /catalog/menu`.
- `image_path` es columna aditiva nullable en `app.menu_products` y `app.menu_modifier_options` con CHECK de forma, de tenant (primer segmento = `restaurant_id`) y de fila (tercer segmento = id de la fila). `save_menu_catalog` y el release lo persisten y devuelven.
- El límite JSON del API sube de 100 kb a 3 mb (acotado) de forma global: Nest no permite un parser por ruta sin añadir `express`/`body-parser` como dependencia directa. Aceptado, con rate limit por ruta pendiente.
- Variables requeridas: `SUPABASE_URL` (HTTPS) y `SUPABASE_SECRET_KEY` (`sb_secret_...`). Se leen en el primer uso: el API arranca sin ellas y `POST /menu/images` responde `503 { code: "MENU_IMAGES_UNCONFIGURED" }`.
- Idempotencia: el nombre del objeto es un hash SHA-256 de actor, restaurante, `idempotencyKey`, destino, MIME y bytes. Un reintento idéntico cae en la misma ruta, Storage responde que existe (409) y se devuelve el mismo `imagePath`/`publicUrl` sin objeto huérfano. No hay estado persistido, así que la misma clave con otro destino, MIME o bytes crea un objeto distinto en vez de rechazarse.
- Entrada tolerante: `imagePath` puede omitirse al guardar el catálogo (productores previos); se normaliza a `null`. Orden de despliegue: aplicar la migración antes que este API, pues el API siempre envía `imagePath` a `save_menu_catalog`.

## Consecuencias
- Contratos aditivos: `imagePath` es opcional en entrada y siempre `string | null` en la salida normalizada; mobile y KDS no cambian.
- `targetId` no se valida contra el catálogo: subir una foto para un producto u opción inexistente deja un objeto huérfano (acotado por permiso, tamaño y restaurante).
- Sin borrado ni reemplazo de objetos: las fotos sustituidas quedan huérfanas hasta una tarea de limpieza. Sin redimensionado.
- Verificación del bucket y políticas sólo en un proyecto Supabase real: el clúster local de verificación no tiene el esquema `storage` y la migración omite esa parte allí.
- Sin rate limit específico (el API aún no tiene patrón); pendiente.
