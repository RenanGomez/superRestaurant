# menu-locked-ingredients — implementar el paquete A `.claude/packets/menu-locked-ingredients.md` (escribe código)
Agente: Gemini   Nivel de rigor: A   Complejidad: Compleja

## Objetivo
Implementar completo `.claude/packets/menu-locked-ingredients.md` (léelo primero; luego `.agents/reports/p2-locked-ingredients-research.md`, que es tu propia investigación con el inventario archivo:línea, la regla de mapeo y la consulta de dry-run; y `AGENTS.md` §9, §10, §11, §12, §19.2). Codex no está disponible por cuota; eres el implementador.

## Dónde trabajar (obligatorio)
1. Desde la raíz: `git worktree add "C:\tmp\sr-wt\menu-locked-ingredients-g" -b gemini/menu-locked-ingredients main` (main ≥ el merge de `menu-polish-r2`).
2. Todos los cambios dentro de ese worktree. **No edites el checkout principal.**
3. Dependencias: Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js" install --frozen-lockfile`; construye `packages/shared-types` y `packages/domain` antes de typecheck.
4. Trabaja por capas y commitea cada una en `gemini/menu-locked-ingredients`: (1) contratos+dominio, (2) SQL+invariantes+verificador+dry-run, (3) API, (4) web+mobile. Si git falla por permisos, dilo.

## Archivos (editables)
Los del alcance del paquete: `packages/shared-types/src/**`, `packages/domain/src/**`, `supabase/migrations/20261102000100_menu_locked_ingredients.sql` (nuevo), `supabase/tests/menu_locked_ingredients_invariants.sql` (nuevo), `apps/api/src/**`, `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (sólo `FractionEditor`), `apps/web/src/app/app/capture/product-sheet.tsx`, `apps/web/src/lib/line-halves.ts`, `menu-fraction.ts`, `menu-duplicate.ts`, `menu-draft-storage.ts`, `apps/mobile/src/**` si consume el campo, y tests.
## Prohibido
Aplicar en la base remota, push, merge, editar migraciones ya existentes.

## Restricciones e invariantes
Las del paquete. Las invariantes SQL empiezan con `begin;`, terminan con `rollback;` y no contienen `commit`. Sin `any`, LF (respeta CRLF donde ya exista), español, sin `alert/confirm/prompt`.

## Criterios de aceptación
Los siete puntos del alcance del paquete.

## Verificación (en el worktree)
- `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js" turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/domain --filter=@super-restaurant/api --filter=@super-restaurant/web --filter=@super-restaurant/mobile`
- `git diff --check`.
- El verificador local no podrá correr (sin Postgres local): documéntalo; el orquestador ejecuta migración + invariantes en remoto con rollback.

## Formato de salida: reporte §8 en .agents/reports/menu-locked-ingredients.md
Resumen por capa, archivos, salida literal de puertas, hashes, brechas, riesgos (en especial lectura de snapshots antiguos con etiquetas). Máximo 100 líneas.
