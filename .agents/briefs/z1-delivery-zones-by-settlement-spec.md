# Brief z1-delivery-zones-by-settlement-spec (Z1, nivel A, solo documento)

## Objetivo
Crear `docs/architecture/DELIVERY_ZONES_V2.md`: zonas de entrega por colonia (catálogo SEPOMEX de Navojoa). Sin tocar código.

## Alcance
- Solo escribir `docs/architecture/DELIVERY_ZONES_V2.md`. Lee `docs/plans/smoke-2026-11-05-r2-plan.md` §4 y el código con `codegraph explore "matchAddress DeliveryZonesService delivery-zone"` (`apps/api/src/delivery-zones.ts`, `packages/domain/src/delivery-zone.ts`, `delivery-quote`, `customers/customer-editor.tsx` AddressForm).

## Decisiones ya tomadas (Emmanuel, 2026-11-20)
- Catálogo solo de Navojoa; la colonia se elige con autocompletado, el CP se rellena solo y ciudad, estado y país salen de la sucursal.
- Tabla de asentamientos global, de solo lectura para clientes, sin `restaurant_id` (dato público): justificar el RLS.
- Relación zona ↔ asentamiento con alcance de restaurante y sucursal; la dirección guarda `settlementId` además del texto.
- Coincidencia: `settlementId`, luego colonia normalizada, luego CP como respaldo legado.
- Rechazo con motivo: «La colonia X no está en ninguna zona de la sucursal Y», «Colonia no reconocida en Navojoa», «Falta la colonia».
- **Colonia fuera de SEPOMEX: texto libre con aviso; el domicilio queda «sin zona» y el envío se cobra con cuota manual** fijada por supervisor, con autorización, motivo y auditoría, antes de confirmar. Especifica contrato, snapshot de la cuota y permisos.
- Backfill de direcciones existentes por nombre normalizado; las ambiguas quedan sin `settlementId` y listadas para revisión.
- Impacto en cuota de envío y su snapshot. Zonas definidas por colonia (multiselección y «todas las de un CP»).

## Hecho cuando
- Documento con: modelo de datos, RLS, contrato de API (búsqueda por prefijo para autocompletado, validación, cuota manual), reglas de coincidencia, backfill, impacto en dominio/cuotas, pruebas obligatorias (aislamiento entre restaurantes, idempotencia) y orden de tareas Z2-Z5.
- Resumen de ≤15 líneas. No commit/push.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Sin evidencia = NO VERIFICADO. Informe con bloque ``` con el comando de codegraph y la salida resumida.
