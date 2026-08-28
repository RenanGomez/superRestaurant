# AGENTS.md

Reglas operativas para agentes de código que trabajen en **superRestaurant**, un sistema POS para restaurantes con web, mobile, KDS y operación offline.

Estas instrucciones aplican a todo el repositorio. Si una instrucción humana explícita contradice este archivo, prevalece la instrucción humana y la decisión debe quedar registrada en HANDOFF.md.

---

## 1. Misión

El agente actúa como socio de implementación supervisado. Debe:

- construir el producto definido en PLAN_MODERNIZACION_POS_RESTAURANTE.md;
- trabajar desde TODO.md y mantener HANDOFF.md actualizado;
- inspeccionar antes de modificar;
- extender patrones existentes y evitar sistemas paralelos;
- proteger datos, dinero, auditoría y operación de restaurante;
- dejar cambios pequeños, verificables y fáciles de revisar;
- no declarar una función terminada sin pruebas proporcionales a su riesgo;
- administrar costo y contexto mediante búsquedas dirigidas y delegación apropiada.

El objetivo es un producto operable y mantenible, no una demostración visual.

---

## 2. Archivos operativos obligatorios

Al comenzar una sesión, leer directamente y una sola vez:

1. AGENTS.md
2. TODO.md
3. PROJECT_NOTES.md
4. HANDOFF.md
5. la sección relevante de PLAN_MODERNIZACION_POS_RESTAURANTE.md

Si falta alguno, continuar con cautela y registrarlo en HANDOFF.md.

Fuentes de verdad, en orden:

1. instrucción humana explícita;
2. TODO.md;
3. PLAN_MODERNIZACION_POS_RESTAURANTE.md;
4. PROJECT_NOTES.md;
5. arquitectura y patrones confirmados mediante CodeGraph.

No duplicar el roadmap completo en HANDOFF.md; registrar solo estado, decisiones y siguiente acción.

---

## 3. Flujo obligatorio de trabajo

1. Leer los archivos operativos.
2. Consultar CodeGraph sobre el subsistema relevante.
3. Seleccionar la tarea elegible de mayor prioridad.
4. Definir alcance, riesgos, criterios de aceptación y estrategia de verificación.
5. Determinar si conviene delegar una unidad acotada.
6. Marcar la tarea IN_PROGRESS.
7. Implementar el cambio mínimo coherente.
8. Reconsultar CodeGraph para dependencias y referencias afectadas.
9. Ejecutar lint, typecheck, pruebas y verificación de interfaz que correspondan.
10. Actualizar TODO.md, PROJECT_NOTES.md si hay una decisión durable, y HANDOFF.md.
11. Dejar el trabajo en REVIEW; solo un humano aprueba trabajo sustancial como DONE.

No iniciar una fase si no se cumplieron los criterios de salida de la anterior, salvo instrucción humana documentada.

---

## 4. CodeGraph es obligatorio

CodeGraph es la fuente estructural principal del repositorio.

Usarlo antes de escribir código para:

- localizar módulos, componentes, servicios, DTOs, esquemas, adaptadores y pruebas;
- encontrar todos los consumidores de símbolos compartidos;
- entender flujo de datos y dependencias;
- evitar duplicación;
- medir impacto de cambios en contratos, tipos o modelos.

Después de editar, usarlo de nuevo para confirmar que no quedaron referencias rotas u objetos huérfanos.

Reglas:

- preferir consultas específicas a exploraciones completas;
- excluir node_modules, dist, coverage, .next, build y artefactos generados;
- no validar CodeGraph con búsquedas repetitivas salvo que el índice esté desactualizado;
- si CodeGraph falla o no está indexado, registrar la limitación y hacer la inspección manual más dirigida posible;
- un cambio de alto impacto sin análisis suficiente debe quedar BLOCKED, no REVIEW.

---

## 5. Estado de tareas

Estados permitidos:

- TODO: no iniciada;
- IN_PROGRESS: trabajo activo;
- REVIEW: implementada y verificada, pendiente de revisión humana;
- DONE: aprobada por el humano o tarea mecánica aprobada explícitamente;
- BLOCKED: no puede continuar por una dependencia o decisión;
- CANCELLED: descartada intencionalmente.

Transiciones normales:

- TODO → IN_PROGRESS;
- IN_PROGRESS → REVIEW;
- REVIEW → DONE con aprobación humana;
- TODO/IN_PROGRESS → BLOCKED con motivo y siguiente acción mínima;
- BLOCKED → TODO cuando se elimina el bloqueo;
- REVIEW → TODO cuando requiere retrabajo;
- TODO → CANCELLED con motivo.

Toda transición a REVIEW, BLOCKED o de regreso a TODO debe incluir una nota breve.

---

## 6. Arquitectura base provisional

La dirección inicial es la alternativa A del plan, pero Auth, persistencia de aplicación y Realtime quedan condicionados por ADR-010. Antes de resolver ese spike solo se implementan tareas neutrales: Git, monorepo, CI, documentación, packages/domain y sus pruebas.

La base candidata es:

- monorepo TypeScript con pnpm workspaces y Turborepo;
- apps/api: NestJS;
- apps/web: Next.js para backoffice y POS web/PWA;
- apps/mobile: Expo y React Native;
- apps/kds: cliente React ligero para cocina;
- packages/domain: reglas de negocio puras sin NestJS, React, Prisma ni acceso a red;
- packages/shared-types: contratos compartidos y esquemas versionados;
- packages/sync-engine: sincronización offline reutilizable;
- packages/ui: componentes compartidos donde sea técnicamente viable;
- packages/printing: adaptadores ESC/POS y Bluetooth;
- PostgreSQL + Prisma;
- Redis + BullMQ;
- REST versionado + OpenAPI y Socket.IO para tiempo real;
- Docker Compose en desarrollo y despliegue inicial.

Cambiar esta base requiere una ADR y autorización humana cuando afecte varias aplicaciones o el modelo de datos.

---

## 7. Límites de dependencia

- packages/domain no importa frameworks, ORM, UI, SDKs externos ni infraestructura.
- Las apps consumen dominio y contratos compartidos; no duplican cálculos financieros o máquinas de estados.
- Prisma pertenece a la capa de persistencia/API; sus modelos no sustituyen las entidades y reglas del dominio.
- Integraciones externas usan puertos/adaptadores: pagos, PAC, almacenamiento, email, push e impresión.
- Web, mobile y KDS no acceden directamente a PostgreSQL.
- Ningún cliente confía en permisos o totales calculados únicamente en el navegador/dispositivo; el servidor revalida.

Antes de crear una abstracción nueva, confirmar que no exista una equivalente.

---

## 8. Reglas de dominio POS

El flujo crítico es:

mesa/canal → orden → ítems/modificadores → estación/KDS → preparación → entrega → cuenta → pago → cierre de caja → inventario/auditoría.

Reglas obligatorias:

- una orden puede ser de mesa, mostrador, para llevar o delivery;
- las transiciones de Order y OrderItem deben estar centralizadas y probadas;
- toda mutación sensible registra actor, sucursal, dispositivo, timestamp, motivo y autorización cuando aplique;
- cancelaciones, descuentos, cortesías, reembolsos y reaperturas requieren reglas explícitas;
- cerrar una cuenta no elimina su historial;
- registros financieros y movimientos de inventario son inmutables; las correcciones se realizan con movimientos compensatorios;
- KDS filtra estrictamente por sucursal y estación;
- no usar alert(), confirm() ni prompt() en flujos de producto.

---

## 9. Dinero, impuestos y pagos

Cambios financieros se consideran de alto riesgo.

- representar dinero con enteros en unidad monetaria menor y código ISO de moneda, o con un tipo decimal exacto aprobado por ADR; nunca usar float;
- congelar en OrderItem snapshots de nombre, precio, modificadores, impuestos y descuentos aplicados;
- documentar redondeo, impuestos incluidos/excluidos, propinas y orden de aplicación de descuentos;
- no recalcular ventas históricas desde el catálogo actual;
- cada pago usa idempotency key;
- pagos y reembolsos tienen estados explícitos y trazabilidad;
- nunca almacenar PAN, CVV o secretos del proveedor;
- los reintentos no pueden duplicar cobros, tickets, facturas ni movimientos de caja;
- el efectivo puede registrarse offline según la matriz de capacidades; tarjeta depende del contrato del proveedor/terminal.

Todo cambio en totales, impuestos, pagos o caja requiere pruebas unitarias de dominio y al menos una prueba de integración.

---

## 10. Multi-restaurante, sucursales y autorización

- Restaurant es la frontera principal de aislamiento; Branch delimita la operación local.
- Toda entidad de negocio debe declarar su pertenencia a Restaurant y, cuando aplique, Branch.
- Toda consulta y mutación debe incluir el alcance autorizado, no solo filtrar en la UI.
- Las restricciones únicas deben incluir el alcance adecuado.
- Usuarios pueden tener membresías y roles distintos por restaurante/sucursal.
- Acciones de supervisor deben verificar autorización del servidor y quedar auditadas.
- Añadir RLS o cambiar la estrategia de aislamiento requiere ADR y pruebas de fuga entre tenants.

Las pruebas de aislamiento son obligatorias desde Fase 0.

---

## 11. Offline y sincronización

Fases 1 y 2 son online-first. La capacidad offline completa comienza en Fase 3.

No afirmar “funciona offline” sin especificar cliente y operación.

Cada evento de sincronización debe incluir al menos:

- eventId;
- deviceId;
- actorId;
- restaurantId y branchId;
- entity y entityId;
- operation y schemaVersion;
- secuencia monotónica local;
- baseVersion esperada;
- occurredAt del dispositivo y receivedAt del servidor;
- idempotencyKey;
- payload validado;
- estado de reintento/error.

Reglas:

- las escrituras locales usan outbox durable;
- el servidor deduplica y revalida permisos;
- timestamp del cliente no determina por sí solo el orden;
- conflictos se resuelven por reglas específicas de entidad;
- ambigüedades financieras se envían a revisión y nunca se fusionan silenciosamente;
- borrados sincronizables usan tombstones/soft delete;
- pull usa cursores versionados;
- cambios de esquema contemplan migración de clientes atrasados;
- reinicio, cierre forzado y reintento no pierden operaciones confirmadas.

Sin servidor local, una caída total de internet no garantiza comunicación entre dispositivos distintos y KDS. El modo LAN requiere una ADR separada con autoridad, failover y reconciliación.

---

## 12. Base de datos y migraciones

- no inventar tablas o campos fuera del plan/tarea sin justificación;
- usar UUID/ULID generados de forma segura, no IDs autoincrementales para entidades sincronizables;
- incluir createdAt, updatedAt, deletedAt cuando corresponda;
- usar migraciones Prisma versionadas y reproducibles desde cero;
- preservar compatibilidad con datos existentes;
- no editar migraciones ya aplicadas; crear una nueva;
- cambios destructivos requieren plan de migración, respaldo y rollback;
- índices se justifican por consultas reales y restricciones de integridad;
- el esquema debe proteger invariantes además de la validación de aplicación.

Antes de alterar una entidad, consultar todos sus lectores, escritores, eventos y reportes.

---

## 13. Seguridad y privacidad

Seguridad inicia en Fase 0, no al final.

- DTOs validados y entradas sanitizadas;
- autenticación con access token corto y refresh token rotatorio/revocable;
- RBAC por restaurante/sucursal;
- rate limiting en endpoints sensibles;
- secretos solo en variables/gestor de secretos; nunca en Git o logs;
- TLS en tránsito y cifrado de almacenamiento local sensible;
- auditoría de autenticación y operaciones privilegiadas;
- webhooks firmados y resistentes a replay;
- dependencias revisadas y actualizadas conscientemente;
- minimizar datos personales y definir retención/exportación.

Una vulnerabilidad crítica o fuga entre restaurantes bloquea la entrega.

---

## 14. UI, accesibilidad y operación

- seguir el sistema visual existente antes de crear otro;
- diseñar para pantallas táctiles, alto ritmo operativo y errores recuperables;
- estados de carga, vacío, error, offline, reintento y éxito deben ser explícitos;
- controles con etiquetas, foco visible, teclado, contraste suficiente y targets táctiles adecuados;
- respetar reduced motion;
- animar solo cuando aclara un cambio de estado;
- acciones destructivas requieren confirmación dentro de la aplicación y motivo cuando el dominio lo exija;
- proteger el área operativa principal de overlays innecesarios;
- mostrar sucursal, turno, caja, conexión y pendientes de sync cuando correspondan.

Todo cambio visual se verifica en navegador real y en breakpoints relevantes. Mobile se verifica en los sistemas objetivo o se documenta la limitación.

---

## 15. Pruebas y garantía de no romper

Antes de marcar REVIEW:

- ejecutar lint, typecheck, tests y build del alcance afectado;
- probar reglas puras con unit tests;
- probar API + PostgreSQL con integration tests;
- probar flujos críticos con E2E;
- probar adaptadores con contract tests;
- probar idempotencia y reintentos;
- verificar visualmente UI y revisar consola/red;
- reconsultar CodeGraph.

Áreas de prueba obligatoria:

- aislamiento entre restaurantes/sucursales;
- cálculo monetario y redondeo;
- máquina de estados;
- doble envío/doble cobro;
- cancelación/reembolso;
- reconexión y conflictos offline;
- inventario compensatorio;
- permisos de supervisor;
- migraciones desde cero y sobre versión anterior.

Si una prueba necesaria no puede ejecutarse, documentar la brecha y no declarar DONE.

---

## 16. Observabilidad, respaldo y operación

Cada servicio debe incluir:

- logs estructurados con correlationId y, cuando aplique, restaurantId, branchId, orderId y deviceId;
- health/readiness checks;
- métricas de errores, latencia, colas, sync, WebSocket y trabajos;
- alertas y runbooks para fallos críticos;
- política de backup, RPO/RTO y prueba periódica de restauración;
- migraciones y despliegues con estrategia de rollback.

No registrar secretos, tokens, datos de tarjeta ni payloads personales completos.

---

## 17. Git y artefactos

Remoto del proyecto: https://github.com/RenanGomez/superRestaurant.git.

- usar conventional commits: feat, fix, refactor, test, docs, chore;
- trabajar en ramas pequeñas por feature;
- no hacer push, merge, rebase, force-push ni reescribir ramas remotas sin autorización humana;
- nunca versionar node_modules, .env, secretos, coverage, dist, .next o artefactos temporales;
- no usar git reset --hard ni checkout destructivo sobre cambios del usuario;
- inspeccionar el remoto antes de integrar historia heredada;
- conservar el prototipo legado hasta que exista una decisión explícita de archivo/migración.

El remoto actual contiene un prototipo previo y node_modules versionado. No mezclarlo automáticamente con el greenfield.

---

## 18. Código fuente vs. generado

- editar solo fuentes;
- no editar dist, build, .next, coverage, clientes generados o bundles;
- generar artefactos solo mediante sus scripts;
- no ejecutar builds de distribución/despliegues salvo que la tarea lo requiera;
- si un artefacto debe distribuirse, regenerarlo, validar su contrato y documentar su versión en la misma sesión.

---

## 19. Delegación y costo

Delegar cuando una unidad:

- sea independiente y acotada;
- toque un módulo o contrato específico;
- pueda implementarse y verificarse sin todo el contexto del orquestador.

Mantener en el agente principal:

- decisiones transversales;
- integración final;
- análisis de impacto global;
- actualización de TODO/PROJECT_NOTES/HANDOFF.

Usar el nivel mínimo de razonamiento suficiente:

- bajo: cambios mecánicos;
- moderado: módulo acotado con decisiones locales;
- alto: dinero, sync, seguridad, esquema compartido o refactor transversal.

Registrar en HANDOFF.md subagentes, alcance y nivel. El agente principal sigue siendo responsable del resultado.

---

## 20. Definition of Done

Una tarea llega a REVIEW cuando:

- cumple sus criterios de aceptación;
- respeta arquitectura y dominio;
- tiene pruebas relevantes;
- no rompe dependientes conocidos;
- pasó verificación estática y funcional;
- actualizó documentación operativa;
- no deja secretos, artefactos o cambios ajenos.

Una fase termina cuando:

- su flujo end-to-end funciona;
- CI está verde;
- migraciones son reproducibles;
- riesgos críticos están cerrados o aceptados por el humano;
- existen instrucciones de operación/verificación;
- se cumplen los criterios de salida del plan maestro.

DONE requiere aprobación humana para trabajo sustancial.

---

## 21. Handoff obligatorio

Al finalizar, HANDOFF.md debe registrar:

- tarea trabajada y estado;
- archivos/módulos modificados;
- decisiones y supuestos;
- pruebas y verificaciones exactas;
- resultado de CodeGraph para código compartido;
- riesgos o bloqueos;
- siguiente acción mínima;
- subagentes usados y nivel de razonamiento;
- si hubo cambios de esquema, migración/rollback;
- si hubo cambios offline, matriz/artifacto realmente probado;
- si hubo interacción Git remota, qué se descargó o publicó.

Escribir conclusiones, no logs extensos.

---

## 22. Regla final

No adivinar cuando el repositorio, la base de datos, los contratos o las pruebas pueden responder.

Inspeccionar primero. Diseñar invariantes. Implementar el cambio mínimo. Verificar contra fallos reales. Documentar al final.
