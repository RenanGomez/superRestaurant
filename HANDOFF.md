# HANDOFF

Última actualización: 2026-08-28

## Estado actual

El plan v2.2 está en implementación: el track neutral, CI, invariantes monetarias y contrato offline/sync quedaron en REVIEW, y ADR-010 sigue IN_PROGRESS. El proyecto aislado `ndblkcmdgpxsxylacutx` pasó probe Auth/RLS, auditoría 27/27, `db lint` y 15 evidencias remotas B con cierre limpio, incluido un rerun completo con TLS `verify-full` y CA/hostname autorizados. Las fronteras financiera y de rotación/revocación Auth ya están demostradas; B aún no obtiene GO porque faltan la migración desde un segundo proyecto/CI fresco y la inspección humana. El restore lógico exigido por el spike ya pasó; la recuperación física de desastre sigue pendiente como requisito operativo previo a producción. C permanece restringida a lecturas y A es NO-GO mientras use Auth de prueba. Aún no existen aplicaciones productivas y no se integró el prototipo remoto.

## Trabajo realizado

Las viñetas de esta sección conservan la evolución cronológica; cuando una cifra histórica difiere, prevalecen el estado actual y las entradas posteriores.

- Git inicializado en la carpeta local.
- origin configurado por HTTPS hacia RenanGomez/superRestaurant.
- fetch exitoso de origin/main y origin/master.
- AGENTS.md reemplazado por reglas específicas de superRestaurant.
- PLAN_MODERNIZACION_POS_RESTAURANTE.md actualizado a versión 2.2.
- TODO.md y PROJECT_NOTES.md actualizados.
- `.gitignore` raíz creado para dependencias, secretos, builds, cobertura, caches, CodeGraph, artefactos móviles y credenciales de firma; las plantillas `.env*.example` siguen siendo versionables.
- Monorepo raíz inicializado con pnpm 11.19.0, Turborepo 2.10.12, workspaces `apps/*`/`packages/*`, scripts orquestados y lockfile reproducible.
- README greenfield/API-first creado y el plan maestro copiado byte a byte en `docs/`.
- `packages/config`, `packages/shared-types` y `packages/domain` creados con ESLint/TypeScript compartidos, contratos tenant, Money, estados Order/OrderItem y pruebas.
- Reglas puras de modificadores añadidas en `packages/domain`: validan catálogo/grupo/producto, actividad, min/max por suma de cantidades, caps por opción, duplicados, moneda y precios; generan snapshots canónicos profundamente inmutables con identidad de grupo compatibles con totales históricos.
- ADR-007 propuesto y `packages/domain/order-totals.ts` implementado: snapshots financieros versionados, impuestos incluidos/excluidos, descuentos de línea/orden, propina, cálculo exacto e inmutabilidad profunda.
- ADR-004 propuesto y acompañado por contrato offline/sync y matriz de capacidades/conflictos auditados. Define protocolo, outbox, deduplicación, causalidad limitada, cursores pull, tombstones, autorización y políticas conservadoras para dinero/KDS sin implementar todavía Fase 3.
- `.github/workflows/ci.yml` creado con instalación frozen, lint, typecheck, tests y build, permisos mínimos y concurrencia por ref.
- Harness ADR-010 creado en `spikes/adr-010`, con ADR propuesta, fixtures 2×2, contrato de adapters, control en memoria y gates comunes reforzados.
- Opción A preparada en `spikes/adr-010/options/a-own-stack`: adapter PostgreSQL que implementa el contrato, migración aislada, frontera Nest, runner opt-in y restore lógico endurecido. El runner sale con código 2/NO-GO incluso si pasan checks PostgreSQL porque no existe Auth real.
- Opción B completada localmente en `spikes/adr-010/options/b-supabase-nest`: implementa `Adr010Adapter`; Nest verifica sesiones reales con Supabase Auth, deriva el actor y delega una única escritura crítica por PostgreSQL privado. Idempotencia, cleanup, guards de proyecto/TLS y backup/restore lógico fueron endurecidos. El runner permanece opt-in y no puede declarar GO.
- La migración B separa `adr010_b` expuesto para lecturas RLS de `adr010_b_private`, no expuesto, donde viven todas las funciones privilegiadas sin grants Data API.
- Bootstrap Auth B server-only añadido: crea dos usuarios desechables por ejecución, memberships 2×2 y cleanup FK-safe/concurrente/reintentable; `app_metadata` con run ID permite redescubrir usuarios si falla antes del marcador SQL. No imprime credenciales ni prueba el gate Auth.
- Probe RLS B ejecutado: dos sesiones publishable independientes demostraron lecturas propias, filtrado cross-scope y revocación efectiva en el siguiente read; el runner prepara fixtures estructurales y siempre cierra/limpia.
- Opción C preparada en `spikes/adr-010/options/c-supabase-direct`: cliente público encapsulado, solo lecturas scoped de órdenes/KDS, hardening SQL contra escrituras y preflights no probatorios. No contiene mutaciones críticas ni consume `Adr010Adapter`.
- El proyecto Supabase proporcionado `cxcnnhafchqslvgvkeye` fue enlazado. Se aplicaron `20260825000100_adr010_b_thin_slice.sql`, `20260826000100_adr010_c_read_only_hardening.sql` y `20260827000100_adr010_b_bootstrap_rls_hardening.sql`; el rollback está documentado, pero no se ejecutó.
- La auditoría remota read-only de catálogo/historial, acotada a `adr010_b` y `adr010_b_private`, pasó 24/24 checks. No inspecciona ni valida tablas ajenas del schema `public`.
- Al exponer `adr010_b`, un primer push de configuración materializó defaults no deseados de Auth. Se restauraron inmediatamente los valores remotos previos y la verificación posterior confirmó API, DB, Auth y Storage al día; `adr010_b` es la única diferencia intencional y el schema privado nunca fue expuesto.
- No se crearon usuarios Auth ni se ejecutaron bootstrap, probe, gates comunes, concurrencia, reset o restore contra el proyecto proporcionado.
- El proyecto nuevo `ndblkcmdgpxsxylacutx` fue confirmado vacío (0 relaciones de usuario/Auth/Storage/migraciones), recibió las tres migraciones ADR y configuró únicamente la exposición adicional de `adr010_b`; Auth/DB/Storage permanecieron sin cambios.
- Su auditoría estructural pasó 24/24 y el security advisor oficial quedó sin hallazgos. La contraseña restablecida permitió conectar por el pooler; las llaves publishable/secret se obtuvieron solo en memoria y `.env.adr010.local` siguió ignorado.
- La ejecución remota reveló y permitió corregir contratos JSONB, nombres snake_case, preparación de fixtures y cleanup duplicado. El probe RLS y las compuertas completas finalizaron con código 0. El reporte verificó 11 capacidades y mantuvo deliberadamente `eligibleForAdr010Go: false` por brechas conocidas.
- La comprobación final quedó en 0 usuarios marcados, 0 bootstrap rows, memberships, órdenes, líneas, snapshots, idempotencia, auditoría y eventos KDS. Permanecen 2 restaurantes y 4 sucursales deterministas del spike. No quedaron identidades ni datos operativos temporales.
- Limitación TLS: el pooler funcionó con cifrado requerido y compatibilidad libpq, pero sin CA del proyecto; no cuenta como evidencia de `verify-full` para producción.
- Payment/Refund y CashRegister/CashMovement puros quedaron implementados y auditados: estados/idempotencia/scope, refunds parciales y totales, cierre con diferencia preservada, compensaciones acumuladas y cursor global por dispositivo.
- La opción B recibió `20260828000100_adr010_b_financial_write_boundary.sql` y `20260829000100_adr010_b_financial_conflict_fix.sql`. La frontera Nest/Auth/PostgreSQL privada crea pagos y refunds de efectivo con idempotencia, supervisor verificado, movimientos inmutables, auditoría y cursor global por dispositivo.
- La primera auditoría remota descubrió una expectativa de FK demasiado débil en el auditor y `db lint` detectó objetivos `ON CONFLICT` incompatibles. Se corrigieron el auditor y una nueva migración versionada; no se editó la migración ya aplicada. La auditoría final pasó 27/27 y `db lint` quedó sin hallazgos.
- `test:option-b:gates` verificó 14 capacidades remotas y `test:option-b:rls` volvió a pasar. La limpieza final confirmó 0 usuarios Auth y 0 filas operativas/financieras/cursor; quedaron solo 2 restaurantes y 4 sucursales estructurales.
- El gate Auth B conserva refresh tokens únicamente en el mapa privado del adapter, deshabilita auto-refresh/persistencia, rota explícitamente con el SDK, valida identidad y `token_type`, reemplaza access+refresh de forma atómica, prueba una escritura crítica con el nuevo access token y exige rechazo del refresh vigente tras `signOut(..., "global")`. El reporte solo emite seis booleanos. La ejecución remota pasó y elevó la evidencia B a 15 capacidades; la limpieza posterior volvió a confirmar 0 usuarios y 0 datos.
- El intento TLS `verify-full` sin CA falló con `SELF_SIGNED_CERT_IN_CHAIN`. El usuario descargó `prod-ca-2021.crt`; se validó como `Supabase Root 2021 CA`, la conexión obtuvo certificado/hostname autorizados y el runner completo volvió a pasar usando `sslmode=verify-full&sslrootcert=...`. Por instrucción expresa no se volverá a controlar su navegador.
- Se añadió `B_SCORING.md`: gates 1,2,3,5,6,8,9,10 demostrados; gate 4 pendiente de humano y gate 7 parcial hasta ejecutar las cinco migraciones completas en otro proyecto fresco/CI. No asigna score antes de elegibilidad.
- Se añadió un runner fail-closed para proyecto remoto fresco. Verifica enlace CLI al mismo project ref, ausencia total de migraciones/usuarios Auth/Storage/relaciones de usuario, hace dry-run, repite checks anti-TOCTOU y solo aplica con un segundo opt-in. No crea ni elimina proyectos/cuentas.
- `packages/domain/src/order.ts` añadió el agregado puro `Order`/`OrderItem`: canal/mesa, scope explícito por línea, snapshots inmutables, altas, transiciones, cancelación total auditada y totales compartidos. La auditoría corrigió bypasses de líneas KDS, mutaciones después del cierre, total de orden cancelada y accessors alternantes.
- Payment/CashRegister ahora crean snapshots estables y revalidan agregados/historias rehidratadas, incluidos refunds, secuencias, referencias, compensaciones acumuladas y saldos de cierre. Transición Payment y cierre CashRegister exigen `eventId`/`idempotencyKey`, soportan replay determinista y detectan conflicto. Money/TaxSnapshot también rechazan formas runtime inválidas mediante errores de dominio.

## Git remoto

- SSH: la huella de GitHub fue aceptada, pero la autenticación falló con Permission denied (publickey).
- HTTPS: lectura y fetch verificados.
- Push: no ejecutado y autenticación de escritura no verificada.
- origin/main y origin/master contienen 10,427 rutas de node_modules.
- origin/main además contiene un prototipo legado.
- No se hizo merge, checkout, reset, rebase ni push; los documentos locales no fueron sobrescritos.
- Auditoría read-only de licencia: `origin/main@293a1551` y `origin/master@f87d5b25` no declaran licencia para código propio; `package.json` tampoco tiene campo `license`. No se reutilizó código del prototipo y queda bloqueado hasta autorización/licenciamiento escrito del titular.

## Cambios documentales

### AGENTS.md

Se eliminó todo el contexto ATS/candidatos/evaluaciones. La nueva versión regula arquitectura, dominio POS, dinero, pagos, tenancy, offline, seguridad, pruebas, UI, observabilidad, Git y delegación.

### Plan maestro

La versión 2.2:

- define piloto online y v1 offline;
- fija stack greenfield TypeScript;
- añade invariantes financieras;
- especifica sync causal/idempotente;
- separa offline por dispositivo de servidor LAN;
- añade seguridad, backups y observabilidad desde Fase 0;
- incorpora criterios de aceptación, ADRs, riesgos y estrategia Git.
- convierte ADR-010 en puerta bloqueante con tres opciones y un spike verificable;
- define `card_manual` sin confundirlo con cobro integrado;
- corrige información y licencias de proyectos de referencia.
- limita el spike a 4 días hábiles, con hard stop al quinto;
- define gates comunes, scoring ≥75/100 y GO/NO-GO por opción;
- autoriza packages/domain como track paralelo independiente.

## Bloqueos

- **Estrategia Git del prototipo:** ADR-006 fue aceptada por el humano. `origin/main` y `origin/master` quedan intactas; el greenfield usa la raíz separada `codex/modernizacion-fase0` y no reutiliza código legado sin licencia/autorización escrita.
- **Publicación Git:** HTTPS quedó verificado. El commit raíz `ceaffcb` se publicó en `origin/codex/modernizacion-fase0`; no hubo merge, rebase, force-push ni modificación de ramas legadas.
- Mercado/CFDI/hardware no bloquean toda Fase 0, pero sí sus módulos.
- **Regla fiscal definitiva:** ADR-007 solo resuelve invariantes técnicas. País, moneda inicial, tasas, exenciones, tratamiento fiscal de propina y CFDI requieren decisión humana y asesoría fiscal antes de producción.
- **GO de ADR-010 B:** el entorno aislado, los gates comunes, la frontera Payment/CashMovement, refresh/revocación, restore lógico y TLS `verify-full` ya existen; faltan ejecutar la migración completa en un segundo proyecto/CI fresco, obtener score elegible y completar la revisión humana de la frontera. La recuperación física de desastre es una evidencia operativa separada para producción. El proyecto anterior `cxcnnhafchqslvgvkeye` sigue siendo ajeno/no aislado y no debe usarse para gates destructivos.
- **Evidencia de ADR-010 A:** no hay Docker, PostgreSQL, Redis ni distribución WSL disponible en este equipo.
- **Implementación offline:** ADR-004 y sus especificaciones están en REVIEW, pero ADR-005 (almacenamiento local) sigue pendiente y ADR-010 condiciona Auth/persistencia. No afirmar que Web, Mobile o KDS funcionan offline.

## Siguiente acción recomendada

1. Revisar humanamente el `.gitignore` y la configuración raíz del monorepo; ADR-006 ya preserva las ramas legadas y publica el greenfield por separado.
2. Crear y autorizar un segundo proyecto Supabase vacío para `test:option-b:fresh-push`; después completar la inspección humana de `WRITE_FRONTIER.md` y el scoring B.

## Subagentes y verificación de la frontera financiera B

- `auditoria_final_finanzas_b` (razonamiento alto): auditó FKs, orden de gates y representación `bigint`; implementó correcciones acotadas en auditoría/preflight/gates.
- `completar_parcial_finanzas_b` (razonamiento alto): implementó restauración del cursor y la quinta migración correctiva, más auditoría, preflight y documentación técnica.
- `corregir_close_b` (razonamiento moderado): hizo `close()` reintentable y conservó errores múltiples de cleanup.
- Verificación exacta acumulada posterior a la integración: lint, typecheck, 70 pruebas de dominio + 57 del spike (127 pruebas Node) y build exitosos; última cobertura medida antes de añadir las tres propiedades: 96.26% líneas, 93.00% ramas y 98.19% funciones; `supabase db push --dry-run`; cinco migraciones aplicadas; auditoría 27/27; `supabase db lint` sin errores; 15 evidencias remotas; probe RLS; runner completo repetido con TLS `verify-full`; limpieza final 0 usuarios y 0 filas operativas.
- CodeGraph se consultó antes y después; el impacto de la frontera financiera queda contenido en el adapter/Nest/gates del spike y sus funciones SQL privadas. Rollback: las migraciones son aditivas; no se ejecutó rollback porque la evidencia y limpieza quedaron verdes.
- `implementar_agregado_order` (gpt-5.6-terra, razonamiento moderado): implementó y corrigió el agregado Order/OrderItem; `endurecer_agregados_financieros` (gpt-5.6-sol, razonamiento alto): cerró integridad de Payment/CashRegister; `validar_money_tax_runtime` (gpt-5.6-terra, razonamiento moderado): cerró validaciones Money/TaxSnapshot.
- `corregir_invariantes_order` (gpt-5.6-terra, razonamiento alto): corrigió cancelación total, terminalidad y accessors; `auditar_finanzas_reintento` (gpt-5.6-terra, razonamiento alto): reprodujo TOCTOU y añadió snapshots/idempotencia financiera. Una primera auditoría financiera independiente falló por límite de uso y no se usó como evidencia.
- `verificar_licencia_legado` (gpt-5.6-luna, razonamiento bajo): verificó refs/commits y ausencia de licencia del prototipo; `auditar_propiedades_dominio` (gpt-5.6-terra, razonamiento alto): añadió propiedades deterministas de Money, descuentos y caja sin dependencias.
- `auditar_gate4_gate8` (gpt-5.6-terra, razonamiento alto): auditó la frontera B y separó Gate 8 lógico ya demostrado de DR físico operacional; luego corrigió README, reporte estructurado y regresión. Gate 4 permanece pendiente de inspección humana y Gate 7 del segundo proyecto fresco.
- `auditar_cobertura_fase0_dominio` (gpt-5.6-terra, razonamiento alto): auditó cobertura neutral, aisló modificadores por restaurante y endureció estados runtime; `auditar_order_adversarial` (gpt-5.6-terra, razonamiento alto): reprodujo getters heredados y cierre prematuro, y corrigió ambos; `auditar_finanzas_adversarial_2` (gpt-5.6-terra, razonamiento alto): añadió eventos explícitos y scope de auditoría a Payment/Refund y cerró la pérdida de motivo al rehidratar caja.
- CodeGraph posterior indexó 55 archivos, 1,224 nodos y 3,149 relaciones; la frontera Order/Payment/refund permanece contenida en dominio o en los servicios Nest, puertos PostgreSQL privados, runners y pruebas del spike, sin `apps/` ni consumidores productivos. No hubo cambios de esquema, offline ni Git remoto en esta unidad.
4. Ejecutar la migración desde el segundo proyecto/CI fresco y completar la inspección humana, scoring y GO/NO-GO de ADR-010; mantener la recuperación física de desastre en el track operativo previo a producción.
5. Resolver la infraestructura de opción A: Docker no está instalado en este equipo, por lo que PostgreSQL/Redis locales aún no pueden levantarse; después ejecutar `test:option-a:gates`, que seguirá devolviendo NO-GO hasta implementar Auth real.
6. Mantener bloqueadas Auth, persistencia y Realtime definitivas hasta el GO/NO-GO.
7. Cerrar ADR-010 al quinto día como máximo.
8. Aceptar ADR-001 y configurar los componentes elegidos.
9. Revisar humanamente ADR-004 y, cuando corresponda iniciar Fase 3, prototipar ADR-005 antes de crear `packages/sync-engine`.

## Verificación

Esta sección es un historial acumulado de verificaciones. Las cifras anteriores (por ejemplo, tres migraciones o 24/24 checks) corresponden a cortes intermedios y no sustituyen la evidencia vigente de cinco migraciones y 27/27 checks.

- CodeGraph antes y después del cambio: 0 archivos/nodos/relaciones; no existe código fuente local que analizar y `.codegraph/` quedó excluido.
- Se validó el remoto con ls-remote y fetch.
- `git check-ignore -v --no-index` verificó reglas para `node_modules`, `.env.local`, `.codegraph`, `.next`, `dist`, `coverage`, Android y credenciales de firma; las reglas negadas conservan `.env.example` y `.env.production.example`.
- `pnpm install --frozen-lockfile`: exitoso con pnpm 11.19.0.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`: exitosos mediante Turborepo 2.10.12; 0 paquetes/tareas porque todavía no se crearon workspaces funcionales.
- CodeGraph posterior al monorepo: 2 YAML indexados (`pnpm-workspace.yaml`, `pnpm-lock.yaml`), 0 nodos y 0 relaciones; no hay consumidores o referencias compartidas que romper.
- No había UI que verificar para estos cambios fundacionales.
- Plan raíz y copia en `docs/`: SHA-256 idéntico `551267BCAF3B9DB69BAC828009BA23D85E7B8413D925BDFF722F4BB620730FD4`.
- Verificación fresca directa por workspace: lint real, typecheck, build y tests exitosos; dominio 13/13 pruebas.
- CodeGraph posterior: 12 archivos, 118 nodos y 210 relaciones; `Money` impacta 12 símbolos internos y `transitionOrderItem` 2 símbolos internos, sin consumidores externos conocidos.
- `.test-dist` no permanece tras pruebas y su regla de ignore fue verificada.
- El sandbox bloqueó procesos hijos `pnpm --recursive` con `EPERM`; se repitieron fuera del sandbox y pasaron. Los intentos previos de pasar `--force` mediante el script raíz reenviaron el argumento a TypeScript y no se usan como evidencia.
- CI: YAML validado con parser temporal, revisión independiente sin hallazgos y CodeGraph reconoce `.github/workflows/ci.yml`; la ejecución real en runner GitHub queda pendiente de publicar una rama autorizada.
- Harness ADR-010: lint, typecheck, build y 15/15 pruebas frescas exitosas; detecta fugas de lectura/escritura, estado parcial/huérfano, duplicados, pérdida/fuga KDS, revocación tardía, migración/restore incompletos, secretos y evidencia insuficiente.
- CodeGraph posterior al harness: 19 archivos, 204 nodos y 521 relaciones; `Adr010Adapter` afecta solo harness/gates/adaptador de referencia, sin dependencias productivas.
- Verificación integrada del 2026-08-26: `pnpm install --frozen-lockfile --yes`, lint, typecheck, test y build exitosos; 13 pruebas de dominio, 15 del harness, 5 preflights A, 9 B y 6 C (48 pruebas Node en total).
- Verificación monetaria posterior del 2026-08-26: 9 pruebas nuevas de totales; suite integrada queda en 22 pruebas de dominio + 35 del spike (57 pruebas Node), con instalación frozen, lint, typecheck y build exitosos.
- Auditoría CodeGraph de C reportó 30 archivos, 327 nodos y 742 relaciones; `SupabaseDirectReadClient` solo afecta 6 símbolos internos y C no consume `Adr010Adapter`. La reconsulta final del agente principal falló tres veces con `Transport closed`; se hizo inspección manual dirigida y la limitación queda registrada.
- CodeGraph del auditor A/B confirmó rutas internas: el runner es el único consumidor del adapter A y del bootstrap B; restore solo alcanza validación allowlist/comparación de referencias, y bootstrap/cleanup solo alcanza descubrimiento server-only por metadata. La reconsulta posterior del agente principal volvió a fallar para status e impactos con `Transport closed`.
- CodeGraph final volvió a estar operativo: 41 archivos, 494 nodos y 1,089 relaciones. `SupabaseAdr010CriticalOrderService` afecta 7 símbolos internos de la frontera Nest; `withAdr010BAuthenticatedFixtures` afecta solo su archivo/runner y no hay consumidores productivos.
- CodeGraph posterior a totales: 43 archivos, 568 nodos y 1,346 relaciones. `OrderItemPriceSnapshot` impacta 13 símbolos, todos internos a `order-totals`; no existen consumidores externos ni referencias productivas que migrar.
- CodeGraph antes y después del contrato offline: 43 archivos, 568 nodos y 1,346 relaciones. Solo encontró cursores/idempotencia internos del spike ADR-010; no existe motor de sync productivo ni consumidores que migrar.
- Documentación offline: fences y tablas Markdown balanceados, referencias ADR verificadas y `git diff --check` sin errores. La validación integrada posterior mantuvo instalación frozen, lint, typecheck, 57 pruebas Node y build exitosos.
- `.test-dist` fue limpiado por las suites y permanece ignorado. No se detectaron archivos `.env` reales ni secretos versionables.
- Supabase CLI 2.109.1 autenticó y enlazó el ref `cxcnnhafchqslvgvkeye`. Las tres migraciones experimentales quedaron aplicadas; la auditoría remota read-only reportó 24/24 checks aprobados para los schemas ADR. Docker no está instalado.
- El security advisor falló por errores preexistentes del schema `public` ajeno al spike (tres tablas sin RLS y una función con `search_path` mutable), evidencia de que el proyecto no es aislado. Por seguridad no se ejecutaron Auth desechable, gates destructivos, reset, concurrencia ni restore.
- El push de configuración que expuso `adr010_b` alteró temporalmente defaults de Auth; la reversión exacta se aplicó y una comparación posterior confirmó API/DB/Auth/Storage al día. No hubo funcionalidad offline ni interacción Git remota.
- La primera reinstalación final quedó sin red dentro del sandbox después de recrear `node_modules`; se interrumpió y se repitió con el acceso aprobado usando exactamente el lockfile. No se descargaron versiones diferentes ni cambió el lockfile.
- Verificación final del 2026-08-27: instalación frozen reproducible, lint, typecheck, 61/61 pruebas Node y build exitosos; no quedaron `.test-dist`, archivos `.env` reales ni metadata Supabase versionada.
- `supabase migration list --linked` confirmó las tres versiones locales/remotas y `supabase db push --linked --dry-run` reportó la base al día. CodeGraph final indexó 43 archivos, 626 nodos y 1,500 relaciones; el impacto de `SupabaseNestAdr010Adapter` permanece contenido en su módulo, sin consumidores productivos.
- Verificación de modificadores del 2026-08-27: pipeline global lint/typecheck/test/build exitoso con 30 pruebas de dominio y 39 del spike (69 pruebas Node). `git diff --check` pasó; no quedaron `.test-dist` ni archivos `.env` reales.
- CodeGraph posterior indexó 45 archivos, 715 nodos y 1,665 relaciones. `ModifierPriceSnapshot` impacta 10 símbolos internos de `order-totals`; `createModifierSelectionSnapshot` solo su propio módulo y no tiene consumidores productivos.
- Verificación global posterior a pagos/caja: lint, typecheck, 46 pruebas de dominio + 39 del spike (85 pruebas Node) y build exitosos; `git diff --check` pasó y no quedaron `.test-dist`.
- CodeGraph final indexó 49 archivos, 915 nodos y 2,173 relaciones. `refundPayment` y `appendCashMovement` solo afectan sus propios módulos; no existen consumidores productivos todavía.
- Verificación remota final B del 2026-08-27: `test:option-b:rls` y `test:option-b:gates` exitosos; 11 capacidades reportadas, `eligibleForAdr010Go: false` deliberado, cleanup final con 0 usuarios/filas operativas temporales.
- Auditoría posterior: 24/24 checks, tres migraciones locales/remotas idénticas, `db push --dry-run` al día y `db lint` sin errores en los schemas ADR.
- Pipeline global posterior: lint, typecheck, 46 pruebas de dominio + 43 del spike (89 pruebas Node) y build exitosos.
- Verificación global del 2026-08-28 posterior a propiedades financieras: lint, typecheck, 69 pruebas de dominio + 56 del spike (125 pruebas Node) y build exitosos; 96 casos Money, 61×4 permutaciones de descuento y 48 secuencias de caja pasaron con semillas fijas; suites sin `.test-dist` residual.

## Subagentes

- implementar_gitignore — modelo gpt-5.6-luna, razonamiento bajo.
- Alcance: implementación mecánica del `.gitignore` raíz y verificación inicial; modificó solo `.gitignore`.
- revisar_gitignore — modelo gpt-5.6-luna, razonamiento bajo.
- Alcance: revisión independiente y corrección acotada de artefactos móviles, credenciales de firma y logs; modificó solo `.gitignore`.
- implementar_monorepo — modelo gpt-5.6-terra, razonamiento moderado.
- Alcance: configuración raíz pnpm/Turborepo y verificación inicial; creó `package.json`, `pnpm-workspace.yaml` y `turbo.json`.
- revisar_monorepo_turbo — modelo gpt-5.6-terra, razonamiento moderado.
- Alcance: cerró la integración real con Turborepo, fijó `turbo@2.10.12`, generó `pnpm-lock.yaml` y verificó los cuatro pipelines.
- documentar_greenfield — modelo gpt-5.6-luna, razonamiento bajo.
- Alcance: README y copia byte a byte del plan en `docs/`.
- crear_config_tipos — modelo gpt-5.6-terra, razonamiento moderado.
- Alcance: presets TypeScript, shared-types neutrales, pruebas de tipos y lockfile.
- implementar_dominio_pos — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: Money, errores, máquinas de estados y pruebas unitarias iniciales.
- auditar_dominio_pos — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: auditoría financiera/estados, evidencia inmutable de cancelación y ampliación a 13 pruebas.
- configurar_eslint — modelo gpt-5.6-terra, razonamiento moderado.
- Alcance: ESLint real, regla de imports prohibidos y ajuste TypeScript 7.0.2 a 6.0.3 por compatibilidad verificada.
- implementar_ci — modelo gpt-5.6-terra, razonamiento moderado.
- Alcance: workflow GitHub Actions, verificación de versiones oficiales, parser YAML y pipeline local.
- revisar_ci — modelo gpt-5.6-luna, razonamiento bajo.
- Alcance: revisión independiente de permisos, eventos, caché, reproducibilidad y ausencia de secretos.
- crear_harness_adr010 — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: harness Día 1, fixtures, contrato, adaptador de referencia, ADR/README y pruebas negativas iniciales.
- auditar_harness_adr010 — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: reforzó gates contra falsos verdes, separó inspección humana de frontera y actualizó claves Supabase a publishable/secret.
- scaffold_opcion_b — modelo heredado, razonamiento moderado.
- Alcance: inició la opción B; alcanzó límite de uso tras dejar una implementación parcial, que fue inspeccionada e integrada por el agente principal.
- auditar_opcion_b — modelo heredado, razonamiento alto.
- Alcance: auditó seguridad/tenancy de B, separó configuración pública/servidor, endureció SQL/RPC/Auth FKs y dejó explícitas las brechas no probadas.
- scaffold_opcion_c — modelo heredado, razonamiento moderado.
- Alcance: implementó el cliente público de solo lectura, hardening SQL, runner opt-in y preflights de C.
- auditar_opcion_c — modelo heredado, razonamiento alto.
- Alcance: encapsuló el SDK, endureció claves/cursor/scope/revocaciones y confirmó que C no puede ser frontera de escritura crítica.
- implementar_bootstrap_b — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: Admin API server-only, usuarios desechables, memberships deterministas, cleanup FK-safe y preflights B; no ejecutó remoto.
- scaffold_opcion_a — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: adapter PostgreSQL A, migración thin-slice, frontera Nest, runner opt-in, dependencias `pg` y preflights; no pudo ejecutar PostgreSQL por falta de infraestructura.
- auditar_adr010_a_b — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: auditoría cruzada de persistencia/tenancy/Auth; bloqueó identificadores controlados por backup, conflictos silenciosos y usuarios Auth huérfanos, añadió regresiones y mantuvo NO-GO explícito.
- implementar_principal_jwt_b — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: inició el principal JWT B y dejó cambios parciales antes de agotar cuota; el orquestador los inspeccionó y reasignó.
- preparar_probe_rls_b — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: inició fixtures autenticados/probe RLS; sus cambios parciales se integraron en la recuperación posterior.
- completar_auth_rls_b — modelo gpt-5.6-luna, razonamiento alto.
- Alcance: recuperó cambios parciales, cerró principal verificado, probe RLS, scripts, pruebas y documentación sin ejecutar remoto.
- privatizar_rpc_b — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: movió funciones privilegiadas a schema privado y cambió escritura/bootstrap a PostgreSQL server-only conforme a guías oficiales.
- auditar_auth_rls_b — modelo gpt-5.6-luna, razonamiento alto.
- Alcance: corrigió cleanup parcial/concurrente con run IDs, endureció ACL privadas y verificó 9 preflights B.
- redactar_adr007_monetario — modelo gpt-5.6-luna, razonamiento alto.
- Alcance: ADR-007 neutral, orden de cálculo, redondeo, snapshots, ejemplos y bloqueos fiscales; no modificó código.
- implementar_totales_dominio — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: snapshots y cálculo puro de líneas/orden, impuestos, descuentos, propina, prorrateo v1 y pruebas iniciales.
- auditar_totales_monetarios — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: eliminó efectos laterales, completó versiones/estación/unidad, estabilizó desempate, alineó ADR y añadió regresiones financieras.
- redactar_contrato_sync — modelo gpt-5.6-luna, razonamiento alto.
- Alcance: especificó topología, envelope, push/pull, outbox, deduplicación, versiones, tombstones, seguridad y pruebas sin implementar almacenamiento ni motor de sync.
- matriz_offline_conflictos — modelo gpt-5.6-luna, razonamiento alto.
- Alcance: definió capacidades por cliente/conectividad, conflictos por entidad, mensajes UI y failure injection con política financiera conservadora.
- auditar_contrato_offline — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: auditó causalidad, idempotencia, cursores, revocación, dinero/KDS y corrigió ambos documentos contra doble efecto, pérdida de pull y falsas garantías offline.
- crear_adr004 — modelo gpt-5.6-luna, razonamiento bajo.
- Alcance: creó el ADR breve de topología y enlazó las especificaciones auditadas; no duplicó contratos ni prometió implementación.
- auditar_plan_pos — modelo gpt-5.6-terra, razonamiento moderado.
- Alcance: auditoría independiente de contradicciones, decisiones, secciones faltantes y criterios de aceptación.
- No editó archivos. Sus hallazgos se integraron en el plan v2.
- revisar_plan_claude — modelo gpt-5.6-terra, razonamiento moderado.
- Alcance: revisión independiente de las aclaraciones añadidas por Claude. No editó archivos; sus hallazgos se integraron en el plan v2.1.
- completar_adapter_b — modelo heredado, razonamiento alto.
- Alcance: implementó el adapter B con Auth real, frontera Nest/PostgreSQL privada, lecturas RLS, migración/ACL checks, backup/restore, cleanup y runner opt-in; mantuvo `eligibleForAdr010Go: false`.
- preparar_migraciones_b_c — modelo heredado, razonamiento alto.
- Alcance: versionó el hardening C como migración, completó configuración Supabase, ignores, preflights y documentación de rollback.
- auditar_adapter_migraciones_b — modelo heredado, razonamiento alto.
- Alcance: auditó seguridad/tenancy/restauración; ligó idempotencia al actor/scope/payload, endureció backup/restore, cleanup, guards de ref/TLS y ACL de bootstrap.
- crear_auditoria_sql_remota_b — modelo heredado, razonamiento alto.
- Alcance: creó la auditoría SQL estrictamente read-only y la migración de hardening RLS/ACL para `bootstrap_users`; corrigió aliases SQL y añadió regresión local.
- actualizar_documentacion_final — modelo heredado, razonamiento moderado.
- Alcance: consolidó TODO/PROJECT_NOTES/HANDOFF con la evidencia remota, el incidente restaurado y el requisito de repetir gates en un proyecto aislado; no ejecutó acciones remotas.
- implementar_modificadores_dominio — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: implementó catálogo y selección pura de modificadores, snapshots históricos compatibles, errores de dominio, exports y pruebas unitarias.
- auditar_diseno_modificadores — modelo gpt-5.6-luna, razonamiento alto.
- Alcance: definió invariantes/casos límite y auditó el cambio real; corrigió entradas no-string para producir errores de dominio deterministas y añadió regresión.
- implementar_payment_dominio — modelo gpt-5.6-terra, razonamiento alto.
- Alcance: implementó Payment/Refund inmutables, estados, idempotencia, scope, evidencia y pruebas.
- auditar_payment_dominio — modelo gpt-5.6-luna, razonamiento alto.
- Alcance: corrigió refunds parciales/total y conflictos idempotentes de scope/moneda; añadió regresiones.
- disenar_cash_register — modelo gpt-5.6-luna, razonamiento alto; interrumpido tras dejar una implementación funcional para limitar el tiempo de la subtarea.
- Alcance: diseñó e implementó la primera versión pura de CashRegister/CashMovement y pruebas.
- auditar_cash_register — modelo gpt-5.6-luna, razonamiento alto.
- Alcance: endureció cursor global por dispositivo, compensaciones acumuladas, evidencia/scope, integridad y saldo contado; amplió pruebas.
- inspect_gate_runner — modelo gpt-5.6-luna, razonamiento bajo.
- Alcance: revisión read-only del runner; confirmó que código 0 representa éxito técnico aunque `eligibleForAdr010Go` sea falso y enumeró brechas deliberadas.
- fix_auth_cleanup_json — modelo gpt-5.6-terra, razonamiento moderado.
- Alcance: corrigió serialización JSONB en bootstrap y dos rutas de cleanup, mapeo snake_case, fixtures del probe RLS y diagnóstico PostgreSQL redactado; añadió cuatro regresiones y validó 43 pruebas del spike.

## Nota de seguridad

No se publicaron secretos ni archivos. Las claves se mantuvieron en memoria y la contraseña permaneció en `.env.adr010.local` ignorado. Los gates crearon únicamente identidades/datos marcados y desechables en el proyecto aislado; el cleanup final dejó 0 usuarios y 0 filas operativas temporales. No hubo interacción Git remota ni cambios offline.
