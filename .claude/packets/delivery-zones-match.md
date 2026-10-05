# delivery-zones-match · zona, cargo y promesa al validar una dirección

## Tarea
delivery-zones-match · dos unidades: **API nivel B** (`implementer-claude`, razonamiento moderado; lectura sobre SQL existente, sin migración, devuelve cargo en minor pero no congela ni persiste) y **web nivel C** (Codex con `-Base claude/delivery-zones-match`). §19.3: B dos rondas, C una. Deuda del lote-feedback (d) #5-#7 y regla «Validación visible» de PROJECT_NOTES 2026-10-01.

## Objetivo
`POST /delivery-zones/match`: dirección + sucursal → `covered|not_covered`, zona, cargo (minor, MXN) y promesa, **sin efectos ni persistencia**. La pantalla de clientes lo muestra al «Validar para esta sucursal» y el paso de entrega de la captura lo muestra antes de cotizar sobre el borrador.

## Hechos verificados (researcher 2026-10-05)
- Dominio puro: `packages/domain/src/delivery-zone.ts:1-118` `findDeliveryZone(zones, address)` (precedencia postalCode > locality); `delivery-quote.ts:1-150` `quoteDelivery(input)` (coverageStatus, zoneId, feeMinor, promiseStart/End de 15 min, horizonte, cutoff; no lee reloj).
- Contratos: `packages/shared-types/src/delivery-zones.ts:1-60,104-110` (`DeliveryZoneV1`, `RequestDeliveryQuoteCommandV1` sobre borrador), `delivery-quote.ts:1-161` (`DeliveryQuoteV1`, `DeliveryAddressFactsV1` + `parseAddressFacts`).
- API: `apps/api/src/delivery-zones.controller.ts:1-51` (`list`, `upsert`, `quote`), `delivery-zones.ts:100-115` `PostgresDeliveryZoneStore.listActiveZonesForQuote`, `210-335` `quoteForCapture` (lee workspace, arma `DeliveryZone[]`, llama `quoteDelivery`, `quoteId` determinista, ClockPort). SQL `20260927000100_delivery_zones.sql` (zonas y códigos postales); la lectura de zonas activas ya existe, **no hace falta migración**.
- Web: `apps/web/src/lib/delivery-zones.ts` (`formatDeliveryQuote`, acciones), `apps/web/src/app/app/customers/customer-editor.tsx` («Validar para esta sucursal»: hoy sólo registra la revisión), `capture-workspace.tsx` paso de entrega con el quote sobre borrador.

## Diseño (seguir salvo razón documentada)
1. **Contrato** (`packages/shared-types/src/delivery-zones.ts`, aditivo): `DeliveryZoneMatchRequestV1 { schemaVersion: 1, restaurantId, branchId, address: DeliveryAddressFactsV1 }` y `DeliveryZoneMatchResultV1 { schemaVersion: 1, coverageStatus, zoneId, zoneName, feeMinor, currency, promiseMinutes, promiseStart, promiseEnd, evaluatedAt }`; parsers fail-closed con pruebas runtime. Sin `quoteId`, sin override, sin `scheduledFor` (promesa ASAP desde el ClockPort).
2. **API**: `DeliveryZoneService.matchAddress(principal, body)` → `authorizeBranch` con el permiso que ya usa `quote` (si `quote` exige un permiso de captura, usar `customers.read` **o** ese permiso: cualquiera de los dos autoriza, porque la pantalla de clientes no tiene captura); parse; `listActiveZonesForQuote`; `findDeliveryZone` + `quoteDelivery` con `now` del ClockPort; devolver resultado. `@Post("match")` en el controller. Pruebas: cubierta por CP, cubierta por localidad, `not_covered` con fee 0, aislamiento (zonas de otra sucursal no aplican), 403 sin permiso, adaptador con fila real `{ result }` si la lectura pasa por SQL. Contract test HTTP del DTO (nivel B).
3. **Web (Codex, paquete C aparte en este mismo archivo)**: server action `matchDeliveryAddress` en `apps/web/src/lib/delivery-zones.ts`; en `customer-editor.tsx` «Validar para esta sucursal» llama al match y muestra debajo «Zona Centro · Envío $35.00 · 30-45 min» o «Fuera de cobertura» (resultado visible, sin bloquear el guardado), conservando el registro de revisión actual; en el paso de entrega de la captura, al elegir/editar dirección se muestra el mismo resumen antes de «Cotizar»; pesos con el formateador existente; sin alert/confirm; targets 44 px; helper puro `formatDeliveryMatch` con prueba.

## Criterios de aceptación
- [ ] `POST /delivery-zones/match` responde zona/cargo/promesa sin escribir nada (verificar que no toca `capture_delivery_quotes`).
- [ ] Puertas: shared-types test; api lint/typecheck/test/build; typecheck web/mobile/kds. Web (Codex): lint/typecheck/test/build.
- [ ] Commits por unidad; **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\delivery-zones-match\packages\domain\src\delivery-zone.ts, delivery-quote.ts (completos).
- C:\tmp\sr-wt\delivery-zones-match\packages\shared-types\src\delivery-zones.ts, delivery-quote.ts.
- C:\tmp\sr-wt\delivery-zones-match\apps\api\src\delivery-zones.ts (90-340), delivery-zones.controller.ts, delivery-zones.test.ts.
- Web: apps\web\src\lib\delivery-zones.ts, app\app\customers\customer-editor.tsx, app\app\capture\capture-workspace.tsx (paso de entrega).

## Invariantes
Cargo en enteros; el match no congela nada (la cotización real sigue siendo `POST /delivery-zones/quote` sobre el borrador al confirmar); alcance Restaurant/Branch; sin migración; sin push.

## Fuera de alcance
Programados, override de gerente, geocodificación.

## Formato de salida
Resumen, archivos y hashes, puertas, riesgos.

## Ronda 2 (web, 2026-10-05) — corregir y nada más
Tu commit `a013990` ya está en `codex/web-delivery-zones-match` (L0 lo commiteó). `codex exec review` marcó un P2 en `apps/web/src/app/app/customers/customer-editor.tsx:118-123`: tras validar, si el operador edita código postal o localidad, el resumen de zona/cargo/promesa sigue visible describiendo la dirección vieja, y una respuesta en vuelo puede restaurar un resultado obsoleto. Corrige: limpiar o invalidar `addressFeedback` cuando cambie cualquier campo de la dirección (mostrar «Vuelve a validar» o nada) y descartar respuestas de match cuya dirección ya no coincide con la actual (token/secuencia de petición). Aplica lo mismo en el paso de entrega de la captura si tiene el mismo patrón. Añade prueba al helper puro si la invalidación es pura. Puertas web lint/typecheck/test/build. No commitees (no puedes); deja los archivos modificados e informa archivos y salida literal.
