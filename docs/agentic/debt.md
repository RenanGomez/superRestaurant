# Deuda tecnica (P3)

Hallazgos P3 y atajos registrados. No se ejecutan durante el hito abierto: se
revisan al cierre del hito y, si aplica, pasan al backlog del siguiente.

## Formato

| Fecha | Hito | Item | Descripcion | Motivo del atajo | Seguimiento |
|---|---|---|---|---|---|
| - | - | - | - | - | - |

## Registradas

- **m1-sec-rate-limit:** los contadores viven en memoria por proceso; reinicios y réplicas no comparten cuota. El límite previo usa la IP del socket, que puede identificar al proxy en despliegues detrás de uno. Adoptar almacenamiento compartido y una configuración explícita de proxies confiables antes de depender de estos límites en producción. El login directo a Supabase requiere protección del proveedor.

| Fecha | Hito | Item | Descripcion | Motivo del atajo | Seguimiento |
|---|---|---|---|---|---|
| 2026-11-22 | AO M0 | P2 · smoke E2E limitado | El smoke de Playwright solo cubre `/health` y `/login`; no ejercita flujos de producto. | Prioridad a desbloquear el CI de M0. | Ampliar los flujos E2E al cierre del hito. |
| 2026-11-22 | AO M0 | P2 · guardia CI opcional en `database.ts` | En `apps/api/src/database.ts` la guardia ligada a `CI === "true"` es opcional y no se ejerce fuera de CI. | Se mantiene para no alterar el arranque local. | Revisar al cierre del hito y hacerla explícita. |
| 2026-11-22 | AO M0 | P3 · robustez de `stop()` en `local-postgres` | `LocalPostgres.stop()` puede dejar limpieza incompleta si fallan `pg_ctl` o `admin.end()`. | Solo afecta a fixtures locales desechables. | Endurecer la limpieza en una tarea mecánica. |
| 2026-11-22 | M1 | P2 · `registerId = deviceId` en cobro mobile (`m1-mobile-pay-note`) | `apps/mobile/src/ui/app.tsx` usa `deviceId` como `registerId` al consultar `/api/v1/cash-registers/report` y `/api/v1/payments/checkout`; no descubre ni permite elegir otra caja abierta de la sucursal ni abrir caja desde mobile. | Reutilizar los endpoints existentes sin introducir nuevas rutas o migraciones en nivel C. | Añadir selección de caja abierta o apertura controlada cuando se amplíe la operación de caja en mobile. |
| 2026-11-22 | M1 | P3 · tabla `FRACTION_DIGITS` duplicada (`m1-mobile-pay-note`) | `apps/mobile/src/money.ts` define `FRACTION_DIGITS` (incluyendo `XTS` para fixtures) en paralelo a `apps/web/src/lib/money-scale.ts`. | Evitar tocar `packages/shared-types` (carril de un solo escritor) en una tarea de nivel C. | Consolidar una tabla compartida de escala monetaria por código ISO en `packages/shared-types` al cerrar M1. |

## M0-7 ? pg-verify (en curso)

- Los cinco invariantes SQL antes tolerados pasan en PostgreSQL 17.6 local tras aplicar todas las migraciones: se corrigieron los fixtures de identidad, privilegios y contratos hist?ricos/actuales. Pendiente confirmar el job completo en PR.
- El `503 ORDER_UNAVAILABLE` del detalle de entrega qued? corregido: el parser acepta y valida los campos de asentamiento del snapshot, conservando compatibilidad hist?rica. El flujo HTTP local pas? 7/7; pendiente verificar el job completo en PR.
- **P2 ? verificador hist?rico de grupos compartidos:** `verify:menu-shared-modifier-groups-schema:rollback` rechaza el fixture porque `extractMigrationBody` exige `COMMIT` y el fixture termina en `ROLLBACK`. El test directo pasa; reconciliar el arn?s sin dejar datos persistentes.
- Los verificadores rollback de selecci?n, pizza V2 y transferencia pasaron localmente. No se aplicaron migraciones remotas.
