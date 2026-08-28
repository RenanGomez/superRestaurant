# PROJECT_NOTES

Última actualización: 2026-08-28

## Estado del repositorio

- Proyecto greenfield: existe la configuración raíz del monorepo; todavía no existen aplicaciones, paquetes funcionales, esquema Prisma ni pruebas de producto.
- Git local está inicializado.
- origin apunta por HTTPS a https://github.com/RenanGomez/superRestaurant.git.
- El fetch de origin/main y origin/master fue exitoso.
- SSH registró la huella de GitHub, pero la autenticación falló por falta de una clave pública autorizada.
- La lectura HTTPS funciona; la capacidad de push todavía no fue verificada.
- No se hizo merge, checkout ni push.
- CodeGraph está indexado y su última reconsulta reporta 49 archivos, 925 nodos y 2,202 relaciones.
- Existe un `.gitignore` raíz, pendiente de revisión humana, que excluye dependencias, secretos, builds, cobertura, caches, `.codegraph`, artefactos móviles y credenciales de firma; conserva versionables las plantillas `.env*.example`.
- El monorepo raíz usa pnpm 11.19.0 y Turborepo 2.10.12 con workspaces `apps/*` y `packages/*`; Node 24.19.0 y las versiones de herramientas quedaron fijadas, y `pnpm-lock.yaml` es reproducible.
- TypeScript quedó fijado en 6.0.3, la última 6.0.x estable compatible con `typescript-eslint` 8.67.0; TypeScript 7.0.2 se descartó porque el linter declara soporte solo para versiones `<6.1.0`.
- `packages/config` publica presets compartidos de TypeScript y ESLint; `packages/shared-types` define identificadores opacos Restaurant/Branch y sus alcances sin filtrar modelos de persistencia.
- `packages/domain` implementa Money con minor units enteros seguros, BigInt interno y redondeo `half-away-from-zero` por defecto, más máquinas de estados puras de Order/OrderItem.
- `packages/domain` calcula líneas y órdenes desde snapshots inmutables: precio/modificadores × cantidad, descuento de línea, impuesto incluido/excluido por línea, descuento de orden y propina. No usa float ni muta inputs del caller.
- `packages/domain` modela Payment inmutable con estados explícitos, intento lógico idempotente y Refund compensatorio referenciado. Un refund parcial conserva `captured`; solo agotar el saldo cambia a `refunded`.
- `packages/domain` modela una sesión CashRegister pura: apertura/cierre auditados, saldo esperado derivado, diferencia `contado - esperado`, movimientos append-only y compensaciones acumuladas que nunca exceden el original. `localSequence` exige un cursor autoritativo por dispositivo suministrado por la futura capa de aplicación/persistencia.
- Los snapshots monetarios conservan catálogo, producto/SKU, estación, unidad, precios, modificadores, quantity, regla fiscal/tasa/modo y versiones de descuentos. Todos los resultados contienen clones profundamente congelados.
- Las reglas puras de modificadores validan un grupo versionado y activo ligado a un producto: los límites mínimo/máximo cuentan la suma de cantidades por unidad de producto, cada opción debe pertenecer al allowlist activo, los duplicados se rechazan y un cap por opción es explícito cuando existe.
- La selección produce orden canónico por ID y snapshots profundamente congelados con identidad/nombre/versión del grupo, opción, precio y cantidad. El impuesto se hereda del `OrderItem` en esta etapa; no se inventó una regla fiscal por modificador.
- El descuento de orden usa la estrategia versionada `largest-remainder-post-tax-line-total-v1`: prorratea sobre totales post-impuesto, distribuye unidades residuales por mayor resto y desempata por `orderItemId` con comparación binaria estable.
- ADR-007 queda PROPUESTA: fija invariantes técnicas neutrales, pero país, moneda inicial, zona predeterminada, tasas/régimen, tratamiento fiscal de propinas y CFDI permanecen bloqueados hasta decisión humana/asesoría fiscal.
- ADR-004 queda PROPUESTA y documenta Fases 0–2 online-first, Fase 3 offline por dispositivo con nube/API autoritativa y Fase 3B LAN fuera de v1 condicionada a ADR-009.
- `docs/architecture/OFFLINE_SYNC_CONTRACT.md` fija el envelope, secuencia global monotónica por dispositivo, versiones, push idempotente, pull con cursor opaco separado, outbox durable, tombstones, revocación y aislamiento. Es contrato de diseño: no existe aún `packages/sync-engine` ni almacenamiento local productivo.
- `docs/architecture/OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX.md` bloquea por defecto operaciones offline de alto riesgo, prohíbe LWW para dinero/estados críticos y envía ambigüedades financieras a revisión humana con correcciones compensatorias.
- Una respuesta de push `accepted`/`duplicate` confirma únicamente su evento de outbox; nunca avanza el cursor de pull. Solo aplicar atómicamente un lote pull puede persistir el siguiente cursor.
- `localSequence` es global por `deviceId`, no se reinicia al cambiar de Restaurant/Branch y no establece causalidad entre dispositivos. Scope, `baseVersion` y versión canónica del servidor siguen siendo controles independientes.
- Una cancelación de ítem después de enviarlo devuelve evidencia auditable inmutable con actor, sucursal, dispositivo, timestamp, motivo y autorización; la capa de aplicación deberá persistir ese registro.
- Una orden `partially_paid` puede aceptar nuevas líneas en este nivel de dominio; el plan solo prohíbe explícitamente añadirlas en `paid`/`closed`, y las reglas de ajuste financiero posteriores podrán restringir el caso de uso.
- CI neutral usa GitHub Actions con permisos `contents: read`, instalación frozen y etapas lint/typecheck/test/build; las acciones fijan majors oficiales vigentes y las versiones Node/pnpm coinciden con `package.json`.
- ADR-010 tiene un harness común en `spikes/adr-010` con fixtures deterministas 2×2 y gates ejecutables de aislamiento, atomicidad, idempotencia, auth/scope/revocación, recuperación KDS, migraciones, backup/restore, secretos y reproducibilidad; la frontera única exige además inspección humana.
- El adaptador en memoria solo valida el harness y no puntúa A/B/C. Los adapters reales, evidencia externa y scoring siguen pendientes.
- La opción A incluye un adapter real de PostgreSQL, migración thin-slice, frontera Nest y runner opt-in. Su función `create_order` concentra scope, revocación, atomicidad e idempotencia; el restore lógico usa tablas/columnas allowlisted, exige destino vacío y no oculta conflictos. Sin PostgreSQL ejecutado y con `issueSession` como doble, A permanece NO-GO y sin score.
- La opción B implementa `Adr010Adapter`: usa sesiones desechables de Supabase Auth, valida el access token mediante `auth.getUser(token)`, deriva `actorId` del usuario verificado y mantiene NestJS/PostgreSQL server-only como única frontera de escritura crítica. Order, Payment, Refund y CashMovement pasan por servicios Nest y funciones SQL privadas; el refund exige un segundo token de supervisor y persiste su autorización. Incluye guards de proyecto/TLS, idempotencia ligada a actor/scope/payload, cleanup reintentable y backup/restore lógico conservador. B sigue sin GO ni score final por las brechas externas restantes.
- B separa `adr010_b` (único schema expuesto, tablas de lectura con RLS) de `adr010_b_private` (todas las funciones `SECURITY DEFINER`, sin exposición ni grants Data API, `search_path=''`). La secret key queda para Auth Admin; `ADR010_DATABASE_URL` queda solo en Nest/CI para funciones privadas.
- El bootstrap B crea dos usuarios Auth desechables mediante Admin API server-only, usa un `bootstrap_run_id` único, adjunta memberships 2×2 por PostgreSQL privado y permite limpieza concurrente/reintentable sin imprimir credenciales. Es preparación remota, no evidencia del gate Auth.
- El probe B opt-in usa clientes independientes con publishable key y sesiones reales para comprobar lecturas propias, ausencia cross-scope y revocación inmediata. Pasó contra `ndblkcmdgpxsxylacutx`; el runner ahora prepara fixtures estructurales mediante el adapter y siempre limpia/cierra en `finally`.
- El proyecto Supabase `cxcnnhafchqslvgvkeye` quedó enlazado y recibió tres migraciones versionadas del spike: thin slice B, hardening read-only C y hardening RLS/ACL de `bootstrap_users`. `adr010_b` es el único schema experimental expuesto; `adr010_b_private` permanece privado. La auditoría SQL remota, estrictamente read-only y limitada a ambos schemas experimentales, pasó 24/24 checks.
- El primer `config push` materializó defaults no deseados de Auth además de exponer `adr010_b`. Los valores previos de URL/redirecciones, TOTP, confirmación de email, frecuencia y longitud OTP se restauraron inmediatamente y una verificación posterior confirmó API, DB, Auth y Storage al día; la única diferencia intencional es la exposición de `adr010_b`.
- El advisor de seguridad detectó errores preexistentes fuera del spike: `public.clients`, `public.client_addresses` y `public.client_categories` tienen RLS deshabilitado, además de una función pública con `search_path` mutable. Esto demuestra que el proyecto no es nuevo/aislado; sus errores no se atribuyen a `adr010_b`, pero impiden usarlo para reset, Auth desechable, gates comunes o restore.
- La opción C implementa únicamente lecturas acotadas de órdenes y recuperación KDS con URL + publishable key. No expone mutaciones, pagos, caja ni `Adr010Adapter`; es NO-GO para backend/core financiero y solo podría considerarse para lecturas o CRUD no financiero tras probar RLS real.
- Los preflights locales de B/C validan configuración, límites del API y SQL estático; no demuestran aislamiento remoto, concurrencia, atomicidad, revocación, Realtime, migraciones ni backup/restore.
- Para Supabase nuevo se usarán URL + publishable key en comprobaciones públicas y secret key solo en servidor/CI. `anon`/`service_role` se consideran legacy y no se adoptan para configuración nueva.
- Supabase CLI 2.109.1 está autenticada y enlazada al proyecto proporcionado, que no es apto para terminar el spike por contener datos/esquemas ajenos. Se necesita un proyecto nuevo y vacío dedicado a ADR-010. Docker/PostgreSQL/Redis tampoco están disponibles localmente, así que la opción A aún no puede generar evidencia ejecutable.
- El proyecto aislado nuevo `ndblkcmdgpxsxylacutx` (`superrestaurant-adr010-spike-20260827`) fue verificado antes de migrar: 0 relaciones de usuario, 0 usuarios Auth, 0 objetos Storage y 0 migraciones. Recibió las tres migraciones ADR, expone `adr010_b` sin exponer `adr010_b_private`, pasó auditoría 24/24 y el security advisor no reportó problemas.
- Las claves publishable/secret del proyecto nuevo se obtienen solo en memoria mediante la CLI oficial. Los gates PostgreSQL esperan una contraseña en `.env.adr010.local`, archivo ignorado por Git; no se almacena ni se comparte por chat.
- El runner B corrigió cuatro defectos descubiertos por evidencia remota: arrays JS enviados como arrays PostgreSQL a parámetros `jsonb`, claves de bootstrap `camelCase` incompatibles con `jsonb_to_recordset`, probe RLS sin fixtures estructurales y una segunda limpieza del adapter con la misma serialización inválida. Los contratos quedaron cubiertos por pruebas y los diagnósticos PostgreSQL se redactan para no exponer secretos.
- `test:option-b:rls` y `test:option-b:gates` pasaron contra el proyecto aislado. Las 15 evidencias remotas verifican principal Auth, rotación de access/refresh token, escritura con la sesión renovada, rechazo del refresh después de revocación global, aislamiento, atomicidad, idempotencia/binding, Payment/Refund de efectivo, compensación, ledger/auditoría, recuperación KDS, revocación de scope, preservación de migración, backup/restore lógico, guard de destino vacío y superficie de secretos. El resultado deliberado es `eligibleForAdr010Go: false` únicamente mientras falten la migración completa desde un segundo proyecto/CI fresco y la inspección humana de la frontera. El restore físico pertenece a recuperación de desastre y RPO/RTO antes de producción; no sustituye ni bloquea el gate 8 lógico del spike, que ya pasó.
- La CA oficial `Supabase Root 2021 CA` descargada por el usuario fue validada como certificado CA vigente hasta 2031. La URL exacta del adapter conectó al pooler con `sslmode=verify-full`, `sslrootcert`, cifrado activo, certificado autorizado, hostname `*.pooler.supabase.com` y sin error de autorización. El runner completo B pasó nuevamente con esta configuración; el certificado permanece fuera del repositorio y no es secreto.
- El runner `test:option-b:fresh-push` queda preparado para un segundo proyecto vacío: exige opt-ins independientes, identidad URL/DB/project-ref/enlace CLI exacta, cero migraciones/usuarios/storage/relaciones de usuario, dry-run primero, revalidación anti-TOCTOU antes de aplicar y confirmación de las cinco versiones. Nunca crea, enlaza ni elimina proyectos.
- El proyecto aislado tiene cinco migraciones ADR. Las dos últimas añaden Payment/Refund/CashMovement/auditoría financiera, cursor privado y unicidad global `(device_id, local_sequence)`; la segunda corrige de forma versionada los objetivos `ON CONFLICT` sin editar la migración aplicada. La auditoría posterior pasó 27/27 y `db lint` no encontró errores en `adr010_b`/`adr010_b_private`.
- La auditoría adversarial neutral del 2026-08-28 cerró tres clases de continuidad/integridad: Order y snapshots ya rechazan getters heredados/prototipos hostiles y no cierran con ítems incompletos; modificadores incluyen `restaurantId` para impedir mezclar catálogos homónimos entre tenants; Payment/Refund conservan `eventId` explícito y evidencia de Branch, mientras CashRegister rechaza cierres rehidratados con diferencia sin motivo. Las APIs públicas de estados ya no filtran `TypeError` ante estados runtime malformados.
- La integración posterior pasó lint, typecheck, 70 pruebas de dominio y 57 del spike, y build global. Los archivos operativos siguen siendo la fuente durable entre sesiones. ADR-006 quedó aceptada: `ceaffcb` creó la raíz greenfield y `f9f4428` conectó la historia previa mediante merge `ours`; `main` y `codex/modernizacion-fase0` publican el mismo árbol moderno por fast-forward, sin force-push ni cambio de `origin/master`.
- Tras las pruebas quedaron 0 usuarios Auth, bootstrap rows, memberships, órdenes, líneas, snapshots, eventos KDS, pagos, refunds, movimientos, auditorías financieras y cursores de dispositivo; permanecen únicamente los 2 restaurantes y 4 sucursales estructurales deterministas del spike.
- `packages/domain` ya contiene un agregado funcional e inmutable `Order`: declara canal `table/counter/takeout/delivery`, mesa obligatoria solo para `table`, scope `restaurantId`/`branchId` también en cada línea, snapshots históricos, estados y totales mediante el calculador compartido. Cancelar la orden exige evidencia completa, bloquea líneas activas de cocina hasta cancelarlas individualmente, cancela pendientes atómicamente y deja total pagable cero; órdenes cerradas/canceladas no aceptan mutaciones de ítems. Toda operación rechaza accessors y revalida agregados rehidratados.
- Las fronteras puras financieras revalidan historiales rehidratados antes de replay, transición, refund, balance o cierre. Payment comprueba secuencia/estado/refunds/evidencia; CashRegister comprueba semántica de movimientos, compensaciones acumuladas y coherencia del cierre. Transición Payment y cierre CashRegister conservan `eventId`/`idempotencyKey`, reproducen el mismo intento y rechazan reutilización divergente. La razón de una variación se exige y devuelve como evidencia al cerrar, pero no forma parte del agregado rehidratado; su persistencia corresponde al audit log inmutable de la aplicación.
- Money rechaza modos de redondeo runtime desconocidos y los snapshots fiscales exigen ratios bigint no negativos con denominador positivo; entradas malformadas producen errores de dominio, no `TypeError`.
- Las propiedades financieras usan PRNG con semilla fija y `node:test`, sin nueva dependencia: 96 casos Money contra oráculo bigint, 61 escenarios de descuento con cuatro permutaciones y 48 secuencias de compensación/replay. Verifican exactitud, overflow, redondeo, conservación de minor units, estabilidad por `orderItemId`, saldos e idempotencia.
- El agregado puro no puede demostrar por sí solo que `tableId` pertenece a `branchId` ni que pagos persistidos autorizan `partially_paid/paid`; esas verificaciones son obligatorias en la futura frontera de aplicación/persistencia y permanecen bloqueadas por ADR-010.
- `pg@8.23.0` y `@types/pg@8.23.1` quedaron fijados para el adapter A; sus versiones y licencia MIT fueron verificadas contra npm por el subagente responsable.
- La separación B sigue la guía oficial actual de Supabase: grants y RLS controlan conjuntamente schemas expuestos, las funciones `SECURITY DEFINER` no deben exponerse y una secret key debe permanecer server-only.

## Estado del remoto legado

- origin/main contiene un prototipo previo con app.js, index.html, style.css, supabase.js y otros archivos.
- main y master versionan node_modules; se contaron 10,427 rutas bajo ese directorio en cada rama.
- El prototipo debe preservarse hasta que el humano elija una estrategia.
- Auditoría exacta de licencia: `origin/main@293a1551e88d7956ac64d2545448d9a9d6346bc7` y `origin/master@f87d5b255695ef28767088c4d0f7dc6a0dc62951` no contienen licencia, NOTICE, COPYING, README ni campo `license` del paquete para el código propio. Las licencias bajo `node_modules` pertenecen solo a dependencias. Hasta recibir autorización/licencia escrita del titular, el prototipo puede orientar requisitos pero no aportar código copiado al greenfield.
- Recomendación: archivar el prototipo en una rama/tag, crear una rama limpia de modernización, añadir .gitignore y publicar esa rama para revisión antes de cambiar main.
- No retirar archivos versionados ni reescribir historia sin autorización explícita.

## Producto

superRestaurant será un POS para restaurantes con:

- web administrativa/POS;
- mobile para meseros;
- KDS;
- mesas, canales, menú, órdenes, pagos y caja;
- inventario/reportes en fases posteriores;
- operación offline por dispositivo en v1;
- servidor local LAN opcional y separado.

## Arquitectura base provisional

- pnpm + Turborepo;
- TypeScript;
- NestJS + REST/OpenAPI + Socket.IO;
- PostgreSQL + Prisma;
- Redis + BullMQ;
- Next.js;
- Expo/React Native;
- React para KDS;
- packages/domain para lógica pura;
- packages/shared-types;
- packages/sync-engine;
- adaptadores para pagos, PAC, impresión y terceros.

Esta es la alternativa A. ADR-010 decidirá entre stack propio, híbrido Supabase+NestJS o Data API restringida antes de implementar Auth/persistencia/Realtime definitivos.

## AGENTS.md

El archivo heredado del ATS fue reemplazado el 2026-08-25 con autorización humana.

La versión nueva es específica para el POS y cubre:

- flujo operativo y CodeGraph;
- estados de tareas;
- arquitectura y límites;
- dinero, pagos y caja;
- Restaurant/Branch y RBAC;
- offline y sincronización;
- migraciones;
- seguridad y privacidad;
- UI y accesibilidad;
- pruebas, observabilidad, backups y Definition of Done;
- Git, artefactos y delegación.

Queda en REVIEW.

## Plan maestro v2.2

PLAN_MODERNIZACION_POS_RESTAURANTE.md está listo para iniciar Fase 0 neutral y ejecutar ADR-010.

Mejoras principales:

- separa piloto online v0.1 de v1 offline;
- fija el stack y lleva alternativas a ADR;
- define invariantes monetarias y snapshots;
- trata pagos/caja como operaciones inmutables e idempotentes;
- formaliza envelope, protocolo y conflictos de sync;
- explicita que KDS multi-dispositivo sin WAN necesita servidor local;
- adelanta seguridad, tenancy, backups y observabilidad;
- añade criterios de aceptación por fase;
- registra riesgos y estrategia Git.
- ADR-010 ahora compara stack propio, alternativa híbrida Supabase+NestJS y Data API restringida mediante un spike bloqueante.
- `card_manual` quedó separado de la integración real con terminal/pasarela.
- La tabla de referencias se corrigió y dejó de usar estrellas o afirmaciones de producción como evidencia.
- El spike tiene timebox de 4 días hábiles y hard stop al quinto.
- Cada opción tiene gates, scoring y condiciones GO/NO-GO.
- packages/domain puede avanzar en paralelo sin framework, ORM, red ni almacenamiento.

## Decisiones humanas pendientes

- Ratificar que el v1 incluye Fases 0–3.
- Confirmar mercado, moneda, zona horaria, impuestos y CFDI.
- Confirmar modelo de licencia/comercial.
- Seleccionar hardware de piloto.
- Mantener el prototipo remoto intacto; cualquier reutilización exige licencia/autorización escrita y tarea explícita conforme a ADR-006.
- Confirmar si KDS LAN durante caída total es requisito de v1.

## Riesgos duraderos

- doble cobro o pérdida de venta;
- fuga de datos entre restaurantes;
- conflictos offline silenciosos;
- alcance v1 excesivo;
- dependencias de hardware/PAC/pagos;
- incumplimiento de licencias de referencias/dependencias;
- historia Git contaminada por artefactos;
- migraciones sin rollback.
