# web-caja-crash-and-split · error al cobrar + separar Cobro de Corte

## Tarea
web-caja-crash-and-split · capa L1 `implementer-claude` · **nivel C** (sólo `apps/web`; sin API ni SQL) · riesgo moderado (pantalla de cobro). Rama `claude/web-caja-crash-and-split` desde `main`. Dos commits separados: primero el error, luego la separación.

## Parte 1 — Error al entrar a cobrar (P1)
Emmanuel, 2026-10-11, al intentar cobrar (Órdenes → «Cobrar en caja» → `/app/caja?orderId=…`):
```
⨯ Error: Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined. You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.
[browser] Uncaught Error: Switched to client rendering because the server rendering errored
```
(log del web dev: `tmp/local-web-20261010.out.log`). Las peticiones a `/app/caja` de antes de las integraciones del 2026-10-10 respondían bien. Sospechosos por fecha: `1037f13` (variantes `ui-classes` en caja/payment-panel), `84cb919`/`74cdbff` (enlaces a `next/link` en órdenes), `04387e8`/`ae6fe9f`/`2f79fe7` (Field/CheckField/FieldHint «server-safe» usados desde `caja/page.tsx`, que es Server Component, e importados desde `components/field-hint.tsx` con `"use client"`), y `print-preview.tsx`.
- Encuentra la causa **reproduciéndola**: escribe una prueba que haga `renderToString` (react-dom/server) de los componentes de caja implicados (`PaymentPanel`, `PayableOrders`, `ReceiptPrintButton`, `CashierSubmitButton`, y las piezas de `page.tsx` que usan `Field`/`CheckField`/`FieldHint`) con datos mínimos, o un import-check que verifique que cada componente JSX usado en `apps/web/src/app/**` resuelve a una función/clase definida (detecta imports por defecto vs. nombrados y exports faltantes). Si no puedes reproducir así, documenta qué descartaste.
- Corrige la causa (no envolver en try/catch). La prueba queda en la cadena `test` para evitar regresiones.

## Parte 2 — Cobro separado de Corte
Hoy `/app/caja` muestra en una sola pantalla: abrir caja, cobro, «Corte X · vista operativa», movimientos y cierre. Un cajero que viene a cobrar una orden ve demasiado. Debe quedar:
- **`/app/caja` = Cobrar.** Con `?orderId=…`: sólo esa orden — resumen (líneas y total del servidor), panel de cobro (métodos, montos rápidos, cambio, propina, referencia), recibo/ticket al terminar y «Volver a órdenes». Sin `orderId`: lista de órdenes cobrables a un lado y el panel de cobro de la elegida al otro (mismo patrón de paneles que Órdenes). Si no hay caja abierta, un bloque compacto «Abre la caja para cobrar» con el formulario de apertura (fondo inicial) y nada más; tras abrir, sigue el cobro.
- **`/app/caja/corte` = Turno y corte.** Estado de la caja, Corte X (esperado por método, propinas, movimientos), entradas/salidas de efectivo y «Cerrar caja» con conteo y motivo si hay diferencia. Enlace visible desde Cobrar («Ver corte de caja») y entrada en la barra lateral bajo Caja o como pestaña «Cobrar | Corte» en el encabezado de ambas páginas.
- Mover, no reescribir: reutilizar los componentes, server actions, cookies (`CASH_REGISTER_COOKIE`, recibo firmado) e idempotencia actuales; ningún cálculo de dinero en el cliente (todo viene del servidor como hoy). Redirects de las server actions que hoy apuntan a `/app/caja` y pertenecen al corte (abrir/cerrar/movimientos) deben llevar a la página correcta.
- Usar variantes de `src/lib/ui-classes.ts`; la guarda `class-conflicts` sigue verde; sin `alert/confirm/prompt`; 44 px; móvil 390×844 una columna.

## Criterios de aceptación
- [ ] `/app/caja?orderId=…` renderiza en el servidor sin error (prueba de regresión de la parte 1 en verde y falla sin el arreglo).
- [ ] Cobrar con orden muestra sólo lo necesario para cobrar; el corte vive en `/app/caja/corte`.
- [ ] Abrir caja desde Cobrar cuando no hay caja abierta; cerrar caja sólo desde Corte.
- [ ] Helpers puros nuevos con prueba (p. ej. qué vista de caja mostrar según estado de caja y `orderId`).
- [ ] Puertas `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build` con Node 24.19.0 (`C:\Users\Emmanuel G\AppData\Local\Programs\node24`; `node "<node24>\node_modules\corepack\dist\pnpm.js"` con la ruta entre comillas). Si falta `node_modules`: `pnpm install --frozen-lockfile --offline` y build de `shared-types`; nunca `Remove-Item -Recurse` sobre node_modules.

## Archivos de entrada
`apps/web/src/app/app/caja/*` (page.tsx es grande: leer por rangos), `apps/web/src/components/field-hint.tsx`, `apps/web/src/app/app/print-preview.tsx`, `apps/web/src/app/app/app-nav.tsx`, `apps/web/src/lib/ui-classes.ts`, `apps/web/src/app/app/orders/orders-tray.tsx` (enlace «Cobrar en caja»).

## Invariantes
Sin API, SQL ni `packages/**`; dinero sólo del servidor (minor units + ISO); idempotencia de cobro intacta; no tocar `tables/**`, `dining-zone.tsx`, `menu/**`.

## Formato de salida
Causa raíz de la parte 1 (archivo:línea), resumen de la parte 2, archivos, salida literal de las puertas, riesgos. Commits convencionales; sin push.
