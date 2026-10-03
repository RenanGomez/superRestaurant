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
- El límite JSON del API sube de 100 kb a 3 mb (acotado) para admitir imágenes en base64.

## Consecuencias
- Contratos aditivos: `imagePath: string | null` obligatorio (nullable) en producto y opción; web fue ajustada, mobile y KDS compilan sin cambios.
- Sin borrado ni reemplazo de objetos: las fotos sustituidas quedan huérfanas hasta una tarea de limpieza. Sin redimensionado.
- Verificación del bucket y políticas sólo en un proyecto Supabase real: el clúster local de verificación no tiene el esquema `storage` y la migración omite esa parte allí.
- Sin rate limit específico (el API aún no tiene patrón); pendiente.
