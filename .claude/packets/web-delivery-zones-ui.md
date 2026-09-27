# web-delivery-zones-ui

## Tarea
web-delivery-zones-ui · capa: L2 (Codex) · riesgo: moderado (UI + server actions, sin dinero en cliente)

## Objetivo
En apps/web implementar (a) página de gestión `/app/delivery-zones` para listar y upsert zonas (nombre, códigos postales, localidades, tarifa en minor units mostrada como moneda, toggle activo con motivo obligatorio al desactivar, versión CAS, idempotency key y retry seguro en `unavailable`), y (b) en Capture workspace, cuando fulfillment es `delivery` y hay address snapshot, action "Cotizar entrega" mostrando cobertura, tarifa, ventana de promesa y expiración de `DeliveryQuoteV1`, con input scheduled-for (ISO) dentro horizonte 7 días. Todo llamado al API de NestJS mediante server actions, cliente nunca calcula tarifas.

## Criterios de aceptación (verificables)
- [ ] Contratos respetados exactamente: DeliveryZoneV1, DeliveryZoneListV1, UpsertDeliveryZoneCommandV1, UpsertDeliveryZoneResultV1, RequestDeliveryQuoteCommandV1, DeliveryQuoteV1 sin alteraciones
- [ ] Página `/app/delivery-zones` gateada a rol "manager" o superior (owner, admin, manager)
- [ ] Pure helpers en apps/web/src/lib: `canonicalizePostalCodes(input: string) -> string[]` (dedup, sort ascending, empty array si input vacío o invalid) con tests en node:test
- [ ] Pure helper `formatDeliveryQuote(quote: DeliveryQuoteV1, locale: string) -> { status, fee, window, expiry }` con tests
- [ ] Server actions: parseadores con shared-types, parsers validando scope, restaurantId y branchId; error mapping idéntico a captures (400→invalid, 401/403→denied, 404→missing, 409→conflict, otro→unavailable)
- [ ] Retry automático en "unavailable" con mismo idempotencyKey; comando guardado en resultado solo si error
- [ ] Sin alert(), confirm() ni prompt(); botones con 44px targets; no enviar zoneId ni fee desde cliente en quote
- [ ] Lint, typecheck, tests y build de apps/web verde; Intl.NumberFormat("es-MX") para moneda
- [ ] Verified desktop y mobile (390x844) en navegador real

## Archivos de entrada
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\src\delivery-zones.ts (1-160): contratos DeliveryZoneV1, parsers parseOrderedTextArray
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\src\delivery-quote.ts (1-120): DeliveryQuoteV1, DeliveryQuoteCoverageStatusV1, promiseStart/End, expiresAt
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\lib\capture-workspace.ts (100-160): patrón request() con fetch /api/v1, error mapping a statusFailure
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\capture\actions.ts (1-26): server action pattern, scope validation, autosave en unavailable
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\capture\page.tsx (15-42): layout, role gating findMembership, listMemberships
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\globals.css (10-30): Tailwind v4 tokens, design system (bg, surface, text, text-muted, accent, border, error, success)
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\lib\shortcut-dispatch.test.ts: patrón test() node:test con assert strict
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\web\src\app\app\capture\capture-workspace.tsx (buscar Intl.NumberFormat): ejemplo formato moneda es-MX

## Símbolos relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|
| packages/shared-types/src/delivery-zones.ts | parseOrderedTextArray, parseUpsertDeliveryZoneCommandV1 | valida postal codes dedup y ascending |
| packages/shared-types/src/delivery-zones.ts | MAX_ZONE_NAME_LENGTH, MAX_POSTAL_CODE_LENGTH, MAX_LOCALITY_LENGTH, MAX_REASON_LENGTH | limites exactos para validación |
| packages/shared-types/src/delivery-zones.ts | DELIVERY_ZONE_SCHEMA_VERSION | versioning, must be 1 |
| packages/shared-types/src/delivery-quote.ts | DeliveryQuoteV1, DeliveryQuoteCoverageStatusV1, DELIVERY_QUOTE_SCHEMA_VERSION | respuesta del quote, nunca alterada |
| apps/web/src/lib/capture-workspace.ts | requestCapture, CaptureRequestResult | patrón ok/error, status codes a errores |
| apps/web/src/app/app/capture/actions.ts | captureWorkspaceAction | server action con session, scope, membership check |
| apps/web/src/app/app/capture/page.tsx | findMembership, listMemberships, role array | gating por roles manager+ |
| apps/web/src/lib/memberships | BranchMembershipSummaryV1, roles array | estructura roles para gating |
| apps/web/src/app/globals.css | --color-*, --font-* | tokens usados en className |

## Invariantes que NO deben cambiar
- Cliente NUNCA calcula fee, NUNCA envía zoneId a quote, NUNCA valida totales offline
- Contratos delivery-zones.ts y delivery-quote.ts inmutables; parser exactos, dedup postal codes en ascending order (compareCodeUnits)
- API routes exactas: POST /delivery-zones/list, POST /delivery-zones/upsert, POST /delivery-zones/quote (versionadas /api/v1)
- Error mapping idéntica a captures: 400→invalid, 401/403→denied, 404→missing, 409→conflict, resto→unavailable
- Deactivación requiere reason non-null (decision 8.1.2 pattern); idempotencyKey en upsert, retry automático en unavailable sin duplicar
- Dinero en minor units entero; locale es-MX; no moneda en cliente
- Roles: manager y superiores acceden; gating en página + server action revalida scope
- Scope restaurantId/branchId en toda llamada; client nunca widens scope
- No alert/confirm/prompt; 44px button targets; tests en node:test para puro helpers

## Fuera de alcance
- Capas L1 (backend API, migraciones, reglas dominio) y L3 (auditoría, observabilidad); API contratos asumidos como listos
- Validación compleja de postal codes (geocoding, geonames); exacto match contra zona
- Mobile app, KDS, capturas existentes; solo web capture workspace integration
- Email, notificaciones, webhooks de delivery
- Pricing logic dinámico; solo lectura/upsert de zonas configuradas

## Verificación
```bash
# Lint y typecheck del packages/shared-types (sin cambios esperados, baseline)
pnpm --filter @super-restaurant/shared-types lint
pnpm --filter @super-restaurant/shared-types typecheck

# Lint, typecheck, test y build de apps/web (con cambios)
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build

# Verificación visual (desktop 1024x768 y mobile 390x844):
# 1. Navegar a http://localhost:3000/app
# 2. Cambiar branch si es necesario
# 3. Navegar a /app/delivery-zones (debe gatear si no es manager+)
# 4. Listar zonas (GET /api/v1/delivery-zones/list)
# 5. Crear/editar una zona (POST /api/v1/delivery-zones/upsert)
# 6. En capture, fulfillment=delivery + address snapshot -> "Cotizar entrega" action
# 7. Quote shows coverage, fee, window, expiry; scheduled-for input valida rango 7 días
# 8. Retry en red lenta: simular unavailable (network throttle) -> debe reintentar
```

---

**Riesgo sugerido / Capa sugerida:** Moderado / L2 (Codex)
