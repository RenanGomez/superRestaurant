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

## PR #53 y #54 (sync M2) — P2/P3

- #53 P3: la suite `test:sync-conflicts:local` es opt-in y no está cableada en CI; la revisión Claude fue estática (agy sin cuota).
- #53 P3: `viewer` asume membresía activa en branchA (sin aserción previa); la revocación se prueba con UPDATE directo, no con la función de producto; resultado fijo `{effect:"payment-1"}` en `record`; aclarar comentario de independencia por scope.
- #53 P3: BOM y CRLF en `sync-conflicts.local.test.ts`; `nowIso()` no determinista.
- #54 P2: offline, el titular promete "se guardó en este dispositivo" sin cola local persistente; reformular hasta que exista.
- #54 P3: `formatSyncAmountMinor` antepone `$` a cualquier moneda; sin pruebas de render ni Server Actions; "Conexión" queda en "Más" en móvil; `getSession()` en servidor (usar `getUser()`).
- #54: verificación visual contra stubs (404 en `/api/v1/sync/*`), sin PostgreSQL real; repetir con API real cuando exista push/pull.

## PR #56, #58, #59 y #60 (offline M2) — P2/P3

- #56 P2/P3: almacenamiento móvil cifrado revisado por Claude (agy sin cuota); sin prueba en dispositivo nativo, solo Node; pendiente verificar `expo-sqlite` real en Android/iOS.
- #58 P2: `kds-local.test.ts` no prueba el flujo "el servidor reemplaza la caché" (solo un filtro puro); extraer `applyServerList(received, scope)` y probarlo con caché {A,B} y servidor {A}.
- #58 P3: sin pruebas del backoff de reconcile, del mensaje `SYNC_UNAVAILABLE` ni de la purga de `signOut`; la purga es best-effort (si falla se hace logout igual y puede quedar caché/outbox del actor anterior).
- #59 P2: con un puerto offline registrado el banner promete "crear órdenes locales" y "cobrar en efectivo sin conexión" aunque no exista `commitLocalOperation` ni pantalla que lo use; hoy no se registra ningún puerto, pero reformular antes de conectarlo.
- #59 P2: el `<summary>` de operaciones bloqueadas mide ~18.6 px (mínimo 44 px).
- #59 P3: en `sync_blocked` online el summary dice "bloqueadas sin conexión"; el mensaje muestra la ruta literal `/app/sync`; el tope offline ignora el importe; sesión fija en el puerto.
- #60 P3: un evento con IDs mal formados se rechaza como `INVALID_PAYLOAD` sin registro en el ledger (no cabe), así que no deja huella de auditoría.
- #60 P3: el rechazo `AUTH_REVOKED`/`DEVICE_REVOKED` no se audita en log estructurado; el token se verifica una vez por evento (N por push); `unknown` de dispositivo se trata como `DEVICE_REVOKED` (usar `DEVICE_UNKNOWN`); `ACTOR_MISMATCH` se reporta como `AUTH_REVOKED`.
- #60 P3: `sync-push.test.ts` usa mock del ledger; la semántica real la cubre solo la verificación PostgreSQL de CI; falta aserción explícita de grants (`sync_device_state` y `sync_write_allowed` solo para `app_api`).
- Protocolo pendiente: las migraciones 20261121000100, 20261123000300, 20261123000400 y 20261123000500 no están aplicadas en remoto (rollback-only, dry-run y staging primero, §19.6).

## PR #62 (almacén cifrado web offline) — P2/P3

- P2: el protocolo de pestaña obsoleta (STORAGE_COMMIT_FAILED → descartar motor, recargar, reintentar con la misma key) depende del llamador; falta prueba a nivel de motor y elección de líder o serialización entre motores antes de activar offline.
- P2: faltan rotación de clave (`keyVersion`), purga al cerrar sesión o AUTH_REVOKED, y `restaurantId`/`branchId` en la AAD como defensa en profundidad; la clave no extraíble vive en el mismo IndexedDB y no protege frente a XSS.
- P3: `sync-transport` sin timeout por defecto cuando `timeoutMs` es 0 o ausente (proponer 30 s); sin respeto de `Retry-After` en 429/503.
- P3: los archivos del PR quedaron en CRLF; normalizar a LF. Falta verificación en navegador real del almacén IndexedDB.

## PR #63 (banner y cola offline mobile) — P2/P3

- P2: verificación visual NO realizada: el harness móvil (`apps/mobile/harness`) no simula conectividad offline ni cola, y `expo-sqlite` no está en el entorno de bundle web. Pendiente en dispositivo/emulador o ampliando el harness antes de activar offline (puerta 5 de §19.6).
- P3: la prueba de doble disparo cubre el helper y el motor, no el componente (guard por ref y clave en `App` sin test de UI).
- P3: se eliminó el reintento por ítem de la cola; queda solo "reintentar todo". Implementar retry por evento si se necesita.
- P3: `navigator.onLine` puede no existir en React Native; verificar en runtime móvil que el banner llegue a mostrar "Sin conexión".
- P3: `lastConfirmedSyncAt` usa la hora del dispositivo.

## PR #65 sync pull/review (m2-api-sync-pull)

- P3: mapeo de códigos de error del pull/review incompleto; sin pruebas de controller/RBAC de `sync-review.controller`.
- P3: el cursor no incluye `deviceId` y tiene expiración fija de 30 días; una página con fallo de parseo de respuesta puede envenenar el avance.
- P3: un caso histórico sin facts solo puede rechazarse, no compensarse.
- P3: `sync_review_event_facts` y commands sin RLS ni triggers de inmutabilidad; `sync_read_reviews` sin paginación.
- P3: la prueba con mock no afirma `deviceId`.
- Operación: `SYNC_CURSOR_SECRET` (>=32 caracteres) debe definirse en todas las instancias antes de desplegar; rotarlo invalida cursores. Migración 20261123000600 sin aplicar en remoto.

## PR #66 mobile crypto (m2-mobile-local-storage-crypto)

- P2: sin pruebas de UI/hook para la carrera `!alive` ni la ruta resume/locked del banner.
- P3: cabecera de documento sin autenticar (límite de amenaza documentado); exclusión de backup en iOS; salt HKDF vacío (documentar en ADR-005).
- Pendiente: pregunta del puente runtime-bridge (la barra debe reflejar la cola local real); verificación en dispositivo real imposible en este entorno.

## PR #67 KDS offline cache (m2-kds-offline-cache)

- P3: falta prueba KDS explícita de idempotencyKey estable tras push fallido y de error IO transitorio sin cuarentena (hoy cubierto por sync-engine); sin prueba de `clearKdsCache`/`clearKdsSyncState`.
- Pendiente: verificación visual de KDS offline en navegador (desktop y 390x844).

## PR #70 puente offline web (m2-web-runtime-bridge)

- P2 resueltos en el PR: carrera release/commit (flag `closing`, relectura del outbox antes de purgar), actor ajeno (`ACTOR_MISMATCH`), tamano por bytes y content-length, timeout 30 s, Sec-Fetch-Site/content-type, pruebas de ruta.
- P2: el proxy solo compara `body.scope` con la cookie; no valida `restaurantId`/`branchId` por evento (depende de `PUSH_SCOPE_VIOLATION` del API). Validar en el proxy o documentarlo.
- P3: StrictMode abre/libera el bridge a la vez (serializar por device); `entityType`/`operation` sin tipar a `SyncEntityTypeV1`/`SyncOperationV1`; `release` cuenta `rejected` como confirmado y borra su evidencia; `getSession` vs `getUser`; catch vacio en el mount.
- Pendiente: verificacion en navegador real (desktop y 390x844); e2e contra el puente real (m2-e2e-offline-web, rehecha tras cerrar #69).

## PR #71 conflictos de sync (m2-api-sync-conflicts-tests)

- P2: `two_devices_add_lines` solo prueba el ledger (el total lo calcula el test, no el servidor); `cancel_vs_kds_preparing` solo prueba monotonia de version (renombrar o probar cancelacion real); `concurrent_same_line_edit` sin dos dispositivos con `baseVersion` divergente; ningun push HTTP produce `manual_review` (se abre con SQL directo); la prueba `test:sync-conflicts:local` no esta enganchada a CI/pg-verify.
- P3: `assertSyncConflictScenariosCovered` depende de `cover()` autodeclarado; tautologia en tombstone 11f; 11e prueba aislamiento con tipo no soportado; `SYNC_CURSOR_SECRET` del test vacuo y sobrescrito; `bootstrapTransactionalHttpApp` duplica `bootstrapHttpApp`.

## Ola 0 solo-dsh (2026-11-25) â€” P2/P3 de revisiÃ³n cruzada dsh

- #73 o0-web-leader (A): P2 el seguidor de `acquireSyncLeader` espera sin timeout; P2 la prueba no estÃ¡ registrada en `apps/web/package.json` (lo hace `o0-wire`); P2 `acquireSyncLeader` aÃºn no tiene consumidor productivo (debe conectarlo `o0-wire` en `offline-runtime-mount.tsx`); P3 `onLost` tambiÃ©n se dispara en liberaciÃ³n voluntaria y no estÃ¡ documentado; P3 el fake de pÃ©rdida modela un modo que Web Locks real no produce sin `signal`.
- #75 o0-mobile-banner-tests (B): P2 la suite no estÃ¡ en `apps/mobile/package.json` (lo hace `o0-wire`); P2 falta la carrera `openRuntime` resuelto despuÃ©s de `stop()` verificando `onDiscard`; P3 rama inalcanzable en `sync-banner-lifecycle.ts:88`.
- #76 o0-visual-assert (C): P2 `offline-kds.spec.ts` no usa `expectFinalRoute` y una redirecciÃ³n a `/app` puede dejarlo verde; P3 el helper cuenta 404/501 de `/api/sync/*` como fallo de red (backend no desplegado); P3 `accessibleName` no considera `img alt`; P3 doble `mkdirSync`; P3 las reglas de consola/red/diÃ¡logos solo tienen caso que falla.
- #77 o0-sync-p3 (B): pendiente de la revisiÃ³n de pruebas; los P1 detectados por su revisiÃ³n son del puente offline y se atacan en `o0-sync-devices` y `o0-bridge-p1`.
- Puente offline (P1 heredados de #70, detectados por las revisiones de la Ola 0): ids de entidad con nibbles de versiÃ³n/variante invÃ¡lidos, payloads `order_add_line`/`cash_collect` no soportados reportados como `committed`, y ausencia de `POST /sync/devices`. Tareas creadas: `o0-sync-devices` (A) y `o0-bridge-p1` (A).


## M3 inventario â€” P1/P2 abiertos al cierre de la sesiÃ³n 2026-11-25

- **API de insumos (#90) P1:** `items.service.ts` hace DML directo como `app_api`, pero `20261126000100_inventory_catalog.sql` revoca todo a `app_api` y solo concede SELECT a `authenticated`: todo GET/POST/PATCH fallarÃ­a con 42501 y el catch lo devuelve como 503. Falta una migraciÃ³n de grants para `app_api` (o funciones `app_private`) y pruebas con privilegios reales.
- **API de insumos P2:** solo 23505 se mapea a 409; 23514/23503 caen en 503; el lÃ­mite de `name` del contrato (200) no coincide con el check de la tabla (160).
- **Compras SQL (#91) P1:** `inventory_create_purchase_order` no es idempotente (sin `idempotencyKey`, id en servidor): un reintento crea otra OC y al recibir ambas duplica stock/costo. AÃ±adir idempotency key y dedupe.
- **Compras SQL P1:** faltan pruebas de importe/moneda invÃ¡lidos, de proveedor de otro restaurante y de auditorÃ­a (actor/device) en la recepciÃ³n; `received_by` no existe.
- **Compras SQL P2:** `app_api` conserva EXECUTE en `inventory_record_movement` y podrÃ­a insertar un `receipt` sin pasar por la recepciÃ³n (y bloquear la legÃ­tima por el Ãºnico de source).
- **Ledger SQL (#86, fusionado) P3:** un `source_id` duplicado con clave nueva escapa como 23505 crudo; el API deberÃ¡ mapearlo.
- **Contratos (#88, fusionado):** `node-test-shims.d.ts` quedÃ³ en `tsconfig.json` de build; mover a test-only si molesta con `@types/node`.

