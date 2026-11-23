# Plan autónomo al 100 % — superRestaurant

Versión 1 · 2026-11-22 · nivel D (orquestador). Sustituye como plan de ejecución a `mvp-cierre-2026-11-22.md`; el diagnóstico de avance de ese documento sigue vigente.

---

## 0. Mandato

Instrucción de Emmanuel del 2026-11-22 (prevalece sobre AGENTS.md §3.1, §5 y §19 donde los contradiga; registrada en PROJECT_NOTES y HANDOFF):

1. No se espera aprobación humana durante la construcción. La aprobación de los revisores y testers que lance el orquestador basta para integrar. Emmanuel aprueba el producto terminado.
2. Objetivo: 100 % de todas las fases del plan maestro (0–8), con un sistema propio de pruebas y revisión.
3. Loop autónomo sin bloqueos ni esperas humanas, con aprendizaje y con un rumbo fijo que no repita trabajo ni gaste cuota en tareas sin valor.
4. Commits frecuentes con disciplina empresarial: ningún cambio pisa a otro y ningún merge rompe `main`.
5. Todos los motores trabajan en paralelo siempre. Claude solo orquesta, con **Sonnet 5.5, esfuerzo medio**.
6. Disparador AO: todo el trabajo delegado se lanza con `ao spawn` (agent-orchestrator), no con `enqueue/drain`.

### 0.1 Autorizaciones permanentes (sin preguntar)
- Crear ramas, hacer push de ramas de trabajo, abrir PR y **fusionar PR a `main`** cuando pase todas las puertas de §4.
- Activar y ajustar la protección de rama de `main` y los workflows de CI.
- Decidir ADRs técnicas (motor de almacenamiento offline, colas, etc.) con investigación previa y registro en `docs/adr/`.
- Aplicar migraciones al proyecto Supabase de desarrollo, por lotes, al cerrar cada hito: preflight de solo lectura → verificación rollback-only → aplicar → postcheck (procedimiento en la memoria `remote-migration-apply-procedure`). El modo auto de Claude Code bloquea el acceso a la base remota, así que ese paso puede pedir **un** clic de permiso por lote; no detiene el resto del loop.
- Instalar dependencias declaradas por el proyecto, incluido Node 24.19.0 (`engines`).

### 0.2 Lo que sigue siendo humano (se acumula y se presenta al final, nunca bloquea)
- Deploy a producción, dominios, facturación, credenciales y secretos reales.
- Contratar proveedores externos reales (PAC/CFDI, pasarela o terminal de pago, agregadores de delivery). Se construyen los adaptadores con un proveedor falso y pruebas de contrato; la conexión real queda como puerta final.
- Datos reales de clientes y borrado de datos reales.
- Force-push, reescribir historia o borrar ramas con trabajo sin integrar: **prohibido** para todos, incluido el orquestador.

Cada decisión que normalmente requeriría a Emmanuel la toma el orquestador con el supuesto más conservador, la anota en `docs/agentic/DECISIONS_PENDING.md` y sigue. Emmanuel revisa esa lista al final.

---

## 1. Alcance: hitos hasta el 100 %

| Hito | Contenido | Sale cuando |
|---|---|---|
| **M0 Plataforma** (≈1 día) | Loop, CI ampliado, protección de rama, backlog, reglas AO, Node 24, agy en AO | Un ciclo completo de prueba: spawn → PR → CI → revisión → merge, sin intervención |
| **M1 MVP v1.0** (Fases 0–2 + producción mínima) | Integrar `feat/smoke-r1`, z2b, huecos de captura/mobile/KDS, E2E de los 12 journeys, seguridad, observabilidad, runbooks | 12 journeys E2E verdes en 3 corridas nocturnas seguidas, cero P1 abiertos, migraciones reproducibles desde cero |
| **M2 v1.1 Offline** (Fase 3) | sync-engine (outbox, reintentos, idempotencia), almacenamiento local mobile y web (ADR), PWA, `POST /sync`, merge determinista, UI de pendientes, prueba de conflictos con dos dispositivos | Suite `e2e:offline` y pruebas de conflicto verdes; matriz offline documentada por cliente/operación |
| **M3 Inventario** (Fase 4) | insumos, almacenes, movimientos inmutables, recetas y descuento por venta, proveedores y compras, stock mínimo, costeo promedio | Integración con ventas probada; movimientos compensatorios probados |
| **M4 Gestión** (Fase 5) | dashboard reconciliable, reportes y exportación Excel/PDF, CRM/consentimiento/lealtad, empleados/asistencia/comisiones, rentabilidad | Reportes cuadran contra órdenes y pagos en pruebas de integración |
| **M5 Fiscal y canales** (Fase 6) | adaptador CFDI 4.0 con PAC falso, `pending_invoice`, `PaymentProvider` con proveedor falso, refunds y conciliación, webhooks de agregadores idempotentes, pedido web/QR/kiosco | Pruebas de contrato y de replay de webhooks verdes; proveedores reales en §0.2 |
| **M6 Multi-sucursal y lanzamiento** (Fase 7) | consolidado multi-sucursal, auditoría de seguridad, carga, respaldo/DR, importación CSV | Prueba de carga con capacidad documentada; restauración probada |
| **M7 Expansión** (Fase 8) | reservaciones y lista de espera, promociones y tarjetas de regalo; ADR de rutas, franquicias y central de producción | Funciones con E2E; ADRs registradas |

Al cerrar M1 se genera el paquete de prueba humana del MVP (smoke HTML + guía). El loop no espera la respuesta y sigue con M2. Los hallazgos de Emmanuel entran al backlog como prioridad P0.

---

## 2. Roles y capacidad

| Rol | Quién | Hace | No hace |
|---|---|---|---|
| Orquestador | Claude, sesión principal, **Sonnet 5.5 medio** | Ticks del loop, despacho, merges, documentos de seguimiento, decisiones | Escribir código, revisar diffs línea a línea, leer archivos grandes |
| Worker rápido | `opencode` (DeepSeek V4.1 Flash, OpenCode Go) · hasta **4** a la vez | Tests, piezas mecánicas y pequeñas, E2E, fixes de CI | Nivel A |
| Worker UI/medio | `agy` (Gemini, Antigravity) · hasta **3** | UI web/mobile/KDS, piezas medianas, investigación, revisión | — |
| Worker difícil | `codex` (ChatGPT Plus, cuenta B) · **1** por cuenta | Nivel A: SQL, dinero, sync, auth, concurrencia; bugs difíciles | Tareas triviales |
| Revisores | `ao review trigger --agent <otra familia>` | Revisión cruzada de cada PR | Revisar su propio PR |
| Respaldo | subagente Claude (`implementer-claude`, `reviewer`) | Solo si dos motores fallaron la misma tarea o están sin cuota; se anota en HANDOFF | Trabajo normal |

**Paralelismo obligatorio:** en cada tick, si un motor tiene capacidad libre y existe un ítem listo de su carril, se despacha. Si su carril no tiene ítems listos, toma uno del carril de relleno, en este orden: (1) revisiones pendientes, (2) pruebas faltantes de la lista de cobertura de §4.4, (3) deuda registrada con `shortcut:`. Nunca se inventa trabajo fuera del backlog.

---

## 3. El loop

### 3.1 Backlog fijo: la brújula
- Archivo único versionado: `docs/agentic/backlog.json`. Cada ítem tiene:
  `id`, `milestone`, `phase`, `level` (A–D), `lane` (codex|agy|opencode), `paths` (conjunto de bloqueo), `deps`, `acceptance` (comandos exactos y criterios visibles), `etaMin`, `attempts`, `status` (`ready|running|pr|review|merged|parked|cancelled`), `sessionId`, `pr`, `parent`.
- El backlog de cada hito lo genera el orquestador al abrir el hito: agy lee TODO, el plan maestro y CodeGraph en modo solo lectura y propone; el orquestador recorta y congela. **Nada se ejecuta si no está en el backlog.**
- Solo entran ítems nuevos durante un hito si nacen de un fallo de CI, de un hallazgo P1/P2 de revisión o de un E2E rojo. Siempre llevan `parent` y justificación. Los P3 van a `docs/agentic/debt.md` y no se ejecutan hasta el cierre del hito.
- Avance medible: `% hito = merged / (total − cancelled)`. Lo publica cada tick en `docs/agentic/status.md`.

### 3.2 Tick del orquestador
Script `tools/agentic/loop-tick.ps1` (nivel D, lo escribe un worker en M0). Junta en una sola salida de ≤40 líneas: `ao session ls --project superrestaurant`, `gh pr list` con CI y revisión, el estado de `main`, el backlog y la cuota. El orquestador nunca lee logs completos.

Cada tick:
1. **Conciliar**: sesiones terminadas → actualizar el ítem; sesiones `stuck`/`needs-input` → responder con `ao send` usando el supuesto conservador, o reasignar.
2. **Fusionar**: PRs verdes y aprobados, uno por uno (§5.3).
3. **Proteger `main`**: si el CI de `main` está rojo, se activa el freno de §6.3 antes de cualquier despacho.
4. **Despachar**: ítems `ready` con dependencias fusionadas y `paths` libres, hasta los límites por motor.
5. **Registrar**: `status.md`, métricas y lecciones nuevas.
6. **Re-armar**: `ScheduleWakeup` (ver 3.3). Un tick nunca termina sin wake armado mientras queden ítems.

### 3.3 Ritmo sin esperas humanas
- **Reacciones de AO**: el daemon devuelve al worker los fallos de CI y los comentarios de revisión (`review auto-inject`). Los bucles de corrección corren sin el orquestador.
- **Wake del orquestador**: `ScheduleWakeup` con `min(ETA de la ola × 1.5, 20 min)`. Si no hay ítems en curso y quedan ítems bloqueados por merges, 10 min. Si no queda nada `ready` ni en curso, se cierra el hito o se abre el siguiente; el loop nunca se queda en espera vacía.
- **Respaldo duradero**: `ao automation create` con un tick cada 30 min (`kind orchestrator`, harness agy) que solo ejecuta `loop-tick.ps1` y escribe una alerta si detecta sesiones muertas o el CI de `main` rojo. Sirve si la app de Claude se cierra.
- **Hechos de AO que el loop respeta** (documentación oficial del repo de ComposioHQ, verificada el 2026-11-22):
  - AO devuelve al worker dueño de la rama los checks fallidos, los comentarios de revisión y los conflictos de merge.
  - AO **no** fusiona solo: el merge lo hace el orquestador con `ao pr merge` y los parámetros `--url` y `--expected-head-sha`, ambos obligatorios.
  - `ao report --needs-input` llega de inmediato. `--stuck` interrumpe al orquestador como máximo una vez cada 3 min por worker. `--done` llega agrupado.
  - Los reportes solo llegan al orquestador **activo** del proyecto, por eso el orquestador debe mantener viva su sesión AO. Si no la hay, los reportes quedan pendientes y el tick de respaldo los recoge.
  - Las claves de reacciones (`ci-failed` con reintentos, `agent-stuck` con umbral, `approved-and-green`) solo aparecen en espejos de terceros de una versión anterior, así que no se activan hasta comprobarlas en M0-4.
- **Corte de iteración** (patrón Ralph/Osmani): una tarea por worker, estado en disco (backlog), puertas objetivas como contrapresión, tope de intentos y salida por «N ticks sin commit nuevo». Terminar el backlog no prueba que sea el producto correcto: por eso la puerta de hito son los journeys E2E, no el conteo de ítems.
- **Nocturna**: automatización diaria a las 03:00 (America/Hermosillo) en un worker opencode: suite completa, `e2e:all`, verificadores PostgreSQL desde cero y buttonmash sobre `main`. Cada rojo se convierte en un ítem P0.

### 3.4 Aprendizaje del sistema
- `docs/agentic/LESSONS.md` (máximo 150 líneas, curado): cada fallo de CI repetido, hallazgo de revisión P1/P2 o tarea `parked` produce una regla concreta («en migraciones X, siempre Y»). Se inyecta a todos los workers vía `ao project set-config --agent-rules-file docs/agentic/WORKER_RULES.md`, que incluye LESSONS.
- `docs/agentic/engine-stats.json`: éxito y número de intentos por motor × tipo de tarea. Si un motor baja de 60 % de éxito en un tipo (con al menos 5 casos), el ruteo de ese tipo cambia de motor.
- Digest semanal: un worker agy lee los PRs cerrados, las revisiones y los `parked` de la semana, y propone hasta 10 lecciones nuevas y las que deben borrarse. El orquestador decide.
- Las plantillas de brief (`docs/templates/CONTEXT_PACKET.md`) se actualizan cuando una lección se repite tres veces.

---

## 4. Sistema de pruebas y revisión (sustituye la aprobación humana)

### 4.1 Puertas por PR
| Puerta | Quién | Qué |
|---|---|---|
| G1 local | worker | `pnpm lint && pnpm typecheck && pnpm test` del alcance (turbo `--filter`); salida real pegada en el PR |
| G2 CI | GitHub Actions | Job `verify` actual (lint, typecheck, test, build) + **`pg-verify`** nuevo (PostgreSQL 17 de servicio: migraciones desde cero, `supabase/tests`, verificadores `verify:*:rollback`, `test:http:local`) + **`e2e-smoke`** nuevo (Playwright desktop y mobile contra API y web locales con datos semilla) |
| G3 revisión | otra familia vía `ao review trigger` | C: 1 revisor · B: 1 revisor (2 si toca autorización) · A: 2 revisores de familias distintas (codex + agy; si escribió codex, agy + opencode) |
| G4 invariantes | CI | Para nivel A: pruebas de aislamiento entre tenants, idempotencia y doble envío, y dinero sin float, según AGENTS §15 |

Un PR se fusiona solo si G1–G4 están en verde y no tiene hallazgos P1/P2 abiertos. Las revisiones respetan los topes de AGENTS §19.3: C 1 ronda, B 2, A 3. Lo que quede tras el tope pasa a `debt.md` si es P3; si es P1/P2, el ítem pasa a `parked` y sale una tarea nueva con otro motor.

### 4.2 Pruebas de aceptación por journey (el nuevo «DONE»)
- Una spec Playwright por cada journey del plan §4.2, en `apps/web/e2e/journeys/` (y mobile donde aplique), con datos semilla deterministas.
- Las 114 tareas en REVIEW se mapean a journeys. Una tarea pasa a **`DONE-auto`** cuando su journey está verde en CI y en la nocturna; ese estado nuevo se registra en TODO. `DONE` sigue reservado a Emmanuel al final.
- Verificación visual automática: capturas en escritorio y 390×844 revisadas por agy (tiene visión): consola limpia, targets de 44 px, sin `alert/confirm/prompt`. Sustituye a la verificación visual humana durante la construcción.

### 4.3 Puerta de hito
- Journeys del hito verdes en 3 nocturnas seguidas.
- Migraciones reproducibles desde cero y aplicadas al Supabase de desarrollo con postcheck (§0.1).
- Cero P1 abiertos; los P2 abiertos se listan en el informe del hito.
- Tag `m<N>-rc<k>` en `main` y smoke HTML del hito regenerado (§19.5).

### 4.4 Lista de cobertura obligatoria (también carril de relleno)
Aislamiento entre restaurantes y sucursales · dinero y redondeo · máquinas de estado · doble envío/doble cobro · cancelación/reembolso · reconexión y conflictos offline · inventario compensatorio · permisos de supervisor · migraciones desde cero y sobre la versión anterior. Al abrir M1, opencode genera un inventario de qué está cubierto y qué no; cada hueco es un ítem.

---

## 5. Git empresarial

### 5.1 Ramas y PRs
- **Trunk-based** sobre `main`. Cada ítem tiene su sesión AO, su worktree, su rama `ao/<session>/root` desde `main` y un solo PR.
- PRs pequeños: guía de menos de 400 líneas cambiadas sin contar tests ni archivos generados. Un ítem más grande se parte en el backlog.
- **Commits de checkpoint**: el worker hace commit y push en cada paso verde, sin esperar al final, para que el trabajo nunca se pierda. Al fusionar se hace squash con un mensaje conventional commit (`feat(api): …`, con el id del ítem).
- Primer movimiento de M0: integrar `feat/smoke-r1` a `main` con un PR que pase CI, después de corregir z2b.

### 5.2 Protección de `main` (se activa en M0)
Required checks: `verify`, `pg-verify`, `e2e-smoke` · branch actualizada antes de fusionar · historia lineal · sin force-push · sin push directo (también para el orquestador: sus documentos van por un PR `chore(docs)` que se fusiona solo en cada cierre de ola).

### 5.3 Merge serializado (cola propia)
- El orquestador fusiona **un PR a la vez** con `ao pr merge --expected-head-sha <sha revisado>`. El daemon rechaza el merge si el head cambió.
- Si un PR quedó atrás de `main`, `ao send` le pide al worker rebase sobre `main` y nueva corrida de CI. No se fusiona nada que no haya pasado CI sobre el `main` actual.
- Orden de fusión: P0 > dependencias de otros ítems > nivel A > el resto.

### 5.4 Bloqueos para que nadie pise a nadie
- `paths` del backlog = bloqueo exclusivo. Dos ítems con rutas que se solapan nunca corren a la vez.
- **Carriles de un solo escritor**: `supabase/migrations/**` (uno a la vez; el timestamp de la migración lo asigna el orquestador en el brief), `packages/shared-types/**` cuando cambia un contrato consumido por dos apps o más, `pnpm-lock.yaml` (solo ítems que declaran dependencias nuevas, uno a la vez).
- Las migraciones aplicadas al Supabase de desarrollo no se editan nunca; se corrigen con una migración nueva.

### 5.5 Recuperación
- Cualquier merge que rompa `main` se revierte de inmediato con `git revert` vía PR (no se arregla encima). El ítem vuelve a `ready` con la lección registrada.
- Tags por hito; el rollback de un hito es revertir hasta el tag anterior.

---

## 6. Anti-desperdicio: rumbo y cuota

### 6.1 Reglas de rumbo
- Solo se trabaja en el backlog del hito abierto. No se abre el siguiente hito hasta que la puerta del actual esté en verde, salvo trabajo de investigación y ADR del siguiente hito en el carril agy cuando no haya otra cosa lista.
- Cada brief tiene «hecho cuando» verificable con un comando. Sin evidencia, el ítem no avanza.
- Antes de despachar se comprueba que no exista ya una sesión o un PR con ese `id` (idempotencia: `--claim-pr --no-takeover` en las revisiones).

### 6.2 Presupuesto de intentos
| Límite | Valor |
|---|---|
| Intentos por ítem y motor | 2 |
| Intentos totales por ítem | 3, siempre en otro motor (opencode → agy → codex) |
| Después del 3.º | `parked` + lección; el orquestador replantea el ítem (partirlo, aclarar el brief) una sola vez; si vuelve a fallar, va a `DECISIONS_PENDING.md` y el loop sigue con lo demás |
| Rondas de revisión | C 1 · B 2 · A 3 |
| Sesión AO sin actividad | 30 min → `ao send` con un aviso; 60 min → `kill` y reintento contado |

### 6.3 Interruptores
- **CI de `main` rojo**: se congela el despacho de ítems nuevos; codex recibe el arreglo (o se revierte el último merge si en 30 min no está). Los workers en curso siguen.
- **Motor sin cuota**: su carril pasa al motor alternativo de `routing.md` y se reanuda solo al reset. Nunca se rehace el trabajo en Claude.
- **Tres fallos seguidos de un motor**: cooldown de 1 h y diagnóstico (login, sandbox, Node).
- **Tres ticks sin ningún merge** con ítems en curso: el siguiente tick es solo de diagnóstico, sin despachos nuevos.

### 6.4 Contexto barato
- Briefs de una pieza: rutas exactas, fragmentos citados, `map.md §N`. Sin AGENTS.md copiado (los workers lo leen del repo).
- Orquestador: solo la salida de `loop-tick.ps1`, los resúmenes de AO y `gh pr view --json`. Los diffs los leen los revisores.
- Compactación automática del orquestador a 200k; al pasar 150k actualiza HANDOFF en pocas líneas y sigue.

---

## 7. M0 — preparación de la plataforma (primer día)

| # | Ítem | Carril | Hecho cuando |
|---|---|---|---|
| M0-1 | Commit de los cambios pendientes del harness y del smoke; cerrar las 16 `unverified` y la `failed` de `.harness/queue` | orquestador | `git status` limpio; cola sin ALERT |
| M0-2 | agy listo en AO: `ao agent ls` muestra `agy installed authorized` (PATH de `%LOCALAPPDATA%\agy\bin` en el entorno del daemon o `--env PATH=` en el proyecto). Si no se logra en 1 h, el carril Gemini corre por `.harness/bin/agent.ps1 -Engine gemini` y se anota | codex | Una sesión `ao spawn --harness agy` de prueba abre un PR |
| M0-3 | Node 24.19.0 disponible para workers y orquestador (quitar la dependencia del shim) | opencode | `node -v` = 24.19.0 dentro de un worktree de AO |
| M0-4 | Reglas AO: `--agent-rules-file docs/agentic/WORKER_RULES.md` (reglas de §4–§6 + LESSONS), `--reviewer codex --reviewer agy`, `--post-create "pnpm install --frozen-lockfile"`. Comprobar en `ao project set-config --help` y en `schema/config.schema.json` qué reacciones existen en esta versión (reintentos de CI, umbral de stuck) y activarlas sin auto-merge | orquestador | `ao project get` muestra la configuración y las reacciones comprobadas |
| M0-5 | CI: jobs `pg-verify` y `e2e-smoke` en `.github/workflows/ci.yml` | codex | Los tres jobs en verde en un PR |
| M0-6 | `tools/agentic/loop-tick.ps1` y `docs/agentic/{backlog.json,status.md,LESSONS.md,DECISIONS_PENDING.md,debt.md,engine-stats.json}` | opencode | El tick imprime ≤40 líneas con datos reales |
| M0-7 | z2b: reconstruir `confirm_capture_draft_v3` sobre el cuerpo v2 + prueba pizza+zona + invariante de cobertura | codex (después de M0-5) | `pg-verify` en verde con la prueba nueva |
| M0-8 | PR de integración `feat/smoke-r1` → `main` | orquestador | Fusionado con CI en verde |
| M0-9 | Protección de `main` (§5.2) | orquestador | `gh api …/protection` muestra los checks requeridos |
| M0-10 | Automatizaciones AO: tick de respaldo cada 30 min y nocturna 03:00 | orquestador | `ao automation list` muestra ambas |
| M0-11 | Backlog M1 congelado (agy propone, orquestador recorta) | agy + orquestador | `backlog.json` con todos los ítems de M1 |

M0-2, M0-3, M0-5 y M0-6 corren en paralelo desde el primer tick.

---

## 8. Backlog inicial de M1 (se detalla en M0-11)

- **Integración y SQL (codex)**: z2b · `resolveAddress` con `settlement_unknown` · K0-B (contacto de Recoger, «Domicilio exige cliente», con migración) · rate limiting y repaso de RBAC/sanitización · health/readiness y logs con correlationId.
- **UI (agy)**: cobro y nota en mobile · `web-nav-perf-r1` · Z4 colonias · verificación visual automática de B2/B3/B4/Z4/Z5/K1/K2/K4 · runbooks de deploy, respaldo y restauración.
- **Tests y piezas (opencode)**: 12 specs de journeys · inventario de cobertura (§4.4) y sus huecos · notificación «platillo listo» · K3 · `menu-tabs-r2` · `menu-size-presets` y `menu-specialties` con los supuestos ya adoptados en TODO · impresión Bluetooth en `packages/printing` con impresora simulada.
- **Migraciones remotas**: lote `20261120000100`, `20261120000200`, `20261121000100` + las nuevas de M1, al cerrar el hito (§0.1).

## 9. Estimación

Con 4 opencode, 3 agy y 1 codex trabajando continuamente: M0 ≈1 día · M1 ≈5–7 días · M2 ≈7–10 · M3 ≈5 · M4 ≈6 · M5 ≈6 · M6 ≈5 · M7 ≈4. **Total ≈6–7 semanas** hasta el 100 % de las fases, con el MVP listo para la prueba humana en ≈1 semana y media. El límite real es la cuota de codex (un solo carril para nivel A): si se agrega otra cuenta de Codex, M2 y M5 se acortan cerca de un 30 %.

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| El loop aprueba algo mal porque todos los revisores son modelos | Revisión cruzada por familia, pruebas de invariantes en CI, journeys E2E y nocturnas como oráculo; la prueba humana final sigue siendo obligatoria |
| agy no arranca desde AO | Respaldo por `agent.ps1` (M0-2) |
| Migraciones remotas fallan a mitad de un lote | Preflight y rollback-only antes; si el resultado es ambiguo, se detiene ese lote (no el loop) y se registra |
| Cuota de codex agotada | Su carril pasa a agy con esfuerzo alto para nivel B; los ítems de nivel A esperan el reset y el loop sigue con el resto |
| Deriva del alcance | Backlog congelado por hito, ítems nuevos solo con `parent` |
