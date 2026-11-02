# order-account-name — terminar el paquete `.claude/packets/order-account-name.md` (nivel B, escribe código)
Agente: Gemini   Nivel de rigor: B   Complejidad: Estándar

## Objetivo
Terminar la implementación del paquete `.claude/packets/order-account-name.md` (léelo completo primero; también `AGENTS.md` §10, §12, §13, §19.2). Codex ya hizo la capa de contratos (`packages/shared-types`: `orders.ts`, `branch-order-work-tray.ts` y sus tests runtime) y se detuvo por cuota; su trabajo está commiteado en la rama `codex/order-account-name`.

## Dónde trabajar (obligatorio)
1. Desde la raíz del repo: `git worktree add "C:\tmp\sr-wt\order-account-name-g" -b gemini/order-account-name codex/order-account-name`.
2. Todos los cambios dentro de `C:\tmp\sr-wt\order-account-name-g`. **No edites el checkout principal.**
3. Dependencias: Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js" install --frozen-lockfile`, luego `... --filter "@super-restaurant/api^..." build` y `... --filter "@super-restaurant/web^..." build` antes de typecheck.
4. Revisa primero `git diff main..HEAD` para ver qué dejó Codex en los contratos y continúa desde ahí (SQL, verificador, API, web), respetando sus nombres (`accountLabel`, `SetOrderAccountLabelCommandV1`).

## Archivos (editables)
- `supabase/migrations/20261102000200_order_account_label.sql` (nuevo), `supabase/tests/order_account_label_invariants.sql` (nuevo)
- `apps/api/src/**` (orders, adaptador Postgres, controller, tests, `operations/run-order-account-label-schema-verification.ts`, `package.json` script)
- `apps/web/src/app/app/tables/**`, `apps/web/src/app/app/orders/**`, `apps/web/src/lib/orders-view.ts`, `apps/web/src/lib/print-documents.ts` y tests
- `packages/shared-types/src/**` sólo si falta algo en lo que hizo Codex
## Sólo lectura
- `supabase/migrations/*` anteriores (localiza con grep la última definición vigente de `assign_order_waiter`, `read_order`, `list_branch_order_work_items`, `read_table_board`), `AGENTS.md`.
## Prohibido
- `apps/web/src/app/app/menu/**`, `apps/web/src/app/app/capture/**`, aplicar nada en la base remota, push, merge.

## Restricciones e invariantes
Las del paquete: sin dinero; aislamiento por restaurante/sucursal en función y endpoint; auditoría obligatoria con from/to/actor/dispositivo/timestamp; `security definer`, `set search_path = ''`, owner postgres, EXECUTE sólo `app_api`; snapshots inmutables; campo opcional en entrada; sin `any`, LF, español, sin `alert/confirm/prompt`, targets ≥ 44 px. Las invariantes SQL empiezan con `begin;` y terminan con `rollback;`, sin `commit`.

## Criterios de aceptación
Los cinco puntos del paquete completos.

## Verificación (en el worktree)
- `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js" turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/api --filter=@super-restaurant/web` y `... --filter @super-restaurant/mobile typecheck`.
- El verificador local no podrá correr (no hay Postgres local): documéntalo; el orquestador ejecutará migración + invariantes en remoto con rollback.
- Intenta commitear por capas en `gemini/order-account-name` (`feat(db): …`, `feat(api): …`, `feat(web): …`); si git falla por permisos, dilo.

## Formato de salida: reporte §8 en .agents/reports/order-account-name.md
Resumen por capa, archivos, salida literal de puertas, hashes o motivo de no commitear, brechas, riesgos. Máximo 80 líneas.
