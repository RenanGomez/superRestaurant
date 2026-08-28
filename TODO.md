# TODO

Última actualización: 2026-08-28

Fuente principal: `PLAN_MODERNIZACION_POS_RESTAURANTE.md`.

Estados permitidos: `TODO`, `IN_PROGRESS`, `REVIEW`, `DONE`, `BLOCKED`, `CANCELLED`.

## P0 — Preparación y decisiones

- [ ] **REVIEW · P0** — Crear `TODO.md`, `PROJECT_NOTES.md` y `HANDOFF.md` a partir de `AGENTS.md` y del plan maestro. Nota: archivos creados el 2026-08-25; pendientes de revisión humana.
- [ ] **REVIEW · P0** — Alinear `AGENTS.md` con este proyecto POS. Nota: el 2026-08-25 se reemplazó el contexto ATS por reglas específicas de arquitectura, dinero, tenancy, offline, seguridad, pruebas y Git; pendiente de revisión humana.
- [ ] **REVIEW · P0** — Robustecer `PLAN_MODERNIZACION_POS_RESTAURANTE.md`. Nota: versión 2.2 lista para implementar Fase 0; ADR-010 tiene timebox, hard stop, gates/GO-NO-GO y packages/domain puede avanzar en paralelo.
- [ ] **TODO · P0** — Confirmar el alcance del v1 vendible: recomendación inicial, Fases 0–3; decidir expresamente si mobile y offline son requisitos de salida o una segunda entrega.
- [ ] **TODO · P0** — Confirmar mercado objetivo, moneda, zona horaria, reglas fiscales y si CFDI México forma parte del producto.
- [ ] **BLOCKED · P0** — Confirmar modelo comercial/licencia del producto antes de reutilizar código. Nota: auditoría Git del 2026-08-28 confirmó que `origin/main@293a1551` y `origin/master@f87d5b25` no incluyen licencia/NOTICE/COPYING/README ni campo `license` para el código propio. No copiar el prototipo; siguiente acción mínima: autorización/licencia escrita del titular y decisión humana del modelo comercial.
- [ ] **BLOCKED · P0** — Registrar la arquitectura inicial definitiva. Nota: ADR-001 queda bloqueada hasta ejecutar y resolver el spike de ADR-010; se compararán stack propio, híbrido Supabase+NestJS y Data API restringida.
- [ ] **IN_PROGRESS · P0** — Ejecutar el spike de ADR-010 en 4 días hábiles, hard stop al quinto, usando gates comunes, scoring ≥75/100 y GO/NO-GO por opción. Nota: el proyecto aislado `ndblkcmdgpxsxylacutx` recibió exactamente cinco migraciones, expone solo `adr010_b`, pasó auditoría estructural 27/27, `db lint`, probe Auth/RLS 2×2 y 15 evidencias remotas B con cierre limpio. La frontera server-only ya cubre Order, Payment, Refund y CashMovement; Auth demostró rotación/revocación. La CA oficial descargada permitió repetir el runner completo mediante TLS `verify-full` con certificado y hostname autorizados. B conserva `eligibleForAdr010Go: false`: el runner fail-closed para migración desde proyecto/CI fresco está listo pero necesita un segundo proyecto vacío autorizado y falta la inspección humana. El backup/restore lógico exigido por el gate 8 ya pasó; la recuperación física de desastre queda como evidencia operativa previa a producción, no como gate del spike. A permanece NO-GO con Auth de prueba y C limitada a lecturas.
- [ ] **REVIEW · P0** — Especificar invariantes monetarias: tipo decimal, moneda, redondeo, impuestos incluidos/excluidos, propinas, descuentos y snapshots históricos de precio/impuesto. Nota: validaciones runtime de redondeo/`TaxSnapshot.rate` y propiedades deterministas contra oráculo bigint/permutaciones quedaron verdes el 2026-08-28; las decisiones de país/moneda/tasas/propina/CFDI siguen pendientes del humano.
- [ ] **REVIEW · P0** — Diseñar el contrato offline/sync antes de la Fase 3: idempotencia, orden causal, deduplicación, conflictos, reloj de dispositivos, borrados y pagos. Nota: ADR-004, contrato de protocolo y matriz de capacidades/conflictos documentados y auditados el 2026-08-26. La especificación no implementa todavía motor de sync, almacenamiento local ni operación offline; pendiente revisión humana.

## Fase 0 — Fundaciones

- [ ] **REVIEW · P0** — Inicializar Git y enlazar el remoto. Nota: origin HTTPS configurado y fetch de main/master verificado el 2026-08-25; no hubo merge ni push y la autenticación de escritura no se ha verificado.
- [ ] **BLOCKED · P0** — Definir la estrategia para el prototipo remoto y sus 10,427 rutas de `node_modules` versionadas. Nota: requiere decisión humana entre preservar rama/tag legado y crear rama limpia; no mezclar automáticamente.
- [ ] **REVIEW · P0** — Crear un `.gitignore` para `node_modules`, secretos, builds, cobertura, caches y CodeGraph antes del primer commit nuevo. Nota: implementado y verificado el 2026-08-25; pendiente de revisión humana.
- [ ] **REVIEW · P0** — Inicializar monorepo con Turborepo y pnpm. Nota: configuración raíz y lockfile reproducible implementados y verificados el 2026-08-25; pendiente de revisión humana.
- [ ] **REVIEW · P0** — Versionar el plan maestro en `docs/PLAN_MODERNIZACION_POS_RESTAURANTE.md` y documentar en README la decisión greenfield/API-first. Nota: copia byte a byte y README greenfield/API-first verificados el 2026-08-25; pendiente de revisión humana.
- [ ] **REVIEW · P0** — Crear en paralelo `packages/domain`, `packages/shared-types` y configuración neutral; implementar Money, Order/OrderItem e invariantes sin framework/ORM/red. Nota: agregado puro `Order` implementado y auditado el 2026-08-28 con canal/mesa, scope explícito por línea, snapshots, cancelación total auditada, totales compartidos y rechazo de accessors/prototipos hostiles; el cierre ahora exige que cada ítem esté entregado o cancelado y las fronteras de estados runtime producen errores de dominio. Pendiente revisión humana.
- [ ] **REVIEW · P0** — Implementar reglas puras de modificadores de menú. Nota: grupos versionados y aislados por restaurante con mínimo/máximo por suma de cantidades, allowlist activa por producto, caps opcionales, duplicados rechazados, moneda/precio exactos y snapshots canónicos; 9 pruebas unitarias incluyen rechazo de catálogo del mismo producto perteneciente a otro restaurante. Verificado el 2026-08-28, pendiente de revisión humana.
- [ ] **REVIEW · P0** — Implementar invariantes puras de pagos y caja. Nota: el 2026-08-28 se cerró la validación fail-closed de `Payment`/refunds y `CashRegister`, incluidos agregados hostiles, compensaciones, saldos rehidratados y 48 particiones generativas; creación/transición/refund usan `eventId` + `idempotencyKey`, evidencia ligada a Branch, replay determinista y conflicto por payload divergente. La rehidratación de cierre con diferencia exige conservar el motivo. Pendiente revisión humana.
- [ ] **BLOCKED · P0** — Configurar Auth y acceso definitivo de `apps/api`. Nota: bloqueado hasta GO/NO-GO de ADR-010.
- [ ] **BLOCKED · P0** — Definir esquema/migraciones definitivas de persistencia. Nota: bloqueado hasta seleccionar una sola autoridad en ADR-010.
- [ ] **BLOCKED · P0** — Configurar infraestructura definitiva PostgreSQL/Supabase, Redis/jobs y Realtime. Nota: bloqueado hasta ADR-010.
- [ ] **BLOCKED · P0** — Configurar login funcional de `apps/web`. Nota: el shell neutral puede crearse; integración Auth espera ADR-010.
- [ ] **REVIEW · P0** — Configurar CI con lint, tests y build. Nota: workflow neutral reproducible implementado y validado localmente el 2026-08-25; pendiente de revisión humana y primera ejecución en GitHub.
- [ ] **BLOCKED · P0** — Añadir E2E definitivas de autenticación y selección de restaurante/sucursal. Nota: el harness del spike las precede; suite final espera ADR-010.

## Fase 1 — POS core online

- [ ] **TODO · P1** — Implementar mesas, zonas y editor de layout web.
- [ ] **TODO · P1** — Implementar menú: categorías, productos, modificadores y reglas de selección.
- [ ] **REVIEW · P1** — Implementar órdenes y máquina de estados de `OrderItem` en `packages/domain`. Nota: agregado y estados puros implementados y auditados; faltan la persistencia/API/KDS de Fase 1 y verificar en servidor que `tableId` pertenece a la sucursal y que los pagos autorizan los estados de liquidación.
- [ ] **TODO · P1** — Implementar auditoría de operaciones de orden y autorizaciones sensibles.
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
