# tables-tabs-count — pestaña «Nueva» en el diálogo de mesa y contador de cuentas sobre la mesa (escribe código)
Agente: Gemini   Nivel de rigor: C   Complejidad: Estándar

## Objetivo
Retroalimentación de Emmanuel (2026-11-02) en `/app/tables`:
1. En el diálogo de la mesa, las cuentas se muestran como **pestañas** (una por cuenta: «Cuenta 1 · $130», «Cuenta 2 · $0», con el nombre si tiene `accountLabel`), y a la derecha, pegada al total de la cuenta activa, una pestaña «+ Nueva» que abre otra cuenta ahí mismo (hoy es un botón al pie: «Abrir otra cuenta»). La pestaña activa muestra su tarjeta (estado, hora, mesero con «Mesero», «Nombre», «Ver cuenta»).
2. Sobre cada mesa del plano se muestra cuántas cuentas abiertas tiene (una insignia «2») además de lo que ya muestra.

## Dónde trabajar (obligatorio)
1. Desde la raíz del repo: `git worktree add "C:\tmp\sr-wt\tables-tabs-count" -b gemini/tables-tabs-count main`; edita sólo ahí. No edites el checkout principal.
2. Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm: `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js"`; `install --frozen-lockfile` y `--filter "@super-restaurant/web^..." build` antes del typecheck.

## Archivos (editables)
- `apps/web/src/app/app/tables/tables-board.tsx`, `apps/web/src/lib/tables-board.ts` y su test.
## Prohibido
- `apps/api`, `packages/*`, SQL, `apps/web/src/app/app/menu/**`, `capture/**`, `caja/**`.

## Restricciones e invariantes
Pestañas accesibles: `role="tablist"`, `role="tab"` con `aria-selected` y `aria-controls`, flechas izquierda/derecha, targets ≥ 44 px, foco visible; la pestaña «+ Nueva» es un botón con `aria-label="Abrir otra cuenta"`. Sin dinero calculado en cliente: los totales vienen del contrato `TableBoardActiveOrderV1` (si no trae total por cuenta, muestra sólo estado y hora y dilo en el reporte). Sin `any`, LF, español, sin `alert/confirm/prompt`. El contador sobre la mesa usa `activeOrders.length`.

## Criterios de aceptación
- Con dos cuentas, el diálogo muestra dos pestañas más «+ Nueva»; cambiar de pestaña cambia la tarjeta; «+ Nueva» crea sin salir del diálogo y selecciona la pestaña nueva.
- La mesa en el plano muestra «2» cuando tiene dos cuentas y nada cuando tiene cero.
- Helper puro con test: etiqueta de pestaña a partir de la cuenta (índice, `accountLabel`, total si existe).

## Verificación (en el worktree)
- `turbo run lint typecheck test build --filter=@super-restaurant/web`; `git diff --check`; commit `feat(web-tables): account tabs and open-account count`.

## Formato de salida: reporte §8 en .agents/reports/tables-tabs-count.md
Resumen, archivos, salida de puertas, hash, brecha de navegador. Máximo 50 líneas.
