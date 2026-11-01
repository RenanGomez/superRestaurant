# orders-tray-table-id · la bandeja de órdenes trae `tableId` para mostrar el nombre de la mesa

## Tarea
orders-tray-table-id · capa L1 `implementer-claude` · nivel B (contrato `BranchOrderWorkItemV1` en `packages/shared-types/src/branch-order-work-tray.ts` consumido por `apps/web`; lector en `apps/api`; sin SQL nuevo si la consulta ya puede leer `table_id` de la orden) · riesgo bajo-medio. Rama `claude/orders-tray-table-id` desde `main` (incluye 403554e). Un solo escritor; no tocar `apps/web/src/app/app/capture/**` ni `apps/web/src/app/app/menu/**` (otros paquetes activos).

## Contexto
`tables-orders-r1` (ya en `main`) muestra el nombre de la mesa en el detalle de la orden y en comanda/ticket con `tableNamesAction` + `tableLabel` (`apps/web/src/lib/orders-view.ts`). Las tarjetas de `apps/web/src/app/app/orders/orders-tray.tsx` siguen diciendo «Mesa» porque `BranchOrderWorkItemV1` no trae `tableId`. `OperationalWorkItem` (`operational-work-tray.ts:70`) sí lo trae y sirve de referencia para la invariante `dine_in ⇔ tableId !== null`.

## Cambios
1. `packages/shared-types`: `BranchOrderWorkItemV1.tableId: string | null` (opcional en entrada para productores viejos, `null` normalizado en salida; UUID validado). Invariante en el parser: `fulfillmentChannel === "table"` ⇔ `tableId !== null` sólo si el canal ya es parte del contrato; si no, aceptar `null` libremente. Actualizar `branch-order-work-tray.runtime.test.ts`.
2. `apps/api`: localizar con CodeGraph el productor de la bandeja (`branch-order-work-tray` / `orders.ts`) y añadir `tableId` desde la columna de la orden; sin migración si la columna existe. Actualizar sus tests y el contract/http test si hay.
3. `apps/web/src/app/app/orders/orders-tray.tsx`: las tarjetas de canal mesa usan `tableLabel(item.tableId, tableNames)`; el mapa `tableNames` ya lo carga `order-detail-panel`/`page.tsx` con `tableNamesAction`; elevarlo al componente que renderiza las tarjetas para no pedirlo dos veces. Fallback «Mesa».
4. CodeGraph antes y después: listar todos los consumidores de `BranchOrderWorkItemV1` (web, kds, mobile) y confirmar que compilan.

## Invariantes
Sin `any`, LF, sin cálculos en cliente, sin textos en inglés. El contrato se amplía de forma compatible (campo opcional en entrada).

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía corepack)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/api --filter=@super-restaurant/web`.
- Si `http://localhost:3000` y `:8082` responden y existe `apps/web/playwright/.auth/user.json`, comprobar que `/app/orders` muestra «Mesa 2» en la tarjeta de la cuenta abierta en Mesa 2 (existe en la base de desarrollo). Documentar la brecha si no.

## Formato de salida
Resumen, archivos, consumidores encontrados por CodeGraph, salida literal de las puertas, brecha, riesgos. Commit local `feat(orders): ...`. Sin merge ni push.
