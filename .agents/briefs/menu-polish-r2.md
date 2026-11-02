# menu-polish-r2 — implementar el paquete `.claude/packets/menu-polish-r2.md` (nivel C, escribe código)
Agente: Gemini   Nivel de rigor: C   Complejidad: Estándar

## Objetivo
Implementar completo el paquete `.claude/packets/menu-polish-r2.md` (léelo primero, es la especificación; también `AGENTS.md` §14 y §19.2 nivel C).

## Dónde trabajar (obligatorio)
1. Desde la raíz del repo ejecuta: `git worktree add "C:\tmp\sr-wt\menu-polish-r2" -b gemini/menu-polish-r2 main`.
2. Todos los cambios van dentro de `C:\tmp\sr-wt\menu-polish-r2`. **No edites nada en el checkout principal** (ahí corre el servidor de desarrollo).
3. Instala dependencias en el worktree si hace falta: Node 24 está en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; usa `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js" install --frozen-lockfile` y luego `... --filter "@super-restaurant/web^..." build` antes del typecheck.

## Archivos (editables)
- `apps/web/src/app/app/menu/**`, `apps/web/src/lib/menu-*.ts` y sus `*.test.ts`, `apps/web/package.json` sólo para registrar tests nuevos.
## Sólo lectura
- `packages/shared-types/src/index.ts`, `apps/web/src/lib/ui-classes.ts`, `apps/web/src/components/field-hint.tsx`, `apps/web/src/app/globals.css`.

## Restricciones e invariantes
Las del paquete: sin `any`, LF, español, sin `alert/confirm/prompt`, targets ≥ 44 px, no cambiar la forma del `draft`, no tocar `apps/api`, `packages/*`, SQL ni `apps/web/src/app/app/capture/**`. No hagas push ni merge.

## Criterios de aceptación
Los nueve puntos del paquete, con especial exigencia en la alineación de inputs (punto 5 y 9).

## Verificación (comandos exactos, en el worktree)
- `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js" turbo run lint typecheck test build --filter=@super-restaurant/web`
- Intenta `git -C "C:\tmp\sr-wt\menu-polish-r2" add -A && git -C "C:\tmp\sr-wt\menu-polish-r2" commit -m "fix(web-menu): polish round 2"`; si git falla por permisos, déjalo sin commit y dilo en el reporte.

## Formato de salida: reporte §8 en .agents/reports/menu-polish-r2.md
Incluye: resumen por punto (1-9), archivos, salida literal de las puertas, hash del commit o motivo de no commitear, brecha de navegador, riesgos. Máximo 80 líneas.
