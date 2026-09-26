# Paquete de contexto S7.1 — Cotización de entrega

## Tarea
s7-1-delivery-coverage-quote · L1 (implementer-claude) · riesgo alto (dinero)

## Objetivo
Implementar dominio puro + contrato runtime para cobertura de entrega y cotización de entrega en S7.1 (primera mitad):
(a) `packages/domain`: entidades de zona por Branch definidas por códigos postales y colonias, búsqueda de zona desde CaptureFulfillmentSnapshotV1, cargo fijo en minor units, ventana de promesa de 15 minutos congelada en quote con `quotedAt` suministrado por caller, órdenes programadas hasta 7 días adelante con cutoff de 30 minutos, override solo por gerente con motivo obligatorio, propina separada.
(b) `packages/shared-types`: `DeliveryQuoteRequestV1`/`DeliveryQuoteV1` con SCHEMA_VERSION=1, parsers exactos, pruebas runtime hostiles, siguiendo patrones de `payment-obligation.ts` y `order-item-change-impact.ts`.

## Criterios de aceptación (verificables)

- [ ] Zone matching precedence: postalCode > locality; no match → `not_covered`
- [ ] Fee in minor units (integer), currency ISO 3-letter, immutable once frozen
- [ ] Promise window: ISO 8601 start/end strings, 15-minute span, timezone-aware math respects DST
- [ ] Scheduled order horizon: 7 days from now (Restaurant timeZone), cutoff 30 minutes before window start
- [ ] Override requires role=manager + non-null reason text, audit trail
- [ ] Idempotent: same quotedAt + address snapshot + zones = same output (frozen)
- [ ] Parsers: hostile (exactRecord, own, safe primitives), no side effects, reject proxies/accessors
- [ ] Unit tests in `packages/domain` for zone matching and Money arithmetic
- [ ] Runtime tests in `packages/shared-types` for parsers (exact schema, invalid inputs, frozen output)
- [ ] All lint, typecheck, tests pass; no orphaned exports

## Archivos de entrada

- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\docs\architecture\P2_OWN_DELIVERY_OPERATION_SLICE.md (líneas 58–72, 149–162): decisiones aprobadas y modelo DeliveryQuote
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\money.ts (líneas 24–88): Money class, minor units, rounding
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\order-totals.ts (líneas 1–50): timeZone validation pattern, IANA zones
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\src\payment-obligation.ts (líneas 1–85): exactRecord, own, safely parser pattern
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\src\commercial-capture.ts (líneas 596–626): CaptureFulfillmentSnapshotV1 fields (postalCode, locality)
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\errors.ts (líneas 1–10): DomainError base, error codes
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\package.json (líneas 21–26): test registration chain
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\package.json (líneas 20–24): runtime test registration chain

## Símbolos relevantes

| Archivo | Símbolo | Por qué importa |
|---|---|---|
| packages/domain/src/money.ts | Money, add, multiplyRatio | Constructor con minorUnits + currency, operaciones con BigInt, rounding mode |
| packages/domain/src/order-totals.ts | assertTimeZone | Validación IANA timezone; reutilizar para promise window |
| packages/shared-types/src/payment-obligation.ts | exactRecord, own, safely, money | Parser pattern: detach object, hostile validation, return undefined on error |
| packages/shared-types/src/commercial-capture.ts | CaptureFulfillmentSnapshotV1, postalCode, locality | Address fields for zone matching |
| packages/domain/src/errors.ts | DomainError | Base para InvalidDeliveryQuoteError, InvalidDeliveryZoneError, etc. |

## Invariantes que NO deben cambiar

- Dinero en minor units (entero seguro) + código ISO 3-letras, nunca float
- Scope Restaurant/Branch en toda cotización y zona
- Address snapshot congelado en Order; zona y cargo nunca se recalculan desde catálogo mutable
- Promesa es ventana (start, end); `start < end`, ambas ISO 8601 con zona horaria Restaurant
- Cutoff: min(ahora + 30 min, ventana.start) en timeZone del Restaurant
- Horizonte: ahora + 7 días (respeta DST)
- Override solo gerente; motivo auditado; no invalida quote anterior sin transacción explícita
- Parsers exacto-field, sin coerción, rechazan proxies y accesores
- Propina separada de cargo; ambos optional según decisión S7.1
- No SQL, no endpoint, no UI en este corte

## Fuera de alcance

- Persistencia PostgreSQL (S7.2+)
- Endpoints HTTP/API (S7.2+)
- UI de cobertura/quote (S7.7)
- Geocodificación o polígonos (decisión 1: zonas manuales solo)
- Integración con scheduler de órdenes programadas (S7.2)
- Liquidación o obligaciones financieras (S7.6)
- Asignación de repartidor (S7.4)

## Verificación

```bash
# Domain unit tests (zona, promesa, override, Money)
pnpm --filter @super-restaurant/domain test

# Shared-types runtime tests (parsers)
pnpm --filter @super-restaurant/shared-types test

# Lint
pnpm --filter @super-restaurant/domain lint
pnpm --filter @super-restaurant/shared-types lint

# Typecheck
pnpm --filter @super-restaurant/domain typecheck
pnpm --filter @super-restaurant/shared-types typecheck
```

## Formato de salida esperado

1. Resumen: nuevos archivos/módulos (src/delivery-zone.ts, src/delivery-quote.ts, src/delivery-quote.runtime.test.ts) y cambios a índices.
2. Lista de archivos tocados (rutas absolutas).
3. Salida de lint, typecheck, test (copy-paste).
4. Riesgos o brechas: ej. "Promise window math no cubre saltos DST explícitos" o "override no revisa historial de cambios previos".

---

## Notas para implementador

**Secciones 4.1 y 8.1 verbatim como invariantes de dominio:**

De **4.1 — Cotización/promesa de entrega:**
> `DeliveryQuote` es una decisión versionada anterior a confirmación, acotada a Restaurant/Branch y al snapshot Address:
> - `quoteId`, `restaurantId`, `branchId`, `captureDraftId`;
> - `addressSnapshotRef` y versión/hash de los hechos geográficos usados;
> - `coverageStatus`: `covered | outside | manual_review`;
> - `zoneId` y versión de regla, ambos nullable sólo cuando no hay match;
> - cargo exacto en minor units + moneda ISO;
> - ventana prometida con inicio/fin y zona horaria autoritativa del Restaurant;
> - desglose explicable de regla, sin publicar configuración privada completa;
> - override nullable con actor, permiso, motivo y cargo/ventana finales;
> - `calculatedAt`, `expiresAt`, `version` e idempotency key.

De **8.1 — Decisiones aprobadas:**
> 1. Cobertura por zonas manuales definidas por colonias y códigos postales por Branch; sin geocodificación ni polígonos en el piloto.
> 2. Cargo de entrega fijo por zona en minor units, sin impuesto separado; propina opcional y separada; override del cargo sólo por gerente, con motivo auditado.
> 3. Promesa como ventana de 15 minutos congelada en el quote; re-promesa manual con motivo y registro del retraso.
> 4. Pedidos programados hasta 7 días adelante, cutoff de 30 minutos antes de la ventana, sin límite de capacidad en el piloto, zona horaria del Restaurant con DST resuelto por el servidor.

**Estructura esperada:**

- `DeliveryZone`: id, branchId, restaurantId, name, feeMinor (Money), postalCodes (set), localities (set)
- `DeliveryZoneLookup(address)`: search postalCode first; fallback locality; return zone or undefined
- `DeliveryQuote`: quoteId, restaurantId, branchId, captureDraftId, addressSnapshotRef, coverageStatus, zone?, feeMinor, currency, promiseStart, promiseEnd, timeZone, quotedAt, expiresAt, version, override?
- Override: actor (UUID), role (verified manager), reason (non-empty string), feeMinor, promiseStart, promiseEnd

Riesgo sugerido: **alto** (dinero, promesas de SLA, cutoff temporal)
Capa sugerida: **L1**
