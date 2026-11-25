# Decisiones pendientes de Emmanuel

Decisiones que normalmente requeririan aprobacion humana. El orquestador no se
bloquea: toma el supuesto mas conservador, lo registra aqui y continua. Emmanuel
revisa esta lista al final del loop.

## Formato

| Fecha | Decision | Supuesto conservador aplicado | Impacto si se revierte |
|---|---|---|---|
| - | - | - | - |

## Abiertas

- 2026-11-23 Â· Revision cruzada: el `ao review` de codex/agy no devolvio veredicto en los PRs #7, #11, #12, #14, #15 y #16. Se uso el `reviewer` de Claude como respaldo; #7 y #14 (nivel A) se integraron con revision Claude (3 rondas en #14) mas CI como segunda familia, en vez de doble revision de motores distintos. Revertir: revisar de nuevo con `codex exec review`.
- 2026-11-23 Â· PRs #3, #5 y #9 se integraron con `gh pr merge` (no estaban rastreados por AO).
- 2026-11-23 Â· P2 aceptados como deuda: #15 (Duplicar en productos archivados, aria-label vacio, product-actions-menu.tsx huerfano, sin captura en navegador); #14 (estado de rate limit por proceso, IP compartida tras proxy); #16 (sin refresco autoritativo al reconectar en mobile/web, reconexion mobile sin backoff, sin test de ready-stream/route.ts, fallo de ack tumba el canal state.changed del KDS); P2 de #11 y #12 ya en debt.md.
- 2026-11-23 Â· Revision cruzada: en #19 (pg-verify), #20 (K0-B, nivel A) y #21 (e2e 1-6) agy/codex tampoco devolvieron veredicto; se uso el `reviewer` de Claude (2 rondas en #20 y #21) mas CI como segunda familia. #20 es nivel A y se integro sin doble revision de motores distintos. Revertir: revisar de nuevo con `codex exec review`.
- 2026-11-23 Â· Autorizado a -23 tocar `packages/shared-types` solo para el parser de detalle de entrega (#19) y a -25 solo para el contrato del contacto de Recoger (#20); ambos con pruebas exact-key.
- 2026-11-23 Â· Deuda P2: `verify:capture-schema:rollback` (verificador historico) falla en main sin relacion con #20 por no incluir la migracion 20260917000100; no corre en CI. Ver debt.md.
- 2026-11-23 Â· Deuda P3: PII (nombre/telefono de contacto de Recoger) en jsonb de `app.capture_drafts`; confirmar retencion y si el journal de eventos duplica el comando completo. Specs e2e 1-6 sin ejecutar contra entorno vivo; journey 6 cobra efectivo (residuo irreversible, solo entorno de pruebas).
- 2026-11-23 Â· Automatizacion nightly-gates (-24) creada para correr las puertas de forma nocturna.
- 2026-11-23 Â· Cuota Codex agotada hasta las 6:48 AM: -29/-31/-33 (codex) nunca arrancaron; las tareas de nivel A `m1-k0b2-customer-open-captures` (correcciones de #26, agy -35) y `m2-sync-contracts-engine` (agy -34) pasaron a agy (Gemini). #26 (nivel A) se integra con revision Claude (2 rondas, APROBAR sin P1/P2) mas CI, sin doble revision de motores distintos. Revertir: revisar de nuevo con `codex exec review` cuando haya cuota.
- 2026-11-23 Â· P3 aceptados en #26: deep link `?draftId=` se omite en silencio si hay autosave pendiente en localStorage; el test SQL no cubre UUID mal formado ni `limit` fuera de rango; `catch` del servicio descarta el error original sin log.
- 2026-11-23 Â· Estado M2: #31 (contratos sync, nivel A) y #36 (merge de dominio, nivel A, 2 rondas con 5 P2 corregidos) se integraron con revision doble de Claude (`reviewer`, APROBAR) mas CI, sin `codex exec review` por cuota agotada; revertir: revisar de nuevo con `codex exec review`. #32, #34, #35 y #37 (niveles B/C) con una revision Claude.
- 2026-11-23 Â· Deuda P3 de #31/#36 hacia `m2-api-sync-push-merge`: el servidor debe recalcular totales y validar ISO; `discountPolicy` y `isOfflineEvent` los deriva el servidor (nunca del cliente) y necesitan prueba de aislamiento y autorizacion propia; `hasValidSession===false` y `requiresSupervisorApproval===true` aceptados en contrato, no fail-open en dominio.
- 2026-11-23 Â· Pendiente verificacion visual humana (44 px, 390x844, instalacion PWA y offline) de #32 y #34; el smoke HTML aun no se regenero.
- 2026-11-23 Â· Triage Ola 0 (#41): F2-02, F2-04, F2-10, anexo TODO:112 y D4/D5 pasan a REVIEW segun docs/agentic/audit-fase2-2026-11-23.md y blocked-fase2-2026-11-23.md; D4/D5 se cierran con Playwright local + PG17, sin fixtures remotas; `legacyAddressInstructions` queda deprecado de solo lectura en v1.0. DONE exige verificacion visual (Ola 1.3).
- 2026-11-23 Â· POST /sync omite eventos reintentables en la respuesta (el motor ya reintenta eventos sin resultado); no se amplia el contrato.
- 2026-11-23 Â· Revision cruzada de #42 (printing, B) y #44 (tests mobile, C) por subagente Claude `reviewer` como respaldo (ao review sin veredicto): ambos APROBAR, sin P1/P2. Tambien las rondas de #39 fueron Claude-only.

## Puente runtime mobile (m2-mobile-runtime-bridge)

- Pregunta: como conectar la barra de sync mobile con la cola local real (sync-store cifrado) y el transporte. El puente web (PR #70) usa `OfflinePosPort` + `DeviceSyncEngine`; mobile aun no tiene equivalente.
- Decision conservadora aplicada: replicar el patron del puente web (puerto + engine + transporte con timeout, aislamiento por restaurante/sucursal/dispositivo, purga solo sin eventos sin confirmar) en una tarea propia nivel A, tras el cierre de v1.0. Sin verificacion en dispositivo real en este entorno.

- 2026-11-25 - Ola 0: los workers dsh agotan turno (~20 pasos de CLI) sin emitir informe aunque el codigo queda completo y sus puertas pasan. Supuesto aplicado: el orquestador re-ejecuta lint, typecheck y las suites en cada worktree y esa salida es la evidencia del PR; el CI es la segunda barrera. Impacto si se revierte: repetir las corridas con briefs mas cortos y reprobar con la revision doble.
- 2026-11-25 - Solo DeepSeek: todos los workers son dsh (deepseek-v4.1-flash) y no se usa codex, agy, AO ni subagentes Claude como escritores o revisores. Revision cruzada entre instancias dsh; nivel A con dos focos (invariantes y pruebas adversariales) mas CI. Verificacion visual con aserciones Playwright; capturas solo para revision humana final. Sin fallback: tras dos fallos la tarea se parte o pasa a BLOCKED.
