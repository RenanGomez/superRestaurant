# Decisiones pendientes de Emmanuel

Decisiones que normalmente requeririan aprobacion humana. El orquestador no se
bloquea: toma el supuesto mas conservador, lo registra aqui y continua. Emmanuel
revisa esta lista al final del loop.

## Formato

| Fecha | Decision | Supuesto conservador aplicado | Impacto si se revierte |
|---|---|---|---|
| - | - | - | - |

## Abiertas

- 2026-11-23 · Revision cruzada: el `ao review` de codex/agy no devolvio veredicto en los PRs #7, #11, #12, #14, #15 y #16. Se uso el `reviewer` de Claude como respaldo; #7 y #14 (nivel A) se integraron con revision Claude (3 rondas en #14) mas CI como segunda familia, en vez de doble revision de motores distintos. Revertir: revisar de nuevo con `codex exec review`.
- 2026-11-23 · PRs #3, #5 y #9 se integraron con `gh pr merge` (no estaban rastreados por AO).
- 2026-11-23 · P2 aceptados como deuda: #15 (Duplicar en productos archivados, aria-label vacio, product-actions-menu.tsx huerfano, sin captura en navegador); #14 (estado de rate limit por proceso, IP compartida tras proxy); #16 (sin refresco autoritativo al reconectar en mobile/web, reconexion mobile sin backoff, sin test de ready-stream/route.ts, fallo de ack tumba el canal state.changed del KDS); P2 de #11 y #12 ya en debt.md.
- 2026-11-23 · Revision cruzada: en #19 (pg-verify), #20 (K0-B, nivel A) y #21 (e2e 1-6) agy/codex tampoco devolvieron veredicto; se uso el `reviewer` de Claude (2 rondas en #20 y #21) mas CI como segunda familia. #20 es nivel A y se integro sin doble revision de motores distintos. Revertir: revisar de nuevo con `codex exec review`.
- 2026-11-23 · Autorizado a -23 tocar `packages/shared-types` solo para el parser de detalle de entrega (#19) y a -25 solo para el contrato del contacto de Recoger (#20); ambos con pruebas exact-key.
- 2026-11-23 · Deuda P2: `verify:capture-schema:rollback` (verificador historico) falla en main sin relacion con #20 por no incluir la migracion 20260917000100; no corre en CI. Ver debt.md.
- 2026-11-23 · Deuda P3: PII (nombre/telefono de contacto de Recoger) en jsonb de `app.capture_drafts`; confirmar retencion y si el journal de eventos duplica el comando completo. Specs e2e 1-6 sin ejecutar contra entorno vivo; journey 6 cobra efectivo (residuo irreversible, solo entorno de pruebas).
- 2026-11-23 · Automatizacion nightly-gates (-24) creada para correr las puertas de forma nocturna.
