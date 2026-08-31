# TODO

Última actualización: 2026-08-31

Fuente principal: `PLAN_MODERNIZACION_POS_RESTAURANTE.md`.

Estados permitidos: `TODO`, `IN_PROGRESS`, `REVIEW`, `DONE`, `BLOCKED`, `CANCELLED`.

## P0 — Preparación y decisiones

- [ ] **REVIEW · P0** — Crear `TODO.md`, `PROJECT_NOTES.md` y `HANDOFF.md` a partir de `AGENTS.md` y del plan maestro. Nota: archivos creados el 2026-08-25; pendientes de revisión humana.
- [ ] **REVIEW · P0** — Alinear `AGENTS.md` con este proyecto POS. Nota: el 2026-08-25 se reemplazó el contexto ATS por reglas específicas de arquitectura, dinero, tenancy, offline, seguridad, pruebas y Git; pendiente de revisión humana.
- [ ] **REVIEW · P0** — Robustecer `PLAN_MODERNIZACION_POS_RESTAURANTE.md`. Nota: versión 2.2 lista para implementar Fase 0; ADR-010 tiene timebox, hard stop, gates/GO-NO-GO y packages/domain puede avanzar en paralelo.
- [ ] **TODO · P0** — Confirmar el alcance del v1 vendible: recomendación inicial, Fases 0–3; decidir expresamente si mobile y offline son requisitos de salida o una segunda entrega.
- [ ] **TODO · P0** — Confirmar mercado objetivo, moneda, zona horaria, reglas fiscales y si CFDI México forma parte del producto.
- [ ] **BLOCKED · P0** — Confirmar modelo comercial/licencia del producto antes de reutilizar código. Nota: auditoría Git del 2026-08-28 confirmó que `origin/main@293a1551` y `origin/master@f87d5b25` no incluyen licencia/NOTICE/COPYING/README ni campo `license` para el código propio. No copiar el prototipo; siguiente acción mínima: autorización/licencia escrita del titular y decisión humana del modelo comercial.
- [ ] **REVIEW · P0** — Registrar la arquitectura inicial definitiva. Nota: `docs/adr/ADR-001.md` traduce la opción B aprobada a límites implementables: Supabase administrado para PostgreSQL/Auth y Storage cuando un módulo lo requiera, NestJS como única frontera crítica, migraciones SQL de Supabase como autoridad única y Data API directa limitada a lecturas RLS/CRUD no financiero expresamente permitido. ORM, colas, transporte Realtime, despliegue y schema productivo siguen como decisiones de implementación. Pendiente revisión humana del documento; la decisión base ya fue autorizada.
- [x] **DONE · P0** — Ejecutar el spike de ADR-010 en 4 días hábiles, hard stop al quinto, usando gates comunes, scoring ≥75/100 y GO/NO-GO por opción. Nota: B demostró los diez gates, obtuvo 75/100 y fue aprobada expresamente por Emmanuel el 2026-08-29. A no fue seleccionada y C queda limitada a lecturas/CRUD no financiero permitido. La recuperación física, RPO/RTO, observabilidad y la reinspección de Gate 4 con aplicaciones reales siguen como obligaciones preproducción.
- [ ] **REVIEW · P0** — Especificar invariantes monetarias: tipo decimal, moneda, redondeo, impuestos incluidos/excluidos, propinas, descuentos y snapshots históricos de precio/impuesto. Nota: validaciones runtime de redondeo/`TaxSnapshot.rate` y propiedades deterministas contra oráculo bigint/permutaciones quedaron verdes el 2026-08-28; las decisiones de país/moneda/tasas/propina/CFDI siguen pendientes del humano.
- [ ] **REVIEW · P0** — Diseñar el contrato offline/sync antes de la Fase 3: idempotencia, orden causal, deduplicación, conflictos, reloj de dispositivos, borrados y pagos. Nota: ADR-004, contrato de protocolo y matriz de capacidades/conflictos documentados y auditados el 2026-08-26. La especificación no implementa todavía motor de sync, almacenamiento local ni operación offline; pendiente revisión humana.

## Fase 0 — Fundaciones

- [x] **DONE · P0** — Inicializar Git y enlazar el remoto. Nota: el humano autorizó publicación e integración el 2026-08-28. HTTPS, fetch y push quedaron verificados; `main` y `codex/modernizacion-fase0` apuntan al merge `f9f4428`, con árbol greenfield idéntico y sin force-push.
- [x] **DONE · P0** — Definir la estrategia para el prototipo remoto y sus 10,427 rutas de `node_modules` versionadas. Nota: ADR-006 preserva la historia anterior como segundo padre recuperable, mantiene `origin/master` intacta y adopta el greenfield como árbol de `main`; no copiar código legado sin licencia/autorización escrita.
- [ ] **REVIEW · P0** — Crear un `.gitignore` para `node_modules`, secretos, builds, cobertura, caches y CodeGraph antes del primer commit nuevo. Nota: implementado y verificado el 2026-08-25; pendiente de revisión humana.
- [ ] **REVIEW · P0** — Inicializar monorepo con Turborepo y pnpm. Nota: configuración raíz y lockfile reproducible implementados y verificados el 2026-08-25; pendiente de revisión humana.
- [ ] **REVIEW · P0** — Versionar el plan maestro en `docs/PLAN_MODERNIZACION_POS_RESTAURANTE.md` y documentar en README la decisión greenfield/API-first. Nota: copia byte a byte y README greenfield/API-first verificados el 2026-08-25; pendiente de revisión humana.
- [ ] **REVIEW · P0** — Crear en paralelo `packages/domain`, `packages/shared-types` y configuración neutral; implementar Money, Order/OrderItem e invariantes sin framework/ORM/red. Nota: agregado puro `Order` implementado y auditado el 2026-08-28 con canal/mesa, scope explícito por línea, snapshots, cancelación total auditada y cierre solo con ítems entregados/cancelados. Totales y estados rechazan DTOs/accessors/prototipos hostiles con errores de dominio. `shared-types` ofrece parsers runtime fail-closed y versionados para Restaurant/Branch scope, sin dependencias. Pendiente revisión humana.
- [ ] **REVIEW · P0** — Implementar reglas puras de modificadores de menú. Nota: grupos versionados y aislados por restaurante con mínimo/máximo por suma de cantidades, allowlist activa por producto, caps opcionales, duplicados rechazados, moneda/precio exactos y snapshots canónicos. Las fronteras normalizan datos propios y rechazan null, accessors, proxies y prototipos hostiles; 11 pruebas cubren aislamiento y entradas runtime. Verificado el 2026-08-28, pendiente de revisión humana.
- [ ] **REVIEW · P0** — Implementar invariantes puras de pagos y caja. Nota: el 2026-08-28 se cerró la validación fail-closed de `Payment`/refunds y `CashRegister`, incluidos agregados hostiles, compensaciones, saldos rehidratados y 48 particiones generativas; creación/transición/refund/cierre usan `eventId` + `idempotencyKey`, evidencia ligada a Branch y espacios de claves sin colisiones entre operaciones. La rehidratación de cierre con diferencia exige conservar el motivo. Pendiente revisión humana.
- [ ] **REVIEW · P0** — Configurar Auth y acceso definitivo de `apps/api`. Nota: configuración fail-closed, identidad por `auth.getUser`, `APP_GUARD`, lookup PostgreSQL privado con rol `app_api`, scope UUID exacto, selección 200/401/403 y `GET /api/v1/access/memberships` están integrados; las respuestas autenticadas declaran `private, no-store`. `app_api` quedó aprovisionado persistentemente como `LOGIN` con SCRAM, vigencia infinita, mínimos privilegios, catálogo exacto y cero sesiones. El 2026-08-31 la E2E remota ejecutó 97 checks contra Auth/Data API/Nest/PostgreSQL privado y terminó con cleanup total de fixtures y dos usuarios temporales; pasa a REVIEW pendiente de aprobación humana.
- [ ] **REVIEW · P0** — Definir esquema/migraciones definitivas de persistencia. Nota: `20260830000100` y `20260830000200` quedaron aplicadas persistentemente con autorizaciones expresas en `zwbyiefqeujstyzysydn`. El staging temporal contenía hashes exactos de las cinco migraciones históricas y dos productivas; el dry-run anunció únicamente `20260830000200`, no se reparó historial ni se usó `db push` raíz, y el postcheck confirmó exactamente siete versiones. Las auditorías endurecidas exigen cinco funciones, catálogo exacto y ausencia de grants `anon`/`authenticated`/`service_role`; pendiente revisión humana.
- [ ] **TODO · P0** — Configurar infraestructura definitiva PostgreSQL/Supabase, Redis/jobs y Realtime. Nota: desbloqueado; PostgreSQL/Auth pertenecen a Supabase y jobs a NestJS, pero ADR-010 no eligió cola ni transporte Realtime. Toda opción debe conservar recuperación durable por cursor.
- [ ] **IN_PROGRESS · P0** — Configurar login funcional de `apps/web`. Nota: FE-0 contiene Next.js App Router/Tailwind v4, `/login`, `/app`, Auth SSR server-only, refresh/rechazo Nest en `proxy.ts`, cookies endurecidas y configuración fail-closed sin `NEXT_PUBLIC_`. El integrador añadió el harness funcional y enlazó `@super-restaurant/shared-types` como dependencia workspace sin iniciar FE-0.1. Lint, typecheck, 23/23 pruebas y build pasaron; la E2E remota de backend/Auth también quedó verde con cleanup. Solo falta el smoke humano real. FE-0.1 queda técnicamente elegible cuando este checkpoint esté publicado y el checkout esté limpio, pero Claude requiere una nueva asignación explícita limitada a `apps/web/**`.
- [ ] **REVIEW · P0** — Configurar CI con lint, tests y build. Nota: workflow neutral reproducible implementado; el 2026-08-29 se corrigió el orden limpio de Turbo para que typecheck/test construyan primero las dependencias publicadas y se verificó sin `dist`, caché ni `tsbuildinfo` previos. Pendiente de revisión humana y ejecución del cambio en GitHub.
- [ ] **REVIEW · P0** — Añadir E2E definitivas de autenticación y selección de restaurante/sucursal. Nota: con autorización expresa de Emmanuel, el runner dirigido expuso persistentemente solo `app` en Data API mediante GET/PATCH exactos; el postcheck confirmó `public,graphql_public,app`, sin `app_private`, `app_rls`, `config push` ni cambios Auth. La matriz remota 2×2 completó 97 checks de Auth, RLS/Data API, lookup privado, directorio, selección Nest, revocación, deshabilitación y constraints. El cleanup confirmó todas las filas temporales eliminadas y dos usuarios Auth retirados. Pasa a REVIEW; el 403 por permiso de acción se añadirá al primer endpoint con roles restringidos.

## Fase 1 — POS core online

- [ ] **TODO · P1** — Implementar mesas, zonas y editor de layout web.
- [ ] **REVIEW · P1** — Implementar menú: categorías, productos, modificadores y reglas de selección. Nota: el slice neutral de `packages/domain` implementa un catálogo Restaurant-scoped/versionado y ordenable de categorías/productos, valida referencias, estados, SKU, moneda, precios y allowlists, resuelve los modificadores existentes y produce snapshots históricos profundamente inmutables compatibles con Order. Diez pruebas nuevas cubren integración monetaria/Order, aislamiento, duplicados, referencias, inactividad, mutación posterior y entradas hostiles; pipeline global verde el 2026-08-29. Persistencia/API/UI, disponibilidad por sucursal/horario, precios por canal, combos y recetas permanecen pendientes de fases posteriores. Pendiente revisión humana.
- [ ] **REVIEW · P1** — Implementar órdenes y máquina de estados de `OrderItem` en `packages/domain`. Nota: agregado y estados puros implementados y auditados; faltan la persistencia/API/KDS de Fase 1 y verificar en servidor que `tableId` pertenece a la sucursal y que los pagos autorizan los estados de liquidación.
- [ ] **REVIEW · P1** — Implementar auditoría de operaciones de orden y autorizaciones sensibles. Nota: el slice neutral de `packages/domain` obliga a que crear/modificar una Order devuelva agregado + evento inmutable versionado; scope, entidad, operación y estados se derivan del dominio. Toda cancelación conserva motivo, actor, dispositivo, origen, `eventId` e idempotency key; después de KDS exige autorización de supervisor. Las fronteras rechazan contextos/órdenes rehidratadas hostiles y ninguna línea cancelada puede omitir evidencia. Cien pruebas de dominio y el pipeline global pasaron el 2026-08-29. La futura persistencia deberá comprobar RBAC, agregar `receivedAt`, aplicar unicidad y guardar agregado + evento atómicamente; no se implementaron Auth, DB, API ni UI. Pendiente revisión humana.
- [ ] **TODO · P1** — Implementar gateway WebSocket para estados en tiempo real.
- [ ] **TODO · P1** — Crear KDS mínimo por estación, con tickets y acción “listo”.
- [ ] **TODO · P1** — Implementar caja y pagos simples: apertura, efectivo, tarjeta manual y cierre.
- [ ] **TODO · P1** — Implementar cobro y cortes X/Z en web.
- [ ] **TODO · P1** — Probar el flujo completo: abrir mesa → comanda → KDS → cobrar → cerrar mesa.

## Fase 2 — Mobile

- [ ] **TODO · P2** — Inicializar `apps/mobile` con Expo/React Native y tipos compartidos.
- [ ] **TODO · P2** — Implementar login y selección de sucursal/turno.
- [ ] **TODO · P2** — Implementar vista de mesas y toma de comanda online.
- [ ] **TODO · P2** — Implementar notificaciones de platillo listo.
- [ ] **TODO · P2** — Implementar impresión Bluetooth mediante `packages/printing`.

## Fase 3 — Offline-first

- [ ] **TODO · P3** — Implementar `packages/sync-engine` con outbox, reintentos e idempotencia.
- [ ] **TODO · P3** — Integrar almacenamiento local móvil; elegir WatermelonDB o una alternativa mediante ADR.
- [ ] **TODO · P3** — Integrar IndexedDB y Service Worker en web; elegir Dexie/RxDB mediante ADR y convertir el POS en PWA.
- [ ] **TODO · P3** — Implementar `POST /sync` por lotes con identificadores generados por cliente.
- [ ] **TODO · P3** — Implementar eventos de órdenes y reglas deterministas de merge.
- [ ] **TODO · P3** — Mostrar estado de conexión, pendientes, errores y reintentos en web/mobile.
- [ ] **TODO · P3** — Probar conflictos con dos dispositivos offline sobre la misma mesa, incluyendo cobros y cancelaciones.
- [ ] **TODO · P3** — Evaluar servidor local opcional para restaurantes con varias estaciones; no implementarlo sin validar necesidad operativa y topología de sincronización.

## Fase 4 — Inventario y compras

- [ ] **TODO · P4** — Implementar insumos, almacenes y movimientos de inventario.
- [ ] **TODO · P4** — Implementar recetas y descuento automático por venta.
- [ ] **TODO · P4** — Implementar proveedores, órdenes de compra y recepción.
- [ ] **TODO · P4** — Implementar alertas de stock mínimo.
- [ ] **TODO · P4** — Implementar costeo promedio y margen por platillo.

## Fase 5 — Fiscal y pagos avanzados

- [ ] **TODO · P5** — Seleccionar PAC e implementar adaptador CFDI 4.0 desacoplado, si México queda confirmado.
- [ ] **TODO · P5** — Implementar `pending_invoice`, reintentos y operación fiscal degradada sin red.
- [ ] **TODO · P5** — Seleccionar e integrar pasarela/terminal mediante `PaymentProvider`.
- [ ] **TODO · P5** — Implementar división avanzada, propinas y reparto.

## Fase 6 — Reportes, CRM y personal

- [ ] **TODO · P6** — Implementar dashboard gerencial.
- [ ] **TODO · P6** — Implementar exportación Excel/PDF.
- [ ] **TODO · P6** — Implementar clientes e historial de consumo.
- [ ] **TODO · P6** — Implementar empleados, asistencia y comisiones.

## Fase 7 — Multi-sucursal y lanzamiento

- [ ] **TODO · P7** — Implementar reportes consolidados multi-sucursal.
- [ ] **TODO · P7** — Completar auditoría de seguridad, RBAC, rate limiting y sanitización.
- [ ] **TODO · P7** — Ejecutar pruebas de carga y establecer capacidad operativa.
- [ ] **TODO · P7** — Documentar despliegue, respaldo, restauración y recuperación ante desastres.
- [ ] **TODO · P7** — Implementar importación CSV desde sistemas legacy.

## Fase 8 — Futuro

- [ ] **TODO · P8** — Integrar apps de delivery mediante adaptadores/webhooks.
- [ ] **TODO · P8** — Implementar lealtad avanzada.
- [ ] **TODO · P8** — Implementar reservaciones online.
