# web-orders-split-layout · Órdenes en paneles: detalle a la izquierda, lista o «Agregar producto» a la derecha

## Tarea
web-orders-split-layout · capa L1 `implementer-claude` · **nivel C** (sólo `apps/web`) · riesgo moderado (flujo mesa → cuenta → agregar producto). Rama `claude/web-orders-split-layout` desde `main`.

## Hallazgo de Emmanuel (2026-10-10, con capturas)
Al tocar una mesa y abrir su cuenta se llega a `/app/orders?orderId=…&addItem=1`: se abre el panel lateral «Agregar producto» (le gusta), pero el «Detalle de la orden» es un **modal** que queda tapado detrás de ese panel. La lista de órdenes es una cuadrícula de tarjetas.

## Cómo debe quedar (≥ 1024 px)
Tres estados de la página `/app/orders` (`page.tsx`, `orders-tray.tsx`, `order-detail-panel.tsx` de 613 líneas):
1. **Sin orden abierta:** la lista ocupa todo el ancho (cuadrícula actual).
2. **Orden abierta:** dos columnas. **Izquierda: Detalle de la orden** como panel en la página (no modal, sin overlay, sin focus trap de diálogo; con encabezado, botón «Cerrar detalle» y scroll propio). **Derecha: la lista de órdenes** en una columna (tarjetas compactas), con la orden abierta resaltada (borde de selección `--color-selected` o variante `selected` de `src/lib/ui-classes.ts`). Tocar otra tarjeta cambia el detalle.
3. **Agregando producto:** izquierda el detalle (sigue visible y se actualiza al agregar cada producto), derecha el panel «Agregar producto» en lugar de la lista. «Volver a la cuenta» cierra sólo «Agregar producto» y vuelve al estado 2 (detalle a la izquierda, lista a la derecha). «Cerrar detalle» vuelve al estado 1.
- Proporción sugerida: detalle ~40 %, derecha ~60 %, ambas a la altura de la ventana bajo la barra superior con scroll independiente; nada recortado.
- El estado vive en la URL (`?orderId=…` y `&addItem=1`) para que el flujo desde Mesas (`router.push('/app/orders?orderId=…&addItem=1')`) y recargar la página conserven la vista; usar `router.replace` al cambiar de estado para no llenar el historial; Atrás del navegador sale de Órdenes.
- Esc: si «Agregar producto» está abierto lo cierra; si no, cierra el detalle.

## Móvil (< 1024 px)
Una vista a la vez: lista → detalle a pantalla completa con «← Órdenes» → «Agregar producto» a pantalla completa con «← Cuenta». Mismos estados por URL.

## Conservar
Todas las acciones del detalle (agregar, enviar a cocina, cancelar línea, imprimir comanda/ticket, cobrar en caja), sus estados de carga/error y la idempotencia existente; búsqueda «/» del menú; pestañas Activas/Canceladas y filtros; refresco al volver a la pestaña. Usar variantes de `src/lib/ui-classes.ts`; la guarda `class-conflicts` debe seguir verde. De paso, los enlaces internos que sigan como `<a href>` en `orders-tray.tsx` (p. ej. «Cobrar en caja») pasan a `next/link`.

## Criterios de aceptación
- [ ] Mesa → Abrir cuenta: detalle visible a la izquierda y «Agregar producto» a la derecha, nada tapado.
- [ ] «Volver a la cuenta» deja detalle izquierda + lista derecha; «Cerrar detalle» deja la lista a todo el ancho.
- [ ] Agregar un producto actualiza el detalle sin cerrarlo.
- [ ] Recargar con `?orderId=…&addItem=1` reproduce la vista.
- [ ] Móvil 390×844: una vista a la vez con botones de regreso de 44 px.
- [ ] Helper puro para el estado de la vista desde la URL (`ordersView(params) → 'list' | 'detail' | 'adding'`) con prueba.
- [ ] Puertas `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build` con Node 24.19.0 (`C:\Users\Emmanuel G\AppData\Local\Programs\node24`; `node "<node24>\node_modules\corepack\dist\pnpm.js"` con la ruta entre comillas). Si falta `node_modules`: `pnpm install --frozen-lockfile --offline` y build de `shared-types`; nunca `Remove-Item -Recurse` sobre node_modules.

## Invariantes
Sin API, SQL ni `packages/**`; el cliente no calcula dinero (totales del servidor); sin `alert/confirm/prompt`; 44 px; no tocar `tables/**` ni `dining-zone.tsx`.

## Formato de salida
Resumen, archivos, salida literal de las puertas, riesgos. Commits convencionales; sin push.
