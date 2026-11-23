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
