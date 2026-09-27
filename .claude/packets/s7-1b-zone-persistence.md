# Paquete de contexto: s7-1b-zone-persistence

## Tarea
**s7-1b-zone-persistence** · capa: L1 (implementer-claude) · riesgo: alto (esquema, dinero, tenancy)

## Objetivo
Persistir zonas de entrega por Restaurant/Branch (códigos postales, localidades, tarifa fija en minor units + ISO, bandera activa, versionado) en migraciones de Supabase como candidatas (nunca editar aplicadas), exponiendo un módulo NestJS con endpoints REST versionados para listar/actualizar zonas (manager) y para solicitar cotización de entrega en Capture (llama a `quoteDelivery` del dominio congelado y retorna `DeliveryQuoteV1`), respaldado por verificador PostgreSQL rollback-only, pruebas de contrato e integración, y aislamiento de tenancy. La interfaz web de Capture será una tarea L2 posterior.

## Criterios de aceptación (verificables)
- [ ] Migración SQL: tabla `app.delivery_zones` con `(restaurant_id, branch_id, postal_code, locality, fee_minor, currency_code, active, created_at)`, índices y RLS+FORCE; reproducible desde cero y sobre versión anterior sin destructivos.
- [ ] Función privada `app_private.list_delivery_zones(p_actor_id uuid, p_request jsonb)` con retorno versionado; revalida scope Branch/Restaurant y verifica rol manager.
- [ ] Función privada `app_private.upsert_delivery_zone(p_actor_id uuid, p_command jsonb)` con CAS, idempotencia y auditoría en `app.delivery_zone_command_events`; rechaza scope falso, fee negativa, zona inactiva sin motivo.
- [ ] Función privada `app_private.quote_delivery(p_actor_id uuid, p_request jsonb)` que lee zonas, llama lógica dominio pura `quoteDelivery`, valida dirección/timestamp y retorna `DeliveryQuoteV1` congelado con zoneId/fee/ventana/promesa; nunca confía cliente fee.
- [ ] Módulo NestJS `DeliveryZonesModule` (inyectable `DeliveryZonesService`, `DeliveryZonesController`) con tres endpoints: `GET /v1/restaurants/:restaurantId/branches/:branchId/delivery-zones` (lista, manager), `POST /v1/delivery-zones/upsert` (actualiza, manager), `POST /v1/delivery-quotes` (cita, cualquiera con captures.read).
- [ ] Parsers/validadores en `packages/shared-types/src/delivery-zone*.ts` y DTOs; sin exportación de config privada.
- [ ] Verificador rollback-only en `apps/api/src/operations/run-delivery-zones-schema-verification.ts`: fixture con 2 restaurantes/3 sucursales, 2 actores con roles, zonas overlapping, UPSERT idempotente, CAS rejection, quote con/sin cobertura, cifra de tablas/políticas/funciones security-definer y postcheck cero residual.
- [ ] Pruebas de contrato: fixture de zona activa/inactiva, cobertura por código postal vs. localidad (precedencia postal), fee en minor units, quote expira en `promiseStart`, override sólo manager con motivo auditado.
- [ ] Pruebas de integración: aislamiento entre Restaurant/Branch, RBAC (manager only), idempotencia UPSERT, conflicto de versión, quote coherente con zona, no confía fee de cliente, autorización revalidada en servidor.
- [ ] Suite, lint, typecheck y build verdes para `apps/api` y `packages/shared-types`.

## Archivos de entrada
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\docs\architecture\P2_OWN_DELIVERY_OPERATION_SLICE.md` (líneas 107-162, 149-161): requisitos S7.1 y decisiones aprobadas por Emmanuel §8.1.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\supabase\migrations\20260924000200_capture_assignment.sql` (líneas 1-140): patrón SQL security-definer, RLS+FORCE, CAS y auditoría.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\supabase\tests\capture_assignment_invariants.sql`: patrón de invariantes rollback-only, fixture, autorización, aislamiento.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\delivery-zone.ts`: dominio puro DeliveryZone, createDeliveryZone, findDeliveryZone (postal > locality), validación.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\delivery-quote.ts` (líneas 104-149): quoteDelivery puro (never Date.now), PROMISE_WINDOW_MS=15min, SCHEDULE_CUTOFF_MS=30min, SCHEDULE_HORIZON_MS=7d, expiresAt=promiseStart.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\src\delivery-quote.ts`: DeliveryQuoteV1, DeliveryAddressFactsV1, parsers con validación ISO/timestamp/UUID.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\api\src\captures.ts` (líneas 367-394, 425-490): patrón servicio+controller, MembershipAuthorizationService, actorId thread, parseInput, exactRecord, unavailable().
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\api\src\auth\rbac-policy.ts` (líneas 68-113): matriz RBAC_ROLE_PERMISSIONS_V1, manager excluye memberships.manage, permisos captures/orders/customers.
- `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\api\src\operations\run-capture-assignment-schema-verification.ts`: patrón verificador rollback-only, readSchemaVerificationConfig, transacción BEGIN/ROLLBACK, residual check, postcheck.

## Símbolos relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|
| packages/domain/src/delivery-zone.ts | DeliveryZone, createDeliveryZone, findDeliveryZone | Dominio puro sin ORM; findDeliveryZone prioriza postal > locality; valida conjunto no vacío. |
| packages/domain/src/delivery-quote.ts | quoteDelivery, DELIVERY_QUOTE_EXPIRY_POLICY | Puro, never Date.now; expira en promiseStart; fee=0 si no covered. |
| packages/shared-types/src/delivery-quote.ts | DeliveryQuoteV1, DeliveryAddressFactsV1, parseDeliveryQuoteV1 | Parsers hostiles, validan ISO/timestamp/UUID/range; contrato versionado. |
| packages/shared-types/src/delivery-zone.ts (pendiente) | DeliveryZoneRequestV1, DeliveryZoneListV1 | Contratos para requests/responses REST. |
| apps/api/src/auth/membership-authorization.ts | MembershipAuthorizationService.authorizeBranch | Revalida actor+scope; lanza si denegado; retorna authorized principal. |
| apps/api/src/auth/rbac-policy.ts | RBAC_ROLE_PERMISSIONS_V1 | Matriz: manager tiene captures.read/update pero no memberships.manage. |
| supabase/migrations/20260924000200_capture_assignment.sql | app_private.list_capture_assignment_candidates, app_private.mutate_capture_assignment | Patrones: security-definer, scope validation, JSONB exactitud, CAS versión. |

## Invariantes que NO deben cambiar
- Dinero: minor units enteros, ISO 4217 moneda; never float.
- Tenancy: toda consulta y mutación debe filtrar por `restaurant_id` y `branch_id` explícitamente; no confiar en cliente scope.
- RLS+FORCE: toda tabla S7 debe tener `FORCE ROW LEVEL SECURITY`; todo `app_api` acceso vía función security-definer.
- Dominio puro: `packages/domain` nunca lee reloj (`Date.now()`); toda hora la pasa el caller.
- Fee/quote: servidor nunca confía fee de cliente; `quoteDelivery` calcula desde zonas autorizadas; override sólo manager con motivo auditado.
- Migraciones: candidatas (nunca aplicadas en desarrollo); SQL versionadas; `begin;` ... `commit;`; rollback-only ≡ cero estado persistido tras ROLLBACK.
- Aislamiento: pruebas multi-tenant (2+ Restaurant) y multi-sucursal (2+ Branch) deben fallar cuando se mezclan.

## Fuera de alcance
- Interfaz web Capture (lectura/aceptación de quote): tarea L2 posterior.
- Sobrescritura de migraciones aplicadas remotamente.
- Autoasignación de repartidor o algoritmo de rutas.
- Geocodificación o polígonos: zonas manuales postalCode/locality.
- Persistencia de quote: S7.2 decidirá si guardar.
- Override manager implementado pero sin endpoint UI.

## Verificación
```bash
# Lint, typecheck y test de paquetes afectados
pnpm --filter packages/shared-types lint
pnpm --filter packages/shared-types typecheck
pnpm --filter packages/shared-types test

pnpm --filter apps/api lint
pnpm --filter apps/api typecheck
pnpm --filter apps/api test -- --testNamePattern="delivery.*zone|delivery.*quote"

# Construcción
pnpm --filter apps/api build

# Verificador rollback-only (disponible si dev local tiene PostgreSQL)
# DELIVERY_ZONES_VERIFICATION_CONFIRMATION=ROLLBACK_ONLY_APP_API_SQL \
#   DATABASE_URL=postgresql://... \
#   pnpm --filter apps/api run verify:delivery-zones

# CodeGraph post-cambio
# codegraph explore "DeliveryZonesService MembershipAuthorizationService quoteDelivery"
```

## Formato de salida esperado
1. Resumen de cambios (3-6 líneas).
2. Lista de archivos tocados (rutas absolutas).
3. Salida literal de lint, typecheck, test, build.
4. Riesgos o dudas abiertas (si las hay).
5. No pegar diffs completos; el orquestador los lee con `git diff`.

---

**Riesgo sugerido:** Alto (esquema, dinero, tenancy). **Capa sugerida:** L1 (implementer-claude).
