# web-capture-tray-lease-ui · borradores con cliente y renovación automática del lease

## Tarea
web-capture-tray-lease-ui · capa: L2 (Codex) · riesgo: bajo · nivel C (`apps/web/src/app/app/capture/capture-workspace.tsx`, `lib/capture-workspace.ts`, server actions de captura). Ritmo: operación. Sin cambios en `apps/api`, `packages/*` ni SQL. Cierra #9 y #24 del lote `lote-feedback-20261001`. Base: `main` ya con `web-capture-feedback` integrado (si al leer este paquete la bandeja ya muestra folio corto, conserva ese folio en segunda línea).

## Hechos verificados (main con `capture-tray-lease-api`, migración `20261005000100` aplicada, API local en 3000)
- `POST /captures/tray` acepta `{ schemaVersion: 2, scope, limit }` y devuelve la bandeja V2: por borrador `customer: { displayName, phone } | null` (sólo con `customers.read`), `totalMinor | null` (total de ítems con impuestos; sin envío ni propina), `currency | null`, `attentionLeaseExpiresAt`, canal y `updatedAt`. Contrato y parser en `packages/shared-types/src/capture-tray-lease.ts`. La V1 sigue existiendo.
- `POST /captures/lease/renew` con `{ schemaVersion, scope, captureDraftId, attentionLeaseId }` extiende el lease propio 5 minutos (idempotente, no sube versión); 409 `CAPTURE_LEASE_TAKEN` si otra estación lo tiene; 409 `CAPTURE_CONFLICT` si el borrador no está activo. Permiso `captures.update`.
- El lease dura 5 minutos. La web guarda `attentionLeaseId` en el estado del workspace (buscar `attentionLeaseId` en `capture-workspace.tsx`/`lib/capture-workspace.ts`) y ya muestra un aviso con «Retomar» cuando vence.

## Criterios de aceptación (verificables)
- [ ] La bandeja usa V2: cada fila muestra nombre del cliente y teléfono (o «Sin cliente» más el folio corto), canal, hora en la zona del restaurante y «Ítems: $X.XX» cuando `totalMinor` no es nulo (con `formatMinorUnits` y la `currency` devuelta; rotulado «ítems», nunca «total a cobrar»). Parser V2 en la server action; si el API responde con V1 (despliegue escalonado), la bandeja sigue funcionando con los campos de V1.
- [ ] Heartbeat del lease: mientras el workspace está abierto, la pestaña visible (`document.visibilityState === "visible"`) y hubo interacción en los últimos 2 minutos, se llama a renovar cada 90 segundos (helper puro `shouldRenewLease(now, lastInteractionAt, visible, expiresAt)` con prueba). Al recibir `CAPTURE_LEASE_TAKEN` se muestra «Otra estación tomó esta captura» con «Ver borradores»; al recibir `CAPTURE_CONFLICT`, se recarga el workspace. Sin renovaciones en segundo plano cuando la pestaña está oculta.
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; 390×844 sin scroll horizontal; consola limpia; ninguna petición de renovación más frecuente que cada 90 s (verificable en la pestaña de red).

## Invariantes
PII sólo la que el API devuelve; dinero sólo formateado; contratos intactos; no tocar `product-sheet.tsx`, `menu/*` ni `/app/tables` (otras tareas).

## Fuera de alcance
API, SQL, mobile.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
Resumen, archivos tocados, salida literal, riesgos. No hagas commit.
