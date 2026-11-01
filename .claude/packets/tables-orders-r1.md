# tables-orders-r1 · abrir cuenta sin doble paso y nombre real de la mesa en las órdenes

## Tarea
tables-orders-r1 · capa L1 `implementer-claude` · nivel C (`apps/web/src/app/app/tables/tables-board.tsx`, `apps/web/src/app/app/orders/orders-tray.tsx`, `order-detail-panel.tsx`, `apps/web/src/lib/order-detail.ts`, `apps/web/src/lib/orders-view.ts`) · riesgo bajo. Rama `claude/tables-orders-r1` desde `main`. No tocar `apps/api`, `packages/*` ni SQL. Si el nombre de la mesa no viene en ningún contrato que la web ya reciba, documentarlo y parar esa parte: se abrirá un paquete de nivel B para el API.

## Hallazgos de Emmanuel (2026-11-01)
1. En `/app/tables`, al tocar una mesa libre aparece «Abrir cuenta»; al confirmar, la app navega a `/app/orders?orderId=…&addItem=1` y ahí **vuelve a ofrecer «Abrir cuenta»** (o un paso equivalente) en lugar de abrir directamente «Agregar producto». Reproducir primero: `tables-board.tsx` líneas 170–200 (`create`, `router.push`) y `orders-tray.tsx` líneas 50–70 (lectura de `?orderId` y `addItem`), `order-detail-panel.tsx` línea ~196.
2. En `/app/orders` las órdenes de mesa sólo dicen «Mesa», sin el nombre o número de la mesa. Confuso con varias mesas abiertas.
3. Emmanuel pide además un **nombre opcional de la cuenta** («a nombre de quién»). Eso requiere campo nuevo en Order y API: **no implementarlo aquí**; sólo dejar un `TODO` en el comentario del paquete de salida.

## Cambios
1. Diagnosticar por qué la vista de órdenes no abre «Agregar producto» al llegar con `addItem=1` recién creada la cuenta (carrera entre la navegación y la carga de la bandeja, o el detalle aún no incluye la orden nueva). Corregir para que al llegar desde Mesas la orden quede seleccionada y la hoja de «Agregar producto» abierta, sin pedir nada más. Si la orden aún no está en la bandeja, cargar el detalle por `orderId` directamente (ya existe `detail`).
2. Nombre de la mesa: buscar en los contratos que la web ya recibe (`OrderDetailV1`, bandeja de órdenes, `TablesBoardSnapshot` con `tables[].name`) de dónde sale el nombre. Si la bandeja de órdenes trae `tableId` y la página puede cargar el plano de mesas de la sucursal (misma server action que usa `/app/tables`), construir un mapa `tableId → name` y mostrar «Mesa 4» (o el nombre configurado) en las tarjetas de la bandeja, en el encabezado del detalle y en la vista previa de comanda/ticket si ya pintan «Mesa». Una sola petición al plano por carga de página, cacheada en estado; si falla, caer a «Mesa» como hoy.
3. Dejar el filtro «Mesa» de la bandeja igual.

## Invariantes
Sin `any`, LF, sin `alert/confirm/prompt`, sin textos en inglés, targets de 44 px. Ningún cálculo de dinero ni cambio de estado en cliente.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`)
- `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build`.
- Unitaria para el helper puro que etiqueta la mesa (`tableLabel(tableId, map)` → nombre o «Mesa»).
- Navegador si `http://localhost:8082` responde y hay `apps/web/playwright/.auth/user.json` en el checkout principal: abrir cuenta desde una mesa libre y comprobar que `/app/orders` muestra la orden con «Agregar producto» abierto y el nombre de la mesa. Documentar la brecha si no se pudo.

## Formato de salida
Resumen, diagnóstico del punto 1 con la causa exacta, archivos, salida literal de las puertas, brecha de verificación, riesgos. Commit local `fix(web-orders): ...`. Sin merge ni push.
