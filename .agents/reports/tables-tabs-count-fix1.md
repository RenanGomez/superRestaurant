# tables-tabs-count-fix1 — hecha
Cambios: Restaurada la carga de detalle por cuenta (`details`, `loadDetails`, `totalLabel`) con `actions.detail` al seleccionar mesa o tras abrir cuenta; total en pestañas («Cuenta 1 · $130.00», «Juan · $130.00», «Cargando…» mientras llega) mediante `tabTotal` y `accountTabLabel`; total restaurado en la tarjeta activa; pestaña «+ Nueva» inmediatamente a la derecha de las cuentas.
Archivos: apps/web/src/app/app/tables/tables-board.tsx, apps/web/src/lib/tables-board.test.ts
Verificación: turbo run lint typecheck test build --filter=@super-restaurant/web → Pasa (12 exitosas); git diff --check → Pasa limpio.
Riesgos/pendientes: Ninguno. Verificación visual en navegador real pendiente por Emmanuel en /app/tables.
Notas: Commit 7012042b6d6883792244c3b24f13a78de55b1378 en rama gemini/tables-tabs-count (worktree C:\tmp\sr-wt\tables-tabs-count).
