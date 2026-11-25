# Plan de ejecución autónoma solo con DeepSeek — cierre de M2 y fases 4 a 8

Versión 1 · 2026-11-25 · nivel D (orquestador). Complementa a `docs/plans/plan-autonomo-100.md`. Donde ese plan asigna motores (codex, agy, AO), **manda este documento**.

---

## 0. Mandato (instrucción de Emmanuel del 2026-11-25)

1. Todo el trabajo delegado lo hacen **workers DeepSeek en paralelo** (`dsh` → OpenCode Go, modelo único `deepseek-v4.1-flash`). Ni codex ni gemini/agy ni AO ni subagentes Claude escriben código. Claude solo orquesta.
2. El orquestador trabaja **sin supervisión y sin pedir verificación humana**. La verificación humana ocurre una sola vez, con el producto terminado (§9).
3. Objetivo: avanzar lo más posible por las fases del plan maestro (3 → 8) sin romper `main`.

Esta instrucción deja sin efecto, solo mientras dure este plan, la regla «nunca todo a dsh / cada motor recibe al menos una tarea» de `.harness/routing.md` y el reparto de motores de AGENTS.md §19.4 y de `plan-autonomo-100.md` §2. Lo demás de AGENTS.md sigue vigente: niveles A–D (§19.2), puertas de §19.6, protocolo de seguridad, Ponytail, CodeGraph y documentos de seguimiento. Registrar al arrancar: una línea en HANDOFF y la entrada correspondiente en `docs/agentic/DECISIONS_PENDING.md` (ya creada con este plan).

---

## 1. Punto de partida real (verificado el 2026-11-25 contra `git log`)

`docs/agentic/backlog.json` está **desactualizado**: marca como `ready` ítems que ya están fusionados en `main`.

| Hito | Estado real en `main` | Lo que falta |
|---|---|---|
| M1 MVP v1.0 (Fases 0–2) | Fusionados: pizza v2 / `confirm_capture_draft_v3` (#51), rate limit (#50), mobile pay note, runbooks, E2E journeys 1–12, health/observabilidad | 3 nocturnas verdes seguidas; P2 abiertos de `debt.md`; migraciones remotas pendientes |
| M2 Offline (Fase 3) | Fusionados: contratos + motor, merge de dominio, SQL de sync, `POST /sync/push`, pull + `manual_review`, almacén cifrado web y mobile, PWA, barra de estado, POS offline con efectivo, caché KDS, UI offline mobile, conflictos multi-dispositivo, `e2e:offline`, matriz offline + runbook (#57) | Cierre formal `m2-docs-offline-matrix-signoff`; P2 de #62, #63, #66 que bloquean «activar offline»; migraciones `20261121000100`, `20261123000300`…`000600` sin aplicar en remoto; verificación visual de KDS offline e IndexedDB |
| M3–M7 (Fases 4–8) | Nada iniciado | Todo |

Migración más reciente en el repo: `20261123000600`. Las nuevas de este plan empiezan en `20261126000100` y el orquestador asigna el nombre exacto en cada brief (carril de un solo escritor).

---

## 2. Capacidad y reglas de la granja DeepSeek

| Parámetro | Valor |
|---|---|
| Motor | `-Engine dsh`, sin `-Model` (todos los alias → `deepseek-v4.1-flash`) |
| Paralelismo | `queue.maxParallel = 6`: **hasta 5 escritores + 1 revisor** a la vez |
| Esfuerzo | `low` por defecto · `medium` en nivel A, en bugs y en el reintento · `high` nunca |
| Cupo | OpenCode Go: ~43k peticiones / 5 h y $100/mes; si se agota, `drain -Wait` espera al reset solo |
| Visión | **No tiene.** Toda verificación visual se hace con aserciones Playwright (ver §5.3), nunca con lectura de capturas |
| Fallback | Ninguno a otros motores. Antes de la primera ola, poner `codex.fallback` sin efecto no hace falta: simplemente no se encola nada como `codex` ni `gemini` |

**Lanzamiento** (vía normal del harness, sin AO):

```
powershell -NoProfile -File .harness/bin/enqueue.ps1 -Id <id> -Engine dsh -Effort <low|medium> -Write -Worktree -Files <rutas> [-After <ids>] -EtaMin <min>
powershell -NoProfile -File .harness/bin/drain.ps1 -Wait      # una sola vez por ola, en background
```

- `-Worktree` **siempre** en tareas que escriben código (rama `harness/<id>`, worktree en `C:\tmp\sr-wt`). Las tareas de solo lectura van sin `-Write` ni `-Worktree`.
- Briefs en `.agents/briefs/<id>.md` con la plantilla `.harness/templates/brief.md` + campos de `docs/templates/CONTEXT_PACKET.md` (nivel, razón, rutas exactas, firmas exactas, «hecho cuando» con comando). Cada brief incluye la línea Ponytail y la línea de limpieza de procesos de `routing.md`.
- **Tamaño de tarea DeepSeek**: 1–3 archivos de producción (+ sus tests), un objetivo, ≤ 300 líneas de diff, ETA 10–30 min. Lo que no cabe se parte en el backlog **antes** de lanzar.
- **Firmas primero**: Flash adivina mal las APIs del proyecto. Todo brief pega la firma real de lo que debe llamar (sacada con `codegraph explore` por el orquestador) y la ruta exacta del archivo de tests y del script que lo registra.
- Entorno de puertas: Node 24.19.0 + shim `pnpm` con rutas absolutas (memoria `node24-and-pnpm-shim`). El brief indica el `PATH` exacto a usar; si el worker no puede correr las puertas, el informe sale `unverified` y no se integra.

### 2.1 Carriles de un solo escritor (nunca dos tareas a la vez)

`supabase/migrations/**` · `supabase/tests/**` del mismo módulo · `packages/shared-types/**` · `pnpm-lock.yaml` y cualquier `package.json` · `apps/api/src/app.module.ts` · `packages/domain/src/index.ts` · `.github/workflows/**`.

Patrón para no serializar todo: las tareas paralelas **no** tocan el archivo de registro (index/app.module/script de tests); una tarea final de «cableado» por ola registra todo junto.

### 2.2 Revisión cruzada sin otra familia de modelos

No hay segunda familia disponible. Sustituto (registrado en DECISIONS_PENDING):

| Nivel | Revisión |
|---|---|
| C | 1 revisión dsh (`-Engine dsh` sin `-Write`, brief de revisor con criterios `/ponytail-review` y el diff por `Diff: <rango>`) |
| B | 1 revisión dsh; 2 si toca autorización o scope |
| A | **2 revisiones dsh independientes con focos distintos**: (1) invariantes de AGENTS §8–§12 (dinero sin float, scope Restaurant/Branch, inmutabilidad, idempotencia, auditoría); (2) pruebas: ¿cada invariante tiene una prueba que falla si se rompe? El revisor 2 debe **escribir y ejecutar** una prueba adversarial (doble envío, otro tenant) en `.harness/state/tmp/` y pegar la salida |
| Todos | El orquestador lee `git diff --stat` y el informe; el CI (`verify` + `pg-verify` + `e2e-smoke`) es la segunda barrera objetiva |

Una revisión sin veredicto `APROBAR`/`CAMBIOS` explícito se relanza una vez; si vuelve sin veredicto, el ítem se integra solo si CI está verde **y** es nivel C/D; en A/B pasa a `parked`.

### 2.3 Integración (la hace solo el orquestador)

1. Informe `done` con bloque de comandos y salida real → revisión(es) §2.2 → `APROBAR`.
2. `git push -u origin harness/<id>` → `gh pr create` (cuerpo: nivel, «hecho cuando», salida de puertas, veredictos) → esperar CI.
3. CI verde y cero P1 → `gh pr merge --squash` **uno a la vez** (cola serial). P2/P3 → `docs/agentic/debt.md` en el mismo PR o en un `docs:` inmediato.
4. Tras cada merge: rebase de las ramas abiertas que tocan `main` lo hace el worker dueño en un reintento barato (`low`), nunca el orquestador a mano.
5. Borrar el worktree integrado con `cmd /c rmdir /s /q` + `git worktree prune` (memoria `worktree-cleanup-on-windows`).
6. Tras integrar la ola completa: `pnpm lint && pnpm typecheck && pnpm test` global una vez en `main`.

### 2.4 Fallos y reintentos

- Intento 1 `low` (A: `medium`). Si falla: mismo `-Id`, brief corregido con la salida exacta del fallo, `medium`.
- Dos fallos → `parked` + nota en HANDOFF + el orquestador **parte la tarea en dos más pequeñas** y las relanza. Si las partes fallan también → BLOCKED con evidencia y se sigue con otras. Nunca se baja el nivel de rigor para destrabar.
- Cada fallo repetido genera una regla en `docs/agentic/LESSONS.md` (que se pega al final de cada brief).

---

## 3. Ritmo del orquestador

- **Una ola = un lote de tareas independientes** encoladas juntas + un `drain -Wait` en background.
- Mientras corre la ola: el orquestador prepara los briefs de la ola siguiente (CodeGraph para firmas) e integra lo que ya terminó. Nunca espera ocioso.
- Ward: `ScheduleWakeup` a `min(ETA de la ola × 1.5, 20 min)`; al despertar solo `status.ps1`.
- Al cerrar cada ola: `backlog.json` (estado real), `TODO.md`, una entrada corta en HANDOFF, smoke (§19.5) si hubo cambio visible.
- Al cerrar cada hito: migraciones remotas por lote (§6), tag `m<N>-rc1`, smoke HTML regenerado, informe del hito en `docs/agentic/`.
- La sesión del orquestador usa contexto acotado: no lee archivos > 300 líneas; pide resúmenes a un dsh de solo lectura.

---

## 4. Olas

Notación: `id · nivel · rutas · deps · ETA`. Todas `-Engine dsh`. **Esc** = escritor, **Rev** = revisor, **Lec** = solo lectura. Las olas se encadenan por dependencias, no por calendario: en cuanto una tarea de la ola N+1 tiene sus deps fusionadas y sus rutas libres, se lanza aunque la ola N no haya terminado (la cola de drain lo hace sola con `-After`).

### Ola 0 — Higiene y cierre de M1/M2 (arranque inmediato)

| id | Tipo | Nivel | Rutas | ETA |
|---|---|---|---|---|
| `o0-backlog-reconcile` | Orquestador | D | `docs/agentic/backlog.json` | 10 |
| `o0-web-storage-leader` | Esc | A | `apps/web/src/lib/offline/**` (elección de líder entre pestañas con `BroadcastChannel`/Web Locks + prueba de motor del protocolo STORAGE_COMMIT_FAILED; P2 de #62) | 30 |
| `o0-web-storage-purge` | Esc | A | `apps/web/src/lib/offline/` archivo de purga/rotación (purga en sign-out y `AUTH_REVOKED`, `keyVersion`, scope en AAD; P2 de #62) — `-After o0-web-storage-leader` | 30 |
| `o0-mobile-banner-tests` | Esc | B | `apps/mobile/src/ui/sync-banner*.test.tsx` (carrera `!alive`, ruta resume/locked; P2 de #66) | 20 |
| `o0-visual-offline-assert` | Esc | C | `apps/web/e2e/visual/offline-kds.spec.ts`, `apps/web/e2e/visual/assert-ui.ts` (helper §5.3) | 25 |
| `o0-sync-p3-batch` | Esc | B | `apps/api/src/sync/**` (P3 de #60/#65: `DEVICE_UNKNOWN`, `ACTOR_MISMATCH`, log estructurado de rechazo, timeout 30 s por defecto en transporte web) | 25 |
| `o0-rev-*` | Rev | — | revisión de cada uno de los anteriores | 10 c/u |

Al cerrar Ola 0: `m2-docs-offline-matrix-signoff` (orquestador, D) con la evidencia; migraciones remotas pendientes por lote (§6); M2 → `m2-rc1`. Lo imposible aquí (dispositivo iOS real, exclusión de backup iOS, impresora Bluetooth) va a la lista humana final (§9), no bloquea.

### M3 · Inventario y compras (Fase 4) — Olas 1 a 5

**Ola 1 — Diseño y contratos (paralelo)**

| id | Tipo | Nivel | Rutas | Deps | ETA |
|---|---|---|---|---|---|
| `m3-map-sale-hooks` | Lec | — | informe: dónde se confirma, cancela y reembolsa una venta (funciones SQL `confirm_capture_*`, cancelación, `cash-register`, refunds), con firmas exactas | — | 15 |
| `m3-adr-013-inventory` | Orquestador | D | `docs/adr/ADR-013.md`: unidades y conversiones enteras (cantidad en unidad mínima, entero), almacén por Branch, ledger de movimientos inmutable, costo promedio ponderado con dinero en unidad menor, consumo por venta idempotente por `(order_item_id, causa)`, compensación en cancelación/reembolso, conteos que generan ajuste | `m3-map-sale-hooks` | 20 |
| `m3-dom-units` | Esc | A | `packages/domain/src/inventory/units.ts` + test (conversiones enteras, redondeo explícito, error en conversión no definida) | ADR | 20 |
| `m3-dom-ledger` | Esc | A | `packages/domain/src/inventory/stock-ledger.ts` + test (movimientos tipados: receipt, sale_consumption, sale_reversal, waste, adjustment, transfer_out/in, count_adjustment; saldo = suma; nunca editar, solo compensar) | ADR | 25 |
| `m3-dom-costing` | Esc | A | `packages/domain/src/inventory/costing.ts` + test (costo promedio ponderado entero, reproducible desde el ledger, margen por platillo) | ADR | 25 |
| `m3-dom-recipe` | Esc | A | `packages/domain/src/inventory/recipe-explosion.ts` + test (receta por producto y modificador → consumos; mitades de pizza; sin receta = sin consumo, no error) | ADR | 25 |

Cableado: `m3-dom-wire` (Esc, B): `packages/domain/src/index.ts` exporta los cuatro, `-After` los cuatro.

**Ola 2 — Esquema SQL (carril único, en cadena) + contratos**

| id | Nivel | Rutas | Deps |
|---|---|---|---|
| `m3-sql-catalog` | A | `supabase/migrations/20261126000100_inventory_catalog.sql` + `supabase/tests/inventory_catalog.sql`: unidades, insumos, almacenes (scope Restaurant/Branch, RLS+FORCE, sin grants directos) | ADR |
| `m3-sql-ledger` | A | `…20261126000200_inventory_ledger.sql` + test: movimientos inmutables (trigger que rechaza UPDATE/DELETE), saldos por almacén, función privada `app_private.inventory_record_movement` con idempotencia, actor y motivo | `m3-sql-catalog` |
| `m3-sql-recipes` | A | `…20261126000300_inventory_recipes.sql` + test: recetas versionadas con snapshot | `m3-sql-ledger` |
| `m3-sql-purchasing` | A | `…20261126000400_inventory_purchasing.sql` + test: proveedores, órdenes de compra, recepción que genera movimiento `receipt` y recalcula costo | `m3-sql-recipes` |
| `m3-sql-sale-consumption` | A | `…20261126000500_inventory_sale_consumption.sql` + test: consumo ligado a confirmación y reverso ligado a cancelación/reembolso, idempotente; prueba de doble envío y de otro tenant | `m3-sql-purchasing`, `m3-map-sale-hooks` |
| `m3-contracts` | A | `packages/shared-types/src/inventory/**` (DTOs + parsers exact-key) | `m3-dom-wire` (en paralelo con el carril SQL) |

Cada migración: `pg-verify` local desde cero (PG17, `LOCAL_POSTGRES_BIN`) + verificador rollback-only en el «hecho cuando».

**Ola 3 — API (paralelo por archivo; un cableado al final)**

`m3-api-items` (insumos/almacenes CRUD) · `m3-api-movements` (ajuste, merma, transferencia, conteo; supervisor + motivo obligatorio) · `m3-api-recipes` · `m3-api-purchasing` (proveedores, OC, recepción) · `m3-api-alerts-costing` (stock mínimo, costo promedio, margen). Nivel B, salvo `movements` y `purchasing` (A: dinero y auditoría). Cada uno en `apps/api/src/inventory/<módulo>.{ts,controller.ts,test.ts}`, deps `m3-contracts` + su SQL. Después `m3-api-wire` (app.module + script de tests + OpenAPI) y `m3-api-http-tests` (contract tests HTTP + aislamiento entre tenants).

**Ola 4 — UI web (paralelo por ruta)**

`apps/web/src/app/app/inventario/`: `m3-web-insumos`, `m3-web-movimientos` (con confirmación in-app y motivo), `m3-web-conteo` (táctil, captura rápida), `m3-web-recetas`, `m3-web-compras` (OC + recepción), `m3-web-alertas`. Nivel C. Más `m3-web-nav` (entrada de menú y permisos de vista; cableado). La UI nunca calcula costo ni saldo: los pide al API.

**Ola 5 — Integración y salida de M3**

`m3-int-sale-to-stock` (A: venta confirmada → consumo; cancelación → reverso; doble envío no duplica; existencias balancean) · `m3-e2e-journey` (Playwright: recibir OC → vender → cancelar → contar → ver margen) · `m3-visual` (§5.3 sobre todas las rutas de inventario) · revisión final. Salida = criterios de Fase 4 del plan maestro: movimientos inmutables, venta/cancelación no duplican, existencias balancean, costo reproducible, trazabilidad actor/motivo.

### M4 · Gestión, CRM y personal (Fase 5) — Olas 6 a 9

- **Ola 6 (diseño):** `m4-metrics-catalog` (orquestador, D): `docs/architecture/METRICS_CATALOG.md` con cada métrica versionada (`sales.net.v1`, `ticket.avg.v1`, `prep.time.p50.v1`…), su fuente autoritativa (órdenes/pagos/eventos, nunca catálogo actual) y su regla de zona horaria. `m4-adr-014-exports` (D): CSV nativo + XLSX/PDF con **una** dependencia cada uno, elegida con supuesto conservador (registrada en DECISIONS_PENDING); la tarea que la agrega es la única que toca `package.json`/lockfile en esa ola.
- **Ola 7 (SQL + dominio, en cadena el SQL):** funciones de lectura de reportes por Restaurant/Branch/canal/zona (`20261127…`), CRM: consentimiento, preferencias, segmentos y ledger de puntos de lealtad inmutable (A); personal: empleados, asistencia (entrada/salida auditada), comisiones (A, dinero). Dominio en paralelo: `reports/`, `loyalty/`, `commissions/` con tests.
- **Ola 8 (API + exportación):** endpoints de reportes, exportación con permisos y sin PII de más, CRM, personal. Prueba de reconciliación: la suma del reporte = suma de pagos de las órdenes semilla.
- **Ola 9 (UI + salida):** dashboard operativo y gerencial, reportes con filtros, ficha de cliente ampliada, personal/asistencia, rentabilidad por canal/producto/zona/repartidor. E2E + §5.3. Salida = criterios de Fase 5 (reportes cuadran en integración).

### M5 · Fiscal, pagos integrados y canales (Fase 6) — Olas 10 a 13

Todo contra **proveedores falsos**; los reales son puerta humana final (§9).

- **Ola 10:** puertos en dominio/API: `FiscalProvider` (CFDI 4.0), `PaymentProvider`, `AggregatorAdapter`; proveedores falsos deterministas en `apps/api/src/integrations/fake/**`; contract tests reutilizables que cualquier proveedor real deberá pasar.
- **Ola 11 (A):** `pending_invoice` con reintentos y operación degradada sin red; pagos integrados con idempotency key, estados explícitos, webhooks firmados y anti-replay; refunds y conciliación externa auditada. SQL en cadena (`20261128…`).
- **Ola 12 (A/B):** webhooks de agregadores idempotentes (pedido externo nunca duplica orden ni salta disponibilidad/cocina); normalización de productos/modificadores/estados por canal.
- **Ola 13 (C + salida):** canales propios: pedido web, menú QR y kiosco (endpoints públicos con rate limit y sin datos de otros tenants), UI de facturación pendiente y conciliación. Pruebas de replay de webhooks y de contrato verdes = salida.

### M6 · Multi-sucursal y lanzamiento (Fase 7) — Olas 14 a 16

- **Ola 14:** reportes consolidados multi-sucursal (reutiliza M4, solo agrega scope Restaurant con permiso explícito); importador CSV legacy idempotente (re-importar el mismo archivo no duplica; informe de filas rechazadas).
- **Ola 15 — auditoría de seguridad automatizada:** un dsh de solo lectura por módulo (`auth`, `sync`, `captures`, `cash`, `inventory`, `integrations`, `web`) con la lista de AGENTS §13 → cada hallazgo es un ítem; `pnpm audit` sin críticos; suite de fugas entre tenants sobre **todos** los endpoints (generada desde OpenAPI); rate limit en todo endpoint sensible.
- **Ola 16:** prueba de carga contra API + PG17 local con datos semilla (herramienta: script Node propio con `fetch` concurrente para no añadir dependencias; capacidad documentada en `docs/runbooks/capacidad.md`); simulacro de respaldo y restauración en PG local medido contra RPO/RTO; alertas y runbooks; checklist go/no-go en `docs/runbooks/go-no-go.md` con cada punto marcado por evidencia automática o como «humano».

### M7 · Expansión (Fase 8) — Olas 17 a 18

- Reservaciones y lista de espera (SQL + API + UI, integrado con mesas).
- Promociones avanzadas y tarjetas de regalo (A: saldo de tarjeta = ledger inmutable, como dinero).
- ADRs (orquestador, D) de rutas/flota, franquicias y central de producción: **solo documento**, sin implementación.
- Fase 3B (servidor local LAN): fuera de alcance; solo se deja ADR-009 en borrador con la pregunta abierta para Emmanuel.

---

## 5. Puertas por nivel (sin humano)

### 5.1 Por PR (todas, siempre)
G1 local en el worker (lint, typecheck, test del alcance, salida real en el informe) · G2 CI (`verify`, `pg-verify`, `e2e-smoke`) · G3 revisión §2.2 · G4 invariantes (nivel A: aislamiento, idempotencia, doble envío, dinero entero) · cero P1.

### 5.2 Por hito
Journeys E2E del hito verdes en **3 nocturnas seguidas** (automatización nocturna ya creada) · migraciones reproducibles desde cero y aplicadas al Supabase de desarrollo con postcheck (§6) · tag `m<N>-rc1` · smoke HTML regenerado.

### 5.3 Verificación visual sin visión
Helper `apps/web/e2e/visual/assert-ui.ts` (Ola 0) que todo spec visual usa, en **1280×800 y 390×844**:
- cero errores de consola y cero respuestas de red ≥ 400 no esperadas;
- cada control interactivo con caja ≥ 44×44 px y nombre accesible no vacío;
- `window.alert/confirm/prompt` reemplazados por funciones que fallan la prueba si se llaman;
- sin desbordamiento horizontal (`scrollWidth <= clientWidth`);
- foco visible al tabular (outline o box-shadow computado distinto de `none`);
- capturas guardadas en `docs/agentic/visual-<hito>/` **solo como evidencia para la revisión humana final**; ningún worker las interpreta.

Esto sustituye a la verificación visual de agy durante la construcción. Lo que solo un humano puede juzgar (estética, legibilidad real en cocina) va a la lista final.

---

## 6. Acciones críticas autónomas (protocolo §19.6)

- **Migraciones remotas:** por lote al cerrar cada hito, con el procedimiento de la memoria `remote-migration-apply-procedure` (probe rollback-only → preflight → staging → dry-run → apply → postcheck). El modo auto de Claude Code bloquea el acceso remoto: si el permiso no está disponible, el lote queda **BLOCKED con evidencia** en HANDOFF y el loop sigue con el siguiente hito. Nunca se esquiva el bloqueo.
- **Push/merge:** solo por PR con CI verde (§2.3). Nunca force-push a `main`.
- **Datos reales, deploy a producción, proveedores reales, secretos reales:** fuera de este plan; se acumulan para Emmanuel (§9).
- **Decisiones de producto:** supuesto conservador + entrada en `docs/agentic/DECISIONS_PENDING.md`; nunca se detiene el loop.

---

## 7. Estimación de volumen

| Hito | Tareas de escritura | Olas | Duración estimada con 5 escritores |
|---|---|---|---|
| Ola 0 (cierre M1/M2) | ~6 | 1 | 0,5 día |
| M3 Inventario | ~30 | 5 | 3–4 días |
| M4 Gestión | ~30 | 4 | 3–4 días |
| M5 Fiscal/canales | ~28 | 4 | 3–4 días |
| M6 Lanzamiento | ~20 | 3 | 2–3 días |
| M7 Expansión | ~14 | 2 | 1–2 días |

Supuestos: ~60 % de las tareas pasan al primer intento, cada revisión dura 10 min, el cupo de 5 h de OpenCode Go no se agota con 5–6 procesos simultáneos. El cuello de botella esperado es el **carril SQL en cadena** y la **cola serial de merges**, no el cupo: por eso el SQL de cada hito se lanza en la primera ola posible y la UI y los tests se lanzan en paralelo apenas existen los contratos.

---

## 8. Métricas y aprendizaje

- `docs/agentic/status.md` por ola: % del hito = fusionadas / (total − canceladas), tareas `parked`, cupo restante.
- `docs/agentic/engine-stats.json` por tipo de tarea (SQL, dominio, API, UI, tests). Si un tipo baja de 60 % de éxito en primer intento con ≥ 5 casos, se reducen el tamaño de sus tareas y se enriquecen sus briefs (más firmas y ejemplos), porque no hay otro motor al que cambiar.
- `LESSONS.md` curado (≤ 150 líneas) e inyectado al final de cada brief.

---

## 9. Paquete de verificación humana final (único punto de contacto con Emmanuel)

Se genera al cerrar M7 (o antes si el loop se detiene por bloqueos):

1. Smoke HTML final (`docs/smoke/smoke-<fecha>.html`) con todos los journeys y su estado real.
2. `docs/runbooks/guia-de-pruebas-operador.md` actualizada por módulo.
3. `docs/agentic/DECISIONS_PENDING.md` completo, ordenado por impacto si se revierte.
4. Lista de puertas humanas: proveedores reales (PAC, pasarela/terminal, agregadores), deploy a producción, dominios y secretos reales, verificación en dispositivo iOS/Android real (incluida la exclusión de backup iOS), impresoras físicas, checklist go/no-go.
5. Migraciones o lotes que quedaron BLOCKED por permisos de sesión, con el comando exacto para aplicarlos.
6. Capturas de §5.3 por hito para la revisión estética.
