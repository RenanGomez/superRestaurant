# Órdenes al orquestador — cierre de v1.0 en paralelo (2026-11-23)

> Mensaje listo para pegar en la sesión «Agente orquestador USA». Redactado por Emmanuel con apoyo de Claude el 2026-11-23.

---

Uso agent-orchestrator (AO). Lanza todo el trabajo delegado con `ao spawn`, en paralelo, con workers `opencode` (DeepSeek), `agy` y `codex`. Nunca `claude-code`.

## Objetivo

Cerrar **v1.0 (Fases 0–2)** lo antes posible. Hoy el avance total ronda 58 % y v1.0 ronda 80 %. El cuello de botella no es código: casi todo está en REVIEW y casi nada en DONE. Hay que (1) terminar Mobile (Fase 2, ~48 %), (2) convertir lo que ya está hecho en algo que Emmanuel pueda aprobar de una vez, y (3) dejar `TODO.md` fiel al estado real.

## Reglas de ejecución

1. **Paralelismo real:** al menos 8 workers vivos al mismo tiempo entre Mobile y offline (máximo 10). Cuando uno termine, lanza el siguiente de la cola de inmediato; no esperes a que termine la ola.
2. **Reparto por motor:** `codex` = bugs difíciles, API, estado, red; `agy` = UI/visual, verificación en navegador y lectura/auditoría; `opencode` (DeepSeek) = tests, tareas mecánicas y piezas pequeñas. Con 3 tareas o más, cada motor recibe al menos una.
3. **Un escritor por conjunto de archivos.** Cada brief declara qué rutas toca; no lances dos workers sobre las mismas rutas. Si dos tareas chocan, serialízalas.
4. **Nivel de rigor (AGENTS.md §19.2/19.3):** declara A/B/C/D en cada brief. Revisión: C una ronda, B dos, A doble con corte en la tercera. Nada fuera de la lista de v1.0 o del backlog M2 (`docs/agentic/m2-backlog-proposal.md`) sin registrar la decisión en `DECISIONS_PENDING.md`; ante una duda eliges la opción conservadora y sigues.
5. **PR por tarea; tú mergeas cuando pasen las puertas de AGENTS.md §19.6** (CI verde, revisión cruzada sin P1, verificación visual si hay UI). No esperes a Emmanuel. Después de cada merge actualiza `TODO.md`, `HANDOFF.md` y el smoke (`node tools/agentic/build-smoke-html.mjs <fecha>`) en el mismo commit o en un `docs:` inmediato (AGENTS.md §19.5).
6. **Autonomía total (AGENTS.md §19.6, vigente hoy):** no esperes aprobación humana para nada: migraciones remotas, push/merge, deploy, credenciales del proyecto, datos y pasar tareas a DONE. Lo que sustituye a la aprobación son los checkers y testers: sigue el protocolo de seguridad de §19.6 (rollback-only y dry-run antes de aplicar, staging primero, respaldo antes de tocar datos, postchecks, sin `force-push` sobre `main`). **Offline (Fase 3) sigue en paralelo con Mobile**, ver «Carril offline»; reanuda el worker 43 y descarta o reutiliza 35 y 36 si ya no aplican. Si el modo de permisos de tu sesión te bloquea una acción, cámbialo o registra BLOCKED; no lo esquives.

## Ola 0 — triaje (lanzar ya, todo a la vez)

| # | Motor | Tarea | Salida |
|---|---|---|---|
| 0.1 | `agy` (lectura) | Auditar los ítems IN_PROGRESS de Fase 2 contra `main` y decir cuáles ya cumplen criterios y pasan a REVIEW, cuáles faltan y qué. Incluir «notificaciones de platillo listo» (el commit `3cfe0238` parece cubrirla). | `docs/agentic/audit-fase2-2026-11-23.md` |
| 0.2 | `agy` (lectura) | Explicar los 2 ítems BLOCKED de Fase 2: qué decisión necesitan de mí, con opciones y recomendación en una línea cada una. | mismo documento |
| 0.3 | `opencode` | Cruzar `docs/agentic/coverage-m1.md` y `debt.md` con los tests existentes y listar huecos de cobertura obligatoria que quedan en Mobile. | `docs/agentic/gaps-mobile-2026-11-23.md` |

Cuando 0.1–0.3 terminen, usa sus resultados para fijar los briefs de la Ola 1 y actualiza `TODO.md` con los pases a REVIEW que ya estén justificados.

## Ola 1 — Mobile en paralelo (rutas disjuntas)

| # | Motor | Nivel | Tarea | Rutas |
|---|---|---|---|---|
| 1.1 | `codex` | B | Cerrar «vista de mesas y toma de comanda online» en mobile con lo que dejó el audit 0.1 | `apps/mobile/src/**` (mesas/comanda) |
| 1.2 | `codex` | B | Cerrar impresión Bluetooth en `packages/printing`: adaptador, reintentos, contract tests | `packages/printing/**` |
| 1.3 | `agy` | C | Puesto operativo móvil/tablet: atajos, targets de 44 px, estados de carga/vacío/error; verificar en navegador a 390×844 y en escritorio, consola limpia | `apps/mobile` UI y `apps/web` lo que el audit indique, sin tocar lo de 1.1 |
| 1.4 | `opencode` | C/B | Pruebas de los huecos de `gaps-mobile` (unitarias y de contrato; E2E sin tocar lógica) | `**/*.test.ts` de las rutas de 1.1 y 1.2, coordinado para no chocar |
| 1.5 | `codex` | A | Sólo si el audit marca pendiente: autoguardado/directorio/lectura de bandeja de captura. Revisión doble. | `apps/api` captura, `packages/domain` captura |
| 1.6 | `agy` | D | Preparar la guía única de prueba para Emmanuel: todo lo que está en REVIEW agrupado por flujo, con pasos de 3 a 5 toques y resultado esperado | `docs/runbooks/guia-de-pruebas-operador.md` |

## Carril offline (M2) — en paralelo con la Ola 1

Estado: olas 1–3 del backlog M2 ya están en `main` (contratos, ADR-005, merge de dominio, PWA, failure injection, matriz de conflictos, migraciones del ledger). Sigue la cadena A estricta por `deps`; no se salta ningún eslabón.

| Paso | Motor | Nivel | Tarea | Notas |
|---|---|---|---|---|
| O1 | `codex` | A | `m2-api-sync-push-merge` (`POST /sync`) | Ya lo tiene el worker 43; revisión doble |
| O2 | `codex` | A | `m2-api-sync-pull-review` (`POST /sync/pull` + `manual_review`) | Después de O1 |
| O3 | `codex` | A | `m2-web-local-storage-crypto` | Después de O2 |
| O4 | `codex` | A | `m2-mobile-local-storage-crypto` | **Choca con `apps/mobile` de 1.1**: serializar, no lanzar mientras 1.1 esté abierta |
| O5 | `opencode` | B | `m2-api-sync-conflicts-tests` | Cuando O2 esté mergeado |
| O6 | `agy` | C/B | `m2-web-sync-status-ui`, `m2-kds-offline-cache`, `m2-web-offline-pos-cash`, `m2-mobile-offline-sync-ui` | En el orden de sus `deps`; el de mobile también espera a 1.1 |
| O7 | `opencode` | B | `m2-e2e-offline-web` | Después de O6 web |
| O8 | `agy` | D | `m2-docs-offline-matrix-signoff` | Último |

**Cuota de Codex:** la cadena offline usa 1 carril Codex y Mobile (1.1, 1.2, 1.5) otro; no pasa de 2 Codex a la vez. Si Codex se queda sin cuota, el carril A pasa a `implementer-claude` y lo registras en HANDOFF con el motivo; las piezas B y C de Mobile pasan a `agy` u `opencode`.

**Migraciones:** O1–O3 llevan migraciones SQL; se verifican con `pg-verify` y se aplican al Supabase remoto tú mismo con el protocolo de §19.6 (dry-run exacto, staging/dev primero, postcheck), sin esperar aprobación.

## Ola 2 — cierre

- Revisión cruzada de cada PR (Codex revisa lo de agy, agy revisa lo de Codex; Sonnet sólo en nivel A como segunda familia).
- Merge de lo que pase CI, actualización de `TODO.md`/`HANDOFF.md`/smoke.
- Informe corto para Emmanuel: qué ítems quedan listos para su aprobación visual, qué decisiones tomaste tú y por qué, y sólo lo que realmente exija a Emmanuel (si algo) y el % actualizado de v1.0 y del total.

## Reporte

Al arrancar: una línea con «Uso AO: N workers» y la tabla de reparto. Después, un resumen cada vez que termine una ola o cuando un worker quede BLOCKED con evidencia (no esperes respuesta: sigue con otras tareas).
