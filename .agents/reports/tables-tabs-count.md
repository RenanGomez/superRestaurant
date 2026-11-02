# tables-tabs-count — hecha
Cambios: Cuentas como pestañas accesibles en el diálogo con botón «+ Nueva» que crea y selecciona la nueva cuenta sin cerrar el diálogo; insignia sobre la mesa con contador de cuentas abiertas (`activeOrders.length`); helpers puros `accountTabLabel` y `tableOpenAccountsCount`.
Archivos: apps/web/src/app/app/tables/tables-board.tsx, apps/web/src/lib/tables-board.ts, apps/web/src/lib/tables-board.test.ts
Verificación: turbo run lint typecheck test build --filter=@super-restaurant/web → Pasa (12 exitosas); git diff --check → Pasa limpio.
Riesgos/pendientes: Ninguno. Brecha de navegador: pendiente de verificación visual por Emmanuel en /app/tables.
Notas: Commit d669430 en gemini/tables-tabs-count. Contrato TableBoardActiveOrderV1 no incluye total por cuenta; la tarjeta muestra sólo estado y hora según la restricción del brief.
