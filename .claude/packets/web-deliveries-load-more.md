# web-deliveries-load-more · «Cargar más» en la pantalla de entregas

## Tarea
web-deliveries-load-more · **nivel C** (Codex L2, `-Base main`). Deuda de `deliveries-unassigned-tray` (HANDOFF 2026-10-05: la pantalla mantiene 100 sin «Cargar más»; también descarta `failed` del tray en cliente).

## Objetivo
Que «Por asignar» en `/app/deliveries` pagine con el cursor que ya devuelve `POST /branch-orders/tray` (`unassignedDeliveriesOnly: true`), con un botón «Cargar más» (44 px) como en `/app/orders`, y que la lista no pierda filas por descartar `failed` en cliente.

## Hechos verificados
- `apps/web/src/app/app/deliveries/page.tsx` pide el tray con `requestBranchOrderWorkTray(..., scope, null, 100, "delivery", { unassignedDeliveriesOnly: true })` (verificar firma en `apps/web/src/lib/branch-order-work-tray.ts`) y filtra `deliveryState === null` en cliente; la respuesta trae `nextCursor` (ver `BranchOrderWorkTrayV1`).
- `/app/orders` (`apps/web/src/app/app/orders/*`) ya implementa «Cargar más» con el cursor y refresco por foco: reutilizar ese patrón (componente cliente + server action).
- Las entregas `failed` ya aparecen en su columna «No realizadas» con versión; en «Por asignar» sólo deben verse las `deliveryState === null`, pero el filtro debe hacerse pidiendo páginas sucesivas hasta llenar la vista, no descartando y quedándose corto.

## Criterios de aceptación
- [ ] Con más de 100 órdenes por asignar aparece «Cargar más» y añade la siguiente página sin duplicados; con menos, no aparece.
- [ ] Las `failed` no ocupan huecos: si una página trae `failed`, se pide la siguiente automáticamente hasta tener ≥ 20 visibles o agotar el cursor.
- [ ] Helpers puros con prueba: fusión de páginas sin duplicados por `orderId`, decisión de «seguir cargando».
- [ ] Sin alert/confirm; targets 44 px; 390×844; consola limpia. Puertas: `pnpm --filter @super-restaurant/web lint && typecheck && test && build`.

## Invariantes
Sin tocar apps/api ni SQL; el servidor sigue filtrando; sin push.

## Formato de salida
Resumen (toques), archivos, salida literal, riesgos.
