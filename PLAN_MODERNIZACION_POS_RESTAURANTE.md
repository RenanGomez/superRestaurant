# Plan Maestro v2.3: superRestaurant

Sistema POS para restaurantes — Web, Mobile, KDS y Offline-First

**Versión:** 2.3

**Fecha de revisión:** 2026-08-29

**Estado:** IN_IMPLEMENTATION; ADR-010 aceptó la opción B híbrida y las decisiones comerciales abiertas bloquean solo sus módulos

**Repositorio remoto:** https://github.com/RenanGomez/superRestaurant.git

---

## 0. Propósito y autoridad del documento

Este documento registra el plan inicial completo del proyecto: alcance, decisiones arquitectónicas, invariantes de dominio, seguridad, sincronización, modelo de datos, estrategia de calidad, roadmap y criterios de salida.

Orden de autoridad:

1. instrucciones humanas explícitas;
2. TODO.md;
3. este plan;
4. PROJECT_NOTES.md;
5. ADRs y contratos aprobados;
6. patrones existentes confirmados mediante CodeGraph.

El checklist operativo vive en TODO.md. Este documento explica **qué se construye, por qué, bajo qué restricciones y cómo se considera aceptado**.

---

## 1. Plan de corrección del documento original

La primera versión contenía una buena visión funcional, pero mezclaba alternativas, aplazaba controles críticos y tenía contradicciones sobre offline. Esta revisión establece el siguiente programa de corrección:

### 1.1 Correcciones integradas en esta versión

- [x] Establecer una base greenfield TypeScript y una puerta ADR-010 para decidir stack propio, híbrido o acceso Supabase restringido.
- [x] Definir un piloto online y un v1 offline sin afirmar que Fase 1 ya funciona sin red.
- [x] Separar offline por dispositivo de operación LAN entre varios dispositivos.
- [x] Sustituir “timestamp + version como vector” por un contrato causal e idempotente de sync.
- [x] Tratar pagos como operaciones financieras inmutables, no como eventos mergeables genéricos.
- [x] Añadir invariantes de dinero, impuestos, descuentos, snapshots y redondeo.
- [x] Añadir aislamiento por restaurante/sucursal desde la fundación.
- [x] Mover seguridad, auditoría, backups y observabilidad a Fase 0–1.
- [x] Añadir criterios de aceptación y puertas de salida por fase.
- [x] Registrar el estado real del repositorio remoto y una estrategia segura para el prototipo legado.
- [x] Añadir Definition of Done, riesgos, ADRs y decisiones humanas pendientes.
- [x] Limitar ADR-010 a 4 días hábiles, con quinto día como hard stop.
- [x] Definir gates comunes y criterios GO/NO-GO por opción.
- [x] Permitir que packages/domain avance en paralelo al spike.

### 1.2 Trabajo documental todavía pendiente

- [ ] Ratificar alcance comercial del v1.
- [ ] Confirmar país, moneda inicial, impuestos y si CFDI México entra en la salida.
- [ ] Confirmar licencia/modelo comercial del producto.
- [ ] Seleccionar hardware de piloto.
- [x] Resolver la estrategia Git del prototipo remoto mediante ADR-006.
- [x] Ejecutar el spike y resolver ADR-010 antes de implementar Auth, acceso a datos o Realtime definitivos.
- [ ] Prototipar y elegir almacenamiento/sync local mediante ADR-005.
- [ ] Convertir decisiones aceptadas en ADRs versionadas bajo docs/adr.

Ninguna decisión pendiente debe permanecer implícita dentro del código.

---

## 2. Visión del producto

Construir un POS de restaurante production-ready que cubra el ciclo:

**mesas/canales → comanda → cocina/KDS → entrega → cuenta → cobro → corte → inventario → reportes → administración**

Clientes previstos:

1. **Web Backoffice/POS:** configuración, operación de caja, mesas, cobro y reportes.
2. **Mobile:** toma de comandas y operación de mesero en iOS/Android.
3. **KDS:** tickets por estación y control de preparación.
4. **API:** fuente de reglas, autorización, persistencia, realtime, jobs e integraciones.

Principios:

- API-first;
- modular, sin microservicios prematuros;
- dominio financiero probado y compartido;
- seguridad y aislamiento desde el inicio;
- online-first para validar el negocio, offline en una fase dedicada;
- auditoría antes que mutación destructiva;
- adaptadores para hardware y terceros;
- entregas end-to-end pequeñas.

---

## 3. Alcance de entregas

### 3.1 Piloto operativo v0.1

Incluye Fases 0 y 1:

- un restaurante y al menos una sucursal;
- usuarios, roles y turnos;
- menú, modificadores, mesas y canales mostrador/para llevar;
- orden, KDS, cobro simple, ticket y corte;
- web POS y KDS online;
- auditoría y reportes operativos mínimos;
- sin garantía offline;
- sin CFDI, delivery externo, lealtad ni inventario avanzado.

Objetivo: validar el flujo completo real antes de añadir sincronización.

### 3.2 v1 vendible propuesta

Incluye Fases 0–3:

- todo el piloto;
- mobile para meseros;
- operación offline por dispositivo en web POS y mobile;
- efectivo y ticket offline;
- reintentos y resolución determinista de conflictos;
- visibilidad de pendientes de sincronización;
- recuperación después de cierre/reinicio;
- criterios de seguridad, respaldo y observabilidad para producción.

**Alcance explícito de tarjeta:** el piloto y el v1 pueden registrar un método `card_manual` cuando el cobro fue procesado fuera del sistema por una terminal independiente. Este registro no autoriza, captura ni reembolsa la tarjeta: conserva monto, moneda, cajero, caja, timestamp, proveedor/terminal configurado y referencia o código de autorización cuando exista. Nunca almacena PAN ni CVV. Se incluye en conciliación y corte como método separado y toda corrección usa un movimiento compensatorio auditado.

La integración que inicia cobros desde el POS, consulta su estado, recibe webhooks o ejecuta refunds sigue fuera del v1 y se implementa formalmente en Fase 5 mediante `PaymentProvider`. El efectivo sí funciona online/offline; `card_manual` solo puede registrarse offline si la terminal externa confirmó el cobro por su propio canal y el operador asume una conciliación posterior.

La comunicación KDS multi-dispositivo durante una caída total de internet **no forma parte automática del v1**. Requiere servidor local/relay LAN y ADR separada.

### 3.3 Fuera del v1 salvo decisión humana

- inventario y compras avanzadas;
- CFDI/PAC;
- integración directa con terminal/pasarela;
- delivery apps;
- CRM/lealtad avanzada;
- reservaciones online;
- nómina/RH completo;
- Kubernetes;
- servidor local de sucursal.

---

## 4. Actores y journeys críticos

### 4.1 Actores

- propietario/admin;
- gerente de restaurante/sucursal;
- cajero;
- mesero;
- cocina/bar/postres;
- supervisor autorizador;
- soporte técnico;
- cliente final registrado o anónimo.

### 4.2 Journeys que definen el producto

1. Abrir turno y caja.
2. Abrir mesa u orden por canal.
3. Añadir productos, modificadores y notas.
4. Enviar ítems a su estación.
5. Preparar, marcar listo y entregar.
6. Aplicar descuento/cortesía con autorización.
7. Dividir o consolidar cuenta según alcance de fase.
8. Registrar pago sin duplicados.
9. Imprimir ticket y cerrar orden.
10. Cerrar caja y obtener corte.
11. Continuar operaciones permitidas durante pérdida de red.
12. Reconectar sin perder ni duplicar operaciones.

Todo roadmap debe demostrar estos journeys progresivamente.

---

## 5. Decisiones arquitectónicas iniciales

### 5.1 Arquitectura objetivo aceptada

ADR-010 seleccionó la **alternativa B híbrida** y ADR-001 fija sus límites. Las elecciones no demostradas por el spike permanecen explícitamente pendientes y no se infieren de la alternativa A histórica.

| Capa | Decisión |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Lenguaje | TypeScript en API, web, mobile, KDS y paquetes compartidos |
| API | NestJS, REST versionado y OpenAPI |
| Auth | Supabase Auth; NestJS valida identidad y alcance en operaciones de servidor |
| Datos | Supabase PostgreSQL como autoridad canónica; migraciones SQL versionadas de Supabase como única autoridad de schema |
| ORM | Pendiente; no puede introducir una segunda historia de migraciones ni sustituir el dominio |
| Cache/jobs | Responsabilidad de NestJS; tecnología de cola pendiente |
| Realtime | Transporte pendiente; solo notifica y exige recuperación durable por lectura/cursor |
| Storage | Supabase Storage cuando el módulo defina buckets, políticas y datos permitidos |
| Web | Next.js para backoffice/POS y evolución a PWA |
| Mobile | Expo + React Native |
| KDS | React ligero, compartiendo dominio/contratos cuando corresponda |
| Validación | DTOs de API y esquemas compartidos versionados |
| Infra inicial | Topología local y despliegue pendientes de diseño operativo |
| CI | lint + typecheck + tests + build + migración limpia |

Las versiones exactas se fijarán en Fase 0 usando versiones mantenidas y compatibles, sin rangos abiertos en lockfiles.

NestJS es la única frontera de aplicación para escrituras críticas. Los clientes pueden usar Supabase Auth y lecturas explícitamente permitidas por grants/RLS; no pueden escribir Order, Payment, Refund o CashMovement mediante Data API/RPC ni recibir secretos de servidor.

### 5.2 Monorepo objetivo

~~~
apps/
  api/
  web/
  mobile/
  kds/
packages/
  domain/
  shared-types/
  sync-engine/
  ui/
  printing/
  config/        # eslint/tsconfig/prettier compartidos + esquema de variables de entorno validado (no secretos)
prisma/
docs/
  adr/
  runbooks/
  api/
~~~

### 5.3 Límites de arquitectura

- packages/domain contiene reglas puras: dinero, impuestos, modificadores, órdenes, pagos, caja e inventario.
- packages/domain no importa NestJS, React, Prisma, red ni SDKs.
- apps/api implementa persistencia, autorización, transacciones, idempotencia e integraciones.
- web/mobile/KDS consumen contratos y dominio; el servidor siempre revalida.
- ADR-010 eligió Supabase con NestJS como única frontera crítica; toda lectura o CRUD no financiero directo requiere allowlist y no se permiten dos caminos de escritura con reglas distintas;
- RLS será defensa en profundidad, no sustituto de las invariantes transaccionales de dinero, pagos, caja y órdenes;
- pagos, PAC, almacenamiento, impresión, email y push se implementan con puertos/adaptadores.
- empezar con monolito modular; separar servicios solo por evidencia de escala o aislamiento.

### 5.4 Contratos API

- prefijo inicial /api/v1;
- OpenAPI generado y validado en CI;
- errores con formato consistente y correlationId;
- paginación y filtros explícitos;
- Idempotency-Key obligatorio en operaciones sensibles;
- optimistic concurrency mediante versión/ETag cuando aplique;
- webhooks firmados, versionados y resistentes a replay;
- eventos realtime incluyen identificadores y versión, y el cliente puede refetch;
- contratos incompatibles requieren nueva versión o migración coordinada.

---

## 6. Tenancy, identidad y autorización

### 6.1 Fronteras

- Restaurant es la frontera principal de aislamiento.
- Branch delimita inventario, caja, estaciones, mesas, turnos y operación local.
- Un usuario puede tener membresías y roles diferentes por Restaurant/Branch.

### 6.2 Reglas

- toda entidad de negocio lleva restaurantId y, cuando aplique, branchId;
- ninguna consulta confía en un restaurantId enviado sin contrastarlo con la sesión;
- restricciones únicas e índices incluyen el alcance correcto;
- toda mutación revalida rol y sucursal;
- permisos no se resuelven solo en UI;
- acciones de supervisor registran autorizador, actor, motivo y contexto;
- pruebas automáticas intentan acceso cruzado entre restaurantes y sucursales.

### 6.3 Roles iniciales

- owner/admin;
- manager;
- supervisor;
- cashier;
- waiter;
- kitchen;
- viewer/auditor.

Los permisos precisos se definirán en una matriz versionada durante Fase 0.

---

## 7. Invariantes de dominio

### 7.1 Dinero

- Money = amountMinor entero + currency ISO 4217.
- No usar float para importes.
- Porcentaje/impuesto usa precisión exacta definida en dominio.
- Cada restaurante define moneda y zona horaria IANA; una orden congela ambas.
- El redondeo se centraliza y se prueba con casos límite.
- Totales se calculan desde líneas y snapshots, no se aceptan como verdad del cliente.

Orden de cálculo inicial propuesto:

1. precio base y modificadores;
2. cantidad;
3. descuentos de línea;
4. impuestos de línea;
5. descuentos de orden según reglas;
6. propina;
7. total pagadero.

La regla fiscal definitiva depende del país y se documentará en ADR-007.

### 7.2 Snapshots históricos

OrderItem conserva:

- nombre/SKU;
- precio unitario;
- modificadores y sus precios;
- tasa/tipo de impuesto;
- descuentos;
- estación;
- unidad/cantidad;
- versión de catálogo relevante.

Cambiar el menú no altera una venta histórica.

### 7.3 Orden e ítems

Estados iniciales de Order:

- draft;
- open;
- partially_paid;
- paid;
- closed;
- cancelled.

Estados iniciales de OrderItem:

- pending;
- sent;
- preparing;
- ready;
- delivered;
- cancelled.

Transiciones:

- son funciones explícitas de dominio;
- no pueden regresar arbitrariamente;
- una transición inválida falla sin efectos parciales;
- cancelación después de sent/preparing requiere autorización y motivo;
- orden pagada/cerrada no acepta nuevas líneas salvo reapertura autorizada;
- correcciones financieras usan operaciones compensatorias.

### 7.4 Pagos y caja

Payment es inmutable y usa estados:

- initiated;
- authorized;
- captured;
- failed;
- voided;
- refunded.

Reglas:

- idempotency key única por intento lógico;
- un reintento no crea otro cobro;
- un refund referencia el pago original;
- efectivo offline se registra con dispositivo, caja, cajero y secuencia;
- tarjeta offline solo si el proveedor/terminal ofrece un contrato verificable;
- no almacenar PAN/CVV;
- cierre de caja no borra diferencias; las registra y audita;
- movimientos de caja son inmutables y compensables.

### 7.5 Inventario

- movimientos inmutables por almacén;
- unidades de medida y conversiones explícitas;
- venta, cancelación y reembolso generan movimientos ligados;
- recepciones, mermas, ajustes y transferencias requieren actor/motivo;
- costo y margen se calculan desde snapshots reproducibles.

---

## 8. Módulos funcionales

### 8.1 Configuración

- restaurantes, sucursales, zonas horarias y moneda;
- usuarios, membresías, roles y permisos;
- estaciones de producción;
- dispositivos, cajas, impresoras y parámetros.

### 8.2 Mesas y canales

- zonas y layout;
- estados libre/ocupada/reservada/cuenta;
- combinación/traspaso con auditoría;
- canales table, counter, takeaway, delivery;
- una orden no requiere mesa para canales no presenciales.

### 8.3 Menú

- categorías y productos;
- modificadores con mínimo/máximo y costo;
- disponibilidad por sucursal/horario;
- impuestos;
- combos;
- recetas;
- precios por canal;
- alérgenos/fotos opcionales.

### 8.4 Órdenes y KDS

- enrutamiento por estación;
- notas;
- estados de ítem;
- temporizadores;
- reconexión online;
- auditoría completa;
- reimpresión controlada;
- métricas de preparación.

### 8.5 Caja/pagos

- apertura y cierre;
- movimientos;
- efectivo y métodos manuales;
- pagos mixtos;
- propinas;
- cancelaciones/reembolsos;
- cortes X/Z.

### 8.6 Inventario/compras

- insumos, productos vendibles y recetas;
- almacenes;
- movimientos, conteos, mermas y transferencias;
- proveedores, órdenes y recepción;
- costeo y alertas.

### 8.7 Clientes/reportes/personal

- clientes e historial;
- ventas, márgenes, ocupación y tiempos;
- empleados, turnos, asistencia y comisiones;
- exportación con permisos.

### 8.8 Integraciones futuras

- PAC/CFDI;
- pasarela/terminal;
- delivery;
- notificaciones;
- almacenamiento;
- reservas/lealtad.

---

## 9. Especificación offline y sincronización

### 9.1 Topología por fases

```
Fases 0-2 (online-first)          Fase 3 (offline por dispositivo)         Fase 3B (opcional, con ADR)
┌────────┐                        ┌────────┐        outbox                ┌────────┐   LAN relay
│ Web/   │──── API/WS ────┐       │ Web/   │◄──local DB──┐                │ Web/   │◄──┐
│ Mobile │                │       │ Mobile │             │ sync push/pull │ Mobile │   │
└────────┘                ▼       └────────┘             ▼                └────────┘   │
                    ┌─────────────┐                ┌─────────────┐            ┌─────────────┐
                    │ API (única  │                │ API (única  │            │ Servidor    │
                    │ fuente de   │                │ fuente de   │            │ local (NUC) │
                    │ verdad)     │                │ verdad)     │◄──────────►│ autoritativo│
                    └─────────────┘                └─────────────┘  reconcil. │ en partición│
                                                                               └─────────────┘
```

- Fases 0–2: nube/API autoritativa; clientes online-first, sin base local persistente de operación.
- Fase 3: nube autoritativa + réplicas locales por dispositivo con outbox; cada dispositivo sincroniza de forma independiente, **no hay comunicación directa entre dispositivos**.
- Fase 3B opcional: servidor de sucursal autoritativo durante partición total de internet, permitiendo que dispositivos en la misma LAN se coordinen entre sí (ej. mesero → cocina) sin salir a la nube; requiere ADR de promoción/failover y reconciliación posterior. Fuera del v1 por defecto (Sección 3.3).

No mezclar estas topologías: un mismo dispositivo no debe operar simultáneamente asumiendo dos modelos distintos de autoridad de datos.

### 9.2 Matriz de capacidades objetivo de Fase 3

| Operación | Web POS | Mobile | KDS | Requiere red |
|---|---:|---:|---:|---:|
| Consultar menú cacheado | Sí | Sí | N/A | No |
| Abrir/modificar orden local | Sí | Sí | N/A | No |
| Registrar efectivo y ticket | Sí | Según hardware | N/A | No |
| Tarjeta por pasarela web | No | No | N/A | Sí |
| CFDI/timbrado | No | No | N/A | Sí |
| Ver tickets ya recibidos | N/A | N/A | Sí | No |
| Recibir nuevas órdenes desde otro dispositivo sin WAN | No garantizado | No garantizado | No garantizado | Servidor LAN |
| Reporte consolidado multi-sucursal | No | No | No | Sí |

La UI debe explicar claramente toda operación bloqueada.

### 9.3 Envelope mínimo de evento

Cada mutación sincronizable incluye:

- eventId UUID/ULID;
- idempotencyKey;
- deviceId;
- actorId;
- restaurantId;
- branchId;
- entityType y entityId;
- operation;
- schemaVersion;
- localSequence monotónica por dispositivo;
- baseVersion esperada;
- occurredAt del cliente;
- receivedAt del servidor;
- payload;
- retryCount y estado local.

### 9.4 Protocolo

1. Mutación validada contra base local.
2. Escritura atómica del estado local y outbox.
3. Worker envía lote con backoff y jitter.
4. API autentica, revalida scope y deduplica.
5. API aplica dentro de transacción.
6. Servidor devuelve accepted/rejected/conflict y cursor.
7. Cliente confirma, conserva error recuperable o abre revisión.
8. Pull incremental usa cursor opaco versionado.

### 9.5 Reglas de conflicto

- eventos aditivos de líneas distintas pueden combinarse;
- el timestamp del cliente nunca decide solo;
- estados de ítems no retroceden;
- cancelar un ítem ya preparado requiere revisión/autorización;
- pagos y cierres nunca se fusionan por LWW;
- duplicados se eliminan por eventId/idempotencyKey;
- edición concurrente de catálogo usa versión esperada y rechaza stale writes;
- borrados usan tombstones;
- conflictos financieros ambiguos quedan visibles para resolución humana.

### 9.6 Pruebas obligatorias de sync

- reenvío del mismo lote;
- dos dispositivos agregan líneas;
- cancelar vs preparar;
- pago repetido;
- reloj adelantado/atrasado;
- cierre forzado antes/después de persistir outbox;
- migración de schema con cliente atrasado;
- pérdida de respuesta después de commit del servidor;
- fuga de evento entre sucursales;
- tombstone y recreación;
- cola grande y backoff.

---

## 10. Modelo de datos inicial

Entidades núcleo:

- Restaurant;
- Branch;
- User;
- Membership;
- Role/Permission;
- Device;
- Employee;
- Shift;
- Zone;
- DiningTable;
- ProductionStation;
- Category;
- Product;
- ModifierGroup;
- Modifier;
- ProductModifierGroup;
- RecipeItem;
- Warehouse;
- InventoryItem;
- InventoryMovement;
- Order;
- OrderItem;
- OrderItemModifier;
- OrderEvent;
- Payment;
- Refund;
- CashRegister;
- CashMovement;
- Customer;
- TaxDefinition;
- Discount;
- Authorization;
- AuditLog;
- SyncEvent/IdempotencyRecord;
- Supplier;
- PurchaseOrder/PurchaseOrderItem;
- Invoice.

Convenciones:

- IDs UUID/ULID;
- restaurantId obligatorio en datos tenant-scoped;
- branchId cuando la entidad es operativa;
- createdAt/updatedAt;
- deletedAt solo donde soft delete sea válido;
- version para optimistic concurrency;
- claves únicas compuestas por alcance;
- enums/versiones alineados con packages/domain;
- dinero con amountMinor + currency;
- timestamps guardados en UTC y mostrados en zona IANA de sucursal;
- auditoría no se elimina desde flujos normales.

El schema Prisma detallado se diseña en Fase 0 y no debe crearse como traducción mecánica de esta lista: cada relación exige invariantes, índices y pruebas.

---

## 11. Seguridad y privacidad

Desde Fase 0:

- access tokens cortos;
- refresh tokens rotatorios, hasheados y revocables;
- RBAC por Restaurant/Branch;
- validación de DTOs;
- rate limiting;
- CORS/CSRF según canal;
- headers seguros;
- secretos fuera del repositorio;
- logs sin credenciales/PII innecesaria;
- auditoría de login, permisos y acciones sensibles;
- cifrado TLS;
- cifrado/protección de almacenamiento local;
- webhooks firmados;
- escaneo de dependencias;
- backups protegidos;
- política de retención/exportación.

Pagos:

- minimizar alcance PCI;
- tokenización/proveedor;
- no almacenar PAN/CVV;
- conciliación e idempotencia.

Una fuga entre restaurantes, doble cobro o pérdida silenciosa de venta es severidad crítica y bloquea release.

---

## 12. Observabilidad, operación y recuperación

### 12.1 Telemetría

- logs estructurados;
- correlationId;
- restaurantId/branchId/orderId/deviceId cuando aplique;
- métricas de latencia/error;
- conexiones realtime;
- profundidad/fallos de colas;
- antigüedad/errores de sync;
- pagos/invoices pendientes;
- health y readiness.

### 12.2 Runbooks mínimos

- API o PostgreSQL caído;
- Redis/cola caída;
- WebSocket desconectado;
- sync atascado;
- pago incierto;
- impresora fuera de línea;
- restauración de backup;
- migración fallida;
- credencial comprometida.

### 12.3 Continuidad

Antes del piloto:

- backup automatizado;
- prueba de restauración;
- RPO/RTO acordados;
- migraciones reproducibles;
- rollback documentado;
- exportación de datos operativos.

Objetivos de rendimiento y disponibilidad se medirán con carga real del piloto y se formalizarán antes del lanzamiento.

---

## 13. Estrategia de calidad

### 13.1 Pirámide

- unit tests: dominio puro;
- integration tests: API + PostgreSQL + Redis;
- contract tests: pagos, PAC, push, impresión y webhooks;
- E2E: journeys operativos;
- browser/mobile QA: interacción, responsive, accesibilidad y errores;
- load tests: órdenes/KDS/sync;
- pruebas de recuperación: red, reinicio y fallos parciales.

### 13.2 CI obligatorio

- formato/lint;
- typecheck;
- unit/integration tests;
- build;
- Prisma validate;
- migración desde base vacía;
- verificación de contratos;
- secret/dependency scan básico.

### 13.3 Definition of Done

Una tarea:

- cumple criterios;
- está probada;
- pasa CI;
- no rompe dependencias;
- documenta migración/rollback si aplica;
- actualiza TODO/HANDOFF;
- no deja deuda crítica oculta.

Una fase:

- demuestra el flujo end-to-end;
- tiene migraciones reproducibles;
- cumple seguridad/aislamiento;
- tiene observabilidad y runbook;
- cierra o acepta explícitamente riesgos;
- recibe aprobación humana.

---

## 14. Roadmap con criterios de salida

### Fase 0 — Fundaciones

Trabajo:

- resolver estrategia Git y limpiar tracking de artefactos sin perder el prototipo;
- inicializar monorepo;
- ejecutar en paralelo el **Track A neutral**: packages/domain, shared-types/config, Money, máquinas de estados e invariantes con pruebas;
- ejecutar el **Track B de decisión**: spike comparativo de ADR-010, timebox de 4 días hábiles y hard stop al quinto;
- aceptar una arquitectura y configurar apps/api/apps/web con los componentes seleccionados;
- configurar persistencia, jobs y realtime según ADR-010;
- autenticación, sesiones y selección de Restaurant/Branch según la frontera aprobada;
- matriz RBAC;
- Docker Compose;
- CI;
- logs/health;
- backups de desarrollo y procedimiento de restauración;
- ADRs de stack, tenancy, dinero, v1 y Git.

Criterios de salida:

- instalación reproducible;
- lint/typecheck/test/build verdes;
- ADR-010 aceptada con evidencia, consecuencias y componentes elegidos;
- packages/domain conserva cero dependencias de framework/ORM/red y tiene pruebas de Money, Order y OrderItem;
- login + refresh/revocación;
- pruebas de aislamiento;
- migración desde cero;
- pruebas iniciales de Money y estados;
- secretos fuera de Git;
- documentación de ejecución local.

### Fase 1 — POS core online / piloto

Trabajo:

- mesas/canales;
- menú/modificadores;
- órdenes/estados/auditoría;
- WebSocket;
- KDS;
- caja, efectivo y registro `card_manual`;
- ticket;
- corte X/Z;
- flujo E2E.

Criterios de salida:

- journey mesa → comanda → KDS → pago → cierre;
- snapshots conservan totales históricos;
- reintentos no duplican;
- estados inválidos/doble cobro bloqueados;
- `card_manual` conciliado por separado, sin simular una integración con terminal;
- KDS aislado por sucursal/estación;
- acciones sensibles auditadas;
- piloto online operable.

### Fase 2 — Mobile online

Trabajo:

- Expo;
- login/sucursal/turno;
- mesas/comandas;
- push de listo;
- impresión Bluetooth según hardware elegido;
- paridad de dominio.

Criterios de salida:

- Android/iOS objetivo completan el flujo;
- permisos correctos;
- mismos cálculos que web/API;
- push correcto;
- impresión verificada en hardware o excluida explícitamente.

### Fase 3 — Offline-first por dispositivo

Trabajo:

- ADR de almacenamiento local;
- packages/sync-engine;
- base local web/mobile;
- outbox;
- /sync push/pull;
- idempotencia y conflictos;
- UI de conexión/pendientes;
- efectivo/ticket offline;
- pruebas de partición y recuperación.

Criterios de salida:

- matriz offline demostrada;
- reinicio no pierde operaciones;
- reenvío no duplica;
- conflictos deterministas;
- pagos ambiguos no se auto-fusionan;
- permisos revalidados;
- clientes atrasados migran;
- cola observable y recuperable.

### Fase 3B — Servidor local opcional

Solo después de ADR:

- topología LAN;
- discovery/configuración;
- autoridad durante partición;
- promoción/failover;
- reconciliación cloud;
- backup local;
- pruebas de split-brain.

No forma parte automática del v1.

### Fase 4 — Inventario y compras

Trabajo:

- insumos/almacenes;
- recetas;
- movimientos;
- conteos/mermas/transferencias;
- proveedores/órdenes/recepción;
- costeo/alertas.

Criterios de salida:

- movimientos inmutables;
- venta/cancelación no duplican descuento;
- existencias balancean;
- costo reproducible;
- trazabilidad por actor/motivo.

### Fase 5 — Fiscal y pagos avanzados

Trabajo:

- PAC/CFDI si aplica;
- pending_invoice y reintentos;
- proveedor de pago/terminal;
- pagos mixtos/división;
- propinas/reparto;
- refunds/conciliación.

Criterios de salida:

- contract tests;
- secretos externos;
- webhooks/reintentos idempotentes;
- sin PAN/CVV;
- factura pendiente recuperable;
- conciliación auditada.

### Fase 6 — Reportes, CRM y personal

Trabajo:

- dashboard;
- exportación;
- clientes;
- empleados/clock-in/comisiones.

Criterios de salida:

- métricas definidas/versionadas;
- filtros por Restaurant/Branch/zona horaria;
- exportaciones con permisos;
- privacidad/retención.

### Fase 7 — Multi-sucursal y lanzamiento

Trabajo:

- consolidación;
- seguridad final/pentest;
- carga;
- runbooks/DR;
- importación legacy;
- go-live.

Criterios de salida:

- capacidad objetivo demostrada;
- cero hallazgos críticos;
- backup/restauración contra RPO/RTO;
- alertas operativas;
- importador idempotente;
- checklist go/no-go aprobado.

### Fase 8 — Futuro

- delivery;
- lealtad;
- reservaciones;
- integraciones no críticas.

---

## 15. Estrategia Git y estado remoto

### 15.1 Estado comprobado el 2026-08-25

- carpeta local inicializada como repositorio Git;
- origin configurado por HTTPS;
- fetch exitoso de origin/main y origin/master;
- SSH falló por ausencia de una clave pública autorizada en GitHub;
- origin/main contiene un prototipo legado: app.js, index.html, style.css, supabase.js y otros archivos;
- main y master versionan node_modules; se detectaron 10,427 rutas bajo node_modules;
- no se hizo merge, checkout ni push;
- los documentos locales siguen sin sobrescribirse.

### 15.2 Plan seguro de integración

Requiere aprobación humana:

1. Decidir si el prototipo se archiva en tag/rama legacy-prototype.
2. Decidir si el greenfield nace en rama huérfana modernizacion-pos o reemplaza main mediante una migración revisada.
3. Crear .gitignore antes del primer commit nuevo.
4. Retirar node_modules del tracking sin borrar dependencias locales del usuario.
5. Preservar package.json y código legado solo si aporta requisitos verificables.
6. Hacer el primer commit documental.
7. Publicar una rama nueva y abrir revisión antes de cambiar main.

No reescribir historia ni borrar ramas remotas sin autorización explícita.

### 15.3 Implicación arquitectónica del hallazgo (resuelta por ADR-010)

El prototipo legado en `origin/main` incluye el cliente de Supabase y usa Data API para CRUD de clientes, direcciones y categorías. La inspección del árbol remoto **no encontró** uso de Supabase Auth, Realtime, Storage o Functions, ni una carpeta de migraciones/esquema reproducible. Por tanto, el prototipo demuestra una elección tecnológica previa, pero no una plataforma backend completa que pueda asumirse reutilizable.

ADR-010 evitó una falsa elección entre “todo Supabase” y “todo propio”, evaluó tres opciones y seleccionó B el 2026-08-29:

| Opción | Descripción | Riesgo principal |
|---|---|---|
| A — Stack propio gestionado por el proyecto | NestJS + Prisma + PostgreSQL + Redis/BullMQ + Socket.IO | Mayor trabajo operativo y de autenticación/autorización |
| B — Híbrida | Supabase PostgreSQL/Auth/Storage + NestJS para dominio, transacciones, jobs e integraciones; Prisma si el acceso elegido lo permite | Complejidad de límites, identidad y dos capas de autorización |
| C — Cliente directo a Supabase | Web/mobile usan Data API/RPC con RLS y funciones SQL para reglas | Riesgo de duplicar o dispersar invariantes financieras; no recomendada para escrituras críticas sin una frontera transaccional única |

Supabase aporta servicios reales, pero no elimina responsabilidades del producto:

- RLS requiere grants, políticas por operación y pruebas; no aparece automáticamente por añadir `restaurantId`/`branchId`.
- Una conexión privilegiada o service role puede omitir RLS; si NestJS/Prisma escribe con privilegios, el scope debe imponerse explícitamente o propagarse de forma segura a la transacción.
- Realtime es notificación, no entrega durable. Para KDS se evaluará Broadcast frente a Postgres Changes y siempre existirá recuperación por lectura/cursor.
- BullMQ/jobs, idempotencia financiera, outbox offline y resolución de conflictos siguen necesitando una solución explícita.
- Supabase no convierte por sí solo la aplicación en offline-first.

### 15.4 Criterios de decisión y spike de ADR-010

La decisión se tomará con evidencia, no por afinidad con el prototipo.

#### Timebox y calendario

- duración objetivo: **4 días hábiles**;
- hard stop: final del **quinto día hábil**;
- no se autoriza ampliar el spike para pulir UI, infraestructura productiva o casos no incluidos;
- si ninguna opción supera los gates al hard stop, ADR-010 queda `BLOCKED`, se documenta la brecha y packages/domain continúa sin acoplarse a backend.

Plan:

1. Día 1: harness común, datos de dos restaurantes/dos sucursales y pruebas de aceptación.
2. Día 2: opción A.
3. Día 3: opción B y evaluación limitada de C.
4. Día 4: fallos inducidos, backup/restore, scoring y borrador ADR.
5. Día 5 máximo: resolver evidencia faltante crítica y publicar GO/NO-GO; no desarrollar nuevas funciones.

#### Gates comunes obligatorios

Una opción no puede recibir GO si falla cualquiera de estos gates:

1. **Aislamiento:** pruebas automatizadas entre dos restaurantes y sucursales producen cero lecturas/escrituras cruzadas.
2. **Transacción:** crear orden + líneas + snapshots + auditoría es atómico; un fallo inducido deja cero estado parcial.
3. **Idempotencia:** 20 reenvíos concurrentes de la misma operación producen exactamente un resultado de negocio.
4. **Frontera única:** existe un solo camino autorizado de escritura para Order, Payment y CashMovement.
5. **Realtime recuperable:** tras omitir intencionalmente un evento KDS, el cliente reconstruye el estado correcto mediante lectura/cursor.
6. **Auth/scope:** login, membresía, revocación y revalidación de operaciones offline quedan demostrados en el thin slice.
7. **Migraciones:** una base vacía puede reconstruirse desde control de versiones mediante un comando documentado en CI.
8. **Backup/restore:** el dataset del spike se restaura y conserva conteos e identificadores esperados.
9. **Secretos:** ninguna credencial privilegiada o service role llega al navegador/mobile.
10. **Reproducibilidad:** otro agente puede ejecutar el spike siguiendo el README sin pasos implícitos.

#### Scoring

Solo se puntúan opciones que pasen todos los gates. Escala 0–5:

| Criterio | Peso | Mínimo |
|---|---:|---:|
| Seguridad y aislamiento | 25 | 4/5 |
| Dominio transaccional y frontera única | 25 | 4/5 |
| Compatibilidad offline futura | 15 | 3/5 |
| Operación, backup y observabilidad | 15 | 3/5 |
| Productividad/mantenibilidad | 10 | 3/5 |
| Costo y portabilidad | 10 | 3/5 |

Puntuación ponderada = suma de `(score / 5) × peso` para cada criterio. GO requiere al menos **75/100** y todos los mínimos. Entre opciones con GO se selecciona la puntuación mayor; un empate se resuelve a favor de la menor cantidad de componentes de seguridad hechos a medida y, después, de la mayor portabilidad.

#### GO/NO-GO por opción

**A — Stack propio**

GO si:

- pasa todos los gates;
- el aislamiento se aplica mediante una abstracción obligatoria y comprobable, no filtros manuales dispersos;
- refresh/revocación, jobs, backup y recuperación tienen una implementación mantenida y un responsable claro;
- Socket.IO conserva recuperación por lectura/cursor.

NO-GO si:

- el aislamiento depende de recordar `restaurantId` en cada query;
- Auth/revocación o idempotencia quedan como “se implementará después”;
- requiere infraestructura nueva no contemplada para superar los gates.

**B — Híbrida Supabase + NestJS**

GO si:

- pasa todos los gates;
- NestJS valida el JWT/membresía de Supabase y es la única frontera de escritura crítica;
- RLS tiene pruebas por operación y service role permanece exclusivamente en servidor;
- Prisma/Supabase usan una sola autoridad de migraciones;
- Auth/DB gestionados reducen trabajo sin duplicar reglas de dominio.

NO-GO si:

- Data API y NestJS pueden escribir la misma entidad financiera;
- RLS se omite en conexiones privilegiadas sin mitigación;
- existen dos fuentes de migraciones/esquema;
- la integración local/CI o backup/restore no es reproducible.

**C — Data API/RPC directa**

GO limitado si:

- pasa aislamiento, migraciones, secretos y recuperación realtime;
- se restringe a lecturas o CRUD no financiero explícitamente permitido;
- las tablas críticas no aceptan escrituras genéricas desde clientes.

NO-GO como backend principal del core bajo el plan actual si:

- Order, Payment o CashMovement se escriben directamente desde web/mobile;
- las invariantes se duplican entre SQL y packages/domain;
- no existe una frontera transaccional única y versionada.

Elegir C como backend principal exige cambiar explícitamente la regla de packages/domain, AGENTS.md y ADR-003; no puede ocurrir como consecuencia accidental del spike.

### 15.5 Trabajo paralelo durante ADR-010

ADR-010 **no bloquea packages/domain**. Desde el primer día otro agente puede implementar, en una rama/cambio independiente:

- tipo Money, moneda y redondeo;
- cálculo de líneas/totales con snapshots;
- máquina de estados de Order y OrderItem;
- reglas de modificadores;
- invariantes básicas de Payment y CashRegister;
- errores de dominio;
- unit tests y property-based tests donde aporten valor.

Restricciones del track paralelo:

- cero imports de NestJS, Prisma, Supabase, React, red o almacenamiento;
- ninguna decisión de tabla, JWT, RLS o transporte realtime;
- APIs pequeñas y revisables;
- los tipos compartidos no deben filtrar modelos del ORM.

Estas implementaciones quedaron desbloqueadas al aceptar ADR-010 y ahora deben respetar ADR-001; el transporte Realtime concreto, ORM, colas y schema productivo siguen pendientes de diseño y verificación.

---

## 16. Investigación y referencias

No se hará fork literal de un POS legado. La tabla es un inventario de referencias, no una clasificación por popularidad. Estrellas, actividad, stack y licencias cambian; toda consulta debe registrar fecha y enlace y volver a verificarse antes de copiar o depender de código.

| Referencia | Uso permitido en este proyecto | Observación verificada |
|---|---|---|
| [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) | Conceptos de ventas, inventario, compras, impuestos y reportes | La rama actual documenta CodeIgniter 4 y licencia MIT con una condición adicional de atribución visible; revisar LICENSE vigente antes de reutilizar código |
| [evan361425/flutter-pos-system](https://github.com/evan361425/flutter-pos-system) | UX y persistencia local offline en mobile | Documenta operación local sin internet y datos en dispositivo; no demuestra un motor de sincronización multi-dispositivo/backend |
| [emreeren/SambaPOS-3](https://github.com/emreeren/SambaPOS-3) | Cobertura funcional enterprise | Arquitectura Windows desktop; referencia de dominio, no de stack |
| [ucraft-com/POS-Awesome](https://github.com/ucraft-com/POS-Awesome) | Flujos POS sobre ERP | Depende de Frappe/ERPNext |
| [amritmaurya1504/Restaurant_POS_System](https://github.com/amritmaurya1504/Restaurant_POS_System) | Patrones básicos de API/órdenes | Verificar mantenimiento y licencia antes de uso |
| [faizaldevs/RestoPOS](https://github.com/faizaldevs/RestoPOS) | Ideas multi-tenant/multi-sucursal | Verificar aislamiento y licencia |
| [longnick/small-pos-open-source](https://github.com/longnick/small-pos-open-source) | Estructura TypeScript/local-first | Prototipo pequeño; no prueba producción |
| [rezadrian01/Kasirku](https://github.com/rezadrian01/Kasirku) | KDS, impresión e integración de pago | Verificar contratos/licencia |
| [ury-erp/mosaic](https://github.com/ury-erp/mosaic) | KDS/KOT y estaciones | Referencia acotada de cocina |

Reglas:

- usar ideas, contratos y aprendizajes;
- no copiar código literal sin revisar la licencia exacta del commit utilizado;
- no inferir “producción”, “offline sync” o seguridad solo por README, estrellas o presencia de una función;
- toda dependencia se revisa por licencia, mantenimiento, seguridad y compatibilidad antes del lockfile;
- referencias temporales se clonan fuera del monorepo publicado y nunca se mezclan con las apps nuevas.

---

## 17. Registro de ADRs

| ADR | Tema | Estado |
|---|---|---|
| ADR-001 | Arquitectura híbrida Supabase + NestJS y límites de persistencia | Aceptada; documento en revisión humana |
| ADR-002 | Restaurant/Branch como frontera de aislamiento | Propuesto para aceptación |
| ADR-003 | Money en unidad menor + snapshots | Propuesto para aceptación |
| ADR-004 | Fases 1–2 online; Fase 3 offline por dispositivo | Propuesto para aceptación |
| ADR-005 | Dexie/RxDB y WatermelonDB/alternativa | Pendiente de prototipo |
| ADR-006 | Preservación y migración del prototipo Git | Aceptada: historial legado recuperable y greenfield adoptado en main |
| ADR-007 | País, moneda, impuestos y CFDI | Pendiente de decisión humana |
| ADR-008 | Hardware e impresión | Pendiente de piloto |
| ADR-009 | Servidor local LAN | Diferido; fuera de v1 por defecto |
| ADR-010 | Stack propio vs. híbrido Supabase+NestJS vs. Data API directa | Aceptada: opción B, 10 gates y 75/100 |

---

## 18. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---:|---|
| Doble cobro o pérdida de venta | Crítica | idempotencia, transacciones, pruebas de fallos |
| Fuga entre restaurantes | Crítica | scope servidor/DB y pruebas de aislamiento |
| Conflictos offline silenciosos | Alta | reglas por entidad y revisión financiera |
| Scope v1 excesivo | Alta | piloto online y puertas de salida |
| Dependencia PAC/pagos/hardware | Alta | adaptadores y contract tests |
| Incumplimiento de licencias de referencias/dependencias | Alta | verificar licencia del commit y no copiar sin decisión |
| Relojes desalineados | Alta | secuencia por dispositivo y orden servidor |
| Base local comprometida | Alta | mínimo de datos, cifrado y revocación |
| Prototipo remoto contaminado | Media | rama/tag legado y .gitignore |
| Migraciones irreversibles | Alta | backups, migraciones aditivas y rollback |

---

## 19. Decisiones humanas pendientes

1. ¿El v1 vendible incluye exactamente Fases 0–3?
2. ¿El mercado inicial es México?
3. ¿Cuál es la moneda y zona horaria inicial?
4. ¿CFDI se incluye en v1 o Fase 5?
5. ¿Producto propietario, open source o híbrido?
6. ¿Qué hardware se usará en piloto?
7. ¿Cómo debe preservarse el prototipo remoto?
8. ¿Se necesita KDS multi-dispositivo sin internet en v1?
9. **Resuelta 2026-08-29:** opción B híbrida Supabase+NestJS.
10. ¿Se aprueba `card_manual` para piloto/v1 bajo las reglas de la Sección 3.2?

Estas preguntas no bloquean toda la Fase 0; sí bloquean las decisiones específicas indicadas en TODO.md.

---

## 20. Estado de avance

- **2026-08-25** — Documento original revisado. Se creó la versión 2.0 con arquitectura fijada, alcance por entregas, invariantes financieras, contrato offline, seguridad, observabilidad, criterios de aceptación, ADRs y estrategia Git.
- **2026-08-25** — Repositorio local inicializado y origin enlazado por HTTPS. Referencias remotas descargadas sin merge ni push.
- **2026-08-25** — Revisión cruzada de Claude: se agregó ADR-010, se aclararon pagos, `packages/config`, topología y referencias.
- **2026-08-25** — Corrección posterior: ADR-010 se convirtió en puerta de Fase 0 con tres opciones y spike; se verificó que el prototipo solo usa CRUD de Supabase; se definió `card_manual`; se corrigieron datos/licencias de referencias y se eliminó lenguaje no demostrable.
- **2026-08-25** — Plan v2.2 listo para implementación de Fase 0: spike ADR-010 limitado a 4 días/hard stop 5, gates y GO/NO-GO por opción, y packages/domain autorizado como track paralelo independiente.
- **2026-08-29** — Plan v2.3: ADR-010 aceptó la opción B con 10 gates y 75/100; ADR-001 registra la arquitectura híbrida y separa las decisiones de ORM, colas, Realtime, despliegue y schema productivo.

---

## 21. Siguiente paso

1. Mantener ADR-006: prototipo preservado y raíz greenfield separada.
2. Mantener `.gitignore` y la rama limpia de modernización.
3. Mantener monorepo y CI neutral.
4. Revisar ADR-001 y mantener sus límites de escritura, Auth, RLS y migraciones.
5. Implementar `apps/api` y Auth productivos sin promover el schema del spike.
6. Diseñar el schema/migraciones de producto desde invariantes y una sola autoridad.
7. Elegir y verificar jobs, Realtime, despliegue y recuperación física antes de producción.
