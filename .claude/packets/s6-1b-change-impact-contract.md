## Tarea
s6-1b-change-impact-contract · capa: L1 · riesgo: alto

## Objetivo
Publicar el cambio/cancelación de orden-item como contrato versionado en shared-types + adaptador API. Codificar la política S6 aprobada en packages/domain, exponiendo assessOrderItemChangeImpact mediante parsers exactos (reject campos extra, accessors, prototipos, proxies). Patrón: copiar payment-obligation.ts (schemaVersion, exactRecord, safely wrapper, frozen output).

## 6 Decisiones Aprobadas (P2_ORDER_CHANGE_CANCELLATION_SLICE.md 5.1, líneas 96-101)
1. Cancelar `sent`, `preparing`, `ready`: supervisor o gerente; motivo auditado. Cliente nunca autoriza.
2. Inventario: `sent` no descuenta; `preparing`/`ready` merma pendiente hasta autoridad recetas.
3. Cambio enviado: cancela original + línea reemplazo, identidad idempotente común. Operación puede ser sólo cancelación sin reemplazo.
4. Destinos: KDS primario; impresora secundaria; reimpresión manual siempre disponible.
5. KDS confirma+impresora falla: orden continúa, marcar `reimprimir`. Impresora confirma+KDS falla: KDS reintenta. Impresión nunca sustituye recuperación KDS.
6. Pago parcial/total: cancelación crea obligación refund `pending` ligada. No compensación atómica. Resuelto S8.6.

## Archivos de Entrada
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\order-item-change-impact.ts (líneas 1-168): assessOrderItemChangeImpact, exactRecord, data, InvalidOrderItemChangeImpactError
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\order-item-change-impact.test.ts (líneas 1-130+): matriz estado/operación, doble envío, entrada hostil
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\src\payment-obligation.ts (líneas 1-141): patrón SCHEMA_VERSION, parsers (exactRecord, own, safely), frozen output
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\src\payment-obligation.runtime.test.ts (líneas 1-63): rechazo accessors, prototipos, proxies, inconsistencia lógica
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\api\src\payments.ts (líneas 103-128): projectPaymentObligation adapter (parser + dominio + error handling)
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\apps\api\src\auth\rbac-policy.ts (líneas 1-80): "orders.cancel.pending", "orders.cancel.sent"
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\domain\src\index.ts (líneas 1-60+): export barrel
- C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\packages\shared-types\src\index.ts (líneas 1-30): export barrel, SCHEMA_VERSION constants

## Símbolos Relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|
| packages/domain/src/order-item-change-impact.ts | assessOrderItemChangeImpact | función pura existente; exponer vía shared-types + API |
| packages/domain/src/order-item-change-impact.ts | OrderItemChangeImpact | interface; publicar como salida contrato |
| packages/shared-types/src/payment-obligation.ts | SCHEMA_VERSION pattern | copiar exactamente (schemaVersion=1, parsers, validators) |
| packages/shared-types/src/payment-obligation.ts | parseProjectPaymentObligationRequestV1 | patrón exactRecord+own+safely; replicar para cambios |
| apps/api/src/payments.ts | projectPaymentObligation | patrón adapter (parser+dominio+Money+error handling) |
| apps/api/src/auth/rbac-policy.ts | orders.cancel.* | permiso derivado servidor según estado persistido |

## Invariantes que NO deben cambiar
- Cliente nunca envía autorización; servidor deriva desde estado persistido + membresía
- Dinero: minor units + ISO, nunca float
- Contrato versioned (schemaVersion=1) independiente de persistencia
- exactRecord rechaza prototipos distintos Object.prototype y campos extra/faltantes
- Salida congelada (deepFreeze); policyDecisions array sorted alfabéticamente
- Permission codes: "orders.cancel.pending" vs "orders.cancel.sent" según itemStatus en API
- Restaurant/Branch scope en toda consulta API (no en parser)

## Fuera de Alcance
- S6.2 (borrador Capture), S6.3 (corrección KDS/impresora), S6.4 (refund/inventario), S6.5 (UX)
- Persistencia NestJS orderRepository (para S6.3)
- Cambios SQL migraciones
- Cambios UI navegador/mobile

## Verificación
```bash
pnpm --filter @super-restaurant/domain test
pnpm --filter @super-restaurant/shared-types test
pnpm --filter @super-restaurant/api test
pnpm --filter @super-restaurant/domain typecheck
pnpm --filter @super-restaurant/shared-types typecheck
pnpm --filter @super-restaurant/api typecheck
pnpm --filter @super-restaurant/domain lint
pnpm --filter @super-restaurant/shared-types lint
pnpm --filter @super-restaurant/api lint
```

## Criterios de Aceptación (Verificables)
- [ ] OrderItemChangeImpactProjectionV1 + AssessOrderItemChangeImpactRequestV1 publicadas con SCHEMA_VERSION=1
- [ ] parseAssessOrderItemChangeImpactRequestV1: rechaza extra fields, accessors, prototipos no Object.prototype, proxies
- [ ] Parser valida operation ∈ ["cancel","replace"], itemStatus ∈ [valid states], orderStatus ∈ [valid states]
- [ ] projectOrderItemChangeImpact adapter en apps/api: no acepta authorization del cliente, revalida en API
- [ ] Tests matriz estado×operación: pending unpaid eligible, sent replacement elevated/correction_required, paid blocked, delivered blocked
- [ ] Tests doble envío: idempotencia bit-exacta, salida frozen
- [ ] Tests rechazo: operation=invalid, itemStatus=futura, capturedAmountMinor<0, schemaVersion!=1
- [ ] Tests actor/scope ajeno: parser no filtra, API debe validar post-llamada
- [ ] Exports: packages/domain/src/index.ts y packages/shared-types/src/index.ts incluyen tipos+función
- [ ] Compilación: tsc sin errores en ambos paquetes

## Formato de Salida Esperado
1. Resumen: tipo/función nuevos publicados, qué validaciones se añadieron (3-4 líneas)
2. Archivos tocados: lista absoluta (no tree)
3. Output literal de tests + typecheck + lint (pegar completo)
4. Riesgos: acoplamiento OrderItemCancellationAudit, trabajo futuro S6.3

---

**Riesgo sugerido: alto | Capa sugerida: L1**
