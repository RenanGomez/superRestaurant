# Huecos de cobertura obligatoria — Mobile (§15)

Fecha: 2026-11-23 · Ítem: **Ola 0.3** (nivel D, solo lectura sobre código; única salida este documento).
Corte inspeccionado: `ao/superrestaurant-46/root` sobre `main` (`aec8f285`).
Fuentes cruzadas: `docs/agentic/coverage-m1.md`, `docs/agentic/debt.md`, `AGENTS.md` §9, §11, §15, §19.2 y el código/pruebas de `apps/mobile` y los contratos de `packages/shared-types` que consume.

Alcance: **Mobile** = `apps/mobile/src` (lógica pura y cableado de UI) y la superficie que consume (endpoints Nest del allowlist y parsers runtime de `packages/shared-types`). No se auditan Web, API, SQL ni KDS salvo para marcar dependencias.

## 1. Resumen ejecutivo

Mobile es hoy **online-first** y su cobertura obligatoria de §15 está concentrada en lógica pura: **19 suites y 238 pruebas** en `node:test`, sin framework de render (`.tsx` queda fuera de `tsconfig.test.build.json`). Las áreas mejor cubiertas son aislamiento de scope en el cliente, dinero sin `float`, máquina de estados de navegación/borrador y replay de la entrega de comanda.

Los huecos restantes no son «falta de código»: son **pruebas obligatorias** que aún no existen o que viven en `app.tsx`, fuera del build de pruebas. Se clasifican con el nivel de rigor de §19.2: casi todos son **C** (cliente puro/cableado de UI); los de persistencia offline y autorización delegada suben a **A** por depender de servidor o de la Fase 3.

**Conteo:** 13 huecos vivos (G-01…G-13), cada uno trazado a `debt.md` y/o `coverage-m1.md`, 0 bloqueantes de este documento.

## 2. Cobertura actual de Mobile por área de §15

| # | Área §15 | Estado Mobile | Evidencia existente | Hueco principal |
|---|---|---|---|---|
| 1 | Aislamiento restaurant/sucursal | **Parcial** | `mobile-client.test.ts` rechaza respuestas de otro scope (layout, catálogo, turnos, contexto, órdenes, checkout); `mobile-state.test.ts` tira datos al cambiar sucursal/operador; `branch-read.test.ts` aísla generaciones y operadores | No hay fixture de **mismo restaurante, otra sucursal**; `scopeA`/`scopeB` cambian ambos ids |
| 2 | Dinero y redondeo | **Parcial** | `money.test.ts` (6): sin float, rechaza no enteros y moneda malformada; `order-draft.test.ts` demuestra que el borrador no lee importes; el cobro muestra solo cotización del servidor | Sin property-based ni borde de overflow; tabla `FRACTION_DIGITS` duplicada respecto de web; no se prueba que el cliente nunca derive cambio/propina |
| 3 | Máquinas de estado | **Parcial** | `mobile-state.test.ts` (40), `order-draft.test.ts` (38), `order-submission.test.ts` (15), `order-delivery.test.ts` (13), `order-draft-layout.test.ts` (5) | Sin turno vacío/cerrado ni orden `cancelled`/`paid` en la bandeja; el estado de envío de pago tiene una sola ruta feliz |
| 4 | Doble envío / doble cobro | **Parcial–Cubierto** | `order-submission.test.ts`: replay reanuda sin duplicar y «delivery que ya completó no envía nada»; `order-delivery.test.ts`: segundo toque se rechaza | El guard de doble cobro existe en `mobile-state.ts` pero **no se prueba**; la identidad de auditoría del pago vive en `app.tsx`, fuera de tests |
| 5 | Cancelación / reembolso | **No aplica / Faltante** | El allowlist de `MOBILE_API_PATHS` excluye cancelación y reembolso; `order-intents.test.ts` lo verifica por lista de rutas | Sin prueba negativa de gestos/comandos y sin prueba de que una orden cancelada por otro actor se refleje sin revivirla |
| 6 | Reconexión / conflictos offline | **Parcial** | `revalidation.test.ts` y `lifecycle.test.ts` cubren regreso a foreground y sesión; `order-submission.test.ts` distingue fallos de transporte | Sin `sync-engine`, sin `POST /sync`, sin outbox durable, sin reinicio, sin conflicto multi-dispositivo; el móvil no importa `packages/sync-engine` |
| 7 | Inventario compensatorio | **No aplica** | Mobile no consume stock, recetas ni movimientos | Corresponde a M3 (`m3-cov-inventory-compensating`); no es un hueco de Mobile hasta que exista contrato |
| 8 | Permisos de supervisor | **Parcial / Faltante** | `toMobileBranchContext` conserva `roles`; `branch-screen.tsx` solo muestra roles y pide acudir a un supervisor | Los roles se guardan pero no gobiernan ninguna acción; no hay prueba de que un cajero no pueda iniciar una acción de supervisor ni de que Mobile nunca envíe `authorization.actorId` |
| 9 | Migraciones desde cero / versión anterior | **No aplica a la app; Parcial en contratos** | Mobile usa solo parsers runtime de `shared-types`; `mobile-client.test.ts` falla cerrado ante un cuerpo que no cumple el contrato | Sin prueba de evolución de `schemaVersion` ni de campo retirado por endpoint; `pg-verify` no ejerce al cliente |

## 3. Huecos obligatorios de Mobile

Nivel = rigor de `AGENTS.md` §19.2 para la tarea que cerraría el hueco.
Traz. = fila/ítem de `coverage-m1.md` o `debt.md` que lo origina o donde ya se registró.

| ID | Hueco | Archivo(s) | Prueba sugerida | Nivel | Traz. |
|---|---|---|---|---|---|
| **G-01** | El cliente rechaza respuestas de otro restaurant/sucursal, pero **no se prueba el caso mismo restaurante + otra sucursal**, que es el aislamiento más fino de §15.1. | `apps/mobile/src/mobile-client.test.ts`, `src/test-fixtures.ts`, `src/mobile-client.ts` (`sameScope`) | Nuevo fixture `scopeA2` (mismo `restaurantId` que `scopeA`, otro `branchId`); por cada endpoint con scope (layout, catálogo, turnos, contexto, orden activa, checkout) esperar `MobileRequestError("protocol")`/`403` y cero aplicación de datos. Nombres: `"refuses a same-restaurant other-branch answer for layout"`, etc. | C | `coverage-m1.md` §2.1 |
| **G-02** | Dinero: sin pruebas property-based de ida/vuelta parse↔format, sin borde `MAX_SAFE_INTEGER`, y `FRACTION_DIGITS` de Mobile duplica (con `XTS`) la de web sin guarda de paridad. | `apps/mobile/src/money.test.ts`, `src/money.ts`, `apps/web/src/lib/money-scale.ts` (o consolidar en `packages/shared-types`) | 1) Property test: para enteros seguros y monedas soportadas, `parseMinorUnitsInput(formatMinorUnitsInput(n)) === n`. 2) Rechazo de `MAX_SAFE_INTEGER + 1`, negativos y exponentes no soportados. 3) Guarda de paridad de tablas (`it("mobile and web agree on minor-unit scale")`) o mover la tabla a shared-types y probarla una vez. | C | `debt.md` P3 `FRACTION_DIGITS`; §15.2 |
| **G-03** | Doble cobro en Mobile: el reducer impide un segundo `paymentSubmitStarted` mientras `sending` y descarta recibos de otro scope, pero **ningún test lo afirma**. | `apps/mobile/src/mobile-state.test.ts`, `src/mobile-state.ts` (líneas 545-558, 762-777) | Añadir al test de cobro: (a) segundo `paymentSubmitStarted` deja `submission.status === "sending"` y no cambia identidad; (b) recibo duplicado tras `collected` no muta; (c) recibo con `orderId`/scope ajenos se ignora; (d) `canSubmitMobilePayment` es `false` durante `sending`. | C | §15.4; `coverage-m1.md` §2.4 |
| **G-04** | La identidad de auditoría del cobro (`eventId`, `idempotencyKey`, `paymentId`, reutilización por clave de cotización) está en `app.tsx`, que **no compila en el test build**; un fallo ahí duplicaría cobros y ningún gate lo ve. | `apps/mobile/src/ui/app.tsx` (554-604), `apps/mobile/tsconfig.test.build.json` | Extraer helper puro `buildPaymentAttemptKey/nextPaymentAttempt` a `src/payment-attempt.ts`; probar que editar monto/método cambia la clave y genera nuevas identidades, y que un reintento idéntico reutiliza las mismas; incluirlo en `tsconfig.test.build.json`. | C | §15.4, §9 |
| **G-05** | La entrega de comanda reutiliza el plan por clave de borrador (`planRef`) y lo «gasta» al aceptar; eso solo se prueba en piezas puras, no en el cableado que decide reutilizar. | `apps/mobile/src/ui/app.tsx` (624-660), `src/order-plan.ts`, `src/order-submission.ts`, `src/order-delivery.ts` | Extraer a helper puro la decisión `(draftKey, lines) → plan retenido o plan nuevo` y probar: reintento idéntico conserva `eventId`/`idempotencyKey`; editar líneas genera plan nuevo; tras éxito no se reofrece nada. Alternativa mínima: test de integración del puerto con un plan memoizado. | C | §15.4; `coverage-m1.md` §2.4 |
| **G-06** | Turno vacío/cerrado: todos los fixtures devuelven un turno `open`. No se prueba que una lista vacía sea estado explícito y que bloquee lecturas operativas (hoy solo se prueba la lista de membresías vacía). | `apps/mobile/src/mobile-state.test.ts`, `src/branch-read.test.ts`, `src/test-fixtures.ts` (`operationalShiftListBody`) | Añadir `operationalShiftListBody(scope, { shifts: [] })`; probar que `mobileScreen` queda en `shifts`, `canReadOperationalData` es `false` y la UI recibe mensaje explícito (no pantalla en blanco). | C | §15.3; §14 estados vacíos |
| **G-07** | Bandeja de órdenes: no se prueba cómo se reflejan `cancelled`/`paid`/`closed` ni que una orden ajena o terminal no pueda reabrirse desde Mobile. `active-orders-panel.tsx` rotula `cancelled`, pero el reducer no tiene fixture de estados terminales. | `apps/mobile/src/mobile-state.test.ts`, `src/test-fixtures.ts` (`activeTableOrderItemBody`/`activeTableOrderListBody`), `src/ui/active-orders-panel.tsx` | Fixtures por estado (`cancelled`, `paid`, `closed`) y pruebas: se muestran con su etiqueta; una orden terminal no habilita acciones de escritura; al cambiar de mesa no sobrevive. | C | §15.3, §15.5 |
| **G-08** | Cancelación/reembolso: el allowlist excluye las rutas (correcto), pero no hay **prueba negativa de gestos** ni de que código de Mobile no pueda construir un comando de cancelación/reembolso por accidente al crecer el allowlist. | `apps/mobile/src/order-intents.test.ts`, `src/mobile-client.ts` (`MOBILE_API_PATHS`) | Ampliar la guarda: lista explícita de fragmentos prohibidos (`cancel`, `refund`, `items/cancel`, `payments/refund`) y prueba de que ningún módulo de `src` los nombra ni los envía. Nota de dependencia: cuando exista `POST /payments/refund` (`m1-cov-refunds-execution`, A), decidir si Mobile lo recibe; hasta entonces la ausencia es deliberada. | C (servidor A) | §15.5, §15.8; `coverage-m1.md` §2.5 |
| **G-09** | Supervisor delegado: `roles` se guarda en el contexto pero no gobierna ninguna affordance; no hay prueba de que Mobile no pueda actuar como supervisor ni de que no envíe `authorization.actorId` inventado. | `apps/mobile/src/mobile-state.ts` (101, 954-961), `src/ui/app.tsx`, `src/mobile-client.ts` | Con `roles: ["waiter"]`, probar que ninguna acción sensible se ofrece/habilita; guarda de que los comandos construidos no incluyen `authorization` ni `actorId` más allá de identidad propia. Depende de la decisión `m1-cov-delegated-supervisor-auth` (A). | C (servidor A) | §15.8; `coverage-m1.md` §2.8 |
| **G-10** | Offline real: Mobile no importa `packages/sync-engine`, no tiene outbox durable ni storage persistente; el estado vive en memoria. Solo se prueba la revalidación online-first al volver del background. | `apps/mobile/package.json`, `apps/mobile/src/*`, `src/ui/app.tsx`; motor en `packages/sync-engine` | Corto plazo (C): prueba de corte de red durante `submitOrderPlan` + reintento al reconectar con un solo efecto y estado pendiente explícito. Fase 3 (A): integrar `sync-engine`, outbox durable (ADR-005) y prueba multi-dispositivo con conflicto financiero a `manual_review`; cubierto por `m2-cov-offline-sync-e2e`. | A | §15.6, §11; `coverage-m1.md` §2.6 |
| **G-11** | Caja: `registerId = deviceId` está fijado en el cableado; no se prueba descubrir/seleccionar otra caja abierta de la sucursal ni el caso «sin caja abierta» más allá de mapear 404 a `noRegister`. | `apps/mobile/src/ui/app.tsx` (465-472), `src/mobile-client.ts` (`getCashRegisterReport`/`getCheckoutOrder`), `src/mobile-state.test.ts` | Decisión primero (ver deuda P2): si Mobile mantiene una sola caja, prueba explícita de que `registerId` debe pertenecer al dispositivo y de que un `registerId` ajeno del servidor es fallo de protocolo; si se habilita selección, prueba de lista de cajas abiertas y de ausencia explícita. | C | `debt.md` P2 `m1-mobile-pay-note` |
| **G-12** | La lógica de UI (`app.tsx`, pantallas) no compila en el test build y no existe ninguna prueba de render/interacción: estados de carga/error/reintento, confirmaciones dentro de la app y objetivos táctiles no están cubiertos por unit tests. | `apps/mobile/tsconfig.test.build.json` (solo `src`, sin `.tsx`), `src/ui/*.tsx`, `harness/` | Mínimo: mover a helpers puros toda decisión de `app.tsx` que hoy no se prueba (G-04, G-05, G-11). Complemento: verificación en navegador/harness real (desktop y 390×844, consola limpia) y, si se adopta render testing, pruebas de estados vacío/error/offline y de que no se usa `alert/confirm/prompt`. | C | §14, §19.2 C; `debt.md` (sin ítem propio) |
| **G-13** | Compatibilidad de contratos: Mobile depende de `schemaVersion: 1` en cada respuesta, pero no se prueba que rechace un `schemaVersion` futuro/desconocido ni un campo obligatorio retirado tras una migración del servidor. | `apps/mobile/src/mobile-client.test.ts`, `src/test-fixtures.ts` | Por endpoint representativo (layout, catálogo, turnos, contexto, orden activa, checkout, cobro): variante con `schemaVersion: 2` y campo requerido ausente; esperar `MobileRequestError("protocol")` y ningún dato aplicado. | C | §15.9; `coverage-m1.md` §2.9 |

### 3.1 Huecos ya cerrados que conviene no reabrir

- **Nota de línea:** `order-draft.test.ts` («composes, edits, trims and validates optional line notes»), `order-intents.test.ts` y `order-draft-screen.tsx` ya cubren captura y propagación; la nota vieja de `HANDOFF.md` («mobile sin captura de nota») está obsoleta.
- **Pizza V2 fail-closed:** `order-draft.test.ts` línea ~534 ya prueba que un producto Pizza V2 con listas canónicas falla cerrado; lo que sigue faltando es UI V2 y su verificación visual, no el guard.
- **Replay de comanda:** `order-submission.test.ts` cubre reintento idempotente, reanudación y «ya completada no envía nada»; no duplicar.
- **Doble toque de entrega:** `order-delivery.test.ts` lo cubre; solo el cobro (G-03) y el cableado (G-04/G-05) quedan.

## 4. Lo que NO es un hueco de Mobile

| Tema | Por qué no corresponde a Mobile | Dónde vive |
|---|---|---|
| Liquidación de reembolsos, descuentos/cortesías, autorización delegada | Requieren contrato, SQL y API primero; Mobile solo podrá consumirlos después | `coverage-m1.md` §2.5, §2.8; ítems A `m1-cov-refunds-execution`, `m1-cov-discounts-courtesies`, `m1-cov-delegated-supervisor-auth` |
| Inventario compensatorio | No hay contrato ni consumidor móvil | `m3-cov-inventory-compensating` |
| Migraciones desde cero / upgrade con datos | Mobile no aplica SQL; solo verifica contratos (G-13) | `.github/workflows/ci.yml` `pg-verify`; `m1-cov-migration-upgrade-ci` |
| Deuda visual web (`m1-visual-verify-r2`) | Archivos exclusivos de `apps/web` | `debt.md` filas 2026-11-23 |

## 5. Orden recomendado de cierre

1. **Sin dependencias de servidor (C, lógica pura):** G-01, G-03, G-06, G-07, G-02, G-13.
2. **Refactor pequeño + prueba (C):** G-04, G-05, G-11, G-12 (mínimo de helpers).
3. **Tras decisión de servidor:** G-08 y G-09 (dependen de reembolso y autorización delegada A).
4. **Fase 3 / M2 (A):** G-10 con `m2-cov-offline-sync-e2e`.

Criterio de cierre de cada fila: prueba incluida en `apps/mobile` (o en el gate que corresponda para el nivel A) y `pnpm --filter @super-restaurant/mobile lint`, `typecheck`, `test` y `build` verdes; para G-12, además verificación visual en dispositivo/navegador real a 390×844 con consola limpia.

## 6. Verificación de este documento

- Documento de solo lectura sobre código: no modifica `apps/mobile` ni contratos.
- Puerta de nivel D: `git diff --check`.
- Puertas del alcance delegado (§19.2/§20) se ejecutan y registran en `HANDOFF.md`: `pnpm lint`, `pnpm typecheck`, `pnpm test` y, cuando aplique, `pnpm build` con Node 24.
