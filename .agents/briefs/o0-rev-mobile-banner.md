# Brief o0-rev-mobile-banner

NO escribas archivos fuera de tu informe `.agents/reports/o0-rev-mobile-banner.md`. NO edites código, NO commitees, NO hagas push. NO ejecutes PostgreSQL ni Playwright. Trabaja en la raíz del repo y lee con `git show` (no abrir worktrees).

## Objetivo
Revisión de código del commit `4bcdf03d` (PR #75, `o0-mobile-banner-tests`, nivel A): **dos focos** en un veredicto.

Tiempo estimado: 12 min

## Qué revisar
`git show 4bcdf03d` (`apps/mobile/src/ui/sync-banner-lifecycle.ts` y `.test.ts`, `sync-banner.tsx`, `tsconfig.test.build.json`). Vigente: `git show HEAD:<ruta>`. Registro en `git show HEAD:apps/mobile/package.json`.

## Foco 1 — invariantes y copy de operador
- Carrera `!alive`: un snapshot que llega **después** de desmontar no debe actualizar estado ni disparar avisos.
- Ruta `resume`/`locked`: el banner explica al operador qué pasa sin rutas internas ni códigos (`/app/sync`, `AUTH_REVOKED`, UUIDs); ¿promete algo que el producto no hace (p. ej. cobrar offline)?
- P2 previo sin cerrar: falta la carrera `openRuntime` resuelto **después** de `stop()` verificando `onDiscard`. ¿Sigue faltando?
- P3 previo: rama inalcanzable en `sync-banner-lifecycle.ts:88`. ¿Sigue? Reporta la línea exacta del commit.
- ¿El componente sigue siendo puro respecto de `navigator.onLine` ausente en React Native?

## Foco 2 — pruebas adversariales
- ¿Las dos pruebas comprometidas (carrera `!alive`, ruta resume/locked) pueden fallar de verdad? Nombra la aserción clave.
- ¿Hay estados del banner sin cubrir (offline→reconnecting, cola bloqueada, pendientes>0 tras éxito)?

## Reporte
`.agents/reports/o0-rev-mobile-banner.md`, máximo 20 líneas:
1. `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
2. Hallazgos `P1`/`P2`/`P3` con `archivo:línea` y una frase de por qué.
3. Estado de los P2/P3 previos (debt.md PR #63 / #75): cerrado / sigue / no era cierto.
4. Qué no pudiste verificar (dispositivo real y suites = orquestador).
