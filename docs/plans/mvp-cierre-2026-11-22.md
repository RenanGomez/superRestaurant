# Plan de cierre del MVP (v1.0) — 2026-11-22

Nivel D (orquestador). Fuente: TODO.md, HANDOFF.md, PLAN_MODERNIZACION §3, cola `.harness/queue`, rama `feat/smoke-r1`.

## 1. Qué es el MVP

Decisión de Emmanuel del 2026-09-04 (TODO P0): **v1.0 = Fases 0–2, online-first, con Mobile como requisito de salida**; v1.1 = Fase 3 offline. No fiscal (ticket interno), `card_manual` sin integración de terminal, MXN, America/Hermosillo.
Nota: el plan maestro §3.2 todavía dice «Fases 0–3»; manda la decisión humana y hay que corregir el plan.

## 2. Avance estimado

Estimación por bloques, ponderada. «Construido» = código integrado con puertas verdes. «Aceptado» = DONE por Emmanuel o E2E con evidencia.

| Bloque | Peso | Construido | Aceptado | Qué falta |
|---|---|---|---|---|
| F0 Fundaciones (monorepo, auth, RBAC, esquema, CI) | 10 | 100 | 100 | — |
| F1 POS core online (mesas, menú, órdenes, KDS, caja, E2E) | 15 | 100 | 100 | — |
| Captura multicanal, clientes, direcciones, zonas | 12 | 90 | 20 | K0-B (contacto Recoger, «Domicilio exige cliente»), K3, `resolveAddress` P2 |
| Menú, tamaños, pizza V2 | 12 | 85 | 10 | z2b (P1 SQL), 3 migraciones sin aplicar en remoto, revisión 2ª familia |
| Caja: cobro, cambio, transferencia, pagos divididos, corte | 10 | 90 | 20 | prueba humana |
| Entregas y repartidor | 7 | 85 | 15 | zona CP 85860 en remoto, prueba humana |
| KDS e impresión | 8 | 80 | 20 | notificación «platillo listo», impresión Bluetooth |
| Mobile meseros | 12 | 60 | 10 | cobro y nota en móvil, prueba en dispositivo real |
| Salida a producción (deploy, respaldo, observabilidad, rate limiting, auditoría de seguridad) | 14 | 30 | 0 | casi todo |
| **Total** | 100 | **≈79 %** | **≈34 %** | |

**Avance general del MVP: ≈75 %.** El código está casi completo. El cuello de botella es la verificación y la integración: 114 tareas en REVIEW, ninguna fila de «Día operable» en DONE, 18 commits en `feat/smoke-r1` sin integrar a `main` y 3 migraciones sin aplicar en remoto.

## 3. Bloqueos actuales

1. **z2b** (nivel A): `confirm_capture_draft_v3` en `20261121000100` parte del cuerpo anterior a v2, así que confirmar pizza+zona da 42703. dsh falló (EPIPE). Fue un error de ruteo: el SQL de nivel A no le toca a dsh.
2. **Migraciones remotas** `20261120000100`, `20261120000200`, `20261121000100`: requieren autorización de Emmanuel (staging rollback-only primero).
3. **Cola del harness**: 16 tareas `unverified` (specs y revisiones de Codex ya consumidas) y 1 `failed`. Hay que cerrarlas para que `drain` deje de detenerse en ALERT.
4. **Cambios sin commit** en `.harness/` (ORCHESTRATOR, routing, config, agent.ps1) y en el smoke.
5. **Verificación humana**: 114 REVIEW por tarea es inmanejable. Se pasa a una aprobación **por journey** (los 12 del plan §4.2).

## 4. Olas de orquestación

Reparto según `.harness/routing.md` y AGENTS §19.4: Codex para lógica con riesgo, Gemini (`agy`) para UI y revisión, dsh para tareas mecánicas y tests. Claude orquesta y hace la segunda revisión de nivel A. Un `drain -Wait` en background por ola.

### Ola 0 — desbloqueo (≈1 día)
| Id | Motor | Nivel | Tarea |
|---|---|---|---|
| z2b-v2 | codex medium, worktree | A | Reconstruir `confirm_capture_draft_v3` sobre el cuerpo v2 + prueba pizza+zona + invariante `delivery_zones_coverage_nonempty` |
| api-resolve-settlement | dsh | B | `resolveAddress` devuelve `settlement_unknown` sin propagar `settlementId` + prueba |
| review-matrix | gemini (solo lectura) | D | Mapear las 114 REVIEW a los 12 journeys y generar la lista de smoke por journey |
| revisión z2b | reviewer Sonnet + gemini strong | A | Revisión doble |
| L0 | orquestador | D | Commit del harness, cerrar los 16 `unverified`, borrar worktrees integrados |
| **Emmanuel** | — | — | Autorizar las migraciones (staging → remoto), crear la zona CP 85860, autorizar la integración de `feat/smoke-r1` a `main` |

### Ola 1 — huecos funcionales del MVP (≈2–3 días)
| Id | Motor | Nivel | Tarea |
|---|---|---|---|
| k0b-pickup-contact | codex | A | Contacto de Recoger en el borrador + regla «Domicilio exige cliente» en el servidor (migración) |
| mobile-pay-note | gemini | C | Cobro (efectivo/tarjeta manual/transferencia) y nota de línea en móvil, usando el API existente |
| web-nav-perf-r1 | gemini | B/C | `loading.tsx`, peticiones en paralelo, `Link` |
| kitchen-ready-notify | dsh | B/C | Notificación «platillo listo» (WebSocket existente) en web y móvil |
| k3-customer-captures | dsh | C | Capturas abiertas del cliente (después de k0b) |
| menu-tabs-r2 | dsh | C | Pestañas del editor de menú |

### Ola 2 — salida a producción (≈3–4 días)
| Id | Motor | Nivel | Tarea |
|---|---|---|---|
| sec-rate-limit | codex | A | Rate limiting en auth, pagos y caja; repaso de sanitización y RBAC |
| obs-health | codex | B | Health/readiness, logs con correlationId, métricas mínimas |
| e2e-journeys | dsh | B | E2E (Playwright) de los journeys 1–11 contra PG local |
| runbooks-release | gemini | D | Deploy, respaldo/restauración, RPO/RTO, rollback |
| **Emmanuel** | — | — | Decidir destino de hosting y política de respaldo |

### Ola 3 — smoke integral y MVP al 100 %
Emmanuel prueba journey por journey (escritorio, 390×844 y dispositivo móvil real) con el smoke HTML. Cada hallazgo se convierte en una tarea de la misma ola. Cuando los 12 journeys quedan aprobados: MVP v1.0 en DONE, y recién entonces empieza la ronda de mejoras.

## 5. Fuera del MVP salvo decisión (propuesta)
`menu-specialties`, `menu-size-presets`, impresión Bluetooth (la impresión desde el navegador ya cubre T1), Fase 3 offline y Fases 4–8.

## 6. Reglas de la ejecución
- Nivel A nunca se asigna a dsh. Revisión doble: Sonnet + Codex o Gemini.
- Cada tarea lleva `-EtaMin` y un ward armado; ninguna se acepta sin un bloque de evidencia con comando y salida.
- El smoke HTML se actualiza tras cada integración visible (§19.5).
- Push, merge y migraciones remotas solo con autorización explícita de Emmanuel.
