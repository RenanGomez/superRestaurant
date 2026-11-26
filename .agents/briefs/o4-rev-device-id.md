# Brief o4-rev-device-id

NO escribas archivos fuera de `.agents/reports/`. NO edites código, NO commitees, NO hagas push. NO ejecutes PostgreSQL ni Playwright. Trabaja en la raíz del repo y lee con `git show`.

## Objetivo
Revisión (nivel B, foco aislamiento y honestidad de la traza) de la rama `harness/o4-device-id` (PR #134).

Tiempo estimado: 10 min

## Qué revisar
`git diff main...origin/harness/o4-device-id` (`apps/web/src/lib/inventory-ui.ts`, `.test.ts`, `purchasing-panel.tsx`, `docs/agentic/device-identity-decision.md`).

Contexto: el `deviceId` de recepción de compras vivía en `sessionStorage` (rotaba por pestaña). El arreglo lo persiste por perfil de navegador y documenta que es auditoría, no autorización; la validación contra `app.sync_devices` queda como tarea con migración.

## Qué comprobar
1. `ensureInventoryDeviceId`: reutiliza UUID canónico, reemplaza corrupto, no rompe con store bloqueado (getItem/setItem que lanzan) y rechaza un generador que no produce UUID. ¿Puede devolver cadena vacía y enviarse así al API?
2. El panel: ¿usa `localStorage` con try/catch, mantiene la clave y no genera un id nuevo por montaje? ¿Sigue enviando `deviceId` solo en la recepción?
3. Pruebas: 5 nuevas, ¿fallan de verdad con el código anterior? ¿Alguna tautológica?
4. El documento de decisión: ¿promete algo que el código no hace? ¿Dice claramente que validar contra el registro exige migración y que hoy no hay prueba de rechazo de dispositivo ajeno (porque no existe esa validación)?
5. ¿La UI de compras cambia de comportamiento para `viewer`/`auditor` (esta rama no lo toca, pero confirma que no lo empeora)?

## Reporte
`.agents/reports/o4-rev-device-id.md`, máximo 15 líneas:
1. `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
2. Hallazgos `P1`/`P2`/`P3` con `archivo:línea`.
3. Qué no pudiste verificar (web typecheck/lint/test: 27/27 verde del orquestador; navegador real pendiente).
