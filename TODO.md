# TODO

Última actualización: 2026-09-03

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
- [ ] **REVIEW · P0** — Configurar Auth y acceso definitivo de `apps/api`. Nota: configuración fail-closed, identidad por `auth.getUser`, `APP_GUARD`, lookup PostgreSQL privado con rol `app_api`, scope UUID exacto, selección 200/401/403 y `GET /api/v1/access/memberships` están integrados; las respuestas autenticadas declaran `private, no-store`. `app_api` quedó aprovisionado persistentemente como `LOGIN` con SCRAM, vigencia infinita, mínimos privilegios, catálogo exacto y cero sesiones. El 2026-08-31 la E2E remota base ejecutó 97 checks y la extensión de zonas ejecutó 119 checks contra Auth/Data API/Nest/PostgreSQL privado; ambas terminaron con cleanup total de fixtures y dos usuarios temporales. El 2026-09-01 la credencial expuesta localmente fue rotada mediante recovery `NOLOGIN PASSWORD NULL`, reprovisionamiento fail-closed y auditoría runtime post-zonas; solo se actualizó el secreto ignorado `.env.adr010.local`. Pasa a REVIEW pendiente de aprobación humana.
- [ ] **REVIEW · P0** — Definir esquema/migraciones definitivas de persistencia. Nota: `20260830000100`, `20260830000200` y `20260831000100` quedaron aplicadas persistentemente con autorizaciones expresas en `zwbyiefqeujstyzysydn`. El último staging temporal contenía hashes exactos de las cinco migraciones históricas y tres productivas; el dry-run anunció únicamente `20260831000100`, no se reparó historial ni se usó `db push` raíz, y el postcheck confirmó exactamente ocho versiones. La auditoría global post-zonas exige siete tablas, cinco políticas, seis funciones y ausencia de grants cliente; `db lint` no encontró errores. Pendiente revisión humana.
- [ ] **REVIEW · P0** — Definir la matriz RBAC versionada. Nota: `RBAC_MATRIX_VERSION=1` publica 18 permisos canónicos P0/P1 y una asignación explícita para los nueve roles, sin herencia implícita. Nest evalúa la unión de roles activos en el scope exacto y falla cerrado ante permisos/roles desconocidos, duplicados o hostiles; `POST /api/v1/access/branch` exige `branch.select` y el primer slice de zonas consume `tables.manage`. La E2E remota confirmó manager 201, viewer 403, false pair 403 y revocación efectiva con el mismo token; queda en REVIEW pendiente de aprobación humana.
- [ ] **TODO · P0** — Configurar infraestructura definitiva PostgreSQL/Supabase, Redis/jobs y Realtime. Nota: desbloqueado; PostgreSQL/Auth pertenecen a Supabase y jobs a NestJS, pero ADR-010 no eligió cola ni transporte Realtime. Toda opción debe conservar recuperación durable por cursor.
- [ ] **REVIEW · P0** — Configurar login y contexto de sucursal de `apps/web`. Nota: FE-0/FE-0.1 integra Next.js App Router/Tailwind v4, `/login`, `/app`, Auth SSR server-only, directorio Nest autoritativo, selector Restaurant/Branch revalidado, preferencia no autoritativa, recuperación de foco y bloqueo por revocación. El smoke protegido remoto autorizado terminó `ok` el 2026-09-01 con 119 checks, selección exacta `manager/waiter`, recarga estable, revocación visible con token vivo, consola limpia y cleanup de todas las filas y dos usuarios. El logout ahora es local al dispositivo y los Server Actions rechazados atraviesan el proxy con la sesión ya limpiada, evitando errores de protocolo/afectar otras sesiones. API pasó lint, typecheck, 135 pruebas y build; web pasó lint, typecheck, 37 pruebas y build. Pasa a REVIEW pendiente de aprobación humana.
- [ ] **REVIEW · P0** — Configurar CI con lint, tests y build. Nota: workflow neutral reproducible implementado; el 2026-08-29 se corrigió el orden limpio de Turbo para que typecheck/test construyan primero las dependencias publicadas y se verificó sin `dist`, caché ni `tsbuildinfo` previos. Pendiente de revisión humana y ejecución del cambio en GitHub.
- [ ] **REVIEW · P0** — Añadir E2E definitivas de autenticación y selección de restaurante/sucursal. Nota: con autorización expresa de Emmanuel, el runner dirigido expuso persistentemente solo `app` en Data API mediante GET/PATCH exactos; el postcheck confirmó `public,graphql_public,app`, sin `app_private`, `app_rls`, `config push` ni cambios Auth. La matriz remota 2×2 completó 97 checks base y 119 con zonas: Auth, RLS/Data API, lookup privado, directorio, selección Nest, permiso de acción, revocación, deshabilitación, idempotencia y constraints. El cleanup y un segundo postcheck idempotente confirmaron cero filas/usuarios temporales. Pasa a REVIEW.

## Fase 1 — POS core online

- [x] **DONE · P1** — Implementar mesas, zonas y editor de layout web. Nota: la E2E final autorizada (`runId=19489012-145d-4b2e-94e0-6c209f2e617b`) terminó con 151 checks, `diningTablesVerified=true`, `diningZonesVerified=true`, `fixtureRowsRemoved=true` y `fixtureUsersRemoved=2`. El smoke protegido corregido (`runId=db4ce441-a375-4076-be04-e8a358949266`) verificó el editor poblado, sus controles y la revocación en desktop y 390×844, sin errores/warnings de consola y con `/login`/`/app` en 200; también limpió todas las filas y dos usuarios. El postcheck final confirmó catálogo post-mesas íntegro, `app_api` runtime y cero sesiones. Pipeline global, `git diff --check` y CodeGraph verdes. Emmanuel aprobó P1 como DONE el 2026-09-02.
- [x] **DONE · P1** — Implementar menú: categorías, productos, modificadores y reglas de selección. Nota: el corte end-to-end incluye contratos runtime versionados, releases normalizados e inmutables con head atómico/auditoría idempotente, GET/PUT Nest con `catalog.read`/`catalog.manage` y editor web protegido para categorías, productos, precios, impuestos y modificadores. `20260902000100` quedó aplicada persistentemente con autorización expresa. La sexta E2E (`runId=cdcbac4a-400c-42e4-837a-a703baba55f0`) pasó 141 checks con `menuCatalogVerified=true` y cleanup completo. El smoke protegido (`runId=0347895d-f216-492b-8cae-d41c728b78ab`) verificó el editor poblado y la revocación en desktop y 390×844, sin errores de consola/red y con cleanup total. El postcheck final confirmó catálogo íntegro, `app_api` runtime y cero sesiones. Emmanuel aprobó el slice el 2026-09-02. Disponibilidad por sucursal/horario, precios por canal, combos y recetas permanecen fuera de este slice según el plan.
- [ ] **REVIEW · P1** — Implementar órdenes y máquina de estados de `OrderItem` en `packages/domain`. Nota: agregado y estados puros implementados y auditados; faltan la persistencia/API/KDS de Fase 1 y verificar en servidor que `tableId` pertenece a la sucursal y que los pagos autorizan los estados de liquidación.
- [ ] **REVIEW · P1** — Implementar auditoría de operaciones de orden y autorizaciones sensibles. Nota: el slice neutral de `packages/domain` obliga a que crear/modificar una Order devuelva agregado + evento inmutable versionado; scope, entidad, operación y estados se derivan del dominio. Toda cancelación conserva motivo, actor, dispositivo, origen, `eventId` e idempotency key; después de KDS exige autorización de supervisor. Las fronteras rechazan contextos/órdenes rehidratadas hostiles y ninguna línea cancelada puede omitir evidencia. Cien pruebas de dominio y el pipeline global pasaron el 2026-08-29. La futura persistencia deberá comprobar RBAC, agregar `receivedAt`, aplicar unicidad y guardar agregado + evento atómicamente; no se implementaron Auth, DB, API ni UI. Pendiente revisión humana.
- [ ] **REVIEW · P1** — Implementar gateway WebSocket para estados en tiempo real. Nota: ADR-011 fue aprobado y el corte incluye contratos compartidos, persistencia atómica de Order/auditoría/eventos KDS, recuperación REST por cursor y gateway Socket.IO autenticado, filtrado por Restaurant/Branch/estación, reautorización antes de cada entrega y cero mutaciones por socket. `20260902000200` está aplicada persistentemente. La E2E única autorizada (`runId=e3e3cfca-2ed1-4743-b51a-33c526642509`) terminó `status=ok` con 150 checks, `ordersRealtimeVerified=true`, `menuCatalogVerified=true`, `fixtureRowsRemoved=true` y `fixtureUsersRemoved=2`; cubrió idempotencia, RBAC/tenancy, notificación Socket.IO, recuperación durable paginada, aislamiento por estación y revocación. El postcheck final confirmó catálogo íntegro, `app_api` runtime y cero sesiones. Pasa a REVIEW pendiente de aprobación humana.
- [x] **DONE · P1** — Crear KDS mínimo por estación, con tickets y acción “listo”. Nota: el corte incluye contratos fail-closed, read model PostgreSQL autorizado con snapshot y versión optimista, `GET /api/v1/kds/tickets`, cliente React por estación, recuperación durable por cursor, actualización Socket.IO y acciones `sent → preparing → ready` sin cola offline. `20260903000100` está aplicada persistentemente y el postcheck confirma 13 migraciones exactas, catálogo post-KDS íntegro, `app_api` runtime, cero sesiones y lint SQL limpio. La E2E final (`runId=f63ca754-f1e4-4bb3-b574-ecd88e4fc45a`) pasó 150 checks con tickets/Orders/Realtime verificados, aislamiento, cursor, revocación y cleanup de todas las filas y dos usuarios. El navegador comprobó `sent`, `ready`, entrega y revocación a 1280×720 y 390×844 sin errores de consola; durante el run se corrigió un overflow móvil del selector y se revalidó sin repetir fixtures. API pasa lint, typecheck, build y 194 pruebas; KDS pasa lint, typecheck, build y 9 pruebas. Emmanuel aprobó el corte como DONE el 2026-09-03.
- [x] **DONE · P1** — Implementar caja y pagos simples: apertura, efectivo, tarjeta manual y cierre. Nota: el corte server-side/API incluye contratos v1 fail-closed, evidencia segura de `card_manual`, endpoints Nest, persistencia privada atómica propuesta en `20260903000200`, auditoría, replay previo a versiones, secuencia autoritativa, saldo recalculado desde snapshots y movimiento `cash_sale` solo para efectivo. Lint, typecheck, builds, 101 pruebas de dominio, 203 de API y las suites de contratos/web/KDS están verdes por ejecución directa; CodeGraph quedó actualizado. La verificación PostgreSQL rollback-only autorizada terminó `status=ok` con 5 políticas, 23 tablas RLS+FORCE RLS y 21 funciones `SECURITY DEFINER`; no aplicó la migración ni dejó estado persistente. Emmanuel aprobó el corte como DONE el 2026-09-03. No incluye UI/cortes X-Z, impuestos/CFDI, moneda predeterminada, refunds ni proveedor integrado.
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
