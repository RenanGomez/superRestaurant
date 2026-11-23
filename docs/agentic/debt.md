# Deuda tecnica (P3)

Hallazgos P3 y atajos registrados. No se ejecutan durante el hito abierto: se
revisan al cierre del hito y, si aplica, pasan al backlog del siguiente.

## Formato

| Fecha | Hito | Item | Descripcion | Motivo del atajo | Seguimiento |
|---|---|---|---|---|---|
| - | - | - | - | - | - |

## Registradas

- **m1-obs-health:** el correlationId solo aparece en la línea de acceso HTTP; los demás logs no lo heredan. Incorporar AsyncLocalStorage para propagar el contexto de request entre capas y pruebas de concurrencia antes de depender de correlación transversal.

- **m1-sec-rate-limit:** (1) no existe límite por cuenta: web, mobile y KDS inician sesión directamente contra Supabase Auth, que debe aplicar su propia protección de credenciales; el API solo limita intentos de token en su frontera. (2) Los contadores viven en memoria por proceso; reinicios y réplicas no comparten cuota. Adoptar almacenamiento compartido antes de depender de estos límites en producción. (3) El borde confía en `x-forwarded-for` solo con `RATE_LIMIT_TRUST_FORWARDED_FOR=true` y `RATE_LIMIT_TRUSTED_PROXY_HOPS` acotado (1..10, por defecto 1); debe desplegarse exactamente la cadena de proxies declarada o el guard vuelve a la IP del socket.

| Fecha | Hito | Item | Descripcion | Motivo del atajo | Seguimiento |
|---|---|---|---|---|---|
| 2026-11-22 | AO M0 | P2 · smoke E2E limitado | El smoke de Playwright solo cubre `/health` y `/login`; no ejercita flujos de producto. | Prioridad a desbloquear el CI de M0. | Ampliar los flujos E2E al cierre del hito. |
| 2026-11-22 | AO M0 | P2 · guardia CI opcional en `database.ts` | En `apps/api/src/database.ts` la guardia ligada a `CI === "true"` es opcional y no se ejerce fuera de CI. | Se mantiene para no alterar el arranque local. | Revisar al cierre del hito y hacerla explícita. |
| 2026-11-22 | AO M0 | P3 · robustez de `stop()` en `local-postgres` | `LocalPostgres.stop()` puede dejar limpieza incompleta si fallan `pg_ctl` o `admin.end()`. | Solo afecta a fixtures locales desechables. | Endurecer la limpieza en una tarea mecánica. |
| 2026-11-22 | M1 | P2 · `registerId = deviceId` en cobro mobile (`m1-mobile-pay-note`) | `apps/mobile/src/ui/app.tsx` usa `deviceId` como `registerId` al consultar `/api/v1/cash-registers/report` y `/api/v1/payments/checkout`; no descubre ni permite elegir otra caja abierta de la sucursal ni abrir caja desde mobile. | Reutilizar los endpoints existentes sin introducir nuevas rutas o migraciones en nivel C. | Añadir selección de caja abierta o apertura controlada cuando se amplíe la operación de caja en mobile. |
| 2026-11-22 | M1 | P3 · tabla `FRACTION_DIGITS` duplicada (`m1-mobile-pay-note`) | `apps/mobile/src/money.ts` define `FRACTION_DIGITS` (incluyendo `XTS` para fixtures) en paralelo a `apps/web/src/lib/money-scale.ts`. | Evitar tocar `packages/shared-types` (carril de un solo escritor) en una tarea de nivel C. | Consolidar una tabla compartida de escala monetaria por código ISO en `packages/shared-types` al cerrar M1. |
| 2026-11-23 | M1 | P3 · foco explícito y etiquetas de colonias guardadas en Z4 (`m1-visual-verify-r2`) | En `apps/web/src/app/app/delivery-zones/delivery-zones-editor.tsx` (líneas 211 y 232), los chips de colonias seleccionadas y el `<summary>` de cobertura heredada no declaran `focus-visible:outline-*` explícito; además las colonias ya guardadas se muestran como `Colonia <id8>` (línea 89). | Auditoría solo lectura (`m1-visual-verify-r2`); no se modifica código. | Añadir clases `focus-visible` consistentes con `uiChip`/`uiButton` y resolver nombres de colonias guardadas al abrir una zona. |
| 2026-11-23 | M1 | P3 · copy desactualizado en `messages.invalid` de Z5 (`m1-visual-verify-r2`) | `apps/web/src/app/app/customers/customer-editor.tsx` (línea 32) sigue diciendo «completa calle, localidad y país» aunque Z5 ocultó los campos localidad y país en `AddressForm`. | Auditoría solo lectura (`m1-visual-verify-r2`); no se modifica código. | Actualizar el texto de validación para mencionar calle y colonia. |
| 2026-11-23 | M1 | P3 · foco de modales y listener de atajos en K2 (`m1-visual-verify-r2`) | Los modales de `apps/web/src/app/app/global-shortcuts.tsx` (líneas 61-76) y «Cancelar captura» en `apps/web/src/app/app/capture/capture-workspace.tsx` (líneas 1406-1421) no usan `trapFocusIndex` ni restauran el foco al cerrarse; el `useEffect` de `keydown` en `capture-workspace.tsx` (líneas 1102-1142) no declara arreglo de dependencias. | Auditoría solo lectura (`m1-visual-verify-r2`); no se modifica código. | Reutilizar `trapFocusIndex` y retorno de foco como en `ProductSheet`/`PhoneRemovalDialog`, y estabilizar dependencias del listener. |

## M0-7 — pg-verify (en curso)

- Los cinco invariantes SQL antes tolerados pasan en PostgreSQL 17.6 local tras aplicar todas las migraciones: se corrigieron los fixtures de identidad, privilegios y contratos históricos/actuales. El job completo pasó en el PR #19 para `114b91e4`; pendiente CI de la nueva cabeza.
- El `503 ORDER_UNAVAILABLE` del detalle de entrega quedó corregido: el parser acepta y valida los campos de asentamiento del snapshot, conservando compatibilidad histórica. El flujo HTTP local pasó 7/7 y el job HTTP pasó en el PR #19 para `114b91e4`.
- **P2 · verificador histórico de grupos compartidos:** `verify:menu-shared-modifier-groups-schema:rollback` rechaza el fixture porque `extractMigrationBody` exige `COMMIT` y el fixture termina en `ROLLBACK`. El test directo pasa; reconciliar el arnés sin dejar datos persistentes.
- **P2 · verificador histórico de Capture:** `verify:capture-schema:rollback` ejecuta la prueba actual de dirección incompleta antes de la migración `20260917000100`; la función histórica devuelve `conflict` y la prueba espera `rejected`. No se ejecuta en `pg-verify`; reconciliar la secuencia sin modificar migraciones aplicadas.
- Los verificadores rollback de selección, pizza V2 y transferencia pasaron localmente. No se aplicaron migraciones remotas.
- **P3 · printing Bluetooth (#42):** `declare function setTimeout` manual en bluetooth-printer.ts:14 (usar types node); backoff 3 intentos/100-200 ms fijo, hacerlo configurable con el adaptador movil real; el error de conexion descarta la causa (registrar en el adaptador de plataforma). Sin adaptador BLE/SPP real ni prueba con impresora fisica.

## PR #47 (mobile mesas/comanda/selector de caja) — P2/P3 de revision Claude (2026-11-23)

- P2: el selector de caja usa `getDaySummary` con fecha de hoy; un turno que cruza medianoche no aparece y el endpoint de reportes puede exigir permiso de supervisor (regresion para cajero). Confirmar permiso del rol cajero o usar la fecha de apertura de `state.shift`; anadir prueba de cruce de medianoche en `register-selection`.
- P2: el efecto de cajas depende de `state.branch`/`state.shift` por identidad; depender de `state.shift?.shiftId` y `state.branch?.timeZone` para no borrar la caja elegida.
- P2: `sendPending` reintenta con expectedVersion viejo si el fallo no es 409; confirmar codigo de conflicto del API y limpiar tambien ahi.
- P3: etiqueta de caja ilegible (8 chars de UUID); ocupacion solo en texto sin color/icono; formato de props; falta prueba de `order-kitchen` y `register-selection`; verificacion visual 390x844 pendiente.

## PR #51 (confirm_capture_draft_v3 pizza v2 + cobertura de zonas) — P2/P3

- P2: la paridad de moneda de `capture_delivery_manual_fees` y `frozen_quote` contra `p_order->>'currency'` no se valida incondicionalmente (migración 20261123000500, ~599-625).
- P2: `deliveryCharge.amount.amountMinor` se compara con `::text::numeric`; acepta `2500.0` y puede lanzar 22P02. Validar `jsonb_typeof = 'number'` y regex de entero.
- P2: `enforce_delivery_zone_coverage_nonempty()` lee `app.delivery_zones` sin `FOR SHARE` (write-skew con SQL directo concurrente).
- P3: la migración 000500 se nombra 000400 en HANDOFF y en un comentario de `delivery_zones_invariants.sql`.
- P3: `delivery_quote_expired` ahora aplica también a cotizaciones con tarifa manual (cambio de comportamiento; reflejar en smoke).
- P3: falta prueba negativa de fuga entre restaurantes/sucursales específica de `confirm_capture_draft_v3`.
- P3: `CREATE CONSTRAINT TRIGGER` no revalida zonas activas preexistentes solo con `localities`.
- Protocolo pendiente: la migración no está aplicada en remoto (rollback-only, dry-run y staging primero, §19.6).
