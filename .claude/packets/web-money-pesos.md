# web-money-pesos

## Tarea
web-money-pesos · capa: L2 (Codex) · riesgo: moderado · nivel C (`apps/web` páginas de menú y caja, componente `product-sheet.tsx`) + nivel B acotado (`apps/web/src/lib/capture-payment.ts` helper puro compartido; server actions de caja). Sin cambios en `apps/api`, `packages/*` ni SQL. Lote `lote-feedback-20261001` (a) y (b): hallazgos #3 #4 #8 #13 #25.

## Objetivo
Que ningún operador vea ni teclee «unidades menores», «u.m.» ni «ISO»: todo input de dinero de la web captura pesos con centavos opcionales («130», «130.50») y todo monto se muestra como «$130.00»; la moneda la decide el servidor; en caja se cobra eligiendo la orden de una lista, no pegando un UUID.

## Hechos verificados (main 7047fbe)
- `apps/web/src/app/app/menu/menu-catalog-editor.tsx:232` y `:297`: `NumberInput` con label «Precio (MXN, unidad menor)» y `value={unitPriceMinor}`; el operador escribe 130 y se guarda 130 centavos → la captura muestra $1.30. El estado inicial `unitPriceMinor: 0` (líneas 71, 82, 94) y el `NumberInput` controlado impiden borrar el cero.
- `apps/web/src/app/app/caja/page.tsx`: inputs texto con `pattern` numérico: apertura línea 140 («Fondo inicial · unidades menores»), pago 193 («Importe · unidades menores»), cierre 222 («Efectivo contado · unidades menores»), moneda 139 («Moneda ISO», `[A-Za-z]{3}`), campo «ID de la orden» línea 163 con placeholder «UUID de la cuenta»; `orderId` también llega por `?orderId=` (línea 55). Los server actions envían los enteros tal cual.
- Formato correcto sin float: `formatMinorUnits(amountMinor, currency)` en `apps/web/src/lib/branch-order-work-tray.ts:71-94` (BigInt). Formato incorrecto con división float: `money()` en `apps/web/src/app/app/capture/product-sheet.tsx:125`.
- Parser exacto pesos→centavos ya existe: `parseMoneyInputToMinor(text)` en `apps/web/src/lib/capture-payment.ts:18-28` (aritmética entera, con pruebas en `capture-payment.test.ts`). No se usa en menú ni caja.
- Contratos: `OpenCashRegisterCommandV1` (`packages/shared-types/src/payments.ts:15-22`) exige `currency`; `CheckoutOrderSummaryV1` y `CashRegisterSummaryV1` devuelven `currency`. El menú ya recibe `currency` del release (prop `currency` en el editor). La lista de órdenes cobrables se obtiene con `requestBranchOrderWorkTray` (`branch-order-work-tray.ts:16-40`, `POST /branch-orders/tray`) filtrando `isPayableBranchOrderWorkStatus` (`open`, `partially_paid`).

## Criterios de aceptación (verificables)
- [ ] **Menú**: los precios de producto y de opción de modificador se capturan en pesos con un input de texto `inputMode="decimal"` (acepta «130», «130.5», «130.50»; rechaza letras, negativos y más de dos decimales con mensaje claro bajo el campo); el estado interno sigue siendo `unitPriceMinor` entero (convertir con `parseMoneyInputToMinor` al salir del campo o al cambiar; nunca `Number(x)/100` ni `*100` con float). El campo se puede vaciar y volver a escribir (sin cero pegado). Etiqueta «Precio» y valor mostrado «$130.00» con `formatMinorUnits`. La descripción de la sección deja de hablar de «unidad monetaria menor».
- [ ] **Caja**: fondo inicial, importe de cobro y efectivo contado se capturan en pesos igual que arriba; los server actions convierten con `parseMoneyInputToMinor` y rechazan con mensaje si el texto no es válido. El campo «Moneda ISO» desaparece: `currency` se toma del restaurante/sucursal (buscar de dónde lo recibe ya la web: release del menú, `CheckoutOrderSummaryV1` o config de la sucursal; si no hay fuente en la página de apertura, usar «MXN» como valor fijo documentado en una constante y ocultarlo). Todos los montos visibles («Efectivo esperado», totales del corte, cambio) se muestran con `formatMinorUnits`, nunca «u.m.».
- [ ] **Caja sin UUID**: el panel «Cargar cuenta» muestra la lista de órdenes cobrables de la sucursal (nombre o etiqueta de cliente, canal, hora, total) con un botón «Cobrar» por fila que carga la cuenta; conserva `?orderId=` desde `/app/orders`. Sin campo de UUID visible (puede quedar un enlace «Pegar identificador» colapsado para soporte).
- [ ] **product-sheet.tsx**: sustituir `money()` por `formatMinorUnits`.
- [ ] Helpers puros nuevos (si los hay) con pruebas node:test; `parseMoneyInputToMinor` ampliado sólo si hace falta (p. ej. aceptar coma decimal) con pruebas.
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; 390×844 sin scroll horizontal; consola limpia.

## Invariantes que NO deben cambiar
- El servidor calcula y revalida todo el dinero; la web sólo convierte texto a enteros de centavos con parseo exacto y formatea para mostrar.
- Contratos del API intactos (`unitPriceMinor`, `amountMinor`, `currency`).
- Nada de float en dinero.

## Fuera de alcance
- Fotos del menú, SKU (paquete `web-menu-labels`), captura (paquete `web-capture-feedback`), API y SQL.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```
El orquestador verifica en navegador real (escritorio y 390×844).

## Formato de salida esperado
1. Resumen (3-6 líneas). 2. Archivos tocados. 3. Salida literal de los comandos. 4. Riesgos o dudas. Sin diffs completos. No hagas commit: el orquestador commitea tu worktree.
